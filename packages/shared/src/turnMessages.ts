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
  /**
   * What is left once the prefixes above are taken off, trimmed.
   *
   * The trimmed line itself when neither prefix matched - nothing but surrounding whitespace is
   * ever dropped, and `raw` keeps even that. A report wraps its long lines and the unwrapper joins
   * them back with the indent still on, so trimming is what stops a wrapped message arriving with
   * two spaces down its front.
   */
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
 * neither. Whatever is left after the ones that matched is the message, trimmed, and a line
 * matching nothing comes back with three nulls and the whole of itself - shown in full rather than
 * mangled by a rule that did not fit it.
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

/** One unit's events, or the faction-level ones. */
export type TurnMessageGroup = {
  /** The unit these belong to, or `null` for the General group. */
  unitId: string | null;
  /**
   * The unit's name as its first line printed it, or `null` for General.
   *
   * From the first line rather than the last: a report can print two names for one id within a
   * turn, and the first is the one the reader met.
   */
  unitName: string | null;
  /** In report order, always - the order within a group is never rearranged. */
  messages: TurnMessage[];
};

/**
 * The messages grouped by the unit that caused them.
 *
 * General first when it has anything, then each unit in the order the report first mentioned it, so
 * the list still walks the turn the way the report tells it and no group moves between turns for a
 * reason the reader cannot see (navigator, 2026-08-17). An empty input is an empty list, and a
 * General group is omitted entirely rather than shown empty.
 *
 * Keyed on `unitId` and nothing else. An id also appears *inside* a message - `Gives 50 silver
 * [SILV] to Lookout (12159)` - and looking for one there would file every gift under both parties.
 * `splitTurnMessage` reads only the leading `Name (id): ` prefix, which is exactly the unit the
 * event is about.
 *
 * Nothing is sorted: a `Map` keeps insertion order, which is the report's order.
 */
export function groupTurnMessages(messages: readonly TurnMessage[]): TurnMessageGroup[] {
  const groups = new Map<string | null, TurnMessageGroup>();

  for (const message of messages) {
    let group = groups.get(message.unitId);
    if (!group) {
      group = { unitId: message.unitId, unitName: message.unitName, messages: [] };
      groups.set(message.unitId, group);
    }
    group.messages.push(message);
  }

  const general = groups.get(null);
  const units = [...groups.values()].filter((group) => group.unitId !== null);

  return general ? [general, ...units] : units;
}


/**
 * One unit's event lines, in report order.
 *
 * Keyed on `unitId` and nothing else, which is exactly the unit the event is about - see
 * `splitTurnMessage`. A unit that is only the *target* of somebody else's gift is not matched.
 */
export function turnMessagesForUnit(
  messages: readonly TurnMessage[],
  unitId: string
): TurnMessage[] {
  return messages.filter((message) => message.unitId === unitId);
}
