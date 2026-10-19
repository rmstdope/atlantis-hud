import { StateEffect, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  showTooltip,
  type DecorationSet,
  type Tooltip
} from "@codemirror/view";
import { formTagHover, formTagLabel, type FormBlockTag } from "../formBlockTags";

/**
 * The tag at the end of a FORM line saying what is wrong inside its block (`ah-j10j`,
 * docs/ui/ah-j10j-form-line-tag.html), its hover box, and its click.
 *
 * What the tags say is worked out in `formBlockTags`, which is pure and unit-tested; this is only
 * how CodeMirror draws them. The tag is a widget rather than text, so it is never part of the
 * orders - never saved, never copied - and it is not focusable: F8 is the keyboard's way there.
 */

/** Replaces the tags shown, as `setDiagnostics` replaces the underlines. */
export const setFormTags = StateEffect.define<readonly FormBlockTag[]>();

/** Which tag the pointer is over, by its index among the tags, or null. */
const setHovered = StateEffect.define<number | null>();

type Shown = {
  tags: readonly FormBlockTag[];
  decorations: DecorationSet;
  hovered: number | null;
};

class FormTagWidget extends WidgetType {
  constructor(
    readonly tag: FormBlockTag,
    readonly index: number,
    readonly onOpen: (tag: FormBlockTag) => void
  ) {
    super();
  }

  override eq(other: FormTagWidget): boolean {
    return (
      other.index === this.index &&
      other.tag.alias === this.tag.alias &&
      formTagLabel(other.tag) === formTagLabel(this.tag) &&
      other.tag.stops === this.tag.stops
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = "cm-form-tag";
    element.dataset.testid = "form-tag";
    element.dataset.severity = this.tag.errorCount > 0 ? "error" : "warning";
    element.setAttribute("contenteditable", "false");
    element.textContent = formTagLabel(this.tag);
    // Down, not click, keeps the caret where it is: CodeMirror would otherwise place it at the end
    // of the FORM line on the way to the formed unit's editor.
    element.addEventListener("mousedown", (event) => event.preventDefault());
    element.addEventListener("click", (event) => {
      event.preventDefault();
      this.onOpen(this.tag);
    });
    element.addEventListener("mouseenter", () => view.dispatch({ effects: setHovered.of(this.index) }));
    element.addEventListener("mouseleave", () => view.dispatch({ effects: setHovered.of(null) }));
    return element;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function hoverBox(tag: FormBlockTag): HTMLElement {
  const { heading, rows, footer } = formTagHover(tag);
  const box = document.createElement("div");
  box.className = "cm-form-tag-hover";
  box.dataset.testid = "form-tag-hover";
  const name = document.createElement("b");
  name.textContent = heading;
  box.append(name);
  for (const row of rows) {
    const line = document.createElement("div");
    line.textContent = row;
    box.append(line);
  }
  const hint = document.createElement("div");
  hint.className = "cm-form-tag-hint";
  hint.textContent = footer;
  box.append(hint);
  return box;
}

/** The tags, their hover box and their click, which `onOpen` is handed. */
export function formTagWidgets(onOpen: (tag: FormBlockTag) => void): Extension {
  const decorate = (state: EditorState, tags: readonly FormBlockTag[]): DecorationSet => {
    const ranges: Range<Decoration>[] = [];
    tags.forEach((tag, index) => {
      // Validation is debounced, so a tag can be a keystroke behind a document that has since lost
      // its line; it waits for the next check rather than landing on some other line.
      if (tag.line < 1 || tag.line > state.doc.lines) {
        return;
      }
      ranges.push(
        Decoration.widget({ widget: new FormTagWidget(tag, index, onOpen), side: 1 }).range(
          state.doc.line(tag.line).to
        )
      );
    });
    return Decoration.set(ranges);
  };

  const shown = StateField.define<Shown>({
    create: () => ({ tags: [], decorations: Decoration.none, hovered: null }),
    update(value, transaction) {
      let next = value;
      if (transaction.docChanged) {
        // Mapped like the underlines are, until the next check moves them; the box closes, since
        // the line it was opened from may be gone.
        next = { ...next, decorations: next.decorations.map(transaction.changes), hovered: null };
      }
      for (const effect of transaction.effects) {
        if (effect.is(setFormTags)) {
          next = { tags: effect.value, decorations: decorate(transaction.state, effect.value), hovered: null };
        } else if (effect.is(setHovered)) {
          next = { ...next, hovered: effect.value };
        }
      }
      return next;
    },
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.decorations),
      showTooltip.compute([field], (state): Tooltip | null => {
        const { tags, decorations, hovered } = state.field(field);
        const tag = hovered === null ? undefined : tags[hovered];
        if (tag === undefined) {
          return null;
        }
        let pos: number | null = null;
        decorations.between(0, state.doc.length, (from, _to, decoration) => {
          if ((decoration.spec.widget as FormTagWidget | undefined)?.index === hovered) {
            pos = from;
            return false;
          }
          return undefined;
        });
        return pos === null ? null : { pos, above: false, create: () => ({ dom: hoverBox(tag) }) };
      })
    ]
  });

  return [
    shown,
    EditorView.baseTheme({
      ".cm-form-tag": {
        marginLeft: "12px",
        padding: "0 7px",
        borderRadius: "9px",
        border: "1px solid var(--color-warn)",
        color: "var(--color-warn)",
        fontFamily: "var(--font-sans, sans-serif)",
        fontSize: "0.85em",
        whiteSpace: "nowrap",
        cursor: "pointer",
        userSelect: "none"
      },
      ".cm-form-tag[data-severity=error]": {
        borderColor: "var(--color-danger)",
        color: "var(--color-danger)"
      },
      ".cm-form-tag-hover": {
        maxWidth: "46ch",
        padding: "7px 10px",
        fontFamily: "var(--font-sans, sans-serif)",
        whiteSpace: "normal"
      },
      ".cm-form-tag-hint": { color: "var(--color-ink-dim)" }
    })
  ];
}
