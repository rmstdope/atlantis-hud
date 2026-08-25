import type { ReportUnit, UnitSilver } from "@atlantis/core-client";
import { aReportUnit, aUnitSilver } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { HOVER_DELAY_MS, SILVER_NOTES, placeTooltip, summariseUnit } from "./unitTooltip";

const unit = (overrides: Partial<ReportUnit> = {}): ReportUnit =>
  aReportUnit({ unitId: "18642", name: "Seven of Eight", ...overrides });

describe("HOVER_DELAY_MS", () => {
  it("waits long enough that passing the pointer over the table shows nothing", () => {
    expect(HOVER_DELAY_MS).toBe(300);
  });
});

describe("summariseUnit", () => {
  it("titles the summary with the unit's name and its id", () => {
    expect(summariseUnit(unit()).title).toBe("Seven of Eight (18642)");
  });

  it("lists every skill with its tag, level and study points", () => {
    const summary = summariseUnit(
      unit({
        skills: [
          { name: "observation", tag: "OBSE", level: 3, points: 180 },
          { name: "stealth", tag: "STEA", level: 1, points: 30 }
        ]
      })
    );

    expect(summary.skills).toEqual([
      { label: "observation OBSE", value: "3 (180)" },
      { label: "stealth STEA", value: "1 (30)" }
    ]);
  });

  it("lists every item, the largest holding first", () => {
    const summary = summariseUnit(
      unit({
        items: [
          { amount: 2, name: "swords", tag: "SWOR" },
          { amount: 1200, name: "silver", tag: "SILV" }
        ]
      })
    );

    expect(summary.items.map((item) => item.label)).toEqual(["silver SILV", "swords SWOR"]);
    // The digits, not the grouping: see the locale test below.
    expect(summary.items.map((item) => item.value.replace(/\D/g, ""))).toEqual(["1200", "2"]);
  });

  /**
   * Asserting "1,200" would pin en-US and fail under a Swedish or German locale while passing on
   * CI - a works-here-fails-there trap the unit composition tests already avoid. The property that
   * matters is that the digits survive and a separator was added, whatever that separator is.
   */
  it("groups thousands in whatever way the reader's locale does", () => {
    const [silver] = summariseUnit(
      unit({ items: [{ amount: 1200, name: "silver", tag: "SILV" }] })
    ).items;

    expect(silver.value.replace(/\D/g, "")).toBe("1200");
    expect(silver.value).not.toBe("1200");
  });

  it("does not reorder the unit's own skills or items lists", () => {
    const skills = [{ name: "stealth", tag: "STEA", level: 1, points: 30 }];
    const items = [
      { amount: 2, name: "swords", tag: "SWOR" },
      { amount: 1200, name: "silver", tag: "SILV" }
    ];
    summariseUnit(unit({ skills, items }));

    expect(items.map((item) => item.tag)).toEqual(["SWOR", "SILV"]);
    expect(skills.map((skill) => skill.tag)).toEqual(["STEA"]);
  });

  it("gives back empty lists for a unit carrying and knowing nothing", () => {
    const summary = summariseUnit(unit());
    expect(summary.skills).toEqual([]);
    expect(summary.items).toEqual([]);
  });
});

/**
 * The tooltip is placed against the pointer, in viewport coordinates.
 *
 * A gap of 12 keeps it clear of the cursor itself, which would otherwise sit on top of the first
 * line of text.
 */
describe("placeTooltip", () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 200, height: 100 };

  it("sits below and to the right of the pointer when there is room", () => {
    expect(placeTooltip({ x: 100, y: 100 }, size, viewport)).toEqual({ left: 112, top: 112 });
  });

  it("flips to the left of the pointer rather than run off the right edge", () => {
    expect(placeTooltip({ x: 950, y: 100 }, size, viewport)).toEqual({ left: 738, top: 112 });
  });

  it("flips above the pointer rather than run off the bottom edge", () => {
    expect(placeTooltip({ x: 100, y: 750 }, size, viewport)).toEqual({ left: 112, top: 638 });
  });

  it("stays on screen when neither side has room", () => {
    // A tooltip wider than the viewport has nowhere to flip to, so it is pinned to the left edge
    // rather than left hanging off one side.
    const wide = { width: 1200, height: 100 };
    expect(placeTooltip({ x: 500, y: 100 }, wide, viewport)).toEqual({ left: 0, top: 112 });
  });

  it("never places the tooltip above the top of the viewport", () => {
    const tall = { width: 200, height: 900 };
    expect(placeTooltip({ x: 100, y: 750 }, tall, viewport)).toEqual({ left: 112, top: 0 });
  });
});

describe("a skill's study points in the unit tooltip (ah-ded4)", () => {
  // The skills cell truncates *into* this tooltip by design, so the fallback must carry at least
  // what the cell does — otherwise a many-skilled unit is worse off than before the points existed.
  it("carries the level and the points, so a truncated cell can be recovered", () => {
    const summary = summariseUnit(
      unit({ skills: [{ name: "mining", tag: "MINI", level: 2, points: 90 }] })
    );

    expect(summary.skills).toEqual([{ label: "mining MINI", value: "2 (90)" }]);
  });

  it("renders (0) for a skill with no points yet", () => {
    const summary = summariseUnit(
      unit({ skills: [{ name: "mining", tag: "MINI", level: 0, points: 0 }] })
    );

    expect(summary.skills).toEqual([{ label: "mining MINI", value: "0 (0)" }]);
  });
});

