import { Fragment } from "react";

import { markSegments, type FilteredItemPart } from "../unitFilter";

/**
 * What the units filter draws into the table (`ah-ykac`): the marks around matched text, and the
 * line that speaks for a match in a hidden Items column. The rules are in `unitFilter.ts`; this
 * only draws their answers.
 */

/** A translucent brass, as the agreed mockup draws it, over the cell's own text colour. */
const MARK_CLASS = "rounded-sm bg-brass/30 text-inherit";

/** `text` with every occurrence of the already-lowered `needle` marked. */
export function Marked({ text, needle }: { text: string; needle: string }) {
  return (
    <>
      {markSegments(text, needle).map((segment, at) =>
        segment.marked ? (
          <mark key={at} className={MARK_CLASS}>
            {segment.text}
          </mark>
        ) : (
          <Fragment key={at}>{segment.text}</Fragment>
        )
      )}
    </>
  );
}

/**
 * One Items entry. Only the code is ever marked, never the amount; a match on the name alone marks
 * the whole code, since the cell prints codes only and the row must still show why it is listed
 * (the navigator, 2026-10-17).
 */
export function MarkedItemPart({ part, needle }: { part: FilteredItemPart; needle: string }) {
  if (part.match === null) {
    return <>{part.text}</>;
  }
  const lead = part.text.slice(0, part.text.length - part.tag.length);
  const code = part.text.slice(lead.length);
  return (
    <>
      {lead}
      {part.match === "name" ? <mark className={MARK_CLASS}>{code}</mark> : <Marked text={code} needle={needle} />}
    </>
  );
}

/**
 * Shown above the rows when the Items column is hidden and a listed row is there for what it
 * carries. "Show it" is the same setting as Settings › Columns.
 */
export function ItemsHiddenLine({ onShow }: { onShow: () => void }) {
  return (
    <p
      data-testid="units-items-hidden-line"
      className="border-y border-edge-soft px-2 py-1.5 text-pane text-ink-soft"
    >
      Some units are listed for what they carry — the Items column is hidden.{" "}
      <button
        type="button"
        onClick={onShow}
        className="text-brass underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
      >
        Show it
      </button>
    </p>
  );
}
