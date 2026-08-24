import type { ReportUnit, UnitSilver } from "@atlantis/core-client";
import { aReportUnit, aUnitSilver } from "@atlantis/core-client";

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
  produce: "produces",
  cast: "casts",
  study: "studies",
  give: "gives"
};

/**
 * The tail of the `cannot-pay` sentence, per order kind. `give` is not a cost - "it gives away",
 * not "its X costs" - so these are complete tails rather than a noun interpolated into one
 * template, which would produce `its give costs` and typecheck (`ah-moq3`).
 */
const CANNOT_PAY: Record<NonNullable<UnitSilver["shortOn"]> | "orders", string> = {
  study: "its study costs",
  buy: "its purchase costs",
  produce: "its production costs",
  cast: "its casting costs",
  give: "it gives away",
  orders: "its orders cost"
};

/**
 * `1 catapult`, `0 catapults`. The core carries the catalogue's singular, because the unit does
 * not hold the thing yet and nothing in its inventory could be read for a plural; English belongs
 * out here, the way `ah-eacd`'s step-6 sentence already puts it.
 */
function countOf(count: number, name: string): string {
  return `${count} ${name}${count === 1 ? "" : "s"}`;
}

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

/** Everything a silver note may look at. One object, so a note's condition is a pure predicate. */
export type SilverFacts = {
  unit: ReportUnit;
  silver: UnitSilver;
  /** Whether this unit carries the `not-enough-silver` finding, which the note explains. */
  warned: boolean;
  /** Whether the Silver column is counting upkeep, which adds the fifth row (`ah-1wcw.4`). */
  countUpkeep: boolean;
};

/**
 * One explanation the hover may show under the Silver rows.
 *
 * Precedence is `SILVER_NOTES`' order and nothing else - but unlike the chain it replaced, a note
 * carries the facts it must win for (`example`), so a note placed where an earlier one swallows it
 * fails `unitTooltip.test.ts` instead of silently never appearing (`ah-hvt8`).
 */
export type SilverNote = {
  /** Stable, kebab-case, never rendered. What the tests name, and what a diff shows. */
  id: string;
  /** Pure. No side effects, no reading anything but `facts`. */
  when: (facts: SilverFacts) => boolean;
  /** Only ever called when `when` returned true. */
  say: (facts: SilverFacts) => string;
  /**
   * A `SilverFacts` this note must win for. Every note has one, and the suite proves each note
   * wins for its own - which is what makes an unreachable note a failing test rather than a
   * sentence nobody ever sees.
   */
  example: () => SilverFacts;
};

/**
 * Every explanation the hover may show under the Silver rows, in precedence order: the first
 * whose `when` holds is the one shown.
 *
 * Exported for `unitTooltip.test.ts`, which enumerates it - a private array cannot be enumerated,
 * and enumeration is the whole mechanism that catches a shadowed note (`ah-hvt8`).
 */
