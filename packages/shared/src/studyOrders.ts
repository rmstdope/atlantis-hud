/**
 * Next turn's `STUDY` and `TEACH` lines, one block per faction (`ah-lyg6.4.1`), and every later
 * planned turn as a `TURN ... ENDTURN` block (`ah-1f87z`).
 *
 * Pure data in, pure text out, in the shape `studySchedule.ts` and `studyPlanner.ts` have and for
 * the same reason: `packages/shared` has no jsdom, so every string a test needs to pin lives in a
 * module with no React in it. The Orders tab draws what this returned and words nothing itself.
 *
 * `rules/study` is what a level on the line means: `STUDY <skill>` is one month, while
 * `STUDY <skill> <level>` is "continued from turn to turn until the unit reaches that skill
 * level" - which would override the turns the player planned by hand, so the bare form is always
 * written. `rules/teach` takes a list of units on one line, and it is unit **numbers** that go on
 * it.
 *
 * Every sentence about why an order is missing or halved is `plannerNotices`' own, copied
 * verbatim: a second wording of a fact this family has already worded is the drift four beads have
 * spent tests avoiding.
 */

import { practisedBy } from "./castPractice";
import { safeFileNamePart } from "./mageSheet";
import type { MagicTree } from "./magicTree";
import type { PlannerGroup } from "./studyPlanner";
import type { ScheduleRow } from "./studySchedule";
import type { PlannerNotice } from "./studyTeaching";
import { joinNames } from "./workspace/standingChip";

/**
 * Where a `;` comment starts on a line whose code part is shorter than this.
 *
 * `UNIT 1234` (9) and `  STUDY FORC 4` (14) both fit, which is what makes the column; anything
 * longer simply gets one space.
 */
export const COMMENT_COLUMN = 20;

/**
 * One mage's contribution to a section, as `ah-lyg6.4.2` needs it to write into a document.
 *
 * `order` and `annotation` are the two halves of the line the section text draws; the section is
 * rendered from these, so the tab and the write can never disagree about what a mage is doing.
 */
export type OrdersEntry = {
  /** `${factionId}/${unitId}` - `ScheduleRow.key`. */
  key: string;
  unitId: string;
  name: string;
  /** `ScheduleRow.regionId` - the core's own id, for the banner a new block goes under. */
  regionId: string;
  /** The month-long order alone: `STUDY FORC 4`, `STUDY PATT`, `TEACH 1234 1263`. Null when the mage has none. */
  order: string | null;
  /** What follows `; ` in the tab: `force 3 -> 4, taught by Sable`, `teaches Ereb and Vess`. Null when there is none. */
  annotation: string | null;
  /** Why there is no order, in the planner's own words. Null when `order` is non-null. */
  skipReason: string | null;
  /** Next turn's planned cast, when "Also write the casts" is ticked (ah-9qdz.4); null otherwise. */
  cast: OrdersCast | null;
  /**
   * One per later turn of the Schedule the plan reaches, in turn order (ah-1f87z) - each a
   * `TURN ... ENDTURN` block. Empty when nothing is planned past next turn.
   */
  later: LaterTurn[];
};

/**
 * One line of a month's orders, without its indentation: an order with its comment, or a comment
 * alone (`code` null). The tab and the write indent and column it each their own way.
 */
export type OrderLine = { code: string | null; comment: string | null };

/**
 * A later turn as a `TURN ... ENDTURN` block (ah-1f87z).
 *
 * `rules/turn`: "Multiple TURN orders in a row will execute on successive turns" - so a turn with
 * nothing planned between two planned ones is kept as an empty block, or every block after it
 * would land a month early. The engine agrees: a block of nothing but comments is still one
 * `TurnOrder` (`ProcessTurnOrder`, parseorders.cpp).
 */
