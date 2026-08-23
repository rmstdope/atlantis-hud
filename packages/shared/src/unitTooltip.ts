import type { ReportUnit, UnitSilver } from "@atlantis/core-client";

/**
 * What resting the pointer on a unit says, and where that is put.
 *
 * The table has room for a truncated line of skills and a truncated line of items, so the summary
 * exists to say the rest of it without making the user select the unit and read the panel. Both
 * halves are pure: the wording so it cannot drift from the panel's, and the placement because
 * arithmetic against the edges of a window is exactly the part that is worth testing and the part
 * a browser will not tell you about until it is wrong.
 */

/**
 * How long the pointer must rest on a row before its summary appears.
 *
 * Long enough that crossing the table on the way to the map leaves no trail of tooltips behind,
 * short enough that it reads as an answer to stopping rather than as a delay.
 */
export const HOVER_DELAY_MS = 300;

/** How far from the pointer the tooltip sits, so the cursor does not cover its first line. */
const GAP = 12;

/** One line of the summary: what it is on the left, how much or how good on the right. */
export type TooltipEntry = { label: string; value: string };

/** The silver section of the panel: the working, and one line explaining it where it needs one. */
export type SilverSummary = { rows: TooltipEntry[]; note: string | null };

export type UnitSummary = {
  /** The unit's name and id, as the report writes it. */
  title: string;
  skills: TooltipEntry[];
  items: TooltipEntry[];
  /** What this unit's month does to its silver, or null for a unit that has no forecast. */
  silver: SilverSummary | null;
};

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Placement = { left: number; top: number };

/**
 * Everything the summary says about a unit.
 *
 * Skills carry their study points as well as their level (ah-ded4), because the table's skills
 * cell truncates into this tooltip by design and the level alone cannot tell two units apart.
 * They keep the report's order, which is the order they were learned in and the order the table
 * shows. Items are ordered by holding, largest first, matching the unit panel: a tooltip that
 * ranked them differently from the panel would be read as a different list.
 */
export function summariseUnit(
  unit: ReportUnit,
  silver: UnitSilver | null = null,
  /** Whether this unit carries the `not-enough-silver` finding, which the note explains. */
  warned = false,
  /** Whether the Silver column is counting upkeep, which adds the fifth row (`ah-1wcw.4`). */
  countUpkeep = false
): UnitSummary {
  return {
    silver: silver === null ? null : summariseSilver(unit, silver, warned, countUpkeep),
    title: `${unit.name} (${unit.unitId})`,
    skills: unit.skills.map((skill) => ({
      label: `${skill.name} ${skill.tag}`,
      value: `${skill.level} (${skill.points})`
    })),
    items: [...unit.items]
      .sort((left, right) => right.amount - left.amount)
      .map((item) => ({
        label: `${item.name} ${item.tag}`,
        value: item.amount.toLocaleString()
      }))
  };
}

/**
 * Where to put the tooltip, in viewport coordinates.
 *
 * It hangs below and to the right of the pointer, and flips to the other side of it rather than
 * cross an edge — flipping keeps the pointer outside the tooltip, which sliding along the edge
 * would not: a tooltip under the cursor takes the hover it was asked for and flickers.
 *
 * The clamp afterwards is for what neither side can hold. A tooltip taller or wider than the
 * window has nowhere to flip to, and pinning it to the top-left at least shows its beginning.
 */
export function placeTooltip(pointer: Point, size: Size, viewport: Size): Placement {
  const along = (start: number, extent: number, limit: number) => {
    const after = start + GAP;
    const placed = after + extent <= limit ? after : start - GAP - extent;
    return Math.max(0, Math.min(placed, limit - extent));
  };

  return {
    left: along(pointer.x, size.width, viewport.width),
    top: along(pointer.y, size.height, viewport.height)
  };
}

/**
 * What the unit calls the food of a given tag, for the sentences that name it. Report food names
 * are already mass nouns - `grain`, `livestock`, `fish` - so nothing is pluralised; the tag itself,
 * lower-cased, is the fallback for a larder the report named oddly (`ah-eacd`).
 */
function nameOfHeldItem(unit: ReportUnit, tag: string): string {
  const held = unit.items.find(
    (item) => item.tag.toUpperCase() === tag.toUpperCase()
  );
  return held?.name ?? tag.toLowerCase();
}

/** A figure the forecast is sure of, or `?` for a term that could not be priced. */
function figure(amount: number | null): string {
  return amount === null ? "?" : String(amount);
}

/**
 * The Silver section's five rows and its one explaining line (`ah-1wcw.1`) - six while the Silver
 * column is counting upkeep (`ah-1wcw.4`). `In` splits in two because silver that arrives in the
 * turn's last phase cannot pay for anything this month's orders spend (`ah-uwa3`).
 *
 * At most one note, and the first that applies: a panel that stacks three explanations under one
 * small number explains nothing. The order is the order of how much the reader needs it.
 */
