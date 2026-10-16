import type {
  ItemChange,
  ItemChangeParty,
  NoStudyFee,
  RefusedCast,
  SilverChange,
  SkillInfo,
  SkillMerge,
  StudyForecast,
  UnitMovementMode,
  UnitSilver
} from "@atlantis/core-client";
import { count } from "./plural";
import { isSilver, withoutSilver } from "./silverTag";
import { sameLongOrder, type ReportedLongOrder } from "./ordersDocument";
import { battleSkillGroups, battleSkillSource } from "./battleSkillPresentation";
import type { DerivedSkill } from "./battleSkills";
import { FLAG_SETTINGS, flagState, unsettledFlags } from "./unitFlags";
import { describeMenBriefly, whyEstimated } from "./unitComposition";
import { presentUnitMovement } from "./unitMovement";
import {
  buildSpendTarget,
  changeFor,
  hasUncertainTransport,
  itemsTooltip,
  originalTooltip,
  type PreviewedUnit
} from "./unitPreview";
import { summariseUnit } from "./unitTooltip";
import { andList, refusedProductReason, shortItems, shortName, shortSentence } from "./refusedCast";
import { isUnfinishedShipName, type StructureFinish } from "./unfinishedMark";
import {
  silverCauseGroups,
  silverCauseLabel,
  silverNoteLines,
  type SilverCauseGroup,
  type SilverFacts
} from "./silverVocabulary";
import {
  atMost,
  monthLostToAnUnreadLine,
  NOT_KNOWN,
  shareBoundedByAnUnreadUnit,
  silverWasNeverRead
} from "./unitRead";
import {
  COLUMN_LABELS,
  silverIsRed,
  silverShownUI,
  unitRowKey,
  type ExtraColumn,
  type ShownSilver,
  type UnitColumn,
  type UnitRowKey
} from "./unitTable";

/**
 * What resting the pointer on one cell of the units table says.
 *
 * One place decides it, for every column, so the cell's hidden sentence for a screen reader and
 * the popup the eye sees can never disagree: both are this module's answer, drawn twice. It is
 * pure and holds no React, because `packages/shared` has no jsdom and a rule that lives in a
 * component there cannot be tested at all (`.cerebro/traps.md`).
 *
 * It sits at a leaf of the import graph. `unitPreview` already imports from `unitTooltip`, and all
 * three import `silverVocabulary`, so this module may import from all of them and none may import
 * it back.
 */

/** A column of the table as the resolver sees it: one of its own, or one a source added. */
export type PopupColumn = UnitColumn | ExtraColumn;

/**
 * How a figure moved this month (decision **R1**, `ah-rgkk.6`).
 *
 * `from` is what the report said, grouped as the line's own `value` is; `value` is where it stands
 * now. The two together are the pair the popup draws, and `direction` is what colours the second
 * of them.
 */
export type PopupChange = { direction: "up" | "down"; from: string };

/**
 * One figure in a Skills line's chain (`ah-rgkk.2.3`).
 *
 * `mark` is how this figure stands against the one before it, which is what colours it. `reported`
 * is always the first step and is never coloured; `projected` is next turn's and is drawn in the
 * selection blue whichever way it moved, because what marks it out is that it has not happened.
 */
export type PopupStep = {
  /** `2 (90)`, or the words `none` and `gone` for a skill the unit did not or does not hold. */
  value: string;
  mark: "reported" | "up" | "down" | "flat" | "projected";
  /** A trailing `?`: the projection rests on something this report cannot settle (decision **U2**). */
  uncertain?: boolean;
};

/** One line of a column popup. */
export type PopupLine = {
  /** What it is, on the left. Lower case, as the report writes item and skill names. */
  label: string;
  /** What it stands at, on the right, already formatted. */
  value: string;
  /** Absent where nothing changed. */
  change?: PopupChange;
  /**
   * The figures this line moved through, when there is more than one to show (`ah-rgkk.2.3`).
   *
   * Present only with **two or more** entries, and only on the Skills column. The first entry is
   * always `reported`; `value` above is the figure the line stands at **now**, which is the last
   * entry that is not `projected` - a projection is not what the unit stands at. `steps` and
   * `change` are never both set.
   */
  steps?: readonly PopupStep[];
  /**
   * How this line stands against its neighbours (`ah-rgkk.5.1`).
   *
   * `deciding` is the carrying capacity the unit's mode rests on - the one its load has to beat;
   * `aside` is one that does not apply. Absent on every other line and every other column, which
   * are drawn exactly as they are today.
   */
  stress?: "deciding" | "aside";
  /** One clause saying why it moved, e.g. `4 bought at 60 silver each`. Absent where unknown. */
  why?: string;
  /**
   * How to ink a value that is not a pair - a signed amount on a ledger line (`ah-rgkk.4.3`).
   *
   * The same two inks decision **R1** puts on the after of a pair, for the same reason: the sign
   * already says the direction, so this is decoration, and `popupAsText` says nothing about it.
   */
  tone?: "up" | "down";
  /**
   * Which side of the line the unfinished mark is drawn before (`ah-2ql5`): an unfinished ship's
   * own name on the left, or the unfinished building a unit stands in on the right. Absent on
   * every other line. Decoration: the words beside it already say "unfinished", so
   * `popupAsText` reads nothing for it.
   */
  unfinished?: "label" | "value";
  /**
   * What a refused CAST would have made (`ah-44at`): the whole line is drawn struck through and
   * dimmed. Decoration, like `unfinished`: the reason sentence under the lines says it will not be
   * made, so `popupAsText` reads nothing for it.
   */
  struck?: true;
  /**
   * Silver a TRANSPORT would send that the forecast could not count (`ah-9qzs`): the whole line is
   * drawn dimmed and italic, and it is in no total. Decoration, like `struck`: its label already
   * says "not counted", so `popupAsText` reads nothing for it.
   */
  uncounted?: true;
};

/** What one column's popup shows. */
export type ColumnPopup = {
  /** `Braves (1487) — items`. */
  title: string;
  /** At most `MAX_LINES`; `popupForCell` caps them and adds the "and N more" note. */
  lines: PopupLine[];
  /** Dim sentences under the lines, in order, each ending with a full stop. */
  notes: string[];
  /** One amber sentence, or null. */
  warning: string | null;
  /**
   * Whether this month changes the cell - see `PopupMonth`. The shared no-change sentence is added
   * only for `unchanged`, and not even then where the popup words its month itself (the flags, the
   * silver ledger, a long order neither side has), so `unchanged` alone does not mean the popup
   * says nothing changes.
   */
  month: PopupMonth;
};

/**
 * What this month does to a cell, as the column's own data says (`ah-v3ro`).
 *
 * `changes`: the month's figure differs from the report's, or something this month moved it and
 * moved it back. `unchanged`: the month was compared with the report and left it alone. `null`:
 * nothing was compared - no baseline, or a unit whose month the report does not show. Worked out
 * from what the body was built from, never from what it happened to draw, so a new shape of line
 * cannot make "Nothing this month changes this." false (`ah-ymms`, `ah-30y0`).
 */
export type PopupMonth = "changes" | "unchanged" | null;

/** A month stated from whether anything moved it. */
const monthOf = (moved: boolean): PopupMonth => (moved ? "changes" : "unchanged");

/** What resting on a cell of this column opens. */
export type PopupSpec =
  | { kind: "silent" }
  | { kind: "unit" }
  | { kind: "column"; popup: ColumnPopup };

/**
 * What the row has already worked out, so the resolver derives nothing the table has not already
 * decided and the two can never disagree.
 */
export type PopupFacts = {
  /** `unitStructureLabel(unit.structureId, structuresById)`, or null in the open. */
  structureLabel: string | null;
  /**
   * The structure this month's orders moved the unit **out of**, labelled exactly as
   * `structureLabel` is - so the two sides of a move read the same way (`ah-rgkk.5.3`).
   *
   * `null` both when the report found the unit in no structure and when nothing moved it. Those
   * are told apart by the unit's own `structureId` change, which is the only thing that puts this
   * field on screen at all.
   */
  reportedStructureLabel: string | null;
  /** `getLongOrder(...)` for one of ours; null for a foreign unit and for none written. */
  longOrder: string | null;
  /**
   * What the report's own orders template said this unit's long order was (`ah-rgkk.5.4`).
   *
   * Required, exactly as `longOrder` is: there are three construction sites and every one of them
   * must answer it. A foreign unit's value is never read - the body answers on `own` first.
   */
  reportedLongOrder: ReportedLongOrder;
  /** `getSilver(...)`, or null for a unit with no forecast. */
  silver: UnitSilver | null;
  /** Whether a `not-enough-silver` or `upkeep-exceeds-unclaimed` finding names this unit. */
  silverWarned: boolean;
  /**
   * Whether this unit's hex carries a silver finding anchored to the hex, naming no unit
   * (`ah-5znb`). Absent means no.
   */
  silverHexShort?: boolean;
  /** The Silver column's upkeep setting (`ah-1wcw.4`). */
  countUpkeep: boolean;
  /** Battle-recovered skills for this unit, or `[]` (`ah-1mpx.6.3`). */
  derivedSkills: readonly DerivedSkill[];
  /**
   * Whether `rules/form` dissolves this row before the month ends (`ah-ty3s.3`).
   *
   * The Silver cell already draws `no month end` for one of these, so the popup must not read out
   * a working the cell itself refuses to show.
   */
  dissolving: boolean;
  /**
   * Whether the structure this row stands in at the month's end is unfinished, or unfinished in
   * the report and finished by this month's `BUILD`s (`ah-2ql5`). `structureFinishState`'s
   * answer, which the table's cell is drawn from too.
   */
  structureFinish: StructureFinish;
  /**
   * Every row the table is drawing, by `unitRowKey` - the hex *and* the number - for naming a
   * giver or a taker (`ah-rgkk.2.3`). By hex as well, because a `FORM` alias is unique to a hex
   * and not to the turn: two hexes each drawing a `new-1` would otherwise have one named after
   * the other's row (`ah-wyxx.2`). A `GIVE` and a `TAKE FROM` are both within one hex, so the
   * source is almost always a row the table already holds in the receiver's own hex; one it does
   * not is named `unit 1502`.
   */
  unitNames: ReadonlyMap<UnitRowKey, string>;
};

/** Columns that say nothing when the pointer rests on them (decision **E2**). */
const SILENT: ReadonlySet<PopupColumn> = new Set<PopupColumn>([
  "own",
  "faction",
  "hex",
  "seen",
  "remove"
]);

/** Columns whose popup is the whole-unit summary the table has shown all along (decision **D1**). */
const WHOLE_UNIT: ReadonlySet<PopupColumn> = new Set<PopupColumn>(["name", "unitId"]);

/** Whether resting on this column opens anything at all. Column-only; no unit is needed. */
export function columnHasPopup(column: PopupColumn): boolean {
  return !SILENT.has(column);
}

/**
 * Whether this column's popup is one of its own rather than the whole-unit summary — which is the
 * same question as whether its cell has a sentence to carry for a screen reader.
 *
 * Column-only, so the table can build that list rather than keep one by hand: a column added to
 * the table and forgotten here would silently lose its explanation instead of failing.
 */
export function columnHasOwnPopup(column: PopupColumn): boolean {
  return columnHasPopup(column) && !WHOLE_UNIT.has(column);
}

/** The report's own figure for one item, keyed by tag, as the `items` change recorded it. */
export type ReportedItems = Map<string, number>;

/** One token of the `items` change's original: a whole amount and a bare tag, and nothing else. */
const REPORTED_ITEM = /^(-?\d+) (\S+)$/;