export type LaterTurn = {
  turn: number;
  /** The `TURN` line's comment: `turn 73`, or `turn 75 — nothing planned` for an empty block. */
  opener: string;
  /** What the tab would write for that turn if it were next turn, without the UNIT line. */
  lines: OrderLine[];
};

/**
 * A planned cast as the tab and the write both read it (ah-9qdz.4).
 *
 * `write` is a line that goes into the orders: `CAST <TAG>` for a spell used by casting or both
 * ways (`rules/cast`), `COMBAT <TAG>` for a combat-only spell (`rules/combat`). `unknown` is a
 * spell he will not know as the turn begins, which is left out and only said.
 */
export type OrdersCast =
  | {
      kind: "write";
      verb: "CAST" | "COMBAT";
      /** Upper-cased tag. */
      spell: string;
      /** Lower case, verbatim from the tree. */
      name: string;
      /** `CAST FARS`. */
      order: string;
      /** `practises farsight`, `readies fire for battle`. */
      annotation: string;
    }
  | {
      kind: "unknown";
      spell: string;
      name: string;
      /** `CAST FARS`. */
      order: string;
      /** `CAST FARS — he won't know farsight yet, left out`. */
      text: string;
    };

/** One faction's block, as the tab draws it and as Copy and Save… deliver it. */
export type OrdersSection = {
  factionId: string;
  /** `PlannerGroup.heading`, verbatim - the pane's existing vocabulary for this group. */
  heading: string;
  /** The whole block, ready to copy or to save. Never the empty string. */
  text: string;
  /** `study-orders-Borg-TNG-(95)-turn-72.txt`. */
  fileName: string;
  /** `PlannerGroup.source` - which section is your own. */
  source: "own" | "sheet";
  /** One per mage of this faction, in the same order as the rows the section draws. */
  entries: OrdersEntry[];
  /**
   * Whether any mage of this faction has a cast planned for next turn, whatever the box says -
   * it is what decides whether the box is there at all (ah-9qdz.4).
   */
  hasCast: boolean;
  /**
   * Set when the box is unticked and this section has casts planned but no mage who studies or
   * teaches (ah-9qdz.4, mockup section 6): `text` is then one line saying so, not orders, and
   * Copy, Save… and Put are greyed. `casts` counts only the casts ticking would write (none he won't know yet).
   */
  withheld: { casts: number } | null;
};

/** Next turn's orders for every faction the planner knows about. */
export type StudyOrders = {
  /** In `groups` order. Empty when nothing at all is planned. */
  sections: OrdersSection[];
  /** `Orders for turn 72 — 3 mages studying, 1 teaching`; null when `sections` is empty. */
  summary: string | null;
  /** Every section's `text` but a withheld one's, separated by one blank line. `""` when there is none. */
  allText: string;
  /** `study-orders-turn-72.txt`. `study-orders.txt` when there is no turn. */
  allFileName: string;
};

/** `UNIT 1234           ; Ereb` - the code part padded to the column, or one space past it. */
function annotated(code: string, comment: string, column = COMMENT_COLUMN): string {
  const gap = code.length >= column ? " " : " ".repeat(column - code.length);
  return `${code}${gap}; ${comment}`;
}

/** One {@link OrderLine} at an indentation, its comment in the column. */
function rendered(line: OrderLine, indent: string, column: number): string {
  if (line.code === null) {
    return `${indent}; ${line.comment ?? ""}`;
  }
  return line.comment === null ? `${indent}${line.code}` : annotated(`${indent}${line.code}`, line.comment, column);
}

/**
 * Later turns as `TURN ... ENDTURN` blocks: `TURN` at `indent`, the orders inside two deeper
 * (ah-1f87z). Shared by the tab and by "Put into my orders", which use different indents and
 * columns, so the two can never disagree about what a block holds.
 */
export function turnBlockLines(later: readonly LaterTurn[], indent: string, column: number): string[] {
  return later.flatMap((one) => [
    annotated(`${indent}TURN`, one.opener, column),
    ...one.lines.map((line) => rendered(line, `${indent}  `, column)),
    `${indent}ENDTURN`
  ]);
}

