/**
 * Next turn's `STUDY` and `TEACH` lines, one block per faction (`ah-lyg6.4.1`).
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
};

/** Next turn's orders for every faction the planner knows about. */
export type StudyOrders = {
  /** In `groups` order. Empty when nothing at all is planned. */
  sections: OrdersSection[];
  /** `Orders for turn 72 — 3 mages studying, 1 teaching`; null when `sections` is empty. */
  summary: string | null;
  /** Every section's `text`, separated by one blank line. `""` when `sections` is empty. */
  allText: string;
  /** `study-orders-turn-72.txt`. `study-orders.txt` when there is no turn. */
  allFileName: string;
};

/** `UNIT 1234           ; Ereb` - the code part padded to the column, or one space past it. */
function annotated(code: string, comment: string): string {
  const gap = code.length >= COMMENT_COLUMN ? " " : " ".repeat(COMMENT_COLUMN - code.length);
  return `${code}${gap}; ${comment}`;
}

/** `1 mage studying`, `3 mages studying`. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The unit number of a `${factionId}/${unitId}` key. A key on an order line is one no server takes. */
function unitOf(key: string): string {
  return key.slice(key.indexOf("/") + 1);
}

/** Next turn's planned cast half, or null. */
function plannedHalf(row: ScheduleRow) {
  const half = row.castHalves[0] ?? null;
  return half !== null && half.kind === "planned" ? half : null;
}

/**
 * Next turn's cast as an entry carries it, or null when none is planned.
 *
 * Practice is judged from where he stands as the turn begins: spells are CAST, and combat fought,
 * before STUDY orders are processed (`rules/sequenceofevents`). The planner has no he/she rule, so
 * the not-known line says `he`, as ah-9qdz.2's cast half does.
 */
function castOf(row: ScheduleRow, tree: MagicTree): OrdersCast | null {
  const half = plannedHalf(row);
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
  const standing = row.standings[0] ?? new Map();
  const practice = practisedBy(spell, standing, tree);
  const level = standing.get(spell)?.level ?? 0;
  const annotation =
    practice.kind === "prerequisite"
      ? `practises ${tree.byTag.get(practice.tag)?.name ?? practice.tag} (${name} can't rise past it)`
      : practice.kind === "none"
        ? level >= (node?.maxLevel ?? Infinity)
          ? `${name} is at its maximum — no practice`
          : "no practice"
        : verb === "COMBAT"
          ? `readies ${name} for battle`
          : `practises ${name}`;
  return { kind: "write", verb, spell, name, order, annotation };
}

