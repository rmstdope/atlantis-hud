import type { ReportUnit, UnitSilver } from "@atlantis/core-client";
import { aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { HOVER_DELAY_MS, placeTooltip, summariseUnit } from "./unitTooltip";

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
  const forecast = (overrides: Partial<UnitSilver> = {}): UnitSilver => ({
    unitId: "1",
    regionId: "1:6,52",
    held: 60,
    income: 0,
    lateIncome: 0,
    expense: 200,
    atMonthEnd: -140,
    shortForOrders: 0,
    shortOn: null,
    upkeep: 50,
    doubt: null,
    doubtSubject: null,
    received: 0,
    givers: [],
    givenToNobody: 0,
    factionFoodCovered: 0,
    ownFoodCovered: 0,
    unclaimedCovered: 0,
    unclaimedContended: false,
    forcedOwnFood: 0,
    forcedOwnFoodTag: null,
    forcedFactionFood: 0,
    foodContended: false,
    sharedSilverCovered: 0,
    withdrawing: false,
    ...overrides
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
      "Faction food in this hex covers 60 of this unit's upkeep."
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
    expect(chosen.silver?.note).toBe("This unit's own food covers 60 of its upkeep.");
  });

  it("the_silver_section_says_when_a_units_own_food_fed_it", () => {
    const fed = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, ownFoodCovered: 60 }),
      true,
      true
    );
    expect(fed.silver?.note).toBe("This unit's own food covers 60 of its upkeep.");
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
    expect(both.silver?.note).toBe("This unit's own food covers 50 of its upkeep.");
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
      "Faction food in this hex covers 60 of this unit's upkeep."
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
      "The faction's unclaimed silver covers 60 of this unit's upkeep."
    );

    const notCounting = summariseUnit(
      aReportUnit({ unitId: "1" }),
      forecast({ upkeep: 0, unclaimedCovered: 60 }),
      true
    );
    expect(notCounting.silver?.note ?? "").not.toContain("unclaimed silver");
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
      "A faction-mate's silver in this hex pays this unit's upkeep."
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
      "A faction-mate's silver in this hex pays this unit's upkeep."
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
      "Wages arrive too late to pay for this month's orders, so this unit is 60 short when it buys."
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
    expect(note(true)).toBe("This unit's withdrawal is paid from the faction's unclaimed silver.");
    expect(note(false)).toBe("This unit's withdrawal is paid from the faction's unclaimed silver.");
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
    ).toBe("Includes 300 given by 2 in this hex.");
    expect(noteFor({ income: 0, expense: 300, atMonthEnd: 60, givenToNobody: 300 })).toBe(
      "Includes 300 given away to nobody."
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