/** `1 mage studying`, `3 mages studying`. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The unit number of a `${factionId}/${unitId}` key. A key on an order line is one no server takes. */
function unitOf(key: string): string {
  return key.slice(key.indexOf("/") + 1);
}

/** The planned cast half of a turn of the Schedule (next turn by default), or null. */
function plannedHalf(row: ScheduleRow, index = 0) {
  const half = row.castHalves[index] ?? null;
  return half !== null && half.kind === "planned" ? half : null;
}

/**
 * Next turn's cast as an entry carries it, or null when none is planned.
 *
 * Practice is judged from where he stands as the turn begins: spells are CAST, and combat fought,
 * before STUDY orders are processed (`rules/sequenceofevents`). The planner has no he/she rule, so
 * the not-known line says `he`, as ah-9qdz.2's cast half does.
 */
function castOf(row: ScheduleRow, tree: MagicTree, index = 0): OrdersCast | null {
  const half = plannedHalf(row, index);
  if (half === null) {
    return null;
  }
  const spell = half.spell.toUpperCase();
  const node = tree.byTag.get(spell);
  const name = node?.name ?? spell;
  const verb = node?.use === "combat" ? "COMBAT" : "CAST";
  const order = `${verb} ${spell}`;
  if (!half.known) {
    return { kind: "unknown", spell, name, order, text: `${order} — he won't know ${name} yet, left out` };
  }
  const standing = row.standings[index] ?? new Map();
  const practice = practisedBy(spell, standing, tree);
  const level = standing.get(spell)?.level ?? 0;
  const annotation =
    practice.kind === "prerequisite"
      ? `practises ${tree.byTag.get(practice.tag ?? "")?.name ?? practice.tag} (${name} can't rise past it)`
      : practice.kind === "none"
        ? level >= (node?.maxLevel ?? Infinity)
          ? `${name} is at its maximum — no practice`
          : "no practice"
        : verb === "COMBAT"
          ? `readies ${name} for battle`
          : `practises ${name}`;
  return { kind: "write", verb, spell, name, order, annotation };
}

/** The line a cast adds to a month's orders. */
function castLine(cast: OrdersCast): OrderLine {
  return cast.kind === "write" ? { code: cast.order, comment: cast.annotation } : { code: null, comment: cast.text };
}

/** What one month of one mage's plan writes: the entry's fields for it, and its order lines. */
type Month = {
  order: string | null;
  annotation: string | null;
  skipReason: string | null;
  /** True when the cell is idle - nothing to study or teach. */
  idle: boolean;
  lines: OrderLine[];
};

/**
 * One month of one mage's plan, worded the same whichever turn it is (ah-1f87z): next turn's line
 * and a later turn's block both come from here, so "what the tab would write for that turn if it
 * were next turn" holds by construction.
 */