function summariseSilver(
  unit: ReportUnit,
  silver: UnitSilver,
  warned: boolean,
  countUpkeep: boolean
): SilverSummary {
  const end = countUpkeep ? shownEnd(silver) : silver.atMonthEnd;
  const rows: TooltipEntry[] = [
    { label: "Held now", value: String(silver.held) },
    { label: "In, in time", value: figure(inTime(silver)) },
    { label: "In, too late", value: figure(silver.lateIncome) },
    { label: "Out", value: figure(silver.expense) },
    ...(countUpkeep ? [{ label: "Upkeep", value: figure(silver.upkeep) }] : []),
    { label: "At month end", value: figure(end) }
  ];

  return { rows, note: silverNote(unit, silver, warned, countUpkeep) };
}

/**
 * The part of income that arrives in time to pay for what the orders spend - everything but wages,
 * entertaining and Phantasmal Entertainment (`ah-uwa3`). `null` where income itself is unknown.
 */
function inTime(silver: UnitSilver): number | null {
  if (silver.income === null || silver.lateIncome === null) {
    return null;
  }
  return silver.income - silver.lateIncome;
}

/** How the hover names the order a shortfall bites on. */
const SPENDS: Record<NonNullable<UnitSilver["shortOn"]>, string> = {
  buy: "buys",
  cast: "casts",
  study: "studies",
  give: "gives"
};

/** The month-end figure with upkeep taken off, or `null` where either term is unpriceable. */
function shownEnd(silver: UnitSilver): number | null {
  if (silver.atMonthEnd === null || silver.upkeep === null) {
    return null;
  }
  return silver.atMonthEnd - silver.upkeep;
}

