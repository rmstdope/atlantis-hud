import type { ColumnPopup, PopupLine, PopupStep } from "../unitCellPopup";
import { popupLabelInk } from "../unitCellPopup";
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
          <span className={popupLabelInk(line)}>{line.label}</span>
          <PopupLineValue line={line} />
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
 * What one line of a popup stands at, and what it stood at before this month (decision **R1**).
 *
 * The pair is drawn `before → after`, the before in the line's own soft ink and the arrow dimmer
 * still, so the eye lands on the figure that holds now. Only the after is coloured: the colour is
 * decoration, and the pair itself is what says the figure moved.
 *
 * Exported so it can be tested at all - `UnitCellPopup` renders a portal, which this package
 * cannot render (`packages/shared/src/testing/README.md`).
 */
export function PopupLineValue({ line }: { line: PopupLine }) {
  return (
    <span className={`tabular-nums ${line.stress === "aside" ? "text-ink-dim" : "text-ink-soft"}`}>
      {line.steps ? (
        line.steps.map((step, index) => (
          <span key={index}>
            {index > 0 ? <span className="mx-1 text-ink-dim">→</span> : null}
            <span className={STEP_INK[step.mark]}>
              {step.value}
              {step.uncertain ? "?" : null}
            </span>
          </span>
        ))
      ) : line.change ? (
        <>
          {line.change.from}
          <span className="mx-1 text-ink-dim">→</span>
          <span className={line.change.direction === "up" ? "text-ok" : "text-danger"}>
            {line.value}
          </span>
        </>
      ) : line.tone ? (
        <span className={line.tone === "up" ? "text-ok" : "text-danger"}>{line.value}</span>
      ) : (
        line.value
      )}
      {line.why ? <span className="ml-1.5 text-ink-dim">{line.why}</span> : null}
    </span>
  );
}

/**
 * What each figure in a chain is drawn in (`ah-rgkk.2.3`).
 *
 * `reported` and `flat` inherit the line's own soft ink; `projected` is the map's selection blue
 * whichever way it moved, because what sets it apart is that it has not happened yet. The colour
 * is decoration - the position in the chain already says which figure is which, and `popupAsText`
 * says it again in words.
 */
const STEP_INK: Record<PopupStep["mark"], string> = {
  reported: "",
  flat: "",
  up: "text-ok",
  down: "text-danger",
  projected: "text-select"
};