function monthOf(
  row: ScheduleRow,
  index: number,
  rows: readonly ScheduleRow[],
  notices: readonly PlannerNotice[],
  cast: OrdersCast | null
): Month {
  const cell = row.cells[index];
  const castLines = cast === null ? [] : [castLine(cast)];

  if (cell === undefined || cell.kind === "idle") {
    // A cast needs his UNIT line to belong to, so the idle comment moves under it (ah-9qdz.4).
    return {
      order: null,
      annotation: null,
      skipReason: "nothing planned",
      idle: true,
      lines: castLines.length === 0 ? [] : [{ code: null, comment: "nothing planned" }, ...castLines]
    };
  }

  let month: Omit<Month, "lines" | "idle">;
  let orderLine: OrderLine;

  if (cell.kind === "study") {
    if (cell.blocked !== null) {
      month = { order: null, annotation: null, skipReason: cell.blocked };
      orderLine = { code: null, comment: `STUDY ${cell.skill} — ${cell.blocked}` };
    } else {
      const from = row.standings[index]?.get(cell.skill)?.level ?? 0;
      // An arrow pointing at itself reads like a defect, and most months in this game buy no
      // level. ASCII `->`, not `→`: this text is mailed and pasted into strangers' order files.
      const gain = from === cell.level ? `${cell.name} ${cell.level}` : `${cell.name} ${from} -> ${cell.level}`;
      const teacher =
        cell.taughtBy === null
          ? ""
          : `, taught by ${rows.find((one) => one.key === cell.taughtBy)?.name ?? unitOf(cell.taughtBy)}`;
      month = { order: `STUDY ${cell.skill}`, annotation: `${gain}${teacher}`, skipReason: null };
      orderLine = { code: month.order, comment: month.annotation };
    }
  } else if (cell.outcome.taught.length > 0) {
    const taughtRows = cell.outcome.taught.map(
      (key) => rows.find((one) => one.key === key)?.name ?? unitOf(key)
    );
    month = {
      order: `TEACH ${cell.outcome.taught.map(unitOf).join(" ")}`,
      annotation: `teaches ${joinNames(taughtRows)}`,
      skipReason: null
    };
    orderLine = { code: month.order, comment: month.annotation };
  } else {
    month = { order: null, annotation: null, skipReason: "nobody can be taught this turn" };
    // `cell.students` is empty for a live cell (ah-af7i), which nobody named - so the comment
    // names the ids only when the player wrote them down.
    const named = cell.live ? "" : cell.students.join(" ");
    orderLine = { code: null, comment: `TEACH${named === "" ? "" : ` ${named}`} — ${month.skipReason ?? ""}` };
  }

  const warnings = notices
    .filter((notice) => notice.rowKey === row.key && notice.turnIndex === index && notice.level === "warning")
    .map((notice): OrderLine => ({ code: null, comment: notice.text }));
  return { ...month, idle: false, lines: [orderLine, ...castLines, ...warnings] };
}

/**
 * What one row contributes: the entry `ah-lyg6.4.2` writes from, and the lines the section draws.
 *
 * One function rather than two, so the mailed text and the written order can never disagree: every
 * line below is rendered *from* the entry it returns.
 */
function contributionOf(
  row: ScheduleRow,
  rows: readonly ScheduleRow[],
  notices: readonly PlannerNotice[],
  castFor: (row: ScheduleRow, index: number) => OrdersCast | null,
  turns: readonly number[]
): { entry: OrdersEntry; lines: string[] } {
  const cast = castFor(row, 0);
  const next = monthOf(row, 0, rows, notices, cast);

  // Every later month up to the last one with anything in it; an empty one before that is kept as
  // an empty block so the months after it land on the right turn (ah-1f87z).
  const months = turns.slice(1).map((turn, offset) => {
    const index = offset + 1;
    return { turn, month: monthOf(row, index, rows, notices, castFor(row, index)) };
  });
  let last = months.length - 1;
  while (last >= 0 && months[last].month.lines.length === 0) {
    last -= 1;
  }
  const later: LaterTurn[] = months.slice(0, last + 1).map(({ turn, month }) => ({
    turn,
    opener: month.lines.length === 0 ? `turn ${turn} — nothing planned` : `turn ${turn}`,
    lines: month.lines
  }));

  const entry: OrdersEntry = {
    key: row.key,
    unitId: row.unitId,
    name: row.name,
    regionId: row.regionId,
    order: next.order,
    annotation: next.annotation,
    skipReason: next.skipReason,
    cast,
    later
  };

  if (next.idle && cast === null && later.length === 0) {
    // Named rather than left out, so a mage you forgot is not indistinguishable from one you
    // meant to idle - the navigator's choice.
    return { entry, lines: [`; ${row.name} (${row.unitId}) — nothing planned for this turn`] };
  }
  const own = next.idle && cast === null ? [{ code: null, comment: "nothing planned" }] : next.lines;
  return {
    entry,
    lines: [
      annotated(`UNIT ${row.unitId}`, row.name),
      ...own.map((line) => rendered(line, "  ", COMMENT_COLUMN)),
      ...turnBlockLines(later, "  ", COMMENT_COLUMN)
    ]
  };
}