/**
 * The report's per-item figures, parsed out of the `items` change's display string.
 *
 * `changes()` builds that string as `format!("{} {}", item.amount, item.tag)` joined with `", "`
 * (`crates/core/src/orders/effects.rs`), so it is `20 SILV, 3 GRAI` and nothing else - no name, no
 * thousands grouping, no cast range. `undefined` when any token fails to parse, which is the
 * signal to quote the string instead of drawing pairs from it.
 *
 * An empty original is an **empty map, not `undefined`**: a formed unit has no original and so
 * never any change at all (`changes()` returns early on `self.original == None`), so an empty
 * `items` original can only mean the report showed this unit holding nothing - a figure, not a
 * gap. That is the one place this column parts company with `markOrQuote`'s empty-original guard,
 * which is about `men`, where `""` means the report never recorded it.
 */
export function reportedItems(original: string): ReportedItems | undefined {
  if (original === "") {
    return new Map();
  }
  const items: ReportedItems = new Map();
  for (const token of original.split(", ")) {
    const match = REPORTED_ITEM.exec(token);
    if (!match) {
      return undefined;
    }
    const amount = Number.parseInt(match[1]!, 10);
    if (Number.isNaN(amount)) {
      return undefined;
    }
    items.set(match[2]!, amount);
  }
  return items;
}

/**
 * The report's own flag list, parsed out of the `flags` change's display string.
 *
 * `changes()` builds it as `original.flags.join(", ")` (`crates/core/src/orders/effects.rs`), so it
 * is `behind, on guard` and nothing else. Splitting on `", "` is safe only because every element is
 * a `KNOWN_FLAGS` literal and none of them contains a comma.
 *
 * An empty original is an **empty list**, not a parse failure: a formed unit records no change at
 * all, so an empty `flags` original can only mean the report showed this unit carrying none.
 */
export function reportedFlags(original: string): readonly string[] {
  return original === "" ? [] : original.split(", ");
}

/**
 * The item's display name alone - `grain`, not `grain GRAI` - which both its line's label and its
 * cause sentence are built from, so the two can never disagree.
 *
 * A gone item is the case that needs the fallbacks: `unit.items` no longer holds it, so the name
 * comes from its first movement, and the bare tag is all that is left when there is none. The
 * `items` change's original carries no names at all (`crates/core/src/orders/effects.rs`).
 */
function itemName(tag: string, unit: PreviewedUnit): string | undefined {
  // A material a refused cast leaves short is named to agree with the figure it ends at - the core
  // names a movement by the catalogue's singular, and `-75` is not one (`ah-44at`).
  const short = shortItems(unit).find((item) => item.tag === tag);
  return (
    unit.items.find((item) => item.tag === tag)?.name ??
    (short ? shortName(short) : undefined) ??
    (unit.itemChanges ?? []).find((change) => change.tag === tag)?.name
  );
}

/** The same name, falling back to the bare tag - which is what a cause sentence is led by. */
function itemLabel(tag: string, unit: PreviewedUnit): string {
  return itemName(tag, unit) ?? tag;
}

/**
 * One item's line, before the cap: what it is, what it stands at, and where it came from. A struck
 * line carries the refused cast it stands for, whose reason is its cause sentence (`ah-44at`).
 */
export type ItemLine = { tag: string; line: PopupLine; moved: boolean; refused?: RefusedCast };

/**
 * The `items` popup's lines, in the order they are drawn.
 *
 * The tags are the union of what the unit holds now, what the report listed, this month's
 * production, and every item this month's movements name. An item given away in full still has a
 * line ending at `gone`, including one the unit produced, or was given, and passed on in the same
 * turn (`ah-dqvi`), while one that arrived this month starts at `none`.
 */
