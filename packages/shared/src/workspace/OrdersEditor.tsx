import type { OrderDiagnostic } from "@atlantis/core-client";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { Annotation, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { minimalChange } from "../editorReconcile";
import { orderCommandCompletions } from "../orderCompletion";
import { toEditorDiagnostics } from "../orderLint";

/** What the shell may do to the editor from outside: shortcut work lands on these two. */
export type OrdersEditorHandle = {
  focus(): void;
  /** Puts the selection on a span and scrolls it into view - how "jump to problem" arrives. */
  select(from: number, to?: number): void;
};

type OrdersEditorProps = {
  /** Whose orders these are. A different unit is a different document and a different history. */
  unitId: string;
  value: string;
  ariaLabel: string;
  /** This unit's diagnostics, lines counted from the top of its block as `diagnosticsForUnit` re-bases them. */
  problems: OrderDiagnostic[];
  /** The core's order vocabulary, for the completion popup. Empty until fetched, which just keeps it quiet. */
  commands: readonly string[];
  onChange: (text: string) => void;
};

/**
 * Marks a transaction as the document coming back from outside, so the update listener does not
 * echo it into `onChange` - it came from there.
 */
const External = Annotation.define<boolean>();

/**
 * The keys the editor claims, and deliberately not all of them.
 *
 * Alt-Arrow moves lines in stock CodeMirror and will mean "next/previous unit" here; F8 walks
 * diagnostics in stock `lintKeymap` and will mean the same thing faction-wide. Neither stock
 * binding is installed, so the global shortcut layer (#91) can own those keys without fighting
 * the editor for them.
 */
const editingKeymap = defaultKeymap.filter(
  (binding) => binding.key !== "Alt-ArrowUp" && binding.key !== "Alt-ArrowDown"
);

/**
 * The orders editor: CodeMirror, one unit's block at a time.
 *
 * The document flows in as a plain string and edits flow out the same way, so the panel's draft
 * state machine neither knows nor cares that the textarea is gone. What changed underneath is how
 * the two stay reconciled: an external update is dispatched as the smallest splice that turns the
 * shown text into the given one, and CodeMirror maps the selection through it - which is what the
 * old `keepCaret` bookkeeping existed to fake.
 *
 * Keyed on the unit by recreating the whole editor state: history lives in the state, so undo in
 * one unit's editor can never rewind into another unit's text.
 */
export const OrdersEditor = forwardRef<OrdersEditorHandle, OrdersEditorProps>(function OrdersEditor(
  { unitId, value, ariaLabel, problems, commands, onChange },
  ref
) {
  const container = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);

  // Read through refs by the editor's callbacks, so a fresh render never means a rebuilt editor.
  const latest = useRef({ value, ariaLabel, commands, onChange });
  latest.current = { value, ariaLabel, commands, onChange };

  useLayoutEffect(() => {
    const parent = container.current;
    if (!parent) {
      return;
    }

    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          history(),
          keymap.of([...editingKeymap, ...historyKeymap]),
          autocompletion({
            override: [
              (context) => orderCommandCompletions(latest.current.commands)(context)
            ]
          }),
          lintGutter(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }
            if (update.transactions.every((transaction) => transaction.annotation(External))) {
              return;
            }
            latest.current.onChange(update.state.doc.toString());
          }),
          EditorView.contentAttributes.of({
            "aria-label": latest.current.ariaLabel,
            spellcheck: "false",
            autocapitalize: "off",
            autocorrect: "off"
          }),
          // Colours come from the app's own tokens rather than CodeMirror's built-in light
          // theme, so the popup, gutter and cursor follow `data-theme` like everything else.
          // Tokens, not hex literals: theme.test.ts's rule holds in spirit for injected styles
          // its component scan cannot see.
          EditorView.theme({
            "&": { height: "100%", fontSize: "11.5px", color: "var(--color-ink)" },
            ".cm-scroller": { fontFamily: "inherit" },
            "&.cm-focused": { outline: "none" },
            ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-ink)" },
            ".cm-gutters": {
              backgroundColor: "transparent",
              color: "var(--color-ink-dim)",
              border: "none"
            },
            ".cm-tooltip": {
              backgroundColor: "var(--color-panel-raised)",
              color: "var(--color-ink)",
              border: "1px solid var(--color-edge)"
            },
            ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
              backgroundColor: "var(--color-select)",
              color: "var(--color-ground)"
            },
            ".cm-lintRange-error": {
              textDecorationColor: "var(--color-danger)"
            },
            ".cm-lintRange-warning": {
              textDecorationColor: "var(--color-warn)"
            }
          })
        ]
      })
    });

    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
  }, [unitId]);

  // The document coming back from outside: usually the editor's own text a moment later, so
  // usually a no-op. When it differs, the smallest splice keeps the caret where the player put it.
  useEffect(() => {
    const editor = view.current;
    if (!editor) {
      return;
    }
    const change = minimalChange(editor.state.doc.toString(), value);
    if (change) {
      // Kept out of the undo history as well as out of `onChange`: the document coming back is
      // not something the player did, so undo must never replay it - recording it made Ctrl+Z
      // able to write one unit's orders into another unit's block.
      editor.dispatch({
        changes: change,
        annotations: [External.of(true), Transaction.addToHistory.of(false)]
      });
    }
  }, [value, unitId]);

  // Diagnostics are pushed rather than pulled: validation already runs debounced in the shell,
  // and CodeMirror's own lint scheduler would only add a second debounce on top of it.
  useEffect(() => {
    const editor = view.current;
    if (!editor) {
      return;
    }
    editor.dispatch(
      setDiagnostics(editor.state, toEditorDiagnostics(editor.state.doc.toString(), problems))
    );
  }, [problems, value, unitId]);

  useImperativeHandle(ref, () => ({
    focus() {
      view.current?.focus();
    },
    select(from, to = from) {
      const editor = view.current;
      if (!editor) {
        return;
      }
      const end = editor.state.doc.length;
      const anchor = Math.min(from, end);
      const head = Math.min(to, end);
      editor.dispatch({
        selection: { anchor, head },
        scrollIntoView: true
      });
      editor.focus();
    }
  }));

  return (
    <div
      ref={container}
      data-testid="orders-input"
      className="min-h-0 w-full flex-1 overflow-hidden rounded border border-edge bg-ground font-mono text-ink focus-within:border-select"
    />
  );
});
