/**
 * How one line of "Errors during turn" or "Events during turn" is split for display.
 *
 * The core keeps these lines exactly as the engine printed them, which is the right contract for a
 * parser that must never lose a line it does not recognise. Reading a column of them is a different
 * job: the unit and the order verb are the two things a player scans for, and they are buried at
 * the front of a sentence.
 *
 * So this is presentation rather than report semantics, and it lives here rather than in the Rust
 * core - nothing about the wire format has to move for a panel to set a name in its own column.
 * Pure, and tested beside itself, because the repository has no jsdom and a component could not be
 * tested at all.
 */

export type TurnMessage = {
  /** The bare numeric id, as `ReportUnit.unitId` spells it. Null when the line names no unit. */
  unitId: string | null;
  /** The unit's name as the line printed it, `Seven of Eight` or plainly `Unit`. */
  unitName: string | null;
  /** The order that failed, for the lines that name one. Errors have these; events rarely do. */
  verb: string | null;
  /** What is left once the prefixes above are taken off. The whole line when neither matched. */
  text: string;
  /** The line as printed, so nothing is ever lost to a shape this did not expect. */
  raw: string;
};

/**
 * `Seven of Eight (18642): ` - a name, a numeric id, and a colon immediately after the bracket.
 *
 * The colon is what makes this safe. `Cpt Stanley (13423) is caught attempting to steal from Cpt
 * Stu (14677) in Nurplishglen.` names a unit too, but mid-sentence, and taking a prefix off it
 * would leave a fragment starting "is caught". Requiring the colon leaves that line whole.
 *
 * Lazy in the name, so `Unit (1387): BUY: ...` stops at the first bracketed id rather than running
 * to a later one.
 */
const UNIT_PREFIX = /^(.+?) \((\d+)\):\s+/;

/**
 * `BUY: `, `STUDY: `, `DECLARE: ` - the order the engine was executing.
 *
 * All caps and at least two letters, which is every order Atlantis has and is what keeps `Claims
 * $878.` from being read as one.
 */
const VERB_PREFIX = /^([A-Z]{2,}):\s+/;

/**
 * Splits one printed line into the fields a row shows.
 *
 * Both prefixes are optional and independent: an error can name a unit and a verb, a verb alone, or
 * neither. Whatever is left after the ones that matched is the message, and a line matching nothing
 * comes back with three nulls and its own text - shown in full rather than mangled by a rule that
 * did not fit it.
 */
export function splitTurnMessage(line: string): TurnMessage {
  const raw = line;
  let rest = line.trim();

  const named = UNIT_PREFIX.exec(rest);
  if (named) {
    rest = rest.slice(named[0].length);
  }

  const verbed = VERB_PREFIX.exec(rest);
  if (verbed) {
    rest = rest.slice(verbed[0].length);
  }

  return {
    unitId: named?.[2] ?? null,
    unitName: named?.[1] ?? null,
    verb: verbed?.[1] ?? null,
    text: rest,
    raw
  };
}

/** The whole of one report section, in the order the report printed it. */
export function splitTurnMessages(lines: readonly string[]): TurnMessage[] {
  return lines.map(splitTurnMessage);
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * What the header chip says, or null when there is nothing to open.
 *
 * A count of zero is left out rather than printed. "0 errors" beside a dozen events reads as a
 * warning about nothing, and the header has one line to spend.
 */
export function describeTurnMessages(errorCount: number, eventCount: number): string | null {
  const parts = [
    ...(errorCount > 0 ? [plural(errorCount, "error")] : []),
    ...(eventCount > 0 ? [plural(eventCount, "event")] : [])
  ];

  return parts.length > 0 ? parts.join(" · ") : null;
}