export function itemLines(unit: PreviewedUnit, reported: ReportedItems | undefined): ItemLine[] {
  const changes = unit.itemChanges ?? [];
  const held = new Map(unit.items.map((item) => [item.tag, item]));
  // The same arithmetic `formatItems` does (`unitPreview.ts`), because the cell under the pointer
  // is drawn from it: it says `2-5 SWOR`, so the popup must not answer `5`.
  const shortfall = new Map<string, number>();
  for (const item of unit.created ?? []) {
    shortfall.set(item.tag, (shortfall.get(item.tag) ?? 0) + (item.most - item.fewest));
  }
  // Silver is answered for by the SILVER column and its popup alone (`ah-6m7b.5.1`), so it is
  // neither a line of its own nor a `gone` line for what the report listed and the month spent.
  // A tag the month only passed through - given to a sharer and lent on to a faction-mate's
  // BUILD - is neither held, reported nor produced, so its movements name it too (`ah-dqvi`).
  const tags: string[] = [];
  for (const tag of [
    ...held.keys(),
    ...(reported?.keys() ?? []),
    ...(unit.produced ?? []).map(({ tag }) => tag),
    ...changes.map(({ tag }) => tag)
  ]) {
    if (!isSilver(tag) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }

  // Decision **B**: everything the month moved first, in the month's own order, so no movement is
  // ever lost to the cap - then a moved tag the core recorded no change for, then the rest. Inside
  // the last two, the cell's own amount-descending order.
  // Keyed on the order tags *first* appear, not on the raw index of each change: one tag bought at
  // four prices writes four entries, and ranking on the raw index would run a later tag's rank
  // past the two fallback bands below and sort an unmoved item ahead of a moved one.
  const monthOrder = new Map<string, number>();
  for (const change of changes) {
    if (!monthOrder.has(change.tag)) {
      monthOrder.set(change.tag, monthOrder.size);
    }
  }

  // What a refused cast leaves short, and what the report listed for a tag - or, with no `items`
  // change to say, what the unit holds now, since then the month left the list as it was.
  const short = new Map(shortItems(unit).map((item) => [item.tag, item.figure]));
  const reportedOr = (tag: string): number | undefined =>
    reported === undefined ? held.get(tag)?.amount : reported.get(tag);

  const lines = tags.map((tag) => {
    const item = held.get(tag);
    const name = itemName(tag, unit);
    const before = reported?.get(tag);
    const amount = item?.amount;
    const moved =
      changes.some((change) => change.tag === tag) ||
      (before !== undefined && before !== (amount ?? 0)) ||
      (before === undefined && reported !== undefined);
    const line: PopupLine = {
      label: name === undefined ? tag : `${name} ${tag}`,
      value: amount === undefined ? "gone" : rangedValue(amount, shortfall.get(tag) ?? 0),
      // An unfinished ship keeps its mark on every line naming it, a `gone` one included
      // (`ah-2ql5`): the report's own words lead the line, and the mark goes before them.
      ...(isUnfinishedShipName(name) ? { unfinished: "label" as const } : {})
    };
    const figure = short.get(tag);
    if (figure !== undefined) {
      // A refused cast's short material ends at its red minus figure (`ah-44at`, Q1 A), paired
      // from what the report listed - which, with no `items` change at all, is what it holds now.
      const from = reportedOr(tag);
      return {
        tag,
        line: {
          ...line,
          value: figure.toLocaleString(),
          change: { direction: "down" as const, from: from === undefined ? "none" : from.toLocaleString() }
        },
        moved: true,
        amount: figure
      };
    }
    const change = changeOf(before, amount, reported);
    return { tag, line: change ? { ...line, change } : line, moved, amount: amount ?? 0 };
  })
    .sort((a, b) => rank(a, monthOrder) - rank(b, monthOrder) || b.amount - a.amount)
    .map(({ tag, line, moved }): ItemLine => ({ tag, line, moved }));

  // What each refused cast would have made, struck through (`ah-44at`, Q3 B), right after the
  // month's recorded movements so the cap never drops one ahead of an item the month left alone.
  const struck: ItemLine[] = (unit.refusedCasts ?? []).flatMap((cast) => {
    const product = cast.product;
    if (!product) {
      return [];
    }
    const from = reportedOr(product.tag);
    return [
      {
        tag: product.tag,
        line: {
          label: `${itemName(product.tag, unit) ?? product.name} ${product.tag}`,
          value: rangedValue((from ?? 0) + product.most, product.most - product.fewest),
          change: { direction: "up", from: from === undefined ? "none" : from.toLocaleString() },
          struck: true
        },
        moved: true,
        refused: cast
      }
    ];
  });
  const afterTheMonth = lines.filter((entry) => monthOrder.has(entry.tag)).length;
  return [...lines.slice(0, afterTheMonth), ...struck, ...lines.slice(afterTheMonth)];
}

/**
 * Which block a line sorts into: its place in the month for a recorded movement, then a movement
 * the core did not record, then everything the month left alone.
 */
function rank(
  entry: { tag: string; moved: boolean },
  monthOrder: ReadonlyMap<string, number>
): number {
  const inMonth = monthOrder.get(entry.tag);
  if (inMonth !== undefined) {
    return inMonth;
  }
  return entry.moved ? monthOrder.size : monthOrder.size + 1;
}

/**
 * One item's figure as the cell writes it: the amount, or the range a pending cast leaves it
 * between. Grouped, as every other popup figure is.
 */
function rangedValue(amount: number, gap: number): string {
  return gap > 0
    ? `${(amount - gap).toLocaleString()}-${amount.toLocaleString()}`
    : amount.toLocaleString();
}

/**
 * The pair one item's line draws, or nothing at all.
 *
 * A tag held now but absent from the report pairs from `none`; a tag the report listed and the
 * unit no longer holds ends at `gone` and moves `down`.
 */
function changeOf(
  before: number | undefined,
  amount: number | undefined,
  reported: ReportedItems | undefined
): PopupChange | undefined {
  if (reported === undefined) {
    return undefined;
  }
  const now = amount ?? 0;
  if (before === now) {
    return undefined;
  }
  return {
    direction: now > (before ?? 0) ? "up" : "down",
    from: before === undefined ? "none" : before.toLocaleString()
  };
}

/**
 * One changed item's movements as a single sentence, e.g.
 * `grain: sold 12 at 12 silver each, sent 20 to Ferry (4102).` (decision **S2**).
 *
 * `label` is the item's display name alone - `grain`, not `grain GRAI` - and is left lower case,
 * because it is the same word that leads the line above. `sentence()` is deliberately not applied.
 *
 * Movements are neither merged nor capped: one clause each, in the month's order, so a unit that
 * bought one tag at four prices gets four clauses in one wrapping sentence - the cost the
 * navigator accepted with **S2**. `undefined` when there is nothing to say.
 */
export function itemCauseSentence(
  label: string,
  changes: readonly ItemChange[],
  unit: PreviewedUnit,
  /**
   * These are people. A market purchase of men is a recruitment rather than a purchase of goods
   * (`rules/buy`, `rules/economy_recruiting`, New Origins v8.0.0), so the `bought` clause says so.
   */
  people?: boolean
): string | undefined {
  // A ship this month's building finishes has its own agreed words, which are a sentence of their
  // own rather than a clause after the item's name (`ah-2ql5` mockup 6a, `ah-uxmh`).
  if (changes.length > 0 && changes.every((change) => change.cause === "ship-finished")) {
    return SHIP_FINISHED_NOTE;
  }
  const clauses = changes.map((change) => itemCauseClause(change, unit, people === true));
  return clauses.length === 0 ? undefined : `${label}: ${clauses.join(", ")}.`;
}

/** The Items hover's note for a ship this month's building finishes (`ah-2ql5`, the agreed words). */
const SHIP_FINISHED_NOTE = "Finished this month: becomes a ship.";

/** The other unit of a movement, as `ah-rgkk.2.3` settled it: `Scouts (1502)`, or `unit 1502`. */
function party(other: ItemChangeParty): string {
  return other.name === null ? `unit ${other.unitId}` : `${other.name} (${other.unitId})`;
}

/** One movement, as a fragment. The clauses are joined with `, ` and closed with one full stop. */
function itemCauseClause(change: ItemChange, unit: PreviewedUnit, people: boolean): string {
  const n = Math.abs(change.delta);
  const each = change.unitPrice === null ? "" : ` at ${change.unitPrice} silver each`;
  switch (change.cause) {
    case "bought":
      return `${people ? "recruited" : "bought"} ${n}${each}`;
    case "sold":
      return `sold ${n}${each}`;
    case "withdrawn":
      return `withdrew ${n} from the faction's stores`;
    case "produced":
      return `produced ${n}`;
    case "production-spent":
      return change.other ? `used ${n} for ${party(change.other)} to produce` : `used ${n} as material`;
    case "build-spent":
      return `spent ${n} ${buildSpendPlace(change, unit)}`;
    // `newage trident rules/share`: a sharing unit supplies another unit's production; the
    // spend that follows on this row says what it went into (`ah-jm7c`).
    case "drawn-from-sharer":
      return `drew ${n}${change.other ? ` from ${party(change.other)}'s shared stock` : ""}`;
    case "cast-created":
      return castCreatedClause(change, unit, n);
    case "cast-spent":
      return `consumed ${n} by a spell`;
    // `newage trident rules/create_village` consumes the founders and their wagons (`ah-mw1r.3`).
    case "create-spent":
      return `used ${n} to found a village`;
    // `newage trident rules/quest` hands in the tokens a QUEST ... DISCOUNT names (`ah-mw1r.4`).
    case "quest-spent":
      return `handed in ${n} on a quest`;
    // `newage trident rules/explore` consumes the resource map EXPLORE RMAP studies (`ah-mw1r.4`).
    case "explore-spent":
      return `used ${n} to explore`;
    case "transported-out":
      return change.other && change.other.name === null
        ? `sent ${n} to unit ${change.other.unitId}, which your report does not show`
        : `sent ${n}${change.other ? ` to ${party(change.other)}` : ""}`;
    case "transported-in":
      return `received ${n}${change.other ? ` from ${party(change.other)}` : ""}`;
    case "abandoned":
      return "left behind, unfinished, when the unit leaves the hex";
    // Alone, a finished ship reads `SHIP_FINISHED_NOTE` instead; this is its part of a longer list.
    case "ship-finished":
      return "finished this month";
    case "given-away":
      // `ah-rgkk.3.2` reserves a null party for a GIVE to a foreign faction that names no unit.
      return change.other ? `gave ${n} to ${party(change.other)}` : `gave ${n} to another faction`;
    // A sharer's goods paid for another unit's GIVE (newage trident `rules/share`): the sharer
    // lent them for that GIVE and gave nothing itself (`ah-49is`, the agreed words).
    case "lent-for-give":
      return `lent ${n}${change.borrower ? ` for ${party(change.borrower)}` : ""} to give to ${lentReceiver(change.other)}`;
    case "was-given":
      return `given ${n}${change.other ? ` by ${party(change.other)}` : ""}`;
    case "took":
      return `took ${n}${change.other ? ` from ${party(change.other)}` : ""}`;
    case "was-taken-from":
      return `${n} taken${change.other ? ` by ${party(change.other)}` : ""}`;
    case "discarded":
      return `discarded ${n}`;
    case "gift-reverted":
      return `${n} reverted from a unit that formed with nobody`;
    case "eaten-for-upkeep":
      return `${n} eaten for upkeep`;
    // Required rather than defensive: `ItemChangeCause` is a string union, so a cause from a newer
    // core is compile-time impossible and runtime real, and `ah-rgkk.3.1` asks a reader to treat
    // one as "moved, reason not stated". Deliberately not an exhaustiveness `never`.
    default:
      return change.delta > 0 ? `gained ${n}` : `lost ${n}`;
  }
}

/**
 * The receiver of a GIVE a sharer lent for (`ah-49is`): the party, a number the report does not
 * show, or - with no party, as the core leaves another faction's unit - another faction.
 */
function lentReceiver(other: ItemChangeParty | null): string {
  if (other === null) {
    return "another faction";
  }
  return other.name === null ? `unit ${other.unitId}, which your report does not show` : party(other);
}

/** What a BUILD spend went into, named from the unit's own `built` list where one matches. */
function buildSpendPlace(change: ItemChange, unit: PreviewedUnit): string {
  if (change.other) {
    return `for ${party(change.other)} to build`;
  }
  // A New Age month may spend two materials on one build, so the spend is found by whichever of
  // its materials this change names (`crates/core/src/orders/semantics.rs`).
  const spend = (unit.built ?? []).find((entry) =>
    entry.materials.some((material) => material.tag === change.tag)
  );
  return spend ? buildSpendTarget(spend) : "on a build";
}

/** A cast's own words, and its range where the spell's yield is not yet settled. */
function castCreatedClause(change: ItemChange, unit: PreviewedUnit, n: number): string {
  // Summed across every cast of the tag, because one unit may cast the same item twice and a
  // single entry would report one spell's range as the month's.
  const casts = (unit.created ?? []).filter((entry) => entry.tag === change.tag);
  const fewest = casts.reduce((total, entry) => total + entry.fewest, 0);
  const most = casts.reduce((total, entry) => total + entry.most, 0);
  const figure = casts.length > 0 && fewest !== most ? `${fewest}-${most}` : `${n}`;
  return casts.some((entry) => entry.summoned)
    ? `summoned ${figure}`
    : `created ${figure} by casting`;
}

/** How many lines a popup shows before it stops and counts the rest (decision **G-d**). */
export const MAX_LINES = 12;

/**
 * The four words `movement_status_label` writes (`crates/core/src/orders/effects.rs`), ranked as
 * the game picks a mode: it tries fly, then ride, then walk, and refuses a MOVE order when none of
 * them will carry the load (`rules/movement_normal`).
 */
const MOVEMENT_RANK: Record<string, number> = {
  Overloaded: 0,
  Walking: 1,
  Riding: 2,
  Flying: 3
};

/** The three capacities, in the order the report prints them, and what the popup calls them. */
const CAPACITY_LINES: readonly { mode: UnitMovementMode; label: string }[] = [
  { mode: "fly", label: "can carry flying" },
  { mode: "ride", label: "can carry riding" },
  { mode: "walk", label: "can carry walking" }
];

/**
 * The field of `previewChanges` each column's cell is drawn from, for the columns the orders can
 * change. The two columns with no field - `longOrder` and `silver` - work out their month themselves.
 */
const CHANGE_FIELD: Partial<Record<PopupColumn, string>> = {
  men: "men",
  movement: "movement",
  // `flags` is deliberately absent: `flagsBody` reads its own change (`ah-rgkk.5.2`), and the
  // `Was: ...` fallback for an empty body cannot fire, because this body is never empty.
  skills: "skills",
  items: "items",
  // The report's own field name, which is not the column's: a structure change is recorded
  // against `structureId` (`UnitTableDock.tsx`, `structureChange`).
  structure: "structureId"
};

/** The columns whose popup lists several things, so the no-change sentence reads as a plural. */
const LISTS: ReadonlySet<PopupColumn> = new Set<PopupColumn>(["skills", "items"]);

export function popupForCell(
  column: PopupColumn,
  unit: PreviewedUnit,
  facts: PopupFacts
): PopupSpec {
  if (SILENT.has(column)) {
    return { kind: "silent" };
  }
  if (WHOLE_UNIT.has(column)) {
    return { kind: "unit" };
  }

  const body = bodyFor(column, unit, facts);
  const field = CHANGE_FIELD[column];
  const change = field ? changeFor(unit, field) : undefined;
  const notes = [...(body.heading ? [body.heading] : []), ...body.causes, ...body.notes];
  if (saysNothingChanges(body)) {
    notes.push(`Nothing this month changes ${LISTS.has(column) ? "these" : "this"}.`);
  }
  // A column with nothing left to show - moved out of its structure, its last flag dropped, its
  // movement no longer disclosed - has no line for the report's own figure to hang off, and
  // dropping it would lose what the cell's `title` used to say. It becomes a sentence instead.
  //
  // On the emptiness of the body, and deliberately not on "no line carries the change": a line
  // that carries none may be saying there was none - `markOrQuote` returns nothing at all for an
  // original equal to the figure beside it, and the wider test said `Was: 12.` of a figure that
  // did not move.
  if (change && body.lines.length === 0) {
    notes.push(sentence(originalTooltip(change)!));
  }

  // Capped rather than scrolled: the popup is transparent to the pointer, so a wheel over it
  // reaches the table underneath and scrolls the rows out from under the hover that opened it.
  const dropped = Math.max(0, body.lines.length - MAX_LINES);
  if (dropped > 0) {
    notes.unshift(`… and ${dropped} more; select the unit to see them all.`);
  }

  return {
    kind: "column",
    popup: {
      title: `${unit.name} (${unit.unitId}) — ${COLUMN_LABELS[column as UnitColumn]?.toLowerCase() ?? column}`,
      lines: body.lines.slice(0, MAX_LINES),
      notes,
      warning: body.warning ?? null,
      month: body.month
    }
  };
}

/**
 * Whether a popup ends with "Nothing this month changes this." - decided here and nowhere else.
 *
 * From the body's `month` alone (`ah-v3ro`). It used to be inferred from what the body drew - a
 * cause, a pair, a chain - and each new shape of line had to be taught to it after shipping a false
 * sentence: movements netting to zero (`ah-ymms`), then a studied skill's projected step
 * (`ah-30y0`). A body that words its month line by line (`worded`) never gets it either.
 */
function saysNothingChanges(body: Body): boolean {
  return body.month === "unchanged" && body.worded !== true;
}

type Body = {
  lines: PopupLine[];
  /** A sentence drawn above everything else, for a body with nothing to list: `No skills.` */
  heading?: string;
  /**
   * The sentences saying how this month moved what the column shows, drawn first, ahead of
   * `notes`.
   */
  causes: string[];
  /** Everything else the popup says: what the figures are, what is missing, what is guessed. */
  notes: string[];
  warning?: string | null;
  /** Whether this month changes the cell, worked out from the body's data (`PopupMonth`). */
  month: PopupMonth;
  /**
   * The body already says, line by line or in its own words, whether the month moved it, so the
   * shared sentence would only repeat it: the flags (`ah-rgkk.5.2`), the silver ledger, and a long
   * order neither side has.
   */
  worded?: true;
};

/** What one column has to say, before the shared capping and change sentence are applied. */
function bodyFor(column: PopupColumn, unit: PreviewedUnit, facts: PopupFacts): Body {
  switch (column) {
    case "men":
      return menBody(unit, facts);
    case "movement":
      return movementBody(unit);
    case "flags":
      return flagsBody(unit);
    case "skills":
      return skillsBody(unit, facts);
    case "items":
      return itemsBody(unit, facts);
    case "structure":
      return structureBody(unit, facts);
    case "longOrder":
      return longOrderBody(unit, facts);
    case "silver":
      return silverBody(unit, facts);
    default:
      return { lines: [], causes: [], notes: [], month: null };
  }
}

/**
 * A change the popup can draw as a pair, or one it can only quote.
 *
 * Only a whole number can stand on the left of the arrow beside the figure that holds now. `~8` is
 * the report's own mark for a count it guessed at and `""` is a figure it never recorded; neither
 * is something the pair can be drawn from, so both are quoted in the report's own words instead.
 */
function markOrQuote(change: ReturnType<typeof changeFor>, now: number): Partial<PopupLine> {
  if (!change) {
    return {};
  }
  const before = Number(change.original);
  // `Number("")` is 0 and `Number.isInteger(0)` is true, so an original the report left empty
  // would otherwise read as a real figure of zero and draw a pair with nothing before the arrow.
  if (change.original.trim() === "" || !Number.isInteger(before)) {
    return { why: originalTooltip(change) };
  }
  if (before === now) {
    return {};
  }
  // Grouped the same way the figure beside it is (`describeMenBriefly`), so a four-figure pair
  // reads `4,210 → 4,255` rather than mixing two notations. Safe to re-format because the
  // guard above has already proved `before` a whole number.
  return { change: { direction: now > before ? "up" : "down", from: before.toLocaleString() } };
}

/** A sentence the app already ships as a fragment, ended the way every popup sentence ends. */
function sentence(text: string): string {
  const trimmed = text.trim();
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return capitalised.endsWith(".") ? capitalised : `${capitalised}.`;
}

/** One race's line, before the total is put above it (`ah-rgkk.4.2`). */
type RaceLine = {
  tag: string;
  line: PopupLine;
  moved: boolean;
  /** The report's figure for this race is not the one it stands at now. */
  differs: boolean;
};

/**
 * Every `ItemChange` of this unit that moved people, in the month's order.
 *
 * `isMan` is the core's answer (`ah-rgkk.4.1`) and the only one this package has: `packages/shared`
 * carries no item catalogue, by decision (`gameData.ts`).
 */
function manChanges(unit: PreviewedUnit): ItemChange[] {
  return (unit.itemChanges ?? []).filter((change) => change.isMan);
}

/**
 * The report's own per-tag figures for the Men popup, off the `items` change - not the `men` one:
 * the per-race before-figures are in the item list, and the `men` change carries only the total.
 */
function reportedFor(unit: PreviewedUnit): ReportedItems | undefined {
  const change = changeFor(unit, CHANGE_FIELD.items!);
  return change ? reportedItems(change.original) : undefined;
}

/**
 * What to call one race: its `menByRace` entry's own name - the report's own word, and so often a
 * plural - failing that the name of its first movement, failing both the bare tag.
 *
 * A race given away in full needs the second: `menByRace` no longer carries it.
 */
function raceName(unit: PreviewedUnit, tag: string): string {
  return (
    unit.menByRace.find((race) => race.tag === tag)?.name ??
    manChanges(unit).find((change) => change.tag === tag)?.name ??
    tag
  );
}

/**
 * The Men popup's per-race lines, in the order they are drawn: `menByRace`'s own order - which is
 * the item list filtered by `is_man` (`crates/core/src/report/composition.rs`), so the report's -
 * then any race the unit no longer holds, in the month's order.
 *
 * `reported` is the report's per-tag figures (`reportedFor`), or `undefined` when there is no items
 * change or its string could not be parsed - in which case no line carries a pair.
 */
function raceLines(unit: PreviewedUnit, reported: ReportedItems | undefined): RaceLine[] {
  const held = new Map(unit.menByRace.map((race) => [race.tag, race.amount]));
  const changes = manChanges(unit);
  const tags = [...held.keys()];
  for (const change of changes) {
    if (!tags.includes(change.tag)) {
      tags.push(change.tag);
    }
  }

  return tags.map((tag) => {
    const amount = held.get(tag);
    const before = reported?.get(tag);
    const line: PopupLine = {
      label: `${raceName(unit, tag)} ${tag}`,
      value: amount === undefined ? "gone" : amount.toLocaleString()
    };
    const change = changeOf(before, amount, reported);
    // Deliberately two clauses where `itemLines` has three: it also counts a tag the report never
    // listed as moved, which earns an item its place ahead of the twelve-line cap. Nothing here is
    // capped or sorted, and `moved` decides only whether a race is offered a sentence - which a
    // race with no `ItemChange` never gets anyway (`itemCauseSentence` returns nothing for an empty
    // list). Do not "fix" this into the third clause.
    const moved =
      changes.some((entry) => entry.tag === tag) ||
      (before !== undefined && before !== (amount ?? 0));
    return { tag, line: change ? { ...line, change } : line, moved, differs: change !== undefined };
  });
}

function menBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  const change = changeFor(unit, CHANGE_FIELD.men!);
  const total: PopupLine = {
    label: "men",
    value: describeMenBriefly(unit),
    ...markOrQuote(change, unit.men)
  };
  const moved = manChanges(unit);
  const unknown = unit.menOfUnknownSkill ?? [];
  const touched = moved.length > 0 || unknown.length > 0;
  const why = whyEstimated(unit);

  // An estimated headcount was never settled against the catalogue, so `men_by_race` is still the
  // report's own list while the item ledger has moved underneath it (`settle_headcounts` returns
  // early on `men_estimated`, `crates/core/src/orders/effects.rs`). Drawing race lines from it
  // would pair the report against itself.
  const entries = unit.menEstimated ? [] : raceLines(unit, reportedFor(unit));

  // The tags to explain, and the order the sentences come in: the drawn races that moved, in the
  // order their lines are drawn, then any tag that moved but has no line - which is every one of
  // them for an estimated unit, whose movements are exact even though its base figure is not.
  const explain: string[] = [];
  for (const entry of entries) {
    if (entry.moved) {
      explain.push(entry.tag);
    }
  }
  for (const change of moved) {
    if (!explain.includes(change.tag)) {
      explain.push(change.tag);
    }
  }

  const causes: string[] = [];
  for (const tag of explain) {
    const said = itemCauseSentence(
      raceName(unit, tag),
      moved.filter((change) => change.tag === tag),
      unit,
      true
    );
    if (said !== undefined) {
      causes.push(said);
    }
  }
  for (const taken of unknown) {
    causes.push(
      `${count(taken.amount, "man", "men")} taken from ${unitReference(taken.from, unit.regionId, facts)}, which your report does not show.`
    );
  }
  return {
    lines: [total, ...entries.map((entry) => entry.line)],
    causes,
    notes: why ? [sentence(why)] : [],
    // Movements that net to zero - three orcs given away and three humans recruited
    // (`ah-rgkk.4.2`) - leave no report change, and still move the cell; so do races that differ
    // from the report's while the headcount does not.
    month: monthOf(change !== undefined || touched || entries.some((entry) => entry.differs)),
    warning:
      unit.menEstimated && (touched || unit.recruitsUnmerged === true)
        ? "This unit's headcount is a guess, so what this month does to it cannot be worked out."
        : null
  };
}