/**
 * The Silver section (`ah-1wcw.1`).
 *
 * Every string the hover shows is decided here rather than in the component, because
 * `packages/shared` has no jsdom and a component test could never read them back.
 */
describe("the silver section", () => {
  // `1:6,52` is this file's existing fixture region; `aUnitSilver` defaults to the builders'
  // own world.
  const forecast = (overrides: Partial<UnitSilver> = {}): UnitSilver =>
    aUnitSilver({
      regionId: "1:6,52",
      held: 60,
      expense: 200,
      atMonthEnd: -140,
      upkeep: 50,
      ...overrides
    });

  it("says_when_a_unit_taxes_by_its_flag", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ income: 40000, atMonthEnd: 39860, taxesByFlag: true })
    );

    expect(summary.silver?.note).toBe(
      "This unit is set to tax every turn, so it taxes without an order."
    );
  });

  it("a_unit_with_a_tax_order_says_nothing_extra", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ income: 40000, atMonthEnd: 39860, taxesByFlag: false })
    );

    expect(summary.silver?.note ?? null).toBeNull();
  });

  it("says_when_silver_caps_a_production", () => {
    const capped = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        expense: 3000,
        atMonthEnd: 0,
        upkeep: 0,
        produced: 1,
        producedName: "catapult",
        productionWanted: 2,
        productionCappedBy: "silver"
      }),
      true
    );

    expect(capped.silver?.note).toBe(
      "This unit has silver for 1 catapult, not the 2 its men could make."
    );
  });

  it("says_when_materials_cap_a_production", () => {
    const capped = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        expense: 0,
        atMonthEnd: 60,
        upkeep: 0,
        produced: 0,
        producedName: "catapult",
        productionWanted: 2,
        productionCappedBy: "materials"
      }),
      true
    );

    // Every sentence that holds, not the first (`ah-x36v`): no silver moves either, and that is
    // now said alongside rather than swallowed.
    expect(capped.silver?.note).toBe(
      [
        "This unit has materials for 0 catapults, not the 2 its men could make.",
        "Nothing this unit is ordered to do moves silver."
      ].join("\n")
    );
  });

  it("the_shortfall_outranks_a_capped_production", () => {
    const both = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        expense: 3000,
        atMonthEnd: 0,
        upkeep: 0,
        shortForOrders: 200,
        shortOn: "produce",
        produced: 1,
        producedName: "catapult",
        productionWanted: 2,
        productionCappedBy: "silver"
      }),
      true
    );

    // The shortfall still reads first, and the capped count is no longer lost behind it (`ah-x36v`).
    expect(both.silver?.note).toBe(
      [
        "This unit cannot pay the 200 its production costs.",
        "This unit has silver for 1 catapult, not the 2 its men could make."
      ].join("\n")
    );
  });

  it("says_nothing_when_a_production_runs_at_full_rate", () => {
    const full = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        expense: 6000,
        atMonthEnd: 0,
        upkeep: 0,
        produced: 2,
        producedName: "catapult",
        productionWanted: 2,
        productionCappedBy: null
      }),
      true
    );

    expect(full.silver?.note).toBeNull();
  });

  it("the_silver_section_says_what_made_the_number", () => {
    const summary = summariseUnit(aReportUnit({ unitId: "1" }), forecast(), true);

    expect(summary.silver?.rows).toEqual([
      { label: "Held now", value: "60" },
      { label: "In, in time", value: "0" },
      { label: "In, too late", value: "0" },
      { label: "Out", value: "200" },
      { label: "At month end", value: "-140" }
    ]);
  });

  it("the_silver_section_shows_an_upkeep_row_only_when_counting", () => {
    const counting = summariseUnit(aReportUnit({ unitId: "1" }), forecast(), true, true);

    expect(counting.silver?.rows).toEqual([
      { label: "Held now", value: "60" },
      { label: "In, in time", value: "0" },
      { label: "In, too late", value: "0" },
      { label: "Out", value: "200" },
      { label: "Upkeep", value: "50" },
      { label: "At month end", value: "-190" }
    ]);
  });

  it("the_silver_section_explains_faction_food", () => {
    const covered = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, factionFoodCovered: 60 }),
      true,
      true
    );
    expect(covered.silver?.note).toBe(
      "This unit's upkeep was paid by faction food here (60)."
    );

    const contested = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: null, doubt: "contested-faction-food" }),
      true,
      true
    );
    expect(contested.silver?.note).toBe(
      "There is not enough faction food here to feed every unit set to eat it."
    );
  });

  it("says_when_food_is_eaten_because_silver_ran_out", () => {
    const forced = summariseUnit(
      aReportUnit({
        unitId: "1",
        items: [{ amount: 2, name: "grain", tag: "GRAI" }]
      }),
      forecast({
        upkeep: 0,
        ownFoodCovered: 60,
        forcedOwnFood: 2,
        forcedOwnFoodTag: "GRAI"
      }),
      true,
      true
    );
    expect(forced.silver?.note).toBe(
      "This unit has no silver for its upkeep, so 2 grain will be eaten."
    );
  });

  it("counts_a_mixed_larder_rather_than_naming_it", () => {
    const mixed = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        upkeep: 0,
        ownFoodCovered: 150,
        forcedOwnFood: 3,
        forcedOwnFoodTag: null
      }),
      true,
      true
    );
    expect(mixed.silver?.note).toBe(
      "This unit has no silver for its upkeep, so 3 of its food items will be eaten."
    );
  });

  it("counts_faction_food_and_never_names_it", () => {
    const fed = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, factionFoodCovered: 50, forcedFactionFood: 1 }),
      true,
      true
    );
    expect(fed.silver?.note).toBe(
      "This unit has no silver for its upkeep, so 1 faction food item in this hex will be eaten."
    );

    const several = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, factionFoodCovered: 100, forcedFactionFood: 2 }),
      true,
      true
    );
    expect(several.silver?.note).toBe(
      "This unit has no silver for its upkeep, so 2 faction food items in this hex will be eaten."
    );
  });

  it("says_when_a_short_pool_might_yet_feed_the_unit", () => {
    const contended = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 60, foodContended: true }),
      true,
      true
    );
    expect(contended.silver?.note).toBe(
      "There is not enough food here to feed every unit that needs it, so this unit may yet be fed."
    );
  });

  it("a_chosen_food_payment_keeps_its_own_sentence", () => {
    const chosen = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, ownFoodCovered: 60, forcedOwnFood: 0 }),
      true,
      true
    );
    expect(chosen.silver?.note).toBe("This unit's upkeep was paid by its own food (60).");
  });

  it("the_silver_section_says_when_a_units_own_food_fed_it", () => {
    const fed = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, ownFoodCovered: 60 }),
      true,
      true
    );
    expect(fed.silver?.note).toBe("This unit's upkeep was paid by its own food (60).");
  });

  it("a_unit_fed_by_both_names_its_own_food_first", () => {
    // The note follows the game's own maintenance payment order: own food is step 1, the hex's
    // faction food step 2, so the step that actually fed it is named first (`ah-p9z5`).
    const both = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, ownFoodCovered: 50, factionFoodCovered: 10 }),
      true,
      true
    );
    expect(both.silver?.note).toBe(
      "This unit's upkeep was paid by its own food (50) and faction food here (10)."
    );
  });

  it("neither_food_note_appears_when_upkeep_is_not_counted", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, ownFoodCovered: 50, factionFoodCovered: 10 }),
      true
    );
    expect(summary.silver?.note ?? "").not.toContain("own food");
    expect(summary.silver?.note ?? "").not.toContain("Faction food");
  });

  it("the_faction_food_note_survives_a_warned_unit", () => {
    // Psylocke's ah-7cdt verification: an Upkeep of 0 with nothing said about why. The wages
    // sentence is about what WORK earns and says nothing about the row a reader is puzzling over,
    // so the explanation of the figure on show wins.
    const fed = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ income: 0, expense: 0, atMonthEnd: 0, upkeep: 0, factionFoodCovered: 60 }),
      true,
      true
    );
    expect(fed.silver?.note).toBe(
      [
        "This unit's upkeep was paid by faction food here (60).",
        "Nothing this unit is ordered to do moves silver."
      ].join("\n")
    );
  });

  it("the_note_names_the_unclaimed_fund_when_it_paid_the_upkeep", () => {
    // Step 7 of the payment order, after both food steps: an Upkeep of 0 the faction's unclaimed
    // silver paid, said in the same shape as the two food notes (`ah-fjty`).
    const fed = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, unclaimedCovered: 60 }),
      true,
      true
    );
    expect(fed.silver?.note).toBe(
      "This unit's upkeep was paid by the faction's unclaimed silver (60)."
    );

    const notCounting = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, unclaimedCovered: 60 }),
      true
    );
    expect(notCounting.silver?.note ?? "").not.toContain("unclaimed silver");
  });

  it("the_note_says_an_idle_unit_will_work", () => {
    // Income arriving from an order nobody wrote reads as a defect until something says why
    // (`ah-gjq4`). It explains the `In` row, which is on show whatever the upkeep setting says -
    // unlike the food and fund notes, which explain `Upkeep`.
    const idle = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ income: 72, lateIncome: 72, worksByDefault: true }),
      true,
      true
    );
    expect(idle.silver?.note).toBe(
      "This unit has no month-long order, so it will work and earn wages."
    );

    const notCounting = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ income: 72, lateIncome: 72, worksByDefault: true }),
      true
    );
    expect(notCounting.silver?.note).toBe(
      "This unit has no month-long order, so it will work and earn wages."
    );
  });

  it("an_idle_unit_whose_income_is_a_gift_is_not_told_it_will_earn_wages", () => {
    // Total income carries gifts and claims as well as wages, so an idle unit in a region with no
    // wage line that was given silver has `income > 0` and no wages at all. For an idle unit the
    // wage is exactly its late income, which is what the note is gated on (`ah-gjq4`, review).
    const gifted = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        income: 40,
        lateIncome: 0,
        worksByDefault: true,
        received: 40,
        givers: ["Lender (100)"]
      }),
      true,
      true
    );
    expect(gifted.silver?.note).toBe(
      "Includes 40 given by Lender (100) in this hex."
    );
  });

  it("an_idle_unit_that_faction_food_also_fed_shows_the_food_note", () => {
    // The ordering decided in planning: the food note is the rarer, more specific fact, and a zero
    // in the Upkeep row is a sharper surprise than a positive income figure (`ah-gjq4`).
    const fed = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        income: 72,
        lateIncome: 72,
        worksByDefault: true,
        upkeep: 0,
        factionFoodCovered: 60
      }),
      true,
      true
    );
    expect(fed.silver?.note).toBe(
      [
        "This unit's upkeep was paid by faction food here (60).",
        "This unit has no month-long order, so it will work and earn wages."
      ].join("\n")
    );
  });

  it("the_note_says_the_fund_cannot_reach_everybody", () => {
    // The figure on show is this unit's whole fee, pessimistically, so the note is what says the
    // number may be kinder than it looks (`ah-fjty`, round 2 question 1).
    const contended = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 50, unclaimedContended: true }),
      true,
      true
    );
    expect(contended.silver?.note).toBe(
      "There is not enough unclaimed silver to feed every unit that needs it."
    );

    const notCounting = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 50, unclaimedContended: true }),
      true
    );
    expect(notCounting.silver?.note ?? "").not.toContain("unclaimed silver");
  });

  it("no_faction_food_note_when_upkeep_is_not_counted", () => {
    const covered = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, factionFoodCovered: 60 }),
      true
    );
    expect(covered.silver?.note ?? "").not.toContain("Faction food");

    const contested = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: null, doubt: "contested-faction-food" }),
      true
    );
    expect(contested.silver?.note ?? "").not.toContain("faction food");
  });

  it("an_upkeep_nothing_could_price_reads_as_a_question_mark", () => {
    const counting = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: null }),
      true,
      true
    );

    expect(counting.silver?.rows).toEqual([
      { label: "Held now", value: "60" },
      { label: "In, in time", value: "0" },
      { label: "In, too late", value: "0" },
      { label: "Out", value: "200" },
      { label: "Upkeep", value: "?" },
      { label: "At month end", value: "?" }
    ]);
  });

  it("a_unit_with_no_forecast_has_no_section", () => {
    expect(summariseUnit(aReportUnit({ unitId: "1" }), null).silver).toBeNull();
  });

  it("a_doubted_row_shows_a_question_mark_in_place_of_its_figure", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      // `lateIncome` is `null` wherever `income` is: the core computes it in the same pass.
      forecast({
        income: null,
        lateIncome: null,
        atMonthEnd: null,
        doubt: "unknown-tax-base"
      })
    );

    expect(summary.silver?.rows).toEqual([
      { label: "Held now", value: "60" },
      { label: "In, in time", value: "?" },
      { label: "In, too late", value: "?" },
      { label: "Out", value: "200" },
      { label: "At month end", value: "?" }
    ]);
  });

  // `ah-moq3`. A studying unit earns no wages, so telling it that wages arrived too late describes
  // money that was never coming. The wages sentence is narrowed to the case `ah-uwa3` wrote it for,
  // and a shortfall with nothing on its way is named by the order it bites on instead.
  it("a_short_studier_is_not_told_about_wages", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        held: 0,
        income: 0,
        lateIncome: 0,
        expense: 50,
        atMonthEnd: -50,
        shortForOrders: 50,
        shortOn: "study"
      }),
      true,
      true
    );

    expect(summary.silver?.note).toBe("This unit cannot pay the 50 its study costs.");
  });

  it("a_worker_whose_wages_arrive_late_still_is", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        held: 0,
        income: 120,
        lateIncome: 120,
        expense: 60,
        atMonthEnd: 60,
        shortForOrders: 60,
        shortOn: "buy"
      }),
      true,
      true
    );

    expect(summary.silver?.note).toBe(
      [
        "Wages arrive too late to pay for this month's orders, so this unit is 60 short when it buys.",
        "This unit cannot pay the 60 its purchase costs."
      ].join("\n")
    );
  });

  it("names_the_cost_a_short_unit_cannot_pay_for_every_kind_of_order", () => {
    const note = (shortOn: UnitSilver["shortOn"]) =>
      summariseUnit(
        aReportUnit({ unitId: "1" }),
        forecast({
          held: 0,
          income: 0,
          lateIncome: 0,
          expense: 50,
          atMonthEnd: -50,
          shortForOrders: 50,
          shortOn
        }),
        true,
        true
      ).silver?.note;

    expect(note("study")).toBe("This unit cannot pay the 50 its study costs.");
    expect(note("buy")).toBe("This unit cannot pay the 50 its purchase costs.");
    expect(note("produce")).toBe("This unit cannot pay the 50 its production costs.");
    expect(note("cast")).toBe("This unit cannot pay the 50 its casting costs.");
    expect(note("give")).toBe("This unit cannot pay the 50 it gives away.");
    expect(note(null)).toBe("This unit cannot pay the 50 its orders cost.");
  });

  it("says_when_a_faction_mate_pays_for_this_units_orders", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        held: 0,
        income: 0,
        lateIncome: 0,
        expense: 50,
        atMonthEnd: 0,
        shortForOrders: 0,
        upkeep: 0,
        sharedSilverForOrders: 50
      }),
      false,
      true
    );

    expect(summary.silver?.note).toBe(
      "A faction-mate's silver in this hex pays for this unit's orders."
    );
  });

  it("a_unit_paying_for_itself_says_nothing_extra", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        held: 100,
        income: 0,
        lateIncome: 0,
        expense: 50,
        atMonthEnd: 50,
        shortForOrders: 0,
        upkeep: 0,
        sharedSilverForOrders: 0
      }),
      false,
      true
    );

    expect(summary.silver?.note ?? null).toBeNull();
  });

  it("says_when_a_faction_mate_pays_the_upkeep", () => {
    // Automatic maintenance sharing, which needs no SHARE flag - so it gets its own sentence
    // rather than the flag's (`ah-e66j`, round 1).
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, sharedSilverCovered: 60 }),
      true,
      true
    );
    expect(summary.silver?.note).toBe(
      "This unit's upkeep was paid by a faction-mate's silver (60)."
    );
  });

  it("an_automatic_rescue_does_not_claim_the_player_shared_anything", () => {
    // The note at the top of `silverNote` is inferred from "the column is negative and nothing
    // warns", not from any field, so without the `sharedSilverCovered === 0` guard it tells a
    // player who set no SHARE flag anywhere that their silver was shared (`ah-e66j`). The same
    // unit, differing only in whether a faction-mate paid its upkeep, must get the other sentence.
    const shared = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ sharedSilverCovered: 60 }),
      false,
      true
    );
    expect(shared.silver?.note).toBe(
      "This unit's upkeep was paid by a faction-mate's silver (60)."
    );

    const flagged = summariseUnit(aReportUnit({ unitId: "1" }), forecast(), false, true);
    expect(flagged.silver?.note).toBe("Shared silver in this hex covers the shortfall.");
  });

  it("says_when_shared_silver_covers_the_shortfall", () => {
    const summary = summariseUnit(aReportUnit({ unitId: "1" }), forecast(), false);
    expect(summary.silver?.note).toBe("Shared silver in this hex covers the shortfall.");
  });

  it("says_why_each_doubt_could_not_be_priced", () => {
    const note = (doubt: UnitSilver["doubt"]) =>
      summariseUnit(aReportUnit({ unitId: "1" }), forecast({ atMonthEnd: null, doubt })).silver
        ?.note;

    expect(note("unknown-tax-base")).toBe("The report never said what this region's tax base is.");
    expect(note("unpriced-skill")).toBe("The ruleset does not say what studying this skill costs.");
    expect(note("estimated-men")).toBe(
      "This unit's headcount is an estimate, so its month cannot be priced."
    );
    expect(note("takes-all-from-another")).toBe(
      "Taking all of another unit's silver cannot be counted until that unit's own month is settled."
    );
  });

  it("says_what_a_unit_took_and_from_whom", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ income: 100, expense: 0, atMonthEnd: 160, taken: 100, takenFrom: ["Workers (6567)"] })
    );

    expect(summary.silver?.note).toBe("Includes 100 taken from Workers (6567) in this hex.");
  });

  it("names_two_sources_the_way_gifts_are_named", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        income: 210,
        expense: 0,
        atMonthEnd: 270,
        taken: 210,
        takenFrom: ["Workers (6567)", "MinersA (16435)"]
      })
    );

    expect(summary.silver?.note).toBe(
      "Includes 210 taken from Workers (6567) and MinersA (16435) in this hex."
    );
  });

  /// `ah-awcm`: money in before money out, and `silverNote` is a first-match chain, so a sentence
  /// in the wrong slot silently swallows the one below it (`ah-hvt8`).
  it("a_unit_that_takes_is_given_and_gives_away_reads_in_that_order", () => {
    const all = {
      income: 125,
      expense: 30,
      atMonthEnd: 155,
      taken: 100,
      takenFrom: ["Workers (6567)"],
      received: 25,
      givers: ["ArmorerA (5671)"],
      givenToNobody: 30
    };
    const note = (silver: Partial<UnitSilver>) =>
      summariseUnit(aReportUnit({ unitId: "1" }), forecast(silver)).silver?.note;

    // All three now appear together, in this order - which is what `ah-awcm` was agreed to do and
    // what the first-match contract could not honour (`ah-x36v`).
    expect(note(all)).toBe(
      [
        "Includes 100 taken from Workers (6567) in this hex.",
        "Includes 25 given by ArmorerA (5671) in this hex.",
        "Includes 30 given away to nobody."
      ].join("\n")
    );
    expect(note({ ...all, taken: 0, takenFrom: [] })).toBe(
      [
        "Includes 25 given by ArmorerA (5671) in this hex.",
        "Includes 30 given away to nobody."
      ].join("\n")
    );
    expect(note({ ...all, taken: 0, takenFrom: [], received: 0, givers: [] })).toBe(
      "Includes 30 given away to nobody."
    );
  });

  it("the_note_explains_a_pool_contended_by_a_guessed_headcount", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ atMonthEnd: null, doubt: "contested-region-pool" })
    );

    expect(summary.silver?.note).toBe(
      "Another of your units here draws on the same pool and its headcount is an estimate, so this unit's share cannot be worked out."
    );
  });

  it("the_silver_section_separates_income_that_arrives_too_late", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        held: 0,
        income: 120,
        lateIncome: 120,
        expense: 60,
        atMonthEnd: 60,
        shortForOrders: 60,
        shortOn: "buy"
      }),
      true,
      true
    );

    expect(summary.silver?.rows).toEqual([
      { label: "Held now", value: "0" },
      { label: "In, in time", value: "0" },
      { label: "In, too late", value: "120" },
      { label: "Out", value: "60" },
      { label: "Upkeep", value: "50" },
      { label: "At month end", value: "10" }
    ]);
    expect(summary.silver?.note).toBe(
      [
        "Wages arrive too late to pay for this month's orders, so this unit is 60 short when it buys.",
        "This unit cannot pay the 60 its purchase costs."
      ].join("\n")
    );
  });

  // `ah-uwa3` removed the old line about wages arriving at the end of the month; it is gone rather
  // than unused, and quoting it here would put it back into the tree that acceptance greps.
  it("a_warning_on_a_positive_figure_that_the_orders_can_pay_needs_no_line", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ income: 200, expense: 0, atMonthEnd: 260 }),
      true
    );
    expect(summary.silver?.note).toBeNull();
  });

  it("says_when_nothing_the_unit_does_moves_silver", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ income: 0, expense: 0, atMonthEnd: 60 })
    );
    expect(summary.silver?.note).toBe("Nothing this unit is ordered to do moves silver.");
  });

  it("the_silver_section_explains_a_gift_and_an_unpriced_spell", () => {
    const note = (silver: Partial<UnitSilver>) =>
      summariseUnit(aReportUnit({ unitId: "1" }), forecast(silver)).silver?.note;

    expect(
      note({ income: null, atMonthEnd: null, doubt: "unknown-goods", doubtSubject: "herbs" })
    ).toBe("The report does not say what herbs are, so what this sale earns cannot be said.");
    expect(
      note({
        income: 200,
        expense: 0,
        atMonthEnd: 260,
        received: 200,
        givers: ["Paymaster (2390)"]
      })
    ).toBe("Includes 200 given by Paymaster (2390) in this hex.");
  });

  it("the_silver_section_explains_a_purchase_and_a_withdrawal", () => {
    const note = (silver: Partial<UnitSilver>) =>
      summariseUnit(aReportUnit({ unitId: "1" }), forecast(silver)).silver?.note;

    expect(
      note({
        expense: null,
        atMonthEnd: null,
        doubt: "market-does-not-sell",
        doubtSubject: "horses"
      })
    ).toBe("This region is not selling horses, so what the purchase costs cannot be said.");
    expect(note({ expense: null, atMonthEnd: null, doubt: "gives-a-whole-class" })).toBe(
      "This unit is giving away a whole class of goods, which cannot be counted."
    );
    expect(
      note({ income: 0, expense: 300, atMonthEnd: 60, givenToNobody: 300 })
    ).toBe("Includes 300 given away to nobody.");
  });

  it("says_the_fund_paid_for_a_withdrawal", () => {
    const note = (countUpkeep: boolean) =>
      summariseUnit(
        aReportUnit({ unitId: "1" }),
        forecast({ income: 0, expense: 0, atMonthEnd: 60, upkeep: 0, withdrawing: true }),
        true,
        countUpkeep
      ).silver?.note;

    // It explains `Out`, which is on show whatever the upkeep setting says (`ah-tdsi`).
    const said = [
      "This unit's withdrawal is paid from the faction's unclaimed silver.",
      "Nothing this unit is ordered to do moves silver."
    ].join("\n");
    expect(note(true)).toBe(said);
    expect(note(false)).toBe(said);
  });

  // The withdrawal note explains a contribution of zero; these two explain money that is on show,
  // and a gift is the one part of the figure a reader cannot find in this unit's own block. So a
  // unit that withdraws AND receives must still be told about the gift (`ah-tdsi`).
  it("the_withdrawal_note_never_masks_a_gift", () => {
    const noteFor = (overrides: Partial<UnitSilver>) =>
      summariseUnit(
        aReportUnit({ unitId: "1" }),
        forecast({ withdrawing: true, ...overrides }),
        true
      ).silver?.note;

    expect(
      noteFor({ income: 300, expense: 0, atMonthEnd: 360, received: 300, givers: ["2"] })
    ).toBe(
      [
        "Includes 300 given by 2 in this hex.",
        "This unit's withdrawal is paid from the faction's unclaimed silver."
      ].join("\n")
    );
    expect(noteFor({ income: 0, expense: 300, atMonthEnd: 60, givenToNobody: 300 })).toBe(
      [
        "Includes 300 given away to nobody.",
        "This unit's withdrawal is paid from the faction's unclaimed silver."
      ].join("\n")
    );
  });

  it("names_every_giver_the_way_a_market_list_reads", () => {
    const note = (givers: string[], received: number) =>
      summariseUnit(
        aReportUnit({ unitId: "1" }),
        forecast({ income: received, expense: 0, atMonthEnd: 60 + received, received, givers })
      ).silver?.note;

    expect(note(["Paymaster (2390)", "Steward (2391)"], 300)).toBe(
      "Includes 300 given by Paymaster (2390) and Steward (2391) in this hex."
    );
    expect(note(["Paymaster (2390)", "Steward (2391)", "Reeve (2392)"], 400)).toBe(
      "Includes 400 given by Paymaster (2390), Steward (2391) and Reeve (2392) in this hex."
    );
  });

  it("an_unsellable_sale_adds_no_note", () => {
    // The sale earns nothing and that is the answer rather than a guess, so the column shows a
    // number and the shipped `not-traded-here` finding is what says why. `ah-1wcw.2`.
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ income: 0, expense: 100, atMonthEnd: -40 }),
      true
    );
    expect(summary.silver?.note).toBeNull();
  });

  it("says_nothing_when_there_is_nothing_to_explain", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ income: 400, expense: 100, atMonthEnd: 360 })
    );
    expect(summary.silver?.note).toBeNull();
  });
});

