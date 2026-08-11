import type { OrderDiagnostic } from "@atlantis/core-client";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, redo } from "@codemirror/commands";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { Annotation, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { minimalChange } from "../editorReconcile";
import { orderCommandCompletions } from "../orderCompletion";
import { toEditorDiagnostics } from "../orderLint";
import { snippetCompletionSource, type OrderSnippet } from "../orderSnippets";

/** What the shell may do to the editor from outside: the shortcut layer lands here. */
export type OrdersEditorHandle = {
  focus(): void;
  /** Puts the selection on a span and scrolls it into view. */
  select(from: number, to?: number): void;
  /**
   * Selects the text a diagnostic points at - the F8 walk's landing. The problem arrives in
   * block-relative lines, exactly as `diagnosticsForUnit` and `diagnosticTargets` speak.
   */
  selectProblem(problem: OrderDiagnostic): void;
  /** Types a command at the cursor, for the palette's order-help entries. */
  insertOrder(command: string): void;
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
  /** The player's snippet library, offered in the same popup and expanded with tab-through fields. */
  snippets: readonly OrderSnippet[];
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
  { unitId, value, ariaLabel, problems, commands, snippets, onChange },
  ref
) {
  const container = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  // Every text this editor has handed to `onChange` and not yet heard back, oldest first, so
  // its own echoes can be told from real external updates. The round trip through React is
  // asynchronous: under load, `value` lags the document by several commits, and dispatching a
  // lagging echo threw the document backwards - the burst of mutations a whole-draft
  // replacement produces arrived faster than the commits echoing them (caught by CI machines
  // slow enough to interleave them). A queue rather than one remembered text, because the echo
  // that arrives can be any of the unacknowledged ones, not only the newest.
  const pendingEchoes = useRef<string[]>([]);

  // Read through refs by the editor's callbacks, so a fresh render never means a rebuilt editor.
  const latest = useRef({ value, ariaLabel, commands, snippets, onChange });
  latest.current = { value, ariaLabel, commands, snippets, onChange };

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
          // Mod-Shift-z redoes on every platform, deliberately beyond what historyKeymap
          // binds: its stock redo bindings are platform variants (mac Mod-Shift-z, a
          // linux-only Ctrl-Shift-z), and windows users expect the chord too. preventDefault
          // stands even when there is nothing to redo, so the browser's native contenteditable
          // history - which replays DOM records from before CodeMirror rewrote the surface -
          // can never answer it.
          keymap.of([
            ...editingKeymap,
            ...historyKeymap,
            { key: "Mod-Shift-z", run: redo, preventDefault: true }
          ]),
          autocompletion({
            override: [
              (context) => orderCommandCompletions(latest.current.commands)(context),
              (context) => snippetCompletionSource(latest.current.snippets)(context)
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
            const text = update.state.doc.toString();
            pendingEchoes.current.push(text);
            // Bounded: an acknowledgement that never comes must not become a leak.
            if (pendingEchoes.current.length > 128) {
              pendingEchoes.current.shift();
            }
            latest.current.onChange(text);
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
            // The native caret, which is what an editor without drawSelection actually shows.
            // CodeMirror's base styles paint it black unless the theme says otherwise, and
            // black on the dark theme's ground is invisible.
            ".cm-content": { caretColor: "var(--color-ink)" },
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
    // A fresh unit is a fresh conversation: nothing has been emitted yet.
    pendingEchoes.current = [];
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
    // The editor's own words coming back are never applied, however stale: while the player
    // types, `value` lags the document by however many commits React is behind, and splicing a
    // lagging echo in rewound the editor to text the player had already left. Hearing an echo
    // acknowledges it and everything emitted before it. Only a value the editor never emitted
    // is genuinely external.
    const echoed = pendingEchoes.current.indexOf(value);
    if (echoed >= 0) {
      pendingEchoes.current.splice(0, echoed + 1);
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
      // A genuinely external update supersedes whatever was in flight; the applied text is as
      // good as emitted, so hearing it back later is an echo like any other.
      pendingEchoes.current = [value];
    }
  }, [value, unitId]);

  // Diagnostics are pushed rather than pulled: validation already runs debounced in the shell,
  // and CodeMirror's own lint scheduler would only add a second debounce on top of it. Only when
  // the problems themselves move - the lint extension maps the spans it holds through document
  // changes on its own, so re-dispatching per keystroke would be a transaction for nothing.
  useEffect(() => {
    const editor = view.current;
    if (!editor) {
      return;
    }
    editor.dispatch(
      setDiagnostics(editor.state, toEditorDiagnostics(editor.state.doc.toString(), problems))
    );
  }, [problems, unitId]);

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
    },
    selectProblem(problem) {
      const editor = view.current;
      if (!editor) {
        return;
      }
      // The same mapping the lint gutter uses, so the walk lands exactly where the underline
      // is - clamping included, for a diagnostic a keystroke behind the document.
      const [placed] = toEditorDiagnostics(editor.state.doc.toString(), [problem]);
      if (!placed) {
        return;
      }
      editor.dispatch({
        selection: { anchor: placed.from, head: placed.to },
        scrollIntoView: true
      });
      editor.focus();
    },
    insertOrder(command) {
      const editor = view.current;
      if (!editor) {
        return;
      }
      const { from, to } = editor.state.selection.main;
      editor.dispatch({
        changes: { from, to, insert: command },
        selection: { anchor: from + command.length },
        scrollIntoView: true,
        userEvent: "input"
      });
      editor.focus();
    }
  }));

  return (
    <div
      ref={container}
      data-testid="orders-input"
      // Whether the completion popup has anything to offer yet: the vocabulary arrives from the
      // core asynchronously, and a test typing before it lands would get silence and no way to
      // tell why. Observable state, not decoration.
      data-commands-ready={commands.length > 0}
      className="min-h-0 w-full flex-1 overflow-hidden rounded border border-edge bg-ground font-mono text-ink focus-within:border-select"
    />
  );
});