function movementBody(unit: PreviewedUnit): Body {
  const movement = unit.movement;
  const change = changeFor(unit, CHANGE_FIELD.movement!);
  if (movement == null) {
    return {
      lines: [],
      causes: [],
      notes: ["Movement not disclosed."],
      month: monthOf(change !== undefined)
    };
  }
  const present = presentUnitMovement(movement);
  const lines: PopupLine[] = [
    { label: "move", value: present.label, ...movementPair(change, present.label) },
    { label: "weight", value: movement.load.toLocaleString() },
    ...CAPACITY_LINES.map(({ mode, label }) => ({
      label,
      value: movement[mode].toLocaleString(),
      stress: mode === present.active ? ("deciding" as const) : ("aside" as const)
    })),
    // `CAPACITY_LINES` is keyed by `UnitMovementMode`, which has no `swim` member, so the fourth
    // capacity is appended separately - and omitted entirely, not blanked, in a world with no
    // swimming rule.
    ...(movement.swim.kind === "absent"
      ? []
      : [
          {
            label: "can carry swimming",
            value:
              movement.swim.kind === "stated"
                ? movement.swim.capacity.toLocaleString()
                : "not stated",
            // Never `deciding`: `capacityMode` is the mode the unit's speed rests on, and
            // swimming is not a speed.
            stress: "aside" as const
          }
        ])
  ];
  const causes = movementCauses(unit);
  return {
    lines,
    causes:
      !change && causes.length > 0
        ? ["Its load changed this month, but not the mode it travels in.", ...causes]
        : causes,
    notes: [],
    // The load moving is the month moving the cell, even where the mode stays.
    month: monthOf(change !== undefined || causes.length > 0),
    warning: movementIsStillTheReport(unit)
      ? "An order this month could not be counted, so these are the report\u2019s own figures, not this month\u2019s."
      : null
  };
}

/**
 * The `move` line's pair, or the report's own words where the pair cannot be drawn.
 *
 * The core records a `movement` change only when the status word moves, and writes it as one of
 * four words rather than as a status, so the direction is a comparison of those words. A word this
 * app does not know can only have come from a newer core; it is quoted rather than ranked, the
 * same fallback `markOrQuote` uses for a figure it cannot pair.
 */
function movementPair(change: ReturnType<typeof changeFor>, now: string): Partial<PopupLine> {
  if (!change) {
    return {};
  }
  const before = MOVEMENT_RANK[change.original];
  const after = MOVEMENT_RANK[now];
  if (before === undefined || after === undefined) {
    return { why: originalTooltip(change) };
  }
  return { change: { direction: after > before ? "up" : "down", from: change.original } };
}

/**
 * One sentence per item this month moved, in the month's order, capped and counted.
 *
 * The same call the Items popup makes, so the two can never disagree about what moved or why.
 * `sentence()` is applied here and deliberately not there: in the Items popup the word repeats the
 * line drawn directly above it, and here nothing does, so it starts a sentence.
 */
function movementCauses(unit: PreviewedUnit): string[] {
  const changes = withoutSilver(unit.itemChanges ?? []);
  const tags: string[] = [];
  for (const change of changes) {
    if (!tags.includes(change.tag)) {
      tags.push(change.tag);
    }
  }
  const said: string[] = [];
  for (const tag of tags.slice(0, MAX_LINES)) {
    const forTag = changes.filter((change) => change.tag === tag);
    const text = itemCauseSentence(itemLabel(tag, unit), forTag, unit, forTag[0]!.isMan);
    if (text !== undefined) {
      said.push(sentence(text));
    }
  }
  if (tags.length > MAX_LINES) {
    said.push(`\u2026 and ${tags.length - MAX_LINES} more; the Items column has them all.`);
  }
  return said;
}

/**
 * Whether the figures above are last month's rather than this month's.
 *
 * `refresh_movement` (`crates/core/src/orders/effects.rs`) gives up on the whole recomputation and
 * hands back the report's own `movement` when any order could not be counted, or when a CAST's
 * yield is still a range. Both are visible here; a third case - an item tag the shipped ruleset
 * does not carry - is not, and is named in the bead's plan rather than guessed at.
 */
function movementIsStillTheReport(unit: PreviewedUnit): boolean {
  return (
    (unit.uncounted?.length ?? 0) > 0 ||
    (unit.created ?? []).some((entry) => entry.fewest !== entry.most)
  );
}

/** `rules/reveal`: `REVEAL UNIT`, `REVEAL FACTION`, and bare `REVEAL` "is used to cancel this". */
const REVEAL_ORDERS: Readonly<Record<string, string | undefined>> = {
  unit: "REVEAL UNIT",
  faction: "REVEAL FACTION",
  off: "REVEAL"
};

/** `rules/consume`: "CONSUME tells the unit to use silver before food items (this is the default)". */
const CONSUME_ORDERS: Readonly<Record<string, string | undefined>> = {
  "unit's food": "CONSUME UNIT",
  "faction's food": "CONSUME FACTION",
  "silver first": "CONSUME"
};

/**
 * `rules/spoils`: "The valid values for type are 'NONE', 'WALK', 'RIDE', 'FLY', 'SWIM', 'SAIL' or
 * 'ALL'", and "SPOILS NONE will instruct the unit to only collect weightless items, such as
 * silver" - which is why `weightless` is reached by `SPOILS NONE`.
 */
const SPOILS_ORDERS: Readonly<Record<string, string | undefined>> = {
  walking: "SPOILS WALK",
  riding: "SPOILS RIDE",
  flying: "SPOILS FLY",
  swimming: "SPOILS SWIM",
  sailing: "SPOILS SAIL",
  weightless: "SPOILS NONE",
  all: "SPOILS ALL"
};

/**
 * The order that put a setting into its new state, as it would be typed - `GUARD 1`, `BEHIND 0` -
 * or `undefined` where no order the preview applies could have done it.
 *
 * Every one of the eleven settings is reachable by an order the preview applies as of `ah-9g94.1`,
 * so every moved line names one; the `default` arm remains the guard for a key no setting declares.
 *
 * Guard and avoid are mutually exclusive - `rules/guard` and `rules/avoid` both say setting one
 * cancels the other - so a flag cleared by its opposite names the order the player actually wrote
 * rather than inventing the clear.
 */