describe("the silver notes' reachability (ah-hvt8, ah-x36v)", () => {
  it.each(SILVER_NOTES.map((note) => [note.id, note] as const))(
    "%s appears for its own example",
    (id, note) => {
      const facts = note.example();
      expect(SILVER_NOTES.filter((candidate) => candidate.when(facts)).map((c) => c.id)).toContain(
        id
      );
    }
  );

  it.each(SILVER_NOTES.map((note) => [note.id, note] as const))(
    "%s carries an example that satisfies its own condition",
    (_id, note) => {
      expect(note.when(note.example())).toBe(true);
    }
  );

  /**
   * What each note says for its own example. Read off `HEAD~1` when the chain became a table
   * (`ah-hvt8`); `upkeep-paid-by` is the four upkeep-source notes collapsed into one (`ah-x36v`).
   */
  const SAID_BEFORE: Record<string, string> = {
    "shared-silver-covers-shortfall": "Shared silver in this hex covers the shortfall.",
    "doubt-unknown-tax-base": "The report never said what this region's tax base is.",
    "doubt-unpriced-production": "The ruleset does not say what producing mithril costs.",
    "doubt-unpriced-skill": "The ruleset does not say what studying this skill costs.",
    "doubt-unknown-goods":
      "The report does not say what widgets are, so what this sale earns cannot be said.",
    "doubt-estimated-men": "This unit's headcount is an estimate, so its month cannot be priced.",
    "doubt-contested-region-pool":
      "Another of your units here draws on the same pool and its headcount is an estimate, so this unit's share cannot be worked out.",
    "doubt-market-does-not-sell":
      "This region is not selling horses, so what the purchase costs cannot be said.",
    "doubt-gives-a-whole-class":
      "This unit is giving away a whole class of goods, which cannot be counted.",
    "doubt-contested-faction-food":
      "There is not enough faction food here to feed every unit set to eat it.",
    "wages-too-late":
      "Wages arrive too late to pay for this month's orders, so this unit is 40 short when it buys.",
    "cannot-pay": "This unit cannot pay the 50 its study costs.",
    "shared-silver-pays-orders":
      "A faction-mate's silver in this hex pays for this unit's orders.",
    "production-capped":
      "This unit has silver for 1 catapult, not the 3 its men could make.",
    "food-contended":
      "There is not enough food here to feed every unit that needs it, so this unit may yet be fed.",
    "unclaimed-contended": "There is not enough unclaimed silver to feed every unit that needs it.",
    "upkeep-paid-by":
      "This unit's upkeep was paid by its own food (8), faction food here (12), a faction-mate's silver (20) and the faction's unclaimed silver (10).",
    "forced-own-food": "This unit has no silver for its upkeep, so 2 grain will be eaten.",
    "forced-faction-food":
      "This unit has no silver for its upkeep, so 3 faction food items in this hex will be eaten.",
    "works-by-default": "This unit has no month-long order, so it will work and earn wages.",
    "taxes-by-flag": "This unit is set to tax every turn, so it taxes without an order.",
    "includes-take": "Includes 100 taken from Workers (6567) in this hex.",
    "includes-take-unshown":
      "Includes 100 taken from unit 999, which your report does not show here.",
    "includes-gift": "Includes 25 given by Quartermaster (18500) in this hex.",
    "doubt-takes-all-from-another":
      "Taking all of another unit's silver cannot be counted until that unit's own month is settled.",
    "given-to-nobody": "Includes 10 given away to nobody.",
    withdrawing: "This unit's withdrawal is paid from the faction's unclaimed silver.",
    "nothing-moves-silver": "Nothing this unit is ordered to do moves silver."
  };

  it("has an expected sentence recorded for every note, and no more", () => {
    expect(Object.keys(SAID_BEFORE).sort()).toEqual(SILVER_NOTES.map((n) => n.id).sort());
  });

  it.each(SILVER_NOTES.map((note) => [note.id, note] as const))(
    "%s says what it said before",
    (id, note) => {
      expect(note.say(note.example())).toBe(SAID_BEFORE[id]);
    }
  );
});

