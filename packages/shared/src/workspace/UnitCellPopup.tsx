import type { ColumnPopup, PopupChange } from "../unitCellPopup";
import type { Point } from "../unitTooltip";
import { TooltipPortal } from "./TooltipPortal";

/**
 * What resting on one cell of the units table says, shown where the pointer came to rest
 * (`ah-rgkk.1`).
 *
 * Every word of it comes from `popupForCell`, and the same words are already in the cell as an
 * `sr-only` sentence - which is why the panel is hidden from screen readers rather than exposed
 * twice (decision **F1**).
 */
export function UnitCellPopup({
  popup,
  column,
  at,
  anchorKey
}: {
  popup: ColumnPopup;
  /** The column this is about, for the smoke suite to name rather than match on text. */
  column: string;
  at: Point;
  /** Re-place when the pointer moves to another cell or another row. */
  anchorKey: string;
}) {
  return (
    <TooltipPortal
      at={at}
      anchorKey={anchorKey}
      testId="unit-cell-popup"
      column={column}
      hiddenFromReaders
    >
      <p className="m-0 font-medium text-brass">{popup.title}</p>

      {popup.lines.map((line, index) => (
        <div key={`${line.label}-${index}`} className="flex justify-between gap-3">
          <span>{line.label}</span>
          <span className="tabular-nums text-ink-soft">
            {line.value}
            {line.change ? <ChangeMark change={line.change} /> : null}
            {line.why ? <span className="ml-1.5 text-ink-dim">{line.why}</span> : null}
          </span>
        </div>
      ))}

      {popup.notes.map((note, index) => (
        <p key={index} className="m-0 mt-1 text-pane-sm text-ink-dim">
          {note}
        </p>
      ))}

      {popup.warning ? <p className="m-0 mt-1 text-pane-sm text-warn">{popup.warning}</p> : null}
    </TooltipPortal>
  );
}

/**
 * How much a figure moved, and which way (decision **B1**).
 *
 * The arrow and the sign each carry the direction, so neither the colour nor the glyph alone has
 * to be read; the colour is decoration. A true minus (U+2212) rather than a hyphen, so the two
 * signs are the same width in the tabular figures beside them.
 */
function ChangeMark({ change }: { change: PopupChange }) {
  const up = change.direction === "up";
  return (
    <span className={`ml-1.5 ${up ? "text-ok" : "text-danger"}`}>
      {up ? "▲" : "▼"} {up ? "+" : "−"}
      {change.amount}
    </span>
  );
}