function flagCause(
  key: string,
  /**
   * The state the setting came from. Every answer below is derivable from `to` and `moves` alone,
   * but the state it moved out of is what a fifth setting's cause would turn on, and the parameter
   * is the plan's own signature - so it is carried rather than dropped and re-added.
   */
  _from: string,
  to: string,
  moves: ReadonlyMap<string, { from: string; to: string }>
): string | undefined {
  const on = to === "on";
  switch (key) {
    case "guarding":
      return on ? "GUARD 1" : moves.get("avoiding")?.to === "on" ? "AVOID 1" : "GUARD 0";
    case "avoiding":
      return on ? "AVOID 1" : moves.get("guarding")?.to === "on" ? "GUARD 1" : "AVOID 0";
    case "behind":
      return on ? "BEHIND 1" : "BEHIND 0";
    case "sharing":
      return on ? "SHARE 1" : "SHARE 0";
    case "holding":
      return on ? "HOLD 1" : "HOLD 0";
    case "noAid":
      return on ? "NOAID 1" : "NOAID 0";
    case "noCross":
      return on ? "NOCROSS 1" : "NOCROSS 0";
    case "taxing":
      return on ? "AUTOTAX 1" : "AUTOTAX 0";
    case "revealing":
      return REVEAL_ORDERS[to];
    case "consuming":
      return CONSUME_ORDERS[to];
    case "spoils":
      return SPOILS_ORDERS[to];
    default:
      return undefined;
  }
}

/**
 * The sentences under the list, of which there are now at most one.
 *
 * `ah-rgkk.5.2`'s standing note - that seven flag orders never reached `read_order` - was deleted
 * with `ah-9g94`, which wired them. An own unit that was not formed this month has no note at all,
 * which is the ordinary case: the eleven lines say everything.
 */
function flagNotes(unit: PreviewedUnit): string[] {
  if (unit.own === false) {
    return ["Another faction's flags, as your report printed them. Nothing you order changes them."];
  }
  if (unit.formed) {
    // `rules/form`: a formed unit inherits its flags bar guard and autotax. It records no
    // `FieldChange` at all, so without this every one of its lines reads unchanged for no stated
    // reason.
    return [
      "Formed this month, so it inherits its flags from the unit forming it — every one but " +
        "guard and autotax, which have to be set in its own orders."
    ];
  }
  return [];
}

/**
 * The state a line is drawn quietly in: a setting resting where the report said nothing about it
 * and which nothing this month moved (decision **F3**, `ah-rgkk.5.2`). `silver first` is not among
 * them - it is `rules/consume`'s own named default, a real answer rather than an absence - and
 * neither is `all`, for the same reason as of `ah-9g94`.
 */
const QUIET_STATES: ReadonlySet<string> = new Set(["off"]);

/**
 * Every setting the game defines an order for, one line each, in `FLAG_SETTINGS` order, with the
 * ones this month moved first (decision **F3**).
 *
 * Read from `unit.flags` and nothing else - in particular never from `unit.onGuard`. The Flags cell
 * draws its letters from the same list, so a popup taking guard from anywhere else would contradict
 * on screen the cell it exists to explain (`ah-9g94` is where that defect was fixed).
 */
function flagsBody(unit: PreviewedUnit): Body {
  const change = changeFor(unit, "flags");
  const before = change ? reportedFlags(change.original) : unit.flags;

  const moves = new Map<string, { from: string; to: string }>();
  const states = FLAG_SETTINGS.map((setting) => {
    const from = flagState(setting, before);
    const to = flagState(setting, unit.flags);
    if (from !== to) {
      moves.set(setting.key, { from, to });
    }
    return { setting, from, to };
  });

  const lines: PopupLine[] = states.map(({ setting, from, to }) => {
    const move = moves.get(setting.key);
    if (!move) {
      return {
        label: setting.label,
        value: to,
        ...(QUIET_STATES.has(to) ? { stress: "aside" as const } : {})
      };
    }
    const why = flagCause(setting.key, from, to, moves);
    return {
      label: setting.label,
      value: to,
      change: { direction: to === setting.resting ? ("down" as const) : ("up" as const), from },
      ...(why ? { why } : {})
    };
  });

  const changed = lines.filter((line) => line.change);
  const rest = lines.filter((line) => !line.change);
  const passengers: PopupLine[] = unsettledFlags(unit.flags).map((flag) => ({
    label: flag,
    value: "on"
  }));

  return {
    lines: [...changed, ...rest, ...passengers],
    causes: [],
    notes: flagNotes(unit),
    month: monthOf(change !== undefined || moves.size > 0),
    // Every setting is a line saying whether it moved, so the sentence would repeat eleven of them.
    worded: true
  };
}

/**
 * A unit's own skills, or - for a foreign one, whose skills a report never prints
 * (`rules/reportformat`) - whatever the battle rosters recovered, named with the battle it came
 * from exactly as the whole-unit summary names it (`ah-1mpx.6.3`).
 */
function skillsBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  return unit.own ? ownSkillsBody(unit, facts) : foreignSkillsBody(unit, facts);
}

/**
 * A foreign unit's Skills popup: what a battle let us read, and the sentence that a report never
 * shows another faction's skills (decision **B1**, `ah-rgkk.1`).
 *
 * Lifted out of `skillsBody` unchanged by `ah-rgkk.2.3`, which rewrote only the own-unit half.
 */
function foreignSkillsBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  const change = changeFor(unit, CHANGE_FIELD.skills!);
  const quoted = change ? { why: originalTooltip(change) } : {};
  const month = monthOf(change !== undefined);

  if (unit.skills.length > 0) {
    return {
      causes: [],
      lines: summariseUnit(unit).skills.map((entry, index) => ({
        ...entry,
        ...(index === 0 ? quoted : {})
      })),
      notes: [],
      month
    };
  }

  const groups = battleSkillGroups(facts.derivedSkills);
  if (groups.length === 0) {
    return {
      causes: [],
      lines: [],
      notes: ["A report never shows another faction's skills."],
      month
    };
  }

  const recovered = groups.flatMap((group) =>
    group.skills.map((skill) => ({
      label: `${skill.name} ${skill.tag}`,
      value: String(skill.level)
    }))
  );

  return {
    causes: [],
    // The quote goes on the first recovered line, since this body has lines and so is not reached
    // by `popupForCell`'s empty-column sentence - and the cell's `title` carried it before.
    lines: recovered.map((line, index) => (index === 0 ? { ...line, ...quoted } : line)),
    notes: [
      ...groups.map((group) => battleSkillSource(group, "read")),
      "A report never shows another faction's skills."
    ],
    month
  };
}

/** `level (points)`, the shape `summariseUnit` already writes a skill in. */
const figure = (skill: SkillInfo): string => `${skill.level} (${skill.points})`;

/**
 * The figures one skill moved through: what the report said, what the market left, and - when this
 * month's STUDY reaches it - next turn's (decision **N2**, as `docs/ui/ah-rgkk.2.3-chain.html`
 * draws it).
 *
 * At most three, whatever happened. The individual arrivals of men are named in the sentences
 * under the lines rather than drawn as steps of their own, which is what keeps a line the same
 * length for a unit that took one gift and for one that took five.
 *
 * `[]` when there is nothing to show but the figure the line already carries.
 */
function chainFor(
  /** The tag's entry in `unit.reportedSkills`, or undefined for one the report did not list. */
  reported: SkillInfo | undefined,
  /** The tag's entry in `unit.skills`, or undefined for one the unit no longer holds. */
  now: SkillInfo | undefined,
  /**
   * `unit.reportedSkills !== undefined` - whether the row carries a preview at all. Without one
   * there is no report figure to compare against, so no chain is drawn. A unit this month's `FORM`
   * creates carries `[]`, which is a report figure of `none` for every tag rather than no figure.
   */
  hasReport: boolean,
  /** This month's forecast, when it is for this tag. */
  study: StudyForecast | undefined
): PopupStep[] {
  if (!hasReport) {
    return [];
  }
  const before = reported ? figure(reported) : "none";
  // A tag the report did not list and the unit does not hold is one only the study reaches: it
  // stands at nothing, and `gone` would claim it lost something it never had.
  const after = now ? figure(now) : reported ? "gone" : "none";
  const steps: PopupStep[] = [{ value: before, mark: "reported" }];
  if (before !== after) {
    const mark: PopupStep["mark"] = !now
      ? "down"
      : !reported
        ? "up"
        : now.points > reported.points
          ? "up"
          : now.points < reported.points
            ? "down"
            : "flat";
    steps.push({ value: after, mark });
  }
  // A study that cannot raise the level has no next turn to draw: the level is the figure a player
  // reads, and a blue step saying `5 (480)` reads as progress that will never come (`ah-dpvh`,
  // decision **D**). What happens instead is the amber sentence `ceilingSentence` writes.
  if (study && !study.cannotRaiseTheLevel) {
    steps.push({
      value: `${study.levelAfter} (${study.pointsAfter})`,
      mark: "projected",
      ...(study.doubts.length > 0 ? { uncertain: true } : {})
    });
  }
  return steps.length > 1 ? steps : [];
}


/** The ratios `rules/studying` states in words; anything else is said as a figure. */
const MONTHS_IN_WORDS: Record<string, string> = {
  "1/4": "a quarter of a month",
  "1/2": "half a month",
  "3/4": "three quarters of a month",
  "1/1": "one month",
  "5/4": "one and a quarter months",
  "3/2": "one and a half months",
  "7/4": "one and three quarters months",
  "2/1": "two months"
};

/**
 * What a month of study is worth, in words where the ratio is one the rules state and as a figure
 * otherwise - a teacher's contribution is `min(1, slots / students)`, so it can be any ratio at
 * all and a table alone would be a bug waiting for a thirteen-student teacher.
 */
function monthsInWords(numerator: number, denominator: number): string {
  const exact = MONTHS_IN_WORDS[`${numerator}/${denominator}`];
  if (exact) {
    return exact;
  }
  const quotient = denominator === 0 ? 0 : numerator / denominator;
  return `${Number(quotient.toFixed(2))} months`;
}

/** `Scouts (1502)` for a row the table holds in this hex, and `unit 1502` for one it does not. */
function unitReference(from: string, regionId: string, facts: PopupFacts): string {
  const name = facts.unitNames.get(unitRowKey(regionId, from));
  return name ? `${name} (${from})` : `unit ${from}`;
}

/** Why one merge of arriving men moved - or did not move - this unit's figures. */
function mergeSentence(merge: SkillMerge, regionId: string, facts: PopupFacts): string {
  if (merge.cause === "recruited") {
    const who =
      merge.menArriving.length > 0
        ? andList(merge.menArriving.map((item) => count(item.amount, item.name)))
        : count(merge.men, "man", "men");
    return `${who} recruited, and recruits bring no skills.`;
  }
  const brought =
    merge.arrivingSkills.length > 0
      ? `, bringing ${andList(merge.arrivingSkills.map((skill) => `${skill.name} ${skill.level}`))}`
      : "";
  const verb = merge.cause === "given" ? "joined from" : "taken from";
  return `${count(merge.men, "man", "men")} ${verb} ${unitReference(merge.from, regionId, facts)}${brought}.`;
}

/** The one note the study writes, every clause of it in order. */
function studySentence(study: StudyForecast, projectionDrawn: boolean): string {
  const taught =
    study.teachers.length > 0
      ? `, taught by ${andList(study.teachers.map((teacher) => `${teacher.name} (${teacher.unitId})`))}`
      : "";
  const clauses = [
    `Studying ${study.name}${taught}: worth ${monthsInWords(study.monthsNumerator, study.monthsDenominator)}.`
  ];
  if (study.halvedOutsideABuilding) {
    clauses.push(
      "Studying a magic skill past level 2 outside a building that houses mages, so half the month is lost."
    );
  }
  if (projectionDrawn) {
    clauses.push("The blue figure is next turn's report; everything before it is this month.");
  }
  return clauses.join(" ");
}

