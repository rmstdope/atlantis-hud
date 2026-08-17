import type { OrderDiagnostic } from "@atlantis/core-client";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, redo } from "@codemirror/commands";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { Annotation, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { minimalChange } from "../editorReconcile";
import { shownUnitText } from "../orderEditor";
import { orderArgumentCompletions, orderCommandCompletions, type CaretLookup } from "../orderCompletion";
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
  /**
   * The unit's block as the document holds it. Read when the editor is created for a unit and
   * again whenever `externalRevision` moves; ignored otherwise - between those moments the
   * editor's own text is the truth and the document is a step behind it.
   */
  text: string;
  /** Moves when something other than this editor wrote the document. See `OrdersOrigin`. */
  externalRevision: number;
  /**
   * When the document last landed on disk, or null. A landed save ends the shown text with the
   * newline an orders file ends with (`shownUnitText`) - in the editor only, never written back.
   */
  savedAt: string | null;
  ariaLabel: string;
  /** This unit's diagnostics, lines counted from the top of its block as `diagnosticsForUnit` re-bases them. */
  problems: OrderDiagnostic[];
  /** The core's order vocabulary, for the completion popup. Empty until fetched, which just keeps it quiet. */
  commands: readonly string[];
  /** The player's snippet library, offered in the same popup and expanded with tab-through fields. */
  snippets: readonly OrderSnippet[];
  /** What may stand at an argument position, asked of the core once per half-typed word. */
  caretCompletions: CaretLookup;
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
 * `text` flows in from the document and is read at creation and again on `externalRevision`;
 * edits flow out through `onChange`. The editor is never handed its own text back - it owns the
 * selected unit's text while it is on screen and writes the document but does not read it back
 * into itself, so there is no reconciliation of echoes here any more. Only a genuine external
 * update - an import, a restore, a route from the planner - is applied, as the smallest splice
 * that turns the shown text into the given one; CodeMirror maps the selection through it.
 *
 * Keyed on the unit by recreating the whole editor state: history lives in the state, so undo in
 * one unit's editor can never rewind into another unit's text.
 */
export const OrdersEditor = forwardRef<OrdersEditorHandle, OrdersEditorProps>(function OrdersEditor(
  {
    unitId,
    text,
    externalRevision,
    savedAt,
    ariaLabel,
    problems,
    commands,
    snippets,
    caretCompletions,
    onChange
  },
  ref
) {
  const container = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);

  // Read through refs by the editor's callbacks, so a fresh render never means a rebuilt editor.
  const latest = useRef({ text, ariaLabel, savedAt, commands, snippets, caretCompletions, onChange });
  latest.current = { text, ariaLabel, savedAt, commands, snippets, caretCompletions, onChange };

  useLayoutEffect(() => {
    const parent = container.current;
    if (!parent) {
      return;
    }

    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: shownUnitText(latest.current.text, latest.current.savedAt),
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
              (context) =>
                orderCommandCompletions(
                  latest.current.commands,
                  latest.current.caretCompletions
                )(context),
              (context) =>
                snippetCompletionSource(
                  latest.current.snippets,
                  latest.current.caretCompletions
                )(context),
              (context) => orderArgumentCompletions(latest.current.caretCompletions)(context)
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
            "&": { height: "100%", fontSize: "var(--text-pane)", color: "var(--color-ink)" },
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
            // Second pass at gh-205: the mockup session (2026-08-15,
            // docs/ui/orders-editor-left-edge.html) chose variant 2b - a 3px full-height bar,
            // gutter shrunk to hug it, whole left edge budgeted at 6px. Px, not em: the budget
            // is exact and em rendering at this 11.5px font differs across engines.
            ".cm-gutter-lint": {
              width: "3px",
              "& .cm-gutterElement": { padding: "0" }
            },
            // The stock marker is a data: SVG dot, which cannot see CSS variables - the last
            // hardcoded colour in the editor's chrome. Paint a bar instead: full line height,
            // themed, no image.
            ".cm-lint-marker": {
              content: "none",
              width: "3px",
              height: "100%",
              borderRadius: "1px"
            },
            // Named explicitly rather than relying on source order beating the stock
            // `-error`/`-warning` icon rules (both compile to equal-specificity selectors, and
            // `.cm-lint-marker` above only wins because EditorView.baseTheme mounts at
            // Prec.lowest) - a future CodeMirror version could remount that precedence and
            // silently bring the hardcoded dot back.
            ".cm-lint-marker-error": { content: "none", backgroundColor: "var(--color-danger)" },
            ".cm-lint-marker-warning": { content: "none", backgroundColor: "var(--color-warn)" },
            // CodeMirror's base theme reserves 6px here; the mockup's budget only holds with
            // this trimmed too, alongside the gutter and marker above.
            ".cm-line": { paddingLeft: "2px" },
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

  // A write from outside - an import, a restore, a route from the planner - and only that: the
  // editor's own writes never come back through here (see OrdersOrigin), so there is no echo to
  // tell from a real change and nothing to rewind. Applied as the smallest splice so the caret
  // stays where the player put it; kept out of the undo history because the player did not do it.
  // The text spliced in is already what the editor should show, so nothing runs after this to
  // finish the job.
  useEffect(() => {
    const editor = view.current;
    if (!editor) {
      return;
    }
    const change = minimalChange(
      editor.state.doc.toString(),
      shownUnitText(latest.current.text, latest.current.savedAt)
    );
    if (change) {
      editor.dispatch({
        changes: change,
        annotations: [External.of(true), Transaction.addToHistory.of(false)]
      });
    }
  }, [externalRevision, unitId]);

  // Once a save has landed, the shown text ends with the newline an orders file ends with. In the
  // editor only: the block boundary neither holds nor needs it, so the document is not written
  // (External, and not history either). An append at the end never moves a caret that is anywhere
  // else - what persistence.spec pins.
  useEffect(() => {
    const editor = view.current;
    if (!editor) {
      return;
    }
    const current = editor.state.doc.toString();
    const wanted = shownUnitText(current, savedAt);
    if (wanted !== current) {
      editor.dispatch({
        changes: { from: current.length, to: current.length, insert: "\n" },
        annotations: [External.of(true), Transaction.addToHistory.of(false)]
      });
    }
  }, [savedAt, unitId]);

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