/** The line a cast adds to the section's text. */
function castLine(cast: OrdersCast): string {
  return cast.kind === "write" ? annotated(`  ${cast.order}`, cast.annotation) : `  ; ${cast.text}`;
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
  cast: OrdersCast | null
): { entry: OrdersEntry; lines: string[] } {
  const base = {
    key: row.key,
    unitId: row.unitId,
    name: row.name,
    regionId: row.regionId,
    cast
  };
  const cell = row.cells[0];

  if (cell === undefined || cell.kind === "idle") {
    const entry: OrdersEntry = { ...base, order: null, annotation: null, skipReason: "nothing planned" };
    if (cast !== null) {
      // A cast needs his UNIT line to belong to, so the idle comment moves under it (ah-9qdz.4).
      return {
        entry,
        lines: [annotated(`UNIT ${row.unitId}`, row.name), "  ; nothing planned", castLine(cast)]
      };
    }
    // Named rather than left out, so a mage you forgot is not indistinguishable from one you
    // meant to idle - the navigator's choice.
    return { entry, lines: [`; ${row.name} (${row.unitId}) — nothing planned for this turn`] };
  }

  let entry: OrdersEntry;
  let orderLine: string;

  if (cell.kind === "study") {
    if (cell.blocked !== null) {
      entry = { ...base, order: null, annotation: null, skipReason: cell.blocked };
      orderLine = `  ; STUDY ${cell.skill} — ${cell.blocked}`;
    } else {
      const from = row.standings[0]?.get(cell.skill)?.level ?? 0;
      // An arrow pointing at itself reads like a defect, and most months in this game buy no
      // level. ASCII `->`, not `→`: this text is mailed and pasted into strangers' order files.
      const gain = from === cell.level ? `${cell.name} ${cell.level}` : `${cell.name} ${from} -> ${cell.level}`;
      const teacher =
        cell.taughtBy === null
          ? ""
          : `, taught by ${rows.find((one) => one.key === cell.taughtBy)?.name ?? unitOf(cell.taughtBy)}`;
      entry = {
        ...base,
        order: `STUDY ${cell.skill}`,
        annotation: `${gain}${teacher}`,
        skipReason: null
      };
      orderLine = annotated(`  ${entry.order}`, entry.annotation ?? "");
    }
  } else if (cell.outcome.taught.length > 0) {
    const taughtRows = cell.outcome.taught.map(
      (key) => rows.find((one) => one.key === key)?.name ?? unitOf(key)
    );
    entry = {
      ...base,
      order: `TEACH ${cell.outcome.taught.map(unitOf).join(" ")}`,
      annotation: `teaches ${joinNames(taughtRows)}`,
      skipReason: null
    };
    orderLine = annotated(`  ${entry.order}`, entry.annotation ?? "");
  } else {
    entry = { ...base, order: null, annotation: null, skipReason: "nobody can be taught this turn" };
    // `cell.students` is empty for a live cell (ah-af7i), which nobody named - so the comment
    // names the ids only when the player wrote them down.
    const named = cell.live ? "" : cell.students.join(" ");
    orderLine = `  ; TEACH${named === "" ? "" : ` ${named}`} — ${entry.skipReason ?? ""}`;
  }

  const lines = [annotated(`UNIT ${row.unitId}`, row.name), orderLine];
  if (cast !== null) {
    lines.push(castLine(cast));
  }
  for (const notice of notices) {
    if (notice.rowKey === row.key && notice.turnIndex === 0 && notice.level === "warning") {
      lines.push(`  ; ${notice.text}`);
    }
  }
  return { entry, lines };
}

/**
 * Next turn's `STUDY` and `TEACH` lines for every mage the planner can see.
 *
 * Only turn `turns[0]`, and deliberately: the navigator chose the fixed next turn over a picker
 * because a later column is a projection and the file would not say so.
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
  const castFor = (row: ScheduleRow): OrdersCast | null =>
    input.casts?.write === true ? castOf(row, input.casts.tree) : null;
  const turn = turns[0];
  // A planned cast counts as a plan whatever the box says: without a section there is no heading
  // to carry the box, and a player who unticked it could never tick it back (ah-9qdz.4).
  const planned = rows.some(
    (row) =>
      (row.cells[0]?.kind ?? "idle") !== "idle" || (input.casts !== undefined && plannedHalf(row) !== null)
  );

  if (turn === undefined || !planned) {
    // A file of nothing but "nothing planned" comments is not orders. A plan whose every order is
    // *refused* is not this case - that is exactly what the player needs to see.
    return { sections: [], summary: null, allText: "", allFileName: "study-orders.txt" };
  }

  const sections: OrdersSection[] = [];
  for (const group of groups) {
    const mine = rows.filter((row) => row.factionId === group.factionId);
    if (mine.length === 0) {
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
    for (const row of mine) {
      const contribution = contributionOf(row, rows, notices, castFor(row));
      entries.push(contribution.entry);
      lines.push(...contribution.lines);
    }
    sections.push({
      factionId: group.factionId,
      heading: group.heading,
      source: group.source,
      entries,
      hasCast: mine.some((row) => plannedHalf(row) !== null),
      text: lines.join("\n"),
      fileName: `study-orders-${safeFileNamePart(group.factionLabel) ?? group.factionId}-turn-${turn}.txt`
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

  return {
    sections,
    summary: `Orders for turn ${turn} — ${parts.join(", ")}`,
    allText: sections.map((section) => section.text).join("\n\n"),
    allFileName: `study-orders-turn-${turn}.txt`
  };
}
