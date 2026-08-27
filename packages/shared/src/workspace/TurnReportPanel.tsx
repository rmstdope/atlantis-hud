import type { ReactNode } from "react";
import {
  TURN_REPORT_SILENT,
  TURN_REPORT_TABS,
  type TurnReportCounts,
  type TurnReportTab,
  turnReportCount,
  turnReportFooter,
  turnReportHeading,
  turnReportIsSilent,
  turnReportTabLabel
} from "../turnReport";
import { POPOVER_BODY_MAX_H } from "./primitives";
import { PopoverFrame } from "./popover";

/**
 * Everything the loaded turn wants checked, in one panel with a section per source (ah-30hg.2).
 *
 * Three panels stood here - order problems, what the engine said, and the lines that could not be
 * read - each behind an amber chip of its own, and the header grew a row every time an advisory was
 * added. They are four tabs now, so a fourth source costs a tab rather than a chip.
 *
 * One body at a time (round 4, S3): on a busy turn the events run to hundreds of rows, so showing
 * every section at once buries what has not been read below what has. The panel owns the frame, the
 * header line, the tab row, the one scroller and the footer; the caller hands in the open tab's
 * list.
 *
 * Anchored to the right of its trigger and capped to the window's width, which is what the widest
 * of the three panels already did: this is wide enough to hold a sentence and the chip sits in the
 * middle of the bar, so hanging it leftwards would put its far edge off a narrow window.
 */
export function TurnReportPanel({
  counts,
  tab,
  onTab,
  turnLabel,
  hexCount,
  body,
  headerAction,
  onDismiss
}: {
  counts: TurnReportCounts;
  tab: TurnReportTab;
  onTab: (tab: TurnReportTab) => void;
  /** The bare turn number, for the Engine and Events headings. */
  turnLabel: string | null;
  /** How many hexes the problems are spread over, for the Problems heading. */
  hexCount: number;
  /** The open tab's list. Ignored when the turn is silent. */
  body: ReactNode;
  /** Rendered between the header line and ✕. The Copy all button, on the unreadable tab only. */
  headerAction: ReactNode;
  onDismiss: () => void;
}) {
  const silent = turnReportIsSilent(counts);
  // A silent turn has no open tab to name, so the line falls back to naming the turn itself - the
  // shape the turn-messages panel's header already used.
  const heading = silent
    ? turnLabel
      ? `Turn ${turnLabel}`
      : "This turn"
    : turnReportHeading(tab, { counts, hexCount, turnLabel });
  const footer = silent ? null : turnReportFooter(tab);

  return (
    <PopoverFrame
      testId="turn-report"
      label="Turn report"
      align="right"
      width="w-[32rem] max-w-[calc(100vw-2rem)]"
    >
      <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
        <span className="text-ink-soft">{heading}</span>
        <span className="flex-1" />
        {headerAction}
        <button
          type="button"
          aria-label="close turn report"
          onClick={onDismiss}
          className="rounded px-1.5 text-ink-dim hover:text-ink"
        >
          ✕
        </button>
      </div>

      {silent ? null : (
        <div
          role="tablist"
          aria-label="Turn report"
          className="flex flex-wrap gap-1 px-2 pt-1.5"
        >
          {TURN_REPORT_TABS.map((name) => (
            <Tab key={name} name={name} counts={counts} active={tab} onTab={onTab} />
          ))}
        </div>
      )}

      {/*
        The one scroller. It was on each of the three bodies, which is right while each has a frame
        of its own and wrong the moment they share one: four scrollers inside one panel would each
        clamp to the whole window.
      */}
      <div className={`${POPOVER_BODY_MAX_H} overflow-y-auto p-2`}>
        {silent ? (
          <p data-testid="turn-report-silent" className="p-2 text-center text-ink-dim">
            {TURN_REPORT_SILENT}
          </p>
        ) : (
          body
        )}
      </div>

      {footer ? (
        <p className="border-t border-edge px-2 py-1.5 text-ink-dim">{footer}</p>
      ) : null}
    </PopoverFrame>
  );
}

function Tab({
  name,
  counts,
  active,
  onTab
}: {
  name: TurnReportTab;
  counts: TurnReportCounts;
  active: TurnReportTab;
  onTab: (tab: TurnReportTab) => void;
}) {
  const selected = name === active;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-testid={`turn-report-tab-${name}`}
      // A list with nothing in it is not worth switching to, and saying so with a disabled tab is
      // clearer than a tab that opens onto nothing. Dimmed rather than removed, so the four tabs
      // stay in the same four places as the counts move (round 5, X2).
      disabled={turnReportCount(counts, name) === 0}
      onClick={() => onTab(name)}
      className={`rounded border px-2 py-0.5 disabled:opacity-40 ${
        selected ? "border-brass text-brass" : "border-edge text-ink-soft hover:text-ink"
      }`}
    >
      {turnReportTabLabel(name, counts)}
    </button>
  );
}