describe("the hover says every sentence that holds (ah-x36v)", () => {
  const forecast = (overrides: Partial<UnitSilver> = {}): UnitSilver =>
    aUnitSilver({ regionId: "1:6,52", held: 60, expense: 200, atMonthEnd: 60, ...overrides });

  it("a unit whose neighbour pays both ways is told both", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 50, sharedSilverCovered: 20, sharedSilverForOrders: 50 }),
      false,
      true
    );

    expect(summary.silver?.note).toBe(
      [
        "This unit's upkeep was paid by a faction-mate's silver (20).",
        "A faction-mate's silver in this hex pays for this unit's orders."
      ].join("\n")
    );
  });

  it("a unit that takes, receives and destroys is told all three", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        income: 125,
        taken: 100,
        takenFrom: ["Workers (6567)"],
        received: 25,
        givers: ["Quartermaster (18500)"],
        givenToNobody: 10
      })
    );

    expect(summary.silver?.note).toBe(
      [
        "Includes 100 taken from Workers (6567) in this hex.",
        "Includes 25 given by Quartermaster (18500) in this hex.",
        "Includes 10 given away to nobody."
      ].join("\n")
    );
  });

  it("a unit that takes and has no month-long order is told both", () => {
    // The failure this bead was reopened for: under the old first-match hover the take sentence
    // was swallowed by the no-month-long-order one, and adding WORK to the unit's orders made it
    // reappear (`ah-awcm`).
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({
        worksByDefault: true,
        income: 112,
        lateIncome: 12,
        taken: 100,
        takenFrom: ["Workers (6567)"]
      })
    );

    expect(summary.silver?.note).toBe(
      [
        "This unit has no month-long order, so it will work and earn wages.",
        "Includes 100 taken from Workers (6567) in this hex."
      ].join("\n")
    );
  });

  it("a take from a source the report does not show says so", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ income: 100, takenUnshown: 100, takenUnshownFrom: ["unit 999"] })
    );

    expect(summary.silver?.note).toBe(
      "Includes 100 taken from unit 999, which your report does not show here."
    );
  });

  it("a unit with one applicable note is unchanged", () => {
    const summary = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ income: 40000, atMonthEnd: 39860, taxesByFlag: true })
    );

    expect(summary.silver?.note).toBe(
      "This unit is set to tax every turn, so it taxes without an order."
    );
  });
});

