/**
 * Every string and every rule the header's one advisory chip and its panel need (ah-30hg.2).
 *
 * Three amber chips stood in the header - what the engine reported went wrong, what order
 * validation found across the map, and what the parser could not read - and each new advisory cost
 * the strip another 130-200px. They are one chip and one panel now, so a fourth costs a tab rather
 * than a row.
 *
 * `packages/shared` has no jsdom by decision (ah-nass), so a pure module is the only place the
 * wording can actually be unit-tested; the panel and the chip render what these return.
 */

/** The four things one turn can want checked, in the order the panel shows them. */
export type TurnReportTab = "problems" | "engine" | "unreadable" | "events";

/** What the four folded sources each amount to, for the chip and the tab row. */
export type TurnReportCounts = {
  /** Order validation, over the whole map - `problemsByHex` summed. */
  problems: number;
  /** "Errors during turn", as the engine printed them. */
  engine: number;
  /** Lines of the loaded report the parser could not read. */
  unreadable: number;
  /** "Events during turn". Counted for its own tab, never as something wrong. */
  events: number;
};

/** Fixable first, then what already happened - the navigator's P1 ordering, round 2. */
export const TURN_REPORT_TABS: readonly TurnReportTab[] = [
  "problems",
  "engine",
  "unreadable",
  "events"
];

/** What a silent turn's panel says instead of a body. */
export const TURN_REPORT_SILENT = "This turn reported nothing, and your orders look sound.";

/** One capitalised word per tab, for the tab row. */
const TAB_NAMES: Record<TurnReportTab, string> = {
  problems: "Problems",
  engine: "Engine",
  unreadable: "Not read",
  events: "Events"
};

/** Things wrong: problems + engine + unreadable. Events are not warnings (navigator, round 2). */
export function turnReportTotal(counts: TurnReportCounts): number {
  return counts.problems + counts.engine + counts.unreadable;
}

/** How many rows one tab has. */
export function turnReportCount(counts: TurnReportCounts, tab: TurnReportTab): number {
  return counts[tab];
}

/**
 * The chip's visible text: `11 to check`, or `Turn report` when nothing is wrong.
 *
 * The `⚠` is a separate `aria-hidden` span at the render site, exactly as the two chips this
 * replaces already do it - so it is not in this string.
 */
export function turnReportChipLabel(counts: TurnReportCounts): string {
  const total = turnReportTotal(counts);
  // "to check" rather than a counted noun: it is the one phrasing that needs no plural, which is
  // why the navigator chose it over "N problems" and "N warnings" (round 1).
  return total > 0 ? `${total} to check` : "Turn report";
}

/** Whether the chip is amber. True exactly when `turnReportTotal` is above zero. */
export function turnReportIsWarning(counts: TurnReportCounts): boolean {
  return turnReportTotal(counts) > 0;
}

/** `Problems 10`, `Engine 1`, `Not read 6`, `Events 333`. */
export function turnReportTabLabel(tab: TurnReportTab, counts: TurnReportCounts): string {
  return `${TAB_NAMES[tab]} ${turnReportCount(counts, tab)}`;
}

/** The panel's one header line, which names the open tab. */
export function turnReportHeading(
  tab: TurnReportTab,
  context: {
    counts: TurnReportCounts;
    /** How many hexes the problems are spread over - the Problems line says it. */
    hexCount: number;
    /** The bare turn number, e.g. "71". Null when the report's header gives none. */
    turnLabel: string | null;
  }
): string {
  // `this turn` is the fallback the turn-messages panel already used for a null turn label.
  const turn = context.turnLabel ? `turn ${context.turnLabel}` : "this turn";
  switch (tab) {
    case "problems": {
      const { problems } = context.counts;
      return `${problems} problem${problems === 1 ? "" : "s"} in ${context.hexCount} hex${
        context.hexCount === 1 ? "" : "es"
      }`;
    }
    case "engine":
      return `Errors during ${turn}`;
    case "unreadable":
      return "Lines that could not be read";
    case "events":
      return `Events during ${turn}`;
  }
}

/** The sentence under the body, or null for a tab that has none. */
export function turnReportFooter(tab: TurnReportTab): string | null {
  switch (tab) {
    case "problems":
      return "These never block an export. They are what the report says will go wrong, not what the server will refuse.";
    case "unreadable":
      return "None of this reached the map.";
    case "engine":
    case "events":
      return null;
  }
}

/**
 * Which tab a fresh open lands on: the remembered one when it still has rows, otherwise the first
 * in `TURN_REPORT_TABS` that has any, otherwise "problems".
 */
export function turnReportOpeningTab(
  remembered: TurnReportTab,
  counts: TurnReportCounts
): TurnReportTab {
  if (turnReportCount(counts, remembered) > 0) {
    return remembered;
  }
  return TURN_REPORT_TABS.find((tab) => turnReportCount(counts, tab) > 0) ?? "problems";
}

/** True when all four counts are zero: no tab row at all, one sentence instead. */
export function turnReportIsSilent(counts: TurnReportCounts): boolean {
  return TURN_REPORT_TABS.every((tab) => turnReportCount(counts, tab) === 0);
}