/** `"a"`, `"a and b"`, `"a, b and c"` - the way the Problems panel already lists a market. */
function namesInAList(names: string[]): string {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function silverNote(
  unit: ReportUnit,
  silver: UnitSilver,
  warned: boolean,
  countUpkeep: boolean
): string | null {
  const end = silver.atMonthEnd;

  // Counted alone this unit runs out, yet no finding names it - which in this hex means the units
  // that share have it covered, exactly as the engine's own borrowing rule would.
  //
  // Inferred from the figures rather than read from a field, so it fires for *any* silence - and
  // since `ah-e66j` a hex with no `SHARE` flag anywhere pays its neighbours' upkeep too. Guarded on
  // `sharedSilverCovered` so this sentence keeps meaning what it says: that the player's own
  // `SHARE` flags did it. The automatic kind has its own sentence further down.
  if (end !== null && end < 0 && !warned && silver.sharedSilverCovered === 0) {
    return "Shared silver in this hex covers the shortfall.";
  }
  if (silver.doubt === "unknown-tax-base") {
    return "The report never said what this region's tax base is.";
  }
  if (silver.doubt === "unpriced-skill") {
    return "The ruleset does not say what studying this skill costs.";
  }
  if (silver.doubt === "unknown-goods") {
    // The goods as the order wrote them: nothing resolved them to a catalogue name, so there is no
    // other way to say which ones are meant.
    return `The report does not say what ${silver.doubtSubject ?? "these goods"} are, so what this sale earns cannot be said.`;
  }
  if (silver.doubt === "estimated-men") {
    return "This unit's headcount is an estimate, so its month cannot be priced.";
  }
  if (silver.doubt === "market-does-not-sell") {
    // The market's own name for the goods where anything knew one, and the order's own text
    // otherwise - the same posture `unknown-goods` above takes.
    return `This region is not selling ${silver.doubtSubject ?? "these goods"}, so what the purchase costs cannot be said.`;
  }
  if (silver.doubt === "gives-a-whole-class") {
    return "This unit is giving away a whole class of goods, which cannot be counted.";
  }
  // With `countUpkeep` off there is no Upkeep row on show, so neither of this bead's two lines has
  // anything to explain and both would be noise about a hidden figure (`ah-7cdt`).
  if (countUpkeep && silver.doubt === "contested-faction-food") {
    return "There is not enough faction food here to feed every unit set to eat it.";
  }
  // The month can end in credit and the purchase still be refused, because wages reach the unit
  // only in the turn's last phase (`ah-uwa3`). The one line that says so names both the amount and
  // the order that fails, and comes before the two food notes: an order the game will refuse is
  // worth more of the reader's attention than an upkeep that was quietly paid.
  if (silver.shortForOrders !== null && silver.shortForOrders > 0) {
    const spends = silver.shortOn ? ` when it ${SPENDS[silver.shortOn]}` : "";
    return `Wages arrive too late to pay for this month's orders, so this unit is ${silver.shortForOrders} short${spends}.`;
  }
  // A doubt about the figure on show, so it sorts above the informational lines that explain one -
  // and below the shortfall line above, which is about an order the game will refuse (`ah-fjty`).
  // Step 6's contended case, which precedes step 7's in the payment order. Unlike step 7 it
  // suppresses the not-enough-silver warning as well, so the note is the only thing that says the
  // figure on show is pessimistic (`ah-eacd`).
  if (countUpkeep && silver.foodContended) {
    return "There is not enough food here to feed every unit that needs it, so this unit may yet be fed.";
  }
  if (countUpkeep && silver.unclaimedContended) {
    return "There is not enough unclaimed silver to feed every unit that needs it.";
  }
  // The two food notes are ordered by the game's own maintenance payment order: a unit spends its
  // own food (step 1) before the hex's faction food (step 2), so a unit fed by both names the step
  // that actually fed it first (`ah-p9z5`).
  // Guarded on `forcedOwnFood`, because a unit fed at step 5 has a non-zero `ownFoodCovered` too
  // and this branch would otherwise swallow the step-5 sentence below (`ah-eacd`).
  if (countUpkeep && silver.ownFoodCovered > 0 && silver.forcedOwnFood === 0) {
    return `This unit's own food covers ${silver.ownFoodCovered} of its upkeep.`;
  }
  // Step 5: food the game takes as a last resort rather than food the `CONSUME` flag chose. Said
  // in items and not silver, because the reader can act on knowing the loss was forced - they
  // could send silver (`ah-eacd`).
  if (countUpkeep && silver.forcedOwnFood > 0) {
    const what = silver.forcedOwnFoodTag
      ? `${silver.forcedOwnFood} ${nameOfHeldItem(unit, silver.forcedOwnFoodTag)}`
      : `${silver.forcedOwnFood} of its food items`;
    return `This unit has no silver for its upkeep, so ${what} will be eaten.`;
  }
  // An Upkeep of 0 on a unit with six men reads as a defect until something says why: this is the
  // only row a *neighbour's* holdings move (`ah-7cdt`).
  if (countUpkeep && silver.factionFoodCovered > 0 && silver.forcedFactionFood === 0) {
    return `Faction food in this hex covers ${silver.factionFoodCovered} of this unit's upkeep.`;
  }
  // Step 6. Counted and never named: the pool is other units' inventory, and which items a shared,
  // all-or-nothing pool gives up is not this unit's to say (`ah-eacd`).
  if (countUpkeep && silver.forcedFactionFood > 0) {
    const n = silver.forcedFactionFood;
    return `This unit has no silver for its upkeep, so ${n} faction food item${n === 1 ? "" : "s"} in this hex will be eaten.`;
  }
  // Step 4 of the payment order: automatic, and unconditional on the `SHARE` flag, which governs
  // discretionary spending only. Said of upkeep because upkeep is the only thing automatic sharing
  // ever pays for (`ah-e66j`, round 1).
  if (countUpkeep && silver.sharedSilverCovered > 0) {
    return "A faction-mate's silver in this hex pays this unit's upkeep.";
  }
  // Step 7 of the payment order, and so the last of the three notes that explain an Upkeep the
  // reader can see is smaller than the headcount owes: own food (step 1), the hex's faction food
  // (step 2), then the faction's unclaimed fund (`ah-fjty`).
  if (countUpkeep && silver.unclaimedCovered > 0) {
    return `The faction's unclaimed silver covers ${silver.unclaimedCovered} of this unit's upkeep.`;
  }
  // The fund pays for a withdrawal, never the unit, so an `Out` of zero on a unit ordered to
  // withdraw $369 of grain reads as a defect until this says why (`ah-tdsi`). Not gated on
  // `countUpkeep` like the notes above it: it explains `Out`, which is on show either way.
  if (silver.withdrawing) {
    return "This unit's withdrawal is paid from the faction's unclaimed silver.";
  }
  // A gift is the one part of the figure that comes from somebody else's orders, so it is the one
  // part a reader cannot find by looking at this unit's own block.
  if (silver.received > 0 && silver.givers.length > 0) {
    return `Includes ${silver.received} given by ${namesInAList(silver.givers)} in this hex.`;
  }
  // Silver a unit is ordered to destroy is spending like any other, and the one kind a reader
  // would otherwise look for a recipient of and find none.
  if (silver.givenToNobody > 0) {
    return `Includes ${silver.givenToNobody} given away to nobody.`;
  }
  if (silver.income === 0 && silver.expense === 0) {
    return "Nothing this unit is ordered to do moves silver.";
  }
  return null;
}
