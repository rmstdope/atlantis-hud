import type { OrderDiagnostic } from "@atlantis/core-client";
import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, redo } from "@codemirror/commands";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { Annotation, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, tooltips } from "@codemirror/view";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef
} from "react";
import { minimalChange } from "../editorReconcile";
import { buildVocabulary, keywordJustFinished } from "../orderCase";
import {
  contentChanges,
  lineDepths,
  tidyInsertion,
  trailingNewlineChange
} from "../orderIndent";
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
  /** Whether keywords uppercase themselves as they are typed (the Order OCD setting, ah-bn6.2). */
  orderOcd: boolean;
  /** Every word the rules know, uppercase, as `client.orderVocabulary` gives them. */
  orderVocabulary: readonly string[];
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
    orderOcd,
    orderVocabulary,
    snippets,
    caretCompletions,
    onChange
  },
  ref
) {
  const container = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);

  // Read through refs by the editor's callbacks, so a fresh render never means a rebuilt editor.
  // The set is derived here rather than in the extension: the editor is built once per unit, so
  // anything it reads must come through `latest` or it freezes at whatever it was on mount.
  const vocabulary = useMemo(() => buildVocabulary(orderVocabulary), [orderVocabulary]);
  const latest = useRef({
    text,
    ariaLabel,
    savedAt,
    commands,
    orderOcd,
    vocabulary,
    snippets,
    caretCompletions,
    onChange
  });
  latest.current = {
    text,
    ariaLabel,
    savedAt,
    commands,
    orderOcd,
    vocabulary,
    snippets,
    caretCompletions,
    onChange
  };

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
          // Order OCD, as the word ends: the space or newline that finishes a keyword uppercases
          // it in the same transaction that inserts the space, so one Ctrl+Z puts back both.
          // Never annotated External - this change must reach onChange and be saved.
          EditorView.inputHandler.of((editor, from, to, inserted) => {
            if (!latest.current.orderOcd) {
              return false;
            }
            if (from !== to || (inserted !== " " && inserted !== "\n")) {
              return false;
            }
            const line = editor.state.doc.lineAt(from);
            const found = keywordJustFinished(line.text, from - line.from, latest.current.vocabulary);
            if (!found) {
              return false;
            }
            editor.dispatch({
              changes: [
                { from: line.from + found.from, to: line.from + found.to, insert: found.upper },
                { from, to: from, insert: inserted }
              ],
              selection: { anchor: from + inserted.length }
              // Deliberately no `input.type` user event: that is what history joins runs of
              // typing under, and joined here one Ctrl+Z would swallow the whole word instead of
              // handing it back as it was typed. Its own step is the single-press promise.
            });
            return true;
          }),
          // Mod-Shift-z redoes on every platform, deliberately beyond what historyKeymap
          // binds: its stock redo bindings are platform variants (mac Mod-Shift-z, a
          // linux-only Ctrl-Shift-z), and windows users expect the chord too. preventDefault
          // stands even when there is nothing to redo, so the browser's native contenteditable
          // history - which replays DOM records from before CodeMirror rewrote the surface -
          // can never answer it.
          keymap.of([
            // Order OCD, as a line ends: the new line opens at the depth the block puts it at.
            // Ahead of `editingKeymap` so it beats `insertNewlineAndIndent`; the completion popup's
            // own Enter binding sits at a higher precedence still, so accepting a completion is
            // unaffected.
            {
              key: "Enter",
              run: (editor: EditorView) => {
                if (!latest.current.orderOcd) {
                  return false;
                }
                const { from, to } = editor.state.selection.main;
                // The depth the *next* line will sit at. `lineDepths` reports an opener at the
                // depth outside its own block, so asking it about a hypothetical empty line
                // appended after the caret turns "the caret is on a FORM line" into "the next line
                // is one level deeper". Computed from the text before the caret only, which is what
                // makes the answer right while the block below is still being written.
                const depth = lineDepths(`${editor.state.doc.sliceString(0, from)}\n`).at(-1) ?? 0;
                const insert = `\n${" ".repeat(depth)}`;
                // A keymap binding dispatches its own transaction, so the `inputHandler` above -
                // which shouts the word a space or newline has just finished - never sees this
                // newline. Shouting here keeps the setting's promise for the word Enter ends, and
                // in the same transaction, so one Ctrl+Z still hands the line back as it was typed.
                const line = editor.state.doc.lineAt(from);
                const finished = keywordJustFinished(
                  line.text,
                  from - line.from,
                  latest.current.vocabulary
                );
                // The depth *this* line sits at, from the same walk one character earlier: without
                // the appended newline the last entry is the caret's own line, computed from the
                // text as it now reads. Typing `end` inside a FORM turns the line into a closer,
                // whose depth is the one outside the block - so the line the player is leaving is
                // usually moved *left*, and the general rule covers any other line whose depth
                // changed as it was typed (ah-rj96).
                const ownDepth = lineDepths(editor.state.doc.sliceString(0, from)).at(-1) ?? 0;
                const indent = line.text.length - line.text.trimStart().length;
                const wanted = " ".repeat(ownDepth);
                // A blank line is left truly empty, as the whole-block tidy leaves it, and an
                // already-correct line produces no change at all: an empty change still makes a
                // history entry, and one Ctrl+Z would then hand back nothing visible.
                const reindent =
                  line.text.trim() !== "" && line.text.slice(0, indent) !== wanted
                    ? { from: line.from, to: line.from + indent, insert: wanted }
                    : null;
                editor.dispatch({
                  changes: [
                    // First: CodeMirror wants ascending, non-overlapping changes, and the leading
                    // whitespace sits ahead of the word the case fix covers.
                    ...(reindent ? [reindent] : []),
                    ...(finished
                      ? [
                          {
                            from: line.from + finished.from,
                            to: line.from + finished.to,
                            insert: finished.upper
                          }
                        ]
                      : []),
                    { from, to, insert }
                  ],
                  // `from` is a position in the *old* document and a dedent deletes characters
                  // before it, so the anchor carries the indent's delta: a transaction's selection
                  // is read against the new document, and the arithmetic alone would leave the
                  // caret one column adrift per level removed.
                  selection: { anchor: from + (reindent ? wanted.length - indent : 0) + insert.length },
                  scrollIntoView: true,
                  // Ordinary typing, so history groups a run of it as usual - and one Ctrl+Z takes
                  // back the newline and its indent together, in the one transaction.
                  userEvent: "input"
                });
                return true;
              }
            },
            ...editingKeymap,
            ...historyKeymap,
            { key: "Mod-Shift-z", run: redo, preventDefault: true }
          ]),
          // The completion popup is wider than this pane for most of the ruleset's catalogue (96
          // skills, whose names are the longest strings it shows), and the editor's own element is
          // `overflow-hidden`, so a popup rendered inside it is cut off border and all (ah-e4v).
          // Hosting it on `document.body` lets it overhang the panes to its right, which is what
          // every code editor's completion does; CodeMirror keeps it inside the viewport itself, so
          // near the window's right edge it shifts left rather than running off (the navigator's
          // R1, 2026-08-17). `position: "fixed"` because the host is no longer an ancestor that
          // scrolls with the editor.
          tooltips({ parent: document.body, position: "fixed" }),
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
          // Order OCD, as text lands: a paste is shouted and re-indented in the transaction that
          // inserts it, so the setting stays true of everything on screen and one Ctrl+Z still
          // removes the whole block. Declining leaves the browser's own paste exactly as it is.
          EditorView.domEventHandlers({
            paste(event, editor) {
              if (!latest.current.orderOcd || latest.current.vocabulary.size === 0) {
                return false;
              }
              const text = event.clipboardData?.getData("text/plain");
              if (!text) {
                return false;
              }
              const { from, to } = editor.state.selection.main;
              const base = lineDepths(editor.state.doc.sliceString(0, from)).at(-1) ?? 0;
              const insert = tidyInsertion(text, base, latest.current.vocabulary);
              event.preventDefault();
              editor.dispatch({
                changes: { from, to, insert },
                selection: { anchor: from + insert.length },
                scrollIntoView: true,
                userEvent: "input.paste"
              });
              return true;
            }
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
              border: "1px solid var(--color-edge)",
              // Above every pane (z-10 and z-20 in this workspace) and below the unit tooltip
              // (z-50). No modal is open while the editor has focus, so it never has to fight one.
              zIndex: "30"
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

  // The tidy E3 promises, run whenever it *can* run rather than only at mount. The vocabulary
  // arrives from the core asynchronously, so the first editor created after a page load is built
  // against an empty set and would otherwise never be tidied (ah-1znc). Keyed on the vocabulary and
  // the setting as well as the unit, so the same effect catches the setting being turned on with a
  // unit already open, and a ruleset switch bringing a new catalogue. Keyed on `externalRevision`
  // too, and declared after the effect that reads it, so a draft restored asynchronously after a
  // reload is tidied once it is actually in the document rather than while the editor is empty.
  useEffect(() => {
    const editor = view.current;
    if (!editor || !orderOcd || vocabulary.size === 0) {
      return;
    }
    // The word the caret is inside is left as typed: while typing, this setting only shouts a word
    // as the space ends it, and a late tidy must not break that promise. Unfocused there is no
    // caret to protect - and selecting a unit row does not focus the editor, so that is the common
    // case, not the exotic one.
    const protect = editor.hasFocus ? editor.state.selection.main.head : null;
    const changes = contentChanges(editor.state.doc.toString(), vocabulary, protect);
    if (changes.length === 0) {
      return;
    }
    // Case replacements are exactly as long as what they replace; indent and trailing-newline edits
    // are not. Restating a selection across a length-changing batch would put the caret in the
    // wrong column, so CodeMirror's own mapping is left to answer in that case.
    const lengthPreserving = changes.every(
      (change) => change.insert.length === change.to - change.from
    );
    editor.dispatch({
      changes,
      // Restated when there is a caret and nothing changes length, because CodeMirror maps a
      // position sitting on a replacement boundary to the far side of it. Left untouched when
      // unfocused: writing a selection there would paint one on an editor nobody is in.
      ...(protect === null || !lengthPreserving ? {} : { selection: editor.state.selection }),
      // Deliberately not External: this is a real edit to the draft, it must reach `onChange` and be
      // saved. Deliberately out of the history: the player did not type it, exactly as the tidy this
      // replaces was. And deliberately no `userEvent`, which is what history groups typing under.
      annotations: [Transaction.addToHistory.of(false)]
    });
  }, [externalRevision, unitId, orderOcd, vocabulary]);

  // The other half of the tidy: the block ends in exactly one newline, so clicking in the empty
  // space below the last order puts the caret on a fresh line ready to type. External, because the
  // document cannot hold a blank line at the end of a block (`writeUnitOrders` drops it) - so this
  // is what the editor shows rather than an edit to the draft, and sending it to `onChange` would
  // mark every unit edited merely for being opened. Runs on the tidy's own clock, which is what
  // leaves Enter free to open as many lines as the player presses it for.
  useEffect(() => {
    const editor = view.current;
    if (!editor || !orderOcd) {
      return;
    }
    const change = trailingNewlineChange(editor.state.doc.toString());
    if (!change) {
      return;
    }
    editor.dispatch({
      changes: change,
      annotations: [External.of(true), Transaction.addToHistory.of(false)]
    });
  }, [externalRevision, unitId, orderOcd, vocabulary]);

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
      // A finding with no columns has no token to put the cursor on - and `toEditorDiagnostics`
      // widens a collapsed span to its whole line, so selecting what it gives back would select
      // the `unit 4117` block header and the next keystroke would replace it. Those findings are
      // about an order that is *missing* (ah-dwk6), so the useful place to be is the end of the
      // block, ready to type the order that is not there (ah-dlao). The editor's document is one
      // unit's block (`OrdersPanel` sets it from `readUnitOrders`), so `doc.length` is the end of
      // this unit's orders rather than the end of the file.
      if (problem.columnStart === null || problem.columnEnd === null) {
        const end = editor.state.doc.length;
        editor.dispatch({ selection: { anchor: end, head: end }, scrollIntoView: true });
        editor.focus();
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