describe("who paid this unit's upkeep, in one sentence (ah-x36v)", () => {
  const forecast = (overrides: Partial<UnitSilver> = {}): UnitSilver =>
    aUnitSilver({ regionId: "1:6,52", held: 60, expense: 200, atMonthEnd: 60, ...overrides });

  const note = (overrides: Partial<UnitSilver>, countUpkeep = true) =>
    summariseUnit(aReportUnit({ unitId: "1" }), forecast(overrides), false, countUpkeep).silver
      ?.note;

  it("one source reads as one", () => {
    expect(note({ upkeep: 0, ownFoodCovered: 8 })).toBe(
      "This unit's upkeep was paid by its own food (8)."
    );
  });

  it("two sources read as a pair", () => {
    expect(note({ upkeep: 0, factionFoodCovered: 12, sharedSilverCovered: 20 })).toBe(
      "This unit's upkeep was paid by faction food here (12) and a faction-mate's silver (20)."
    );
  });

  it("all four read in the game's payment order", () => {
    expect(
      note({
        upkeep: 0,
        ownFoodCovered: 8,
        factionFoodCovered: 12,
        sharedSilverCovered: 20,
        unclaimedCovered: 10
      })
    ).toBe(
      "This unit's upkeep was paid by its own food (8), faction food here (12), a faction-mate's silver (20) and the faction's unclaimed silver (10)."
    );
  });

  it("a unit fed at step five is not also said to have paid with its own food", () => {
    // `ah-eacd`: a unit fed at step 5 has a non-zero `ownFoodCovered` too, so the guard that kept
    // the two sentences apart must survive into the collapsed one.
    const said = note({
      upkeep: 0,
      ownFoodCovered: 10,
      forcedOwnFood: 2,
      forcedOwnFoodTag: "GRAI",
      factionFoodCovered: 12
    });

    expect(said).toContain("This unit's upkeep was paid by faction food here (12).");
    expect(said).not.toContain("its own food");
  });

  it("with upkeep counting off nothing is said", () => {
    expect(note({ upkeep: 0, ownFoodCovered: 8, unclaimedCovered: 10 }, false) ?? "").not.toContain(
      "upkeep was paid by"
    );
  });
});