export const SILVER_NOTES: readonly SilverNote[] = [
  // Counted alone this unit runs out, yet no finding names it - which in this hex means the units
  // that share have it covered, exactly as the engine's own borrowing rule would.
  //
  // Inferred from the figures rather than read from a field, so it fires for *any* silence - and
  // since `ah-e66j` a hex with no `SHARE` flag anywhere pays its neighbours' upkeep too. Guarded on
  // `sharedSilverCovered` so this sentence keeps meaning what it says: that the player's own
  // `SHARE` flags did it. The automatic kind has its own sentence further down.
  {
    id: "shared-silver-covers-shortfall",
    when: ({ silver, warned }) =>
      silver.atMonthEnd !== null &&
      silver.atMonthEnd < 0 &&
      !warned &&
      silver.sharedSilverCovered === 0,
    say: () => "Shared silver in this hex covers the shortfall.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ atMonthEnd: -5, upkeep: 5 }),
      warned: false,
      countUpkeep: true
    })
  },
  {
    id: "doubt-unknown-tax-base",
    when: ({ silver }) => silver.doubt === "unknown-tax-base",
    say: () => "The report never said what this region's tax base is.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ doubt: "unknown-tax-base" }),
      warned: false,
      countUpkeep: true
    })
  },
  {
    id: "doubt-unpriced-production",
    when: ({ silver }) => silver.doubt === "unpriced-production",
    say: ({ silver }) =>
      `The ruleset does not say what producing ${silver.doubtSubject ?? "this"} costs.`,
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ doubt: "unpriced-production", doubtSubject: "mithril" }),
      warned: false,
      countUpkeep: true
    })
  },
  {
    id: "doubt-unpriced-skill",
    when: ({ silver }) => silver.doubt === "unpriced-skill",
    say: () => "The ruleset does not say what studying this skill costs.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ doubt: "unpriced-skill" }),
      warned: false,
      countUpkeep: true
    })
  },
  // The goods as the order wrote them: nothing resolved them to a catalogue name, so there is no
  // other way to say which ones are meant.
  {
    id: "doubt-unknown-goods",
    when: ({ silver }) => silver.doubt === "unknown-goods",
    say: ({ silver }) =>
      `The report does not say what ${silver.doubtSubject ?? "these goods"} are, so what this sale earns cannot be said.`,
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ doubt: "unknown-goods", doubtSubject: "widgets" }),
      warned: false,
      countUpkeep: true
    })
  },
  {
    id: "doubt-estimated-men",
    when: ({ silver }) => silver.doubt === "estimated-men",
    say: () => "This unit's headcount is an estimate, so its month cannot be priced.",
    example: () => ({
      unit: aReportUnit({ menEstimated: true }),
      silver: aUnitSilver({ doubt: "estimated-men" }),
      warned: false,
      countUpkeep: true
    })
  },
  {
    id: "doubt-contested-region-pool",
    when: ({ silver }) => silver.doubt === "contested-region-pool",
    say: () =>
      "Another of your units here draws on the same pool and its headcount is an estimate, so this unit's share cannot be worked out.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ doubt: "contested-region-pool" }),
      warned: false,
      countUpkeep: true
    })
  },
  // The market's own name for the goods where anything knew one, and the order's own text
  // otherwise - the same posture `unknown-goods` above takes.
  {
    id: "doubt-market-does-not-sell",
    when: ({ silver }) => silver.doubt === "market-does-not-sell",
    say: ({ silver }) =>
      `This region is not selling ${silver.doubtSubject ?? "these goods"}, so what the purchase costs cannot be said.`,
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ doubt: "market-does-not-sell", doubtSubject: "horses" }),
      warned: false,
      countUpkeep: true
    })
  },
  {
    id: "doubt-gives-a-whole-class",
    when: ({ silver }) => silver.doubt === "gives-a-whole-class",
    say: () => "This unit is giving away a whole class of goods, which cannot be counted.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ doubt: "gives-a-whole-class" }),
      warned: false,
      countUpkeep: true
    })
  },
  // With `countUpkeep` off there is no Upkeep row on show, so neither of this bead's two lines has
  // anything to explain and both would be noise about a hidden figure (`ah-7cdt`).
  {
    id: "doubt-contested-faction-food",
    when: ({ silver, countUpkeep }) =>
      countUpkeep && silver.doubt === "contested-faction-food",
    say: () => "There is not enough faction food here to feed every unit set to eat it.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ doubt: "contested-faction-food", upkeep: 10 }),
      warned: false,
      countUpkeep: true
    })
  },
  // The month can end in credit and the purchase still be refused, because wages reach the unit
  // only in the turn's last phase (`ah-uwa3`). The one line that says so names both the amount and
  // the order that fails, and comes before the two food notes: an order the game will refuse is
  // worth more of the reader's attention than an upkeep that was quietly paid.
  {
    id: "wages-too-late",
    // Only where wages are actually coming: a studying unit earns none, and telling it that wages
    // arrived too late describes money that never existed (`ah-moq3`).
    when: ({ silver }) =>
      silver.shortForOrders !== null &&
      silver.shortForOrders > 0 &&
      silver.lateIncome !== null &&
      silver.lateIncome > 0,
    say: ({ silver }) => {
      const spends = silver.shortOn ? ` when it ${SPENDS[silver.shortOn]}` : "";
      return `Wages arrive too late to pay for this month's orders, so this unit is ${silver.shortForOrders} short${spends}.`;
    },
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({
        income: 60,
        lateIncome: 60,
        expense: 40,
        atMonthEnd: 20,
        shortForOrders: 40,
        shortOn: "buy"
      }),
      warned: false,
      countUpkeep: true
    })
  },
  // The same shortfall with nothing on its way, so `ah-uwa3`'s explanation is not true of it.
  // Named by the order it bites on, because the reader can act on knowing which one the game will
  // refuse (`ah-moq3`). Below `wages-too-late`, so the more specific case still wins.
  {
    id: "cannot-pay",
    when: ({ silver }) => silver.shortForOrders !== null && silver.shortForOrders > 0,
    say: ({ silver }) =>
      `This unit cannot pay the ${silver.shortForOrders} ${CANNOT_PAY[silver.shortOn ?? "orders"]}.`,
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({
        held: 0,
        income: 0,
        lateIncome: 0,
        expense: 50,
        atMonthEnd: -50,
        shortForOrders: 50,
        shortOn: "study"
      }),
      // A unit that really is short is warned - and the inferred `shared-silver-covers-shortfall`
      // note above reads exactly that silence, so an unwarned example would be shadowed by it.
      warned: true,
      countUpkeep: true
    })
  },
  // An order the game will not carry out as written, like the shortfall line above - and below it,
  // because a shortfall is the more urgent of the two (`ah-19l2.2`). Silent at full rate: the
  // count is only worth a line when something stopped it.
  {
    id: "production-capped",
    when: ({ silver }) =>
      silver.productionCappedBy !== null && silver.producedName !== null,
    say: ({ silver }) => {
      const has = silver.productionCappedBy === "silver" ? "silver" : "materials";
      return `This unit has ${has} for ${countOf(silver.produced, silver.producedName as string)}, not the ${silver.productionWanted} its men could make.`;
    },
    example: () => ({
      unit: aReportUnit({ men: 3 }),
      silver: aUnitSilver({
        produced: 1,
        producedName: "catapult",
        productionWanted: 3,
        productionCappedBy: "silver"
      }),
      warned: false,
      countUpkeep: true
    })
  },
  // A doubt about the figure on show, so it sorts above the informational lines that explain one -
  // and below the shortfall line above, which is about an order the game will refuse (`ah-fjty`).
  // Step 6's contended case, which precedes step 7's in the payment order. Unlike step 7 it
  // suppresses the not-enough-silver warning as well, so the note is the only thing that says the
  // figure on show is pessimistic (`ah-eacd`).
  {
    id: "food-contended",
    when: ({ silver, countUpkeep }) => countUpkeep && silver.foodContended,
    say: () =>
      "There is not enough food here to feed every unit that needs it, so this unit may yet be fed.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ foodContended: true, upkeep: 10 }),
      warned: false,
      countUpkeep: true
    })
  },
  {
    id: "unclaimed-contended",
    when: ({ silver, countUpkeep }) => countUpkeep && silver.unclaimedContended,
    say: () => "There is not enough unclaimed silver to feed every unit that needs it.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ unclaimedContended: true, upkeep: 10 }),
      warned: false,
      countUpkeep: true
    })
  },
  // The two food notes are ordered by the game's own maintenance payment order: a unit spends its
  // own food (step 1) before the hex's faction food (step 2), so a unit fed by both names the step
  // that actually fed it first (`ah-p9z5`).
  // Guarded on `forcedOwnFood`, because a unit fed at step 5 has a non-zero `ownFoodCovered` too
  // and this branch would otherwise swallow the step-5 sentence below (`ah-eacd`).
  {
    id: "own-food-covers-upkeep",
    when: ({ silver, countUpkeep }) =>
      countUpkeep && silver.ownFoodCovered > 0 && silver.forcedOwnFood === 0,
    say: ({ silver }) => `This unit's own food covers ${silver.ownFoodCovered} of its upkeep.`,
    example: () => ({
      unit: aReportUnit({
        items: [{ tag: "GRAI", name: "grain", amount: 4 }]
      }),
      silver: aUnitSilver({ ownFoodCovered: 10, upkeep: 0 }),
      warned: false,
      countUpkeep: true
    })
  },
  // Step 5: food the game takes as a last resort rather than food the `CONSUME` flag chose. Said
  // in items and not silver, because the reader can act on knowing the loss was forced - they
  // could send silver (`ah-eacd`).
  {
    id: "forced-own-food",
    when: ({ silver, countUpkeep }) => countUpkeep && silver.forcedOwnFood > 0,
    say: ({ unit, silver }) => {
      const what = silver.forcedOwnFoodTag
        ? `${silver.forcedOwnFood} ${nameOfHeldItem(unit, silver.forcedOwnFoodTag)}`
        : `${silver.forcedOwnFood} of its food items`;
      return `This unit has no silver for its upkeep, so ${what} will be eaten.`;
    },
    example: () => ({
      unit: aReportUnit({
        items: [{ tag: "GRAI", name: "grain", amount: 4 }]
      }),
      // A unit fed at step 5 has a non-zero `ownFoodCovered` too - which is exactly why the note
      // above is guarded on `forcedOwnFood === 0` (`ah-eacd`).
      silver: aUnitSilver({ ownFoodCovered: 10, forcedOwnFood: 2, forcedOwnFoodTag: "GRAI" }),
      warned: false,
      countUpkeep: true
    })
  },
  // An Upkeep of 0 on a unit with six men reads as a defect until something says why: this is the
  // only row a *neighbour's* holdings move (`ah-7cdt`).
  {
    id: "faction-food-covers-upkeep",
    when: ({ silver, countUpkeep }) =>
      countUpkeep && silver.factionFoodCovered > 0 && silver.forcedFactionFood === 0,
    say: ({ silver }) =>
      `Faction food in this hex covers ${silver.factionFoodCovered} of this unit's upkeep.`,
    example: () => ({
      unit: aReportUnit({ men: 6 }),
      silver: aUnitSilver({ factionFoodCovered: 60, upkeep: 0 }),
      warned: false,
      countUpkeep: true
    })
  },
  // Step 6. Counted and never named: the pool is other units' inventory, and which items a shared,
  // all-or-nothing pool gives up is not this unit's to say (`ah-eacd`).
  {
    id: "forced-faction-food",
    when: ({ silver, countUpkeep }) => countUpkeep && silver.forcedFactionFood > 0,
    say: ({ silver }) => {
      const n = silver.forcedFactionFood;
      return `This unit has no silver for its upkeep, so ${n} faction food item${n === 1 ? "" : "s"} in this hex will be eaten.`;
    },
    example: () => ({
      unit: aReportUnit({ men: 6 }),
      // As with step 5 above, the covering figure is non-zero as well, and the note above is
      // guarded on `forcedFactionFood === 0` for exactly that reason.
      silver: aUnitSilver({ factionFoodCovered: 60, forcedFactionFood: 3 }),
      warned: false,
      countUpkeep: true
    })
  },
  // Step 4 of the payment order: automatic, and unconditional on the `SHARE` flag, which governs
  // discretionary spending only. Said of upkeep because upkeep is the only thing automatic sharing
  // ever pays for (`ah-e66j`, round 1).
  {
    id: "shared-silver-pays-upkeep",
    when: ({ silver, countUpkeep }) => countUpkeep && silver.sharedSilverCovered > 0,
    say: () => "A faction-mate's silver in this hex pays this unit's upkeep.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ sharedSilverCovered: 10, upkeep: 0 }),
      warned: false,
      countUpkeep: true
    })
  },
  // The `SHARE` flag's own purse, and the discretionary twin of the upkeep note above - which is
  // the more specific of the two and so keeps its place ahead of this one. Money appearing from
  // nowhere is exactly what the upkeep, food and unclaimed-fund notes all exist to explain, so a
  // unit a faction-mate paid for is told so (`ah-moq3`).
  //
  // Not gated on `countUpkeep`: it explains the `Out` row and the month end, which are on show
  // whatever that setting says - the same reasoning `withdrawing` and `works-by-default` use.
  {
    id: "shared-silver-pays-orders",
    when: ({ silver }) => silver.sharedSilverForOrders > 0,
    say: () => "A faction-mate's silver in this hex pays for this unit's orders.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ sharedSilverForOrders: 50, upkeep: 0 }),
      warned: false,
      countUpkeep: true
    })
  },
  // Step 7 of the payment order, and so the last of the three notes that explain an Upkeep the
  // reader can see is smaller than the headcount owes: own food (step 1), the hex's faction food
  // (step 2), then the faction's unclaimed fund (`ah-fjty`).
  {
    id: "unclaimed-covers-upkeep",
    when: ({ silver, countUpkeep }) => countUpkeep && silver.unclaimedCovered > 0,
    say: ({ silver }) =>
      `The faction's unclaimed silver covers ${silver.unclaimedCovered} of this unit's upkeep.`,
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ unclaimedCovered: 10, upkeep: 0 }),
      warned: false,
      countUpkeep: true
    })
  },
  // Income arriving from an order nobody wrote reads as a defect until something says why - the
  // same reason the food and fund notes above exist (`ah-gjq4`). Not gated on `countUpkeep`: it
  // explains the `In` row, which is on show whatever the setting says. It sorts below the food and
  // fund notes because each of those is the rarer, more specific fact, and a zero in a row is a
  // sharper surprise than a positive income figure the `In too late to spend` row already half
  // explains - so an idle unit that faction food also fed shows the food note and not this one.
  // Gated on `lateIncome` rather than `income`: for an idle unit the wage IS the whole of its late
  // income - entertaining would spend the month - while total income also carries gifts and claims,
  // which are not wages and would make this sentence say something untrue about them.
  {
    id: "works-by-default",
    when: ({ silver }) =>
      silver.worksByDefault && silver.lateIncome !== null && silver.lateIncome > 0,
    say: () => "This unit has no month-long order, so it will work and earn wages.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({
        worksByDefault: true,
        income: 12,
        lateIncome: 12,
        atMonthEnd: 12
      }),
      warned: false,
      countUpkeep: true
    })
  },
  // The one income in the column with no line in this turn's orders behind it: the flag was set in
  // some earlier turn and is invisible here, so $40,000 would otherwise appear from nowhere
  // (`ah-fvzu`). Above the gift note because a gift is the more specific of the two, and both
  // explain where money in the figure came from.
  {
    id: "taxes-by-flag",
    when: ({ silver }) => silver.taxesByFlag,
    say: () => "This unit is set to tax every turn, so it taxes without an order.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ taxesByFlag: true, income: 40000, atMonthEnd: 40000 }),
      warned: false,
      countUpkeep: true
    })
  },
  // A gift is the one part of the figure that comes from somebody else's orders, so it is the one
  // part a reader cannot find by looking at this unit's own block.
  {
    id: "includes-gift",
    when: ({ silver }) => silver.received > 0 && silver.givers.length > 0,
    say: ({ silver }) =>
      `Includes ${silver.received} given by ${namesInAList(silver.givers)} in this hex.`,
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({
        received: 25,
        givers: ["Quartermaster (18500)"],
        income: 25,
        atMonthEnd: 25
      }),
      warned: false,
      countUpkeep: true
    })
  },
  // Silver a unit is ordered to destroy is spending like any other, and the one kind a reader
  // would otherwise look for a recipient of and find none.
  {
    id: "given-to-nobody",
    when: ({ silver }) => silver.givenToNobody > 0,
    say: ({ silver }) => `Includes ${silver.givenToNobody} given away to nobody.`,
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ held: 30, givenToNobody: 10, expense: 10, atMonthEnd: 20 }),
      warned: false,
      countUpkeep: true
    })
  },
  // The fund pays for a withdrawal, never the unit, so an `Out` of zero on a unit ordered to
  // withdraw $369 of grain reads as a defect until this says why (`ah-tdsi`). Not gated on
  // `countUpkeep` like the food notes: it explains `Out`, which is on show either way. It sits
  // below the two notes above because those explain money that IS on show, and this one explains a
  // contribution of zero - the file's own order of priority.
  {
    id: "withdrawing",
    when: ({ silver }) => silver.withdrawing,
    say: () => "This unit's withdrawal is paid from the faction's unclaimed silver.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ withdrawing: true }),
      warned: false,
      countUpkeep: true
    })
  },
  {
    id: "nothing-moves-silver",
    when: ({ silver }) => silver.income === 0 && silver.expense === 0,
    say: () => "Nothing this unit is ordered to do moves silver.",
    example: () => ({
      unit: aReportUnit(),
      silver: aUnitSilver({ held: 12, atMonthEnd: 12 }),
      warned: false,
      countUpkeep: true
    })
  }
];

function silverNote(
  unit: ReportUnit,
  silver: UnitSilver,
  warned: boolean,
  countUpkeep: boolean
): string | null {
  const facts: SilverFacts = { unit, silver, warned, countUpkeep };
  const note = SILVER_NOTES.find((candidate) => candidate.when(facts));
  return note ? note.say(facts) : null;
}