/** `; Turns 73–76 are written ahead as TURN blocks — …`, or null when no entry has a later turn. */
function writtenAheadLine(entries: readonly OrdersEntry[], turn: number): string | null {
  const lasts = entries.map((entry) => entry.later.at(-1)?.turn ?? null).filter((one): one is number => one !== null);
  if (lasts.length === 0) {
    return null;
  }
  const first = turn + 1;
  const last = Math.max(...lasts);
  return first === last
    ? `; Turn ${first} is written ahead as a TURN block — the plan as it stands on turn ${turn}.`
    : `; Turns ${first}–${last} are written ahead as TURN blocks — the plan as it stands on turn ${turn}.`;
}

/**
 * Next turn's `STUDY` and `TEACH` lines for every mage the planner can see.
 *
 * Next turn (`turns[0]`) as plain orders, and every later turn the plan reaches as a `TURN` block
 * after them (ah-1f87z), so a missed turn's orders do not idle the mage. The file says the later
 * blocks are a projection in a heading line, which is what the navigator required of anything
 * past next turn.
 *
 * `rows` and `notices` are what the Schedule already computed; nothing is re-projected here.
 */
export function studyOrders(input: {
  /** `plannerGroups(...)`, in its own order. */
  groups: readonly PlannerGroup[];
  /** `scheduleRows(...)` - one row per mage. */
  rows: readonly ScheduleRow[];
  /** `scheduleTurns(viewedTurn)`. Empty when no report is loaded. */
  turns: readonly number[];
  /** `plannerNotices(...)`, over the same rows and turns. */
  notices: readonly PlannerNotice[];
  /**
   * The magic tree, and whether "Also write the casts" is ticked (ah-9qdz.4). Absent or unticked,
   * nothing about casts is written - the text is exactly what it was before casts existed.
   */
  casts?: { tree: MagicTree; write: boolean };
}): StudyOrders {
  const { groups, rows, turns, notices } = input;
  const castFor = (row: ScheduleRow, index: number): OrdersCast | null =>
    input.casts?.write === true ? castOf(row, input.casts.tree, index) : null;
  const noCasts = (): OrdersCast | null => null;
  const turn = turns[0];
  // Every turn of the Schedule counts, not only next turn: a later month is written too (ah-1f87z).
  const indices = turns.map((_turn, index) => index);
  const studies = (row: ScheduleRow) => indices.some((index) => (row.cells[index]?.kind ?? "idle") !== "idle");
  const casts = (row: ScheduleRow) =>
    input.casts !== undefined && indices.some((index) => plannedHalf(row, index) !== null);
  // A cast he won't know yet is never written, so it makes no plan and is no promise (review finding 4).
  const writable = (row: ScheduleRow) =>
    input.casts !== undefined && indices.some((index) => plannedHalf(row, index)?.known === true);
  const anyStudy = rows.some(studies);
  // A planned cast counts as a plan whatever the box says: without a section there is no heading
  // to carry the box, and a player who unticked it could never tick it back (ah-9qdz.4).
  const planned = anyStudy || rows.some(writable);

  if (turn === undefined || !planned) {
    // A file of nothing but "nothing planned" comments is not orders. A plan whose every order is
    // *refused* is not this case - that is exactly what the player needs to see.
    return { sections: [], summary: null, allText: "", allFileName: "study-orders.txt" };
  }

  const sections: OrdersSection[] = [];
  for (const group of groups) {
    const mine = rows.filter((row) => row.factionId === group.factionId);
    const hasCast = mine.some(casts);
    // With no study anywhere, only the casts make a plan: a section with neither would be a file
    // of nothing but "nothing planned" comments, which is never offered (ah-9qdz.4).
    if (mine.length === 0 || (!anyStudy && !mine.some(writable))) {
      continue;
    }
    const fileName = `study-orders-${safeFileNamePart(group.factionLabel) ?? group.factionId}-turn-${turn}.txt`;
    const count = mine.filter(writable).length;
    if (input.casts?.write === false && count > 0 && !mine.some(studies)) {
      sections.push({
        factionId: group.factionId,
        heading: group.heading,
        source: group.source,
        entries: mine.map((row) => contributionOf(row, rows, notices, noCasts, turns).entry),
        hasCast,
        withheld: { casts: count },
        text: `No mage studies or teaches on turn ${turn}. Tick Also write the casts to write the ${count} planned cast${
          count === 1 ? "" : "s"
        }.`,
        fileName
      });
      continue;
    }
    const lines = [`; ${group.factionLabel} — study orders for turn ${turn}, from Atlantis HUD`];
    // The heading on screen says the sheet is old; the heading stays behind when the text is
    // copied, and the recipient is the person who most needs to know.
    const stale = group.source === "sheet" ? mine.find((row) => row.monthsUnreported > 0) : undefined;
    if (stale !== undefined) {
      // Pluralised the way `plannerGroupNote` does one file away (`studyPlanner.ts:277-278`):
      // one month stale is the commonest allied case, and this sentence is mailed to a stranger.
      const months = stale.monthsUnreported;
      lines.push(
        `; From their mage sheet of turn ${stale.sheetTurn} — ${months} month${
          months === 1 ? " of study since is" : "s of study since are"
        } estimated.`
      );
    }
    const entries: OrdersEntry[] = [];
    const body: string[] = [];
    for (const row of mine) {
      const contribution = contributionOf(row, rows, notices, castFor, turns);
      entries.push(contribution.entry);
      body.push(...contribution.lines);
    }
    // Under the heading and the stale-sheet line, so a file mailed on says the later turns are
    // a projection (ah-1f87z).
    const ahead = writtenAheadLine(entries, turn);
    if (ahead !== null) {
      lines.push(ahead);
    }
    lines.push(...body);
    sections.push({
      factionId: group.factionId,
      heading: group.heading,
      source: group.source,
      entries,
      hasCast,
      withheld: null,
      text: lines.join("\n"),
      fileName
    });
  }

  const counted = rows.filter((row) => sections.some((one) => one.factionId === row.factionId));
  const studying = counted.filter(
    (row) => row.cells[0]?.kind === "study" && row.cells[0].blocked === null
  ).length;
  const teaching = counted.filter(
    (row) => row.cells[0]?.kind === "teach" && row.cells[0].outcome.taught.length > 0
  ).length;
  const none = counted.length - studying - teaching;
  const casting = sections
    .flatMap((section) => section.entries)
    .filter((entry) => entry.cast?.kind === "write").length;
  const parts = [
    studying === 0 ? null : `${plural(studying, "mage studying", "mages studying")}`,
    teaching === 0 ? null : `${teaching} teaching`,
    none === 0 ? null : `${none} with no order this turn`,
    casting === 0 ? null : `${casting} casting`
  ].filter((part): part is string => part !== null);

  const written = sections.filter((section) => section.withheld === null);
  const lastLater = written
    .flatMap((section) => section.entries)
    .map((entry) => entry.later.at(-1)?.turn ?? null)
    .filter((one): one is number => one !== null);
  const through = lastLater.length === 0 ? "" : ` · planned through turn ${Math.max(...lastLater)}`;
  return {
    sections,
    summary:
      written.length === 0
        ? `Orders for turn ${turn} — nothing to write without the casts`
        : `Orders for turn ${turn} — ${parts.join(", ")}${through}`,
    allText: written.map((section) => section.text).join("\n\n"),
    allFileName: `study-orders-turn-${turn}.txt`
  };
}