describe("no note can be shadowed by another (ah-x36v)", () => {
  // The old guard set one field per note, so no combination was ever tried and a note unreachable
  // only alongside another was invisible to it - which is exactly how `ah-moq3` and `ah-awcm` both
  // shipped a sentence nobody could see. With every fact true at once, every note whose condition
  // is satisfied must appear, which tests every note against every other in a single case.
  const DOUBTS: NonNullable<UnitSilver["doubt"]>[] = [
    "unknown-tax-base",
    "unpriced-production",
    "unpriced-skill",
    "unknown-goods",
    "estimated-men",
    "takes-all-from-another",
    "contested-region-pool",
    "market-does-not-sell",
    "gives-a-whole-class",
    "contested-faction-food"
  ];

  // Built with `aUnitSilver` (`ah-uhnd`) so a field added to `UnitSilver` later does not silently
  // fall out of the case.
  const everything = (doubt: UnitSilver["doubt"]): UnitSilver =>
    aUnitSilver({
      regionId: "1:6,52",
      doubt,
      doubtSubject: "mithril",
      held: 60,
      income: 400,
      lateIncome: 200,
      expense: 300,
      atMonthEnd: 60,
      upkeep: 50,
      shortForOrders: 40,
      shortOn: "buy",
      received: 25,
      givers: ["Quartermaster (18500)"],
      taken: 100,
      takenFrom: ["Workers (6567)"],
      takenUnshown: 100,
      takenUnshownFrom: ["unit 999"],
      givenToNobody: 10,
      ownFoodCovered: 8,
      forcedOwnFood: 2,
      forcedOwnFoodTag: "GRAI",
      factionFoodCovered: 12,
      forcedFactionFood: 3,
      sharedSilverCovered: 20,
      sharedSilverForOrders: 50,
      unclaimedCovered: 10,
      unclaimedContended: true,
      foodContended: true,
      withdrawing: true,
      produced: 1,
      producedName: "catapult",
      productionWanted: 3,
      productionCappedBy: "silver",
      worksByDefault: true,
      taxesByFlag: true
    });

  const unit = aReportUnit({ men: 6, items: [{ tag: "GRAI", name: "grain", amount: 4 }] });

  it.each(DOUBTS)("every note appears when every fact is true (%s)", (doubt) => {
    const silver = everything(doubt);
    const facts = { unit, silver, warned: false, countUpkeep: true };
    const expected = SILVER_NOTES.filter((note) => note.when(facts)).map((note) => note.say(facts));

    // A case that exercises only a handful of notes would prove nothing about the rest.
    expect(expected.length).toBeGreaterThan(10);
    expect(summariseUnit(unit, silver, false, true).silver?.note).toBe(expected.join("\n"));
  });

  it("leaves no note unreachable but the two that read a silence", () => {
    const appeared = new Set(
      DOUBTS.flatMap((doubt) => {
        const facts = { unit, silver: everything(doubt), warned: false, countUpkeep: true };
        return SILVER_NOTES.filter((note) => note.when(facts)).map((note) => note.id);
      })
    );

    // Two notes say that something did NOT happen, so an everything-is-true case cannot reach
    // either: `shared-silver-covers-shortfall` is inferred from a negative month end nothing warns
    // about and no faction-mate covered, and `nothing-moves-silver` from an income and an expense
    // of zero. Each is covered by its own example above. Every other note must appear here.
    expect(
      SILVER_NOTES.map((note) => note.id).filter((id) => !appeared.has(id))
    ).toEqual(["shared-silver-covers-shortfall", "nothing-moves-silver"]);
  });
});
