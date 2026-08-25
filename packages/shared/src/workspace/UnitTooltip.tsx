import type { ReportUnit, UnitSilver } from "@atlantis/core-client";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "../settingsStore";
import { placeTooltip, summariseUnit, type Point } from "../unitTooltip";
import { Absent, Row, Section } from "./primitives";

/**
 * A unit's full skills and items, shown where the pointer came to rest.
 *
 * Rendered into the body rather than beside the row it describes. The panel behind the table is
 * blurred and clips what overflows it, and a blurred ancestor is what a fixed position resolves
 * against — inside the panel this would be trapped in it and cut off at its edge.
 *
 * It is placed after it is measured, so the arithmetic that keeps it on screen works on the size
 * the text actually took. The measuring pass is laid out but not painted: assigning the position
 * happens in a layout effect, which the browser runs before it draws, so there is no frame in
 * which the tooltip is somewhere else.
 */
export function UnitTooltip({
  unit,
  at,
  silver = null,
  warned = false
}: {
  unit: ReportUnit;
  at: Point;
  /** This unit's silver forecast, where it has one. `ah-1wcw.1`. */
  silver?: UnitSilver | null;
  /** Whether this unit carries the `not-enough-silver` finding, which the note explains. */
  warned?: boolean;
}) {
  // The node is held as state rather than a ref so the effect below runs once it exists.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!node) {
      return;
    }
    setPlaced(
      placeTooltip(
        at,
        { width: node.offsetWidth, height: node.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, [node, at, unit.unitId]);

  // The Silver column's upkeep setting also decides the hover's fifth row (`ah-1wcw.4`).
  const countUpkeep = useSettingsStore((state) => state.countUpkeep);
  const summary = summariseUnit(unit, silver, warned, countUpkeep);

  return createPortal(
    <div
      ref={setNode}
      data-testid="unit-tooltip"
      role="tooltip"
      // Hidden until it has been measured and placed, which is one layout pass and no painted
      // frame: shown, that pass would put it at the corner of the window for an instant.
      style={{
        left: placed?.left ?? 0,
        top: placed?.top ?? 0,
        visibility: placed ? "visible" : "hidden"
      }}
      // Transparent to the pointer, so resting on a row cannot put the tooltip under the cursor
      // and take away the very hover that opened it.
      className="pointer-events-none fixed z-50 max-h-[80vh] w-max max-w-sm overflow-hidden rounded-md border border-edge bg-panel/95 px-2.5 py-1.5 text-pane leading-snug text-ink shadow-lg backdrop-blur"
    >
      <p className="m-0 font-medium text-brass">{summary.title}</p>

      <Section title="Skills" count={summary.skills.length || undefined}>
        {summary.skills.length === 0 ? (
          <Absent>none</Absent>
        ) : (
          summary.skills.map((skill) => (
            <Row key={skill.label} label={skill.label} value={skill.value} />
          ))
        )}
      </Section>

      <Section title="Items" count={summary.items.length || undefined}>
        {summary.items.length === 0 ? (
          <Absent>none</Absent>
        ) : (
          summary.items.map((item) => <Row key={item.label} label={item.label} value={item.value} />)
        )}
      </Section>

      {summary.silver ? (
        <Section title="Silver">
          {summary.silver.rows.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
          {summary.silver.note ? (
            // `whitespace-pre-line` is what makes a second note a second line: the note joins every
            // sentence that applies with a newline, and JSX would otherwise collapse it to a space
            // (`ah-x36v`). Runs of spaces still collapse, so a single-sentence note is unaffected.
            <p className="m-0 mt-1 whitespace-pre-line text-pane-sm text-ink-dim">
              {summary.silver.note}
            </p>
          ) : null}
        </Section>
      ) : null}
    </div>,
    document.body
  );
}