/**
 * Why a `STUDY` this unit has written buys nothing (`ah-dpvh`, wording **D1**).
 *
 * The two forms and the `already there` / `already at level N` standing are the ones the core's own
 * `study-at-maximum` finding uses (`ceiling_message`, `crates/core/src/orders/semantics.rs`), so the
 * editor's warning and the popup's say the same thing about one unit in nearly the same words. An
 * empty `limitingRaces` is the skill's own maximum rather than a race limit, exactly as it was for
 * the clause this replaces: naming a race there would blame one for a limit it did not impose.
 *
 * The catalogue's race names are singular (`ah-rgkk.2.2`) and `hill dwarf` does not pluralise by
 * appending `s`, so the race form is built to need no plural.
 */
function ceilingSentence(study: StudyForecast): string {
  const standing =
    study.levelBefore === study.ceilingLevel
      ? "already there"
      : `already at level ${study.levelBefore}`;
  return sentence(
    study.limitingRaces.length > 0
      ? `No ${andList(study.limitingRaces.map((race) => race.name))} may take ${study.name} past level ${study.ceilingLevel}, and this unit is ${standing}, so studying it this month changes nothing`
      : `${study.name} stops at level ${study.ceilingLevel} and this unit is ${standing}, so studying it this month changes nothing`
  );
}

/** One amber sentence per doubt the projection rests on (decision **U2**). */
function doubtSentence(doubt: StudyForecast["doubts"][number], study: StudyForecast): string {
  switch (doubt.reason) {
    case "feeShort":
      return `Studying ${study.name} costs ${doubt.fee.toLocaleString()} silver and this unit is ${doubt.shortBy.toLocaleString()} short, so the study may not happen at all.`;
    case "feeUnpriced":
      return `The data page prices ${study.name} nowhere, so what studying it costs cannot be said.`;
    case "headcountEstimated":
      return "This unit's headcount is a guess, so recruiting may pull these back below what is shown.";
    case "teacherUnsettled":
      return `Whether ${doubt.teacher} may teach cannot be settled from this report, so its month is not counted here.`;
    case "teacherStudentsUnknown":
      return `${doubt.teacher} also teaches a unit of another faction whose headcount the report does not show, so how far its teaching spreads cannot be said.`;
    case "shelterUnknown":
      return "This unit ends the month in a structure this region's report does not list, so whether it shelters a mage cannot be said.";
  }
}

/**
 * One of our own units' Skills popup: every skill as a chain of figures, and a sentence under the
 * lines for every reason one of them moved (`ah-rgkk.2.3`).
 *
 * It derives no arithmetic of its own - every figure and every reason comes off the wire from
 * `ah-rgkk.2.1` and `ah-rgkk.2.2`.
 */
function ownSkillsBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  const reported = unit.reportedSkills ?? [];
  const hasReport = unit.reportedSkills !== undefined;
  const study = unit.study ?? null;
  const reportedByTag = new Map(reported.map((skill) => [skill.tag, skill]));
  const nowByTag = new Map(unit.skills.map((skill) => [skill.tag, skill]));

  // The report's order, then whatever the month added. `merge_skills` keeps the receiver's order
  // and appends what arriving men bring (`crates/core/src/orders/effects.rs`, `ah-isae`), so
  // `unit.skills` only ever adds newcomers after the report's own skills.
  const tags: string[] = [];
  for (const skill of [...reported, ...unit.skills]) {
    if (!tags.includes(skill.tag)) {
      tags.push(skill.tag);
    }
  }
  if (study && !tags.includes(study.tag)) {
    tags.push(study.tag);
  }

  let projectionDrawn = false;
  const lines: PopupLine[] = tags.map((tag, index) => {
    const before = reportedByTag.get(tag);
    const now = nowByTag.get(tag);
    const forTag = study?.tag === tag ? study : undefined;
    const name = before?.name ?? now?.name ?? forTag?.name ?? tag;
    const steps = chainFor(before, now, hasReport, forTag);
    // Only where the eye will actually find it: `popupForCell` caps the lines at `MAX_LINES`
    // (`ah-rgkk.1`, decision **G-d**), and a studied skill the unit has never held is appended
    // last - so on a twelve-skill unit the note would promise a blue figure that was cut off.
    if (forTag && steps.length > 0 && index < MAX_LINES) {
      projectionDrawn = true;
    }
    return {
      label: `${name} ${tag}`,
      // What the cell under the pointer is drawn from, so the two cannot disagree.
      value: now ? figure(now) : before ? "gone" : "none",
      ...(steps.length > 0 ? { steps } : {})
    };
  });

  // Men who joined this month move these figures, whether or not the report change shows it.
  const causes: string[] = [];
  for (const merge of unit.skillMerges ?? []) {
    causes.push(mergeSentence(merge, unit.regionId, facts));
  }
  for (const taken of unit.menOfUnknownSkill ?? []) {
    causes.push(
      `${count(taken.amount, "man", "men")} came from ${unitReference(taken.from, unit.regionId, facts)}, whose skills the report does not show, so these figures do not count them.`
    );
  }
  const notes: string[] = [];
  for (const skill of reported) {
    if (!nowByTag.has(skill.tag)) {
      notes.push(sentence(`${skill.name} drops below one point per man, so the unit loses it`));
    }
  }
  // A study that changes nothing gets no "worth one month" note: the month is not worth anything,
  // and the amber sentence below is the whole of what there is to say (`ah-dpvh`, decision **D**).
  if (study && !study.cannotRaiseTheLevel) {
    notes.push(studySentence(study, projectionDrawn));
  }

  const warnings: string[] = [];
  if (unit.recruitsUnmerged) {
    warnings.push(
      "This unit's headcount is a guess, so what recruiting does to these cannot be worked out."
    );
  }
  if (study?.cannotRaiseTheLevel) {
    warnings.push(ceilingSentence(study));
  }
  for (const doubt of study?.doubts ?? []) {
    // The same cause said twice, and the sentence above is the more specific of the two.
    if (doubt.reason === "headcountEstimated" && unit.recruitsUnmerged) {
      continue;
    }
    warnings.push(doubtSentence(doubt, study!));
  }

  // A figure that is not the report's, or a study that will move one: a STUDY leaves no report
  // change behind, so it has to be named here or a studied skill reads as untouched (`ah-30y0`).
  // One that cannot raise the level moves nothing a player reads (`ah-dpvh`, decision **D**).
  const figuresMoved =
    hasReport &&
    tags.some((tag) => {
      const before = reportedByTag.get(tag);
      const now = nowByTag.get(tag);
      return (before ? figure(before) : null) !== (now ? figure(now) : null);
    });
  const month = monthOf(
    changeFor(unit, CHANGE_FIELD.skills!) !== undefined ||
      causes.length > 0 ||
      figuresMoved ||
      (study !== null && !study.cannotRaiseTheLevel)
  );

  return {
    lines,
    ...(lines.length === 0 ? { heading: "No skills." } : {}),
    causes,
    notes,
    month,
    warning: warnings.length > 0 ? warnings.join(" ") : null
  };
}

/**
 * What the unit holds, and everything today's ITEMS hover says about how the figure was reached.
 *
 * The amber sentence explains the cell's `+ ?` in general terms, because both of its causes - an
 * order that could not be read, and a TRANSPORT whose target the report cannot settle (`ah-64wm`)
 * - leave the month partly counted; which one it was is in the notes, where `itemsTooltip` already
 * words it.
 */
function itemsBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  const told = itemsTooltip(unit, facts.silver);
  const partlyCounted =
    (unit.uncounted?.length ?? 0) > 0 || hasUncertainTransport(unit);

  const change = changeFor(unit, CHANGE_FIELD.items!);
  const reported = change ? reportedItems(change.original) : undefined;
  const entries = itemLines(unit, reported);
  // The unparseable-original fallback, the same shape `foreignSkillsBody` uses: no line carries a
  // pair, and the report's own words go on the first line as `why`.
  const quoteFirst = change !== undefined && reported === undefined && entries.length > 0;
  const lines = entries.map((entry, index) =>
    quoteFirst && index === 0 ? { ...entry.line, why: originalTooltip(change) } : entry.line
  );

  // The sentences follow the changed lines, in the same order, so each is under the figure it
  // explains (decision **S2**).
  const changes = unit.itemChanges ?? [];
  // Each item named as its own line names it, so a sentence and the line above it agree.
  const named = (tag: string, fallback: string) => itemName(tag, unit) ?? fallback;
  const causes = entries
    // Only the entries the cap will draw: **S2** promises the prose block can never be longer
    // than the list above it, and a sentence for a figure the reader cannot see breaks that.
    .slice(0, MAX_LINES)
    .filter((entry) => entry.moved)
    .map((entry) => {
      // `itemLines` marks a tag moved even when the core recorded no change for it, so `forTag`
      // can be empty here — hence `?.`, not the `!` `movementCauses` may use.
      if (entry.refused) {
        return refusedProductReason(entry.refused, named);
      }
      const forTag = changes.filter((c) => c.tag === entry.tag);
      return itemCauseSentence(itemLabel(entry.tag, unit), forTag, unit, forTag[0]?.isMan);
    })
    .filter((note): note is string => note !== undefined);
  // Red first, as `silverMarkWarning` puts it, then the partly-counted sentence (`ah-44at`).
  const warning = [
    shortSentence(shortItems(unit)),
    partlyCounted
      ? "“+ ?” in the cell: this month is only partly counted, so this list may be short."
      : null
  ].filter((part): part is string => part !== null);

  return {
    // Off the drawn list rather than off current stock: a unit that gave everything away still
    // has lines, its items ending at `gone`.
    causes,
    notes: [...(told ? told.split("\n") : []), ...(lines.length === 0 ? ["No items."] : [])],
    lines,
    // Every entry, not only the ones the cap draws: ten iron given in and ten spent leave no report
    // change, and still move the cell (`ah-ymms`).
    month: monthOf(change !== undefined || entries.some((entry) => entry.moved)),
    warning: warning.length > 0 ? warning.join(" ") : null
  };
}

/** What the popup writes where a unit stands in no structure at all (`ah-rgkk.5.3`). */
const IN_THE_OPEN = "in the open";

/**
 * A sentence for each drawn structure the region's report never described.
 *
 * `unitStructureLabel` answers a bare `[id]` for one of those (`structureLabel.ts:36-50`), which is
 * a real case - a stale hex, or a structure seen from outside - and is not the same as a name
 * nobody has given. Detected by comparing the label to the number rather than by matching brackets,
 * so a structure genuinely named `[329]` in the report is not accused of being missing.
 */
function undescribedNotes(drawn: readonly (readonly [string | null, string | null])[]): string[] {
  return drawn
    .filter(([label, id]) => label !== null && id !== null && label === `[${id}]`)
    .map(([label]) => `This region\u2019s report does not describe ${label}, so only its number is shown.`);
}

/** The Structure hover's sentence for an unfinished building (`ah-2ql5`, the agreed words). */
const UNFINISHED_NOTE = "Unfinished \u2014 still being built.";
/** The same, for one this month's building finishes (`ah-2ql5`, decision 5a). */
const FINISHING_NOTE = "Unfinished in the report; this month's building finishes it.";

function structureBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  const change = changeFor(unit, CHANGE_FIELD.structure!);
  // The month-end line carries the mark; the note under the lines says what it means. A building
  // this month finishes drops the mark, and is a change the month makes, so the shared "Nothing
  // this month changes this." must not be written beside it.
  const finish = facts.structureFinish;
  const marked = finish === "unfinished" ? { unfinished: "value" as const } : {};
  // Finishing is something this month does, so it is a cause; being unfinished is a fact.
  const finishCauses = finish === "finishing" ? [FINISHING_NOTE] : [];
  const finishNotes = finish === "unfinished" ? [UNFINISHED_NOTE] : [];
  if (!change) {
    if (facts.structureLabel === null) {
      return { lines: [], causes: [], notes: ["In no structure."], month: "unchanged" };
    }
    return {
      lines: [{ label: "structure", value: facts.structureLabel, ...marked }],
      causes: finishCauses,
      notes: [...finishNotes, ...undescribedNotes([[facts.structureLabel, unit.structureId]])],
      month: monthOf(finish === "finishing")
    };
  }
  // `Number("")` is 0, and an original the report left empty is it saying "in the open" rather
  // than a structure numbered nothing - the same guard `markOrQuote` keeps.
  const beforeId = change.original.trim() === "" ? null : change.original;
  const before = facts.reportedStructureLabel;
  return {
    lines: [
      { label: "was", value: before ?? IN_THE_OPEN },
      {
        label: "structure",
        value: facts.structureLabel ?? IN_THE_OPEN,
        // The core says which order put the unit here - an ENTER, a LEAVE or a movement step -
        // rather than this file guessing it back from the result (`ah-ehgy`). No line number is
        // recorded, so none is named, and no clause is drawn when no order is named.
        why: change.cause ?? undefined,
        ...marked
      }
    ],
    causes: finishCauses,
    notes: [
      ...finishNotes,
      ...undescribedNotes([
        [before, beforeId],
        [facts.structureLabel, unit.structureId]
      ])
    ],
    month: "changes"
  };
}

function longOrderBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  if (!unit.own) {
    return {
      causes: [],
      lines: [],
      notes: ["Another faction's orders are not in your report."],
      month: null
    };
  }
  const now = facts.longOrder;
  const line = (label: string, value: string): PopupLine[] => [{ label, value }];
  const reported = facts.reportedLongOrder;

  // No baseline: say what the month holds, then say plainly that nothing was compared. Neither of
  // these is "unchanged", and the popup must not be silent in a way that reads as if it were.
  if (reported.kind !== "known") {
    return {
      causes: [],
      lines: now === null ? [] : line("long order", now),
      notes: [
        ...(now === null ? ["No long order this month."] : []),
        reported.kind === "no-template"
          ? "Your report carries no orders template, so there is nothing to compare with."
          : "This unit is not in your report\u2019s orders template, so there is nothing to compare with."
      ],
      month: null
    };
  }

  const was = reported.order;
  // `now` first, so every later branch has it narrowed to a string and no assertion is needed.
  if (now === null) {
    return was === null
      ? {
          causes: [],
          lines: [],
          notes: ["No long order this month.", "Your report arrived with none either."],
          month: "unchanged",
          // "...with none either" already says the month left it alone.
          worded: true
        }
      : {
          causes: [],
          lines: line("was", was),
          notes: ["No long order this month."],
          month: "changes"
        };
  }
  if (was === null) {
    return {
      causes: [],
      lines: line("long order", now),
      notes: ["Your report arrived with no long order for this unit."],
      month: "changes"
    };
  }
  if (sameLongOrder(was, now)) {
    // This column has no `CHANGE_FIELD` entry and must not gain one - there is no `longOrder`
    // field in `previewChanges`, so every unit would read unchanged - so it answers for itself.
    return { lines: line("long order", now), causes: [], notes: [], month: "unchanged" };
  }
  return {
    causes: [],
    lines: [
      { label: "was", value: was },
      { label: "long order", value: now }
    ],
    notes: ["Changed since your report arrived."],
    month: "changes"
  };
}

/** `+200`, `-90`. An ASCII hyphen-minus, which is what `String(-90)` gives. */
function signed(amount: number): string {
  return `${amount > 0 ? "+" : "-"}${Math.abs(amount)}`;
}

/**
 * What the market settled, on a `bought` or `sold` line: the one `ItemChange` of the same cause on
 * the same document line, when there is exactly one and it carries a price.
 *
 * `line` is the only thing joining the two ledgers, and both are `null` for a movement no order of
 * this unit's caused - so a `null` line matches nothing rather than matching every other `null`.
 */
function marketClause(group: SilverCauseGroup, itemChanges: readonly ItemChange[]): string | undefined {
  const priced: string[] = [];
  for (const entry of group.entries) {
    if (entry.line === null) {
      continue;
    }
    const matches = itemChanges.filter(
      (change) => change.cause === group.cause && change.line === entry.line
    );
    const only = matches.length === 1 ? matches[0] : undefined;
    if (only === undefined || only.unitPrice === null) {
      continue;
    }
    // The report's own plural where it printed one - `114 livestock`, not `livestocks` (`ah-yvgi`).
    priced.push(`${count(Math.abs(only.delta), only.name, only.plural)} at ${only.unitPrice} each`);
  }
  return priced.length > 0 ? andList(priced) : undefined;
}

/**
 * The aside on the `shipped` line: what was shipped and at what rate, grouped by rate (`ah-7ale.3`).
 *
 * Grouped rather than one clause per shipment because a unit's paid shipments almost always share
 * a rate - it falls out of the sending quartermaster's own skill - so `9 weight at 5 silver` is one
 * clause however many orders it took. Lowest rate first, for a stable order.
 */
function shippingClause(shipping: UnitSilver["shipping"]): string | undefined {
  const weightByRate = new Map<number, number>();
  for (const shipment of shipping) {
    weightByRate.set(shipment.rate, (weightByRate.get(shipment.rate) ?? 0) + shipment.weight);
  }
  if (weightByRate.size === 0) {
    return undefined;
  }
  return andList(
    [...weightByRate.entries()]
      .sort(([left], [right]) => left - right)
      .map(([rate, weight]) => `${weight} weight at ${rate} silver`)
  );
}

function splitShipping(
  silver: UnitSilver,
  entries: readonly SilverChange[]
): { charged: UnitSilver["shipping"]; conditional: UnitSilver["shipping"] } {
  const byFlag = (silver.shipping ?? []).reduce(
    (seen, shipment) => seen || shipment.conditional,
    false
  );
  if (byFlag) {
    return {
      charged: (silver.shipping ?? []).filter((shipment) => !shipment.conditional),
      conditional: (silver.shipping ?? []).filter((shipment) => shipment.conditional)
    };
  }
  const chargedLines = new Set(
    entries
      .filter((entry) => entry.line !== null)
      .map((entry) => entry.line!)
  );
  const charged: UnitSilver["shipping"] = [];
  const conditional: UnitSilver["shipping"] = [];
  for (const shipment of silver.shipping ?? []) {
    if (chargedLines.has(shipment.line)) {
      charged.push(shipment);
    } else {
      conditional.push(shipment);
    }
  }
  return { charged, conditional };
}

function conditionalShippingClause(shipping: UnitSilver["shipping"]): string | undefined {
  if (shipping.length === 0) {
    return undefined;
  }
  return andList(
    [...shipping]
      .sort((left, right) => left.line - right.line)
      .map(
        (shipment) =>
          `${shipment.weight} weight at ${shipment.rate} silver, if unit ${shipment.to} accepts`
      )
  );
}

/**
 * The dim clause beside one cause's amount: the other unit, what the market settled, why there was
 * no order, and whether the money arrives too late - joined with `", "`, no full stop.
 *
 * `undefined` when the cause has nothing to add, which is most of them. Every `other` is used
 * verbatim: the core builds it as `<name> (<id>)` or `unit <id>`, the form `ah-rgkk.2.3` settled.
 */
function silverCauseWhy(
  group: SilverCauseGroup,
  silver: UnitSilver,
  itemChanges: readonly ItemChange[]
): string | undefined {
  const parts: string[] = [];
  const others = (entries: readonly SilverChange[]): string[] =>
    entries.map((entry) => entry.other).filter((other): other is string => other !== null);

  if (group.cause === "was-given" || group.cause === "received") {
    const from = others(group.entries);
    if (from.length > 0) {
      parts.push(`from ${andList(from)}`);
    }
  } else if (group.cause === "took") {
    const shown = others(group.entries.filter((entry) => entry.cause === "took"));
    const unshown = others(group.entries.filter((entry) => entry.cause === "took-unshown"));
    if (shown.length > 0) {
      parts.push(`from ${andList(shown)}`);
    }
    if (unshown.length > 0) {
      parts.push(`from ${andList(unshown)}, which your report does not show`);
    }
  } else if (group.cause === "gave-away" || group.cause === "sent") {
    const to = others(group.entries);
    if (to.length > 0) {
      parts.push(`to ${andList(to)}`);
    }
  } else if (group.cause === "lent") {
    parts.push("to a faction-mate's orders in this hex");
  } else if (group.cause === "was-lent") {
    parts.push("by your units in this hex");
  } else if (group.cause === "was-lent-for-upkeep") {
    // `rules/economy_maintenance`: "Silver from other faction units in the same region" pays what
    // the unit's own silver could not (`ah-2zku`).
    const by = others(group.entries);
    if (by.length > 0) {
      parts.push(`by ${andList(by)}`);
    }
  } else if (group.cause === "lent-for-upkeep") {
    const to = others(group.entries);
    if (to.length > 0) {
      parts.push(`to ${andList(to)}`);
    }
  } else if (group.cause === "was-taken") {
    const by = others(group.entries);
    if (by.length > 0) {
      parts.push(`by ${andList(by)}`);
    }
  } else if (group.cause === "gift-reverted") {
    // `rules/form`: an empty formed unit is dissolved and its silver reverts to the first unit in
    // the region - the same move the ITEMS popup words as "reverted from a unit that formed with
    // nobody" (`ah-09bu`).
    const from = others(group.entries.filter((entry) => entry.amount > 0));
    const to = others(group.entries.filter((entry) => entry.amount < 0));
    if (from.length > 0) {
      parts.push(`from ${andList(from)}, which formed with nobody`);
    }
    if (to.length > 0) {
      parts.push(`to ${andList(to)}, as this unit formed with nobody`);
    }
  }

  if (group.cause === "bought" || group.cause === "sold") {
    const settled = marketClause(group, itemChanges);
    if (settled !== undefined) {
      parts.push(settled);
    }
  }
  if (group.cause === "shipped") {
    const { charged, conditional } = splitShipping(silver, group.entries);
    const aside = shippingClause(charged);
    if (aside !== undefined) {
      parts.push(aside);
    }
    const conditionalAside = conditionalShippingClause(conditional);
    if (conditionalAside !== undefined) {
      parts.push(conditionalAside);
    }
  }

  const noOrder = group.entries.every((entry) => entry.line === null);
  if (group.cause === "taxed" && silver.taxesByFlag && noOrder) {
    parts.push("set to tax every turn");
  }
  if (group.cause === "worked" && silver.worksByDefault && noOrder) {
    parts.push("no month-long order");
  }

  // `rules/sequenceofevents`: ENTERTAIN and WORK are processed after STUDY, after BUY and after
  // BUILD, so a wage can never pay for any of them.
  if (group.cause === "worked" || group.cause === "entertained") {
    parts.push("arrives too late");
  }

  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** Whether a cause group is step 4's maintenance sharing, which the popup draws with the upkeep. */
function isUpkeepShare(group: SilverCauseGroup): boolean {
  return group.cause === "was-lent-for-upkeep" || group.cause === "lent-for-upkeep";
}

/**
 * The headline: `silver`, the cell's own figure, and the pair from the report's `held` when the
 * figure is a number and has moved. Never a pair on a `?`.
 */
export function silverTotalLine(
  silver: UnitSilver,
  shown: number | null | ShownSilver
): PopupLine {
  const shownObj: ShownSilver | null =
    shown && typeof shown === "object"
      ? shown
      : shown === null
        ? null
        : { kind: "single", value: shown };
  const formatShown = (s: ShownSilver | null): string => {
    if (!s || s.kind === "unknown") {
      return "?";
    }
    if (s.kind === "single") {
      return String(s.value);
    }
    if (s.kind === "pair") {
      return `${s.high} or ${s.low}`;
    }
    return `${s.low}-${s.high}`;
  };
  const shownValue =
    shownObj === null || shownObj.kind === "unknown"
      ? null
      : shownObj.kind === "single"
        ? shownObj.value
        : shownObj.low;
  const bounded = shareBoundedByAnUnreadUnit(silver);
  const displayValue =
    shownValue === null ? "?" : bounded && shownObj?.kind === "single" ? atMost(String(shownValue)) : formatShown(shownObj);

  if (shownValue === null || shownValue === silver.held) {
    return { label: "silver", value: displayValue };
  }

  return {
    label: "silver",
    value: displayValue,
    change: { direction: shownValue > silver.held ? "up" : "down", from: String(silver.held) }
  };
}

/**
 * The amber sentence(s) explaining the cell's marks (decision **W1**), or `null`.
 *
 * Red first, because it is the figure itself; the two are joined into one paragraph for a unit that
 * carries both.
 */
function silverMarkWarning(
  silver: UnitSilver,
  shown: number | null,
  warned: boolean
): string | null {
  const parts: string[] = [];
  if (silverIsRed(shown, silver)) {
    parts.push(
      shown !== null && shown < 0
        ? `A red figure in the cell: this unit ends the month ${-shown} short.`
        : "A red figure in the cell: this unit cannot pay for its own orders out of silver that reaches it in time."
    );
  }
  if (warned) {
    parts.push(
      "⚠ in the cell: a check warns about this unit's money. Select the unit to read it in the Problems panel."
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Why a capped unit's month costs nothing, in the words the designer agreed (`ah-jzs9`). */
function noStudyFeeSentence(reason: NoStudyFee): string {
  return sentence(
    reason.limitingRaces.length > 0
      ? `No study fee: no ${andList(reason.limitingRaces.map((race) => race.name))} may take ${reason.skillName} past level ${reason.ceilingLevel}, so this month costs nothing`
      : `No study fee: ${reason.skillName} stops at level ${reason.ceilingLevel} for this unit, so this month costs nothing`
  );
}

/**
 * What moved this unit's silver this month: the cell's own figure against the report's, then one
 * line per cause in the turn's own order (`ah-rgkk.4.3`, decision **V2**).
 *
 * This parts company with the whole-unit tooltip, which keeps `summariseSilver`'s four sums and
 * every note: one composer cannot serve both, the tooltip being a summary where the sums are the
 * right density and this being about one cell, which must name causes.
 */
function silverBody(unit: PreviewedUnit, facts: PopupFacts): Body {
  const silver = facts.silver;
  // Nothing to compare for a unit with no forecast, one the game dissolves, or a month that was
  // never priced; otherwise any movement, even one netting to zero, is the month moving the cell.
  const month: PopupMonth =
    silver === null || facts.dissolving || monthLostToAnUnreadLine(silver)
      ? null
      : monthOf(silver.changes.length > 0 || silver.atMonthEnd !== silver.held);
  // The ledger names every movement as a line of its own, so the shared sentence is never added.
  return { ...silverLedger(unit, facts), month, worded: true };
}

function silverLedger(unit: PreviewedUnit, facts: PopupFacts): Omit<Body, "month"> {
  if (facts.dissolving) {
    return {
      causes: [],
      lines: [],
      notes: ["The game dissolves this unit before the month ends, so it has no month end."]
    };
  }
  const silver = facts.silver;
  if (silver === null) {
    return { causes: [], lines: [], notes: ["Only your own units have a silver forecast."] };
  }

  if (monthLostToAnUnreadLine(silver)) {
    // Two lines and no causes: `silver.changes` is empty for any doubted unit, and a month that
    // was never priced has no working to show. `at month end` is spelled out here rather than
    // folded into the headline, because the headline is the money and they are now two different
    // answers - an arrow between a fact and a thing nobody knows would say something false.
    const lines: PopupLine[] = [
      {
        label: "silver",
        value: silverWasNeverRead(silver) ? NOT_KNOWN : String(silver.held)
      },
      { label: "at month end", value: NOT_KNOWN }
    ];
    const noteFacts: SilverFacts = {
      unit,
      silver,
      warned: facts.silverWarned,
      hexShort: facts.silverHexShort ?? false,
      countUpkeep: facts.countUpkeep
    };
    // The generic "this month cannot be added up" line below is deliberately not reached: the
    // agreed note directly under it says the same thing better.
    return {
      causes: [],
      lines,
      notes: silverNoteLines(noteFacts),
      warning: silverMarkWarning(silver, null, facts.silverWarned)
    };
  }

  const shown = silverShownUI(silver, facts.countUpkeep);
  const shownNumeric =
    shown === null || shown.kind === "unknown"
      ? null
      : shown.kind === "single"
        ? shown.value
        : shown.low;
  // Step 4 of maintenance - faction-mates' silver paying upkeep - is drawn with the upkeep row and
  // only when the column counts it, or the lines would not add up to the cell (`ah-2zku`).
  const allGroups = silverCauseGroups(silver.changes);
  const upkeepShares = facts.countUpkeep ? allGroups.filter(isUpkeepShare) : [];
  const groups = allGroups.filter((group) => !isUpkeepShare(group));
  const lines: PopupLine[] = [silverTotalLine(silver, shown)];
  for (const group of groups) {
    const why = silverCauseWhy(group, silver, unit.itemChanges ?? []);
    lines.push({
      label: silverCauseLabel(group.cause),
      value: signed(group.amount),
      tone: group.amount > 0 ? "up" : "down",
      ...(why === undefined ? {} : { why })
    });
  }
  const alreadyCharged = groups.find((group) => group.cause === "shipped");
  const { conditional } = splitShipping(silver, alreadyCharged?.entries ?? []);
  const conditionalCost = conditional.reduce((sum, shipment) => sum + shipment.cost, 0);
  const conditionalWhy = conditionalShippingClause(conditional);
  if (!alreadyCharged && conditionalCost > 0) {
    lines.push({
      label: "shipped",
      value: signed(-conditionalCost),
      tone: "down",
      ...(conditionalWhy === undefined ? {} : { why: conditionalWhy })
    });
  }
  // What a TRANSPORT would send but the forecast kept with this unit, after every counted line and
  // before maintenance, which `rules/sequenceofevents` runs after transport (`ah-9qzs`).
  // A doubted month lists no working at all (`silver.changes` is empty), so it has none either.
  if (silver.doubt === null) {
    lines.push(...uncountedSilverShipments(unit));
  }
  // Directly above the upkeep row: what faction-mates paid of this unit's fee, or what it paid of
  // theirs (`ah-2zku`).
  for (const group of upkeepShares) {
    const why = silverCauseWhy(group, silver, unit.itemChanges ?? []);
    lines.push({
      label: silverCauseLabel(group.cause),
      value: signed(group.amount),
      tone: group.amount > 0 ? "up" : "down",
      ...(why === undefined ? {} : { why })
    });
  }
  // The fee before faction-mates' silver paid any of it, which the line above accounts for.
  const paidByMates = upkeepShares
    .filter((group) => group.cause === "was-lent-for-upkeep")
    .reduce((sum, group) => sum + group.amount, 0);
  // Last, where `rules/sequenceofevents` puts maintenance - and only while the column counts it,
  // since with the setting off the cell's figure excludes it (`ah-1wcw.4`).
  const fee = silver.upkeep === null ? null : silver.upkeep + paidByMates;
  if (facts.countUpkeep && fee !== null && fee !== 0) {
    lines.push({ label: "upkeep", value: signed(-fee), tone: "down" });
  }

  const noteFacts: SilverFacts = {
    unit,
    silver,
    warned: facts.silverWarned,
    hexShort: facts.silverHexShort ?? false,
    countUpkeep: facts.countUpkeep,
    upkeepLinesDrawn: paidByMates > 0
  };
  const notes = silverNoteLines(noteFacts, [...groups, ...upkeepShares]);
  if (silver.doubt !== null) {
    // Above the doubt's own sentence, which says *why* it could not be added up.
    notes.unshift("This month cannot be added up, so what moved this unit's silver is not listed.");
  }

  if (silver.noStudyFee !== null) {
    notes.push(noStudyFeeSentence(silver.noStudyFee));
  }

  return { causes: [], lines, notes, warning: silverMarkWarning(silver, shownNumeric, facts.silverWarned) };
}

/**
 * The popup's body as sentences, for the `sr-only` span that replaces the cell's `title`
 * (decision **F1**).
 *
 * The title is deliberately left out: the table header already announces the column, and a reader
 * moving through the row would otherwise hear the unit's name and the column word again in every
 * cell. A change is spelled out in words rather than drawn as an arrow, so the direction survives
 * a reader that says nothing about a glyph.
 */
/**
 * The ink one line's label is drawn in (`ah-rgkk.5.1`).
 *
 * Exported because `UnitCellPopup` renders a portal, which `packages/shared` cannot render at all
 * (`packages/shared/src/testing/README.md`); this is the part of that component that has a rule in
 * it, so this is the part that lives here and is tested.
 */
export function popupLabelInk(line: PopupLine): string {
  if (line.struck) {
    // What a refused cast would have made: struck through and dimmed, whole (`ah-44at`).
    return "text-ink-dim line-through";
  }
  if (line.uncounted) {
    // Silver the forecast could not count, set apart from every counted line (`ah-9qzs`).
    return UNCOUNTED_INK;
  }
  return line.stress === "deciding" ? "text-brass" : line.stress === "aside" ? "text-ink-dim" : "";
}

/** How a line's value is drawn, on the right: the counterpart of `popupLabelInk`. */
export function popupValueInk(line: PopupLine): string {
  if (line.struck) {
    return "text-ink-dim line-through";
  }
  if (line.uncounted) {
    return UNCOUNTED_INK;
  }
  return line.stress === "aside" ? "text-ink-dim" : "text-ink-soft";
}

const UNCOUNTED_INK = "text-ink-dim italic";

/**
 * One dimmed `not counted` line per silver TRANSPORT the forecast could not count, in document
 * order (`ah-9qzs`, the agreed words): a target the report does not show, or another faction's
 * unit whose eligibility or acceptance it cannot settle (`rules/transport`). The forecast keeps
 * that silver with the sender, so the line is in no total; its amount is the issue's, the same
 * figure the "Could not count ..." sentence beneath the unit states.
 *
 * A certain refusal, a reach issue, other goods, an order over several tags (empty `tag`) or one
 * that moves nothing draws no line.
 */
export function uncountedSilverShipments(unit: PreviewedUnit): PopupLine[] {
  return (unit.transportTargetIssues ?? [])
    .filter(
      (issue) =>
        issue.tag.toUpperCase() === "SILV" &&
        issue.amount > 0 &&
        (issue.reason === "eligibilityUnknown" || issue.reason === "acceptanceUnknown")
    )
    .map((issue) => ({
      label: "not counted",
      value: `(\u2212${issue.amount})`,
      why: `sent to unit ${issue.to}, ${
        issue.toUnshown ? "which your report does not show" : "which may not accept it"
      }`,
      uncounted: true
    }));
}

export function popupAsText(popup: ColumnPopup): string {
  const lines = popup.lines.map((line) => {
    const parts = [`${line.label} ${line.value}`];
    if (line.steps) {
      // The label carries the first figure; every later one is a clause of its own, so the
      // direction is a word rather than a colour and the projection says that it has not happened.
      parts[0] = `${line.label} ${line.steps[0]!.value}`;
      for (const step of line.steps.slice(1)) {
        parts.push(
          step.mark === "projected"
            ? `${step.value} next turn${step.uncertain ? " if it happens" : ""}`
            : `${step.mark === "up" ? "up to" : step.mark === "down" ? "down to" : "still"} ${step.value}`
        );
      }
    } else if (line.change) {
      parts.push(`${line.change.direction} from ${line.change.from}`);
    }
    if (line.stress === "deciding") {
      parts.push("which is the one that decides");
    }
    if (line.why) {
      parts.push(line.why);
    }
    return `${parts.join(", ")}.`;
  });

  return [...lines, ...popup.notes, ...(popup.warning ? [popup.warning] : [])]
    .join(" ")
    .trim();
}
