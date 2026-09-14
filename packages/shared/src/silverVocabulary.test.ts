import type { ReportUnit, SilverChangeCause, UnitSilver } from "@atlantis/core-client";
import { aReportUnit, aUnitSilver } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import {
  SILVER_NOTES,
  buyAllSentences,
  productionStatusSentence,
  productionMenSentence,
  silverCauseGroups,
  silverCauseLabel,
  silverNoteLines,
  type SilverCauseGroup,
  type SilverFacts
} from "./silverVocabulary";

const unit = (overrides: Partial<ReportUnit> = {}): ReportUnit =>
  aReportUnit({ unitId: "18642", name: "Seven of Eight", ...overrides });

describe("productionMenSentence", () => {
  it("says how many the men that are left can make", () => {
    expect(
      productionMenSentence(
        aUnitSilver({
          produced: 3,
          producedName: "sword",
          productionWanted: 3,
          productionMenLeft: 5
        })
      )
    ).toBe(
      "This unit has men for 3 swords: GIVE and TAKE resolve before production, so the men that leave it this month do not work for it."
    );
  });

  it("says nothing when no men left this unit", () => {
    expect(
      productionMenSentence(
        aUnitSilver({
          produced: 8,
          producedName: "sword",
          productionWanted: 8,
          productionMenLeft: 0
        })
      )
    ).toBeUndefined();
  });

  it("says nothing when the run makes nothing at all", () => {
    expect(
      productionMenSentence(
        aUnitSilver({
          produced: 0,
          producedName: "sword",
          productionWanted: 0,
          productionMenLeft: 8
        })
      )
    ).toBeUndefined();
  });

  it("says nothing for a unit with no priceable production", () => {
    expect(
      productionMenSentence(
        aUnitSilver({
          produced: 3,
          producedName: null,
          productionMenLeft: 5
        })
      )
    ).toBeUndefined();
  });
});

describe("productionStatusSentence, unnumbered (ah-19l2.2, ah-256d)", () => {
  it("words a capped production the same way wherever it is asked", () => {
    expect(
      productionStatusSentence(
        aUnitSilver({
          produced: 1,
          producedName: "catapult",
          productionWanted: 3,
          productionCappedBy: "silver"
        })
      )
    ).toBe("This unit has silver for 1 catapult, not the 3 its skill and tools could make.");
  });

  it("says nothing when nothing capped the run", () => {
    expect(
      productionStatusSentence(
        aUnitSilver({
          produced: 3,
          producedName: "catapult",
          productionWanted: 3,
          productionCappedBy: null
        })
      )
    ).toBeUndefined();
  });

  it("says nothing for a unit with no priceable PRODUCE to speak about", () => {
    expect(productionStatusSentence(aUnitSilver())).toBeUndefined();
    expect(productionStatusSentence(null)).toBeUndefined();
    expect(productionStatusSentence(undefined)).toBeUndefined();
  });

  it("names the region when the hex's yield is what limited the run", () => {
    expect(
      productionStatusSentence(
        aUnitSilver({
          produced: 20,
          producedName: "iron",
          productionWanted: 40,
          productionCappedBy: "region",
          productionRegionName: "iron"
        })
      )
    ).toBe("This region has iron for 20, not the 40 its skill and tools could make.");
  });

  it("takes the noun from the region's own Products line, not the catalogue's singular", () => {
    // The `Products` line writes `floater hides` where the catalogue writes `floater hide`, and
    // this slot wants a bare noun rather than a counted one (`ah-256d`). Seven of the nineteen
    // land recipes differ this way - HORS, HERB, FLOA, TURT, MUSH, WING and CAME.
    expect(
      productionStatusSentence(
        aUnitSilver({
          produced: 4,
          producedName: "floater hide",
          productionWanted: 10,
          productionCappedBy: "region",
          productionRegionName: "floater hides"
        })
      )
    ).toBe("This region has floater hides for 4, not the 10 its skill and tools could make.");
  });
});

describe("productionStatusSentence, numbered (ah-6x5u)", () => {
  // `rules/produce`: "If a number is given then the unit will attempt to produce exactly that
  // number of items; if this is not possible in one month then the order will carry over to
  // subsequent months." The wording below is the navigator's, from
  // `docs/ui/ah-6x5u-numbered-produce.html`.
  const numbered = (overrides: Partial<UnitSilver> = {}) =>
    aUnitSilver({
      produced: 3,
      producedName: "sword",
      productionWanted: 8,
      productionRequested: 3,
      productionCappedBy: null,
      ...overrides
    });

  it("shows the request and the month's output even when they fit exactly", () => {
    expect(productionStatusSentence(numbered())).toBe(
      "Requested: 3 swords. This month: 3."
    );
  });

  it("says none rather than 0 for a month that makes nothing", () => {
    expect(
      productionStatusSentence(
        numbered({ produced: 0, productionCappedBy: "materials" })
      )
    ).toBe(
      "Requested: 3 swords. This month: none.\nLimited by materials. The remaining 3 carry over."
    );
  });

  it("names the materials and carries a single remaining item over in the singular", () => {
    expect(
      productionStatusSentence(
        numbered({ produced: 2, productionCappedBy: "materials" })
      )
    ).toBe(
      "Requested: 3 swords. This month: 2.\nLimited by materials. The remaining 1 carries over."
    );
  });

  it("names silver when the unit cannot pay for the whole run", () => {
    expect(
      productionStatusSentence(
        numbered({
          produced: 1,
          producedName: "catapult",
          productionWanted: 12,
          productionCappedBy: "silver"
        })
      )
    ).toBe(
      "Requested: 3 catapults. This month: 1.\nLimited by silver. The remaining 2 carry over."
    );
  });

  it("names skill and tools when the month itself cannot finish the request", () => {
    expect(
      productionStatusSentence(
        numbered({
          produced: 8,
          productionRequested: 10,
          productionCappedBy: "workforce"
        })
      )
    ).toBe(
      "Requested: 10 swords. This month: 8.\nLimited by skill and tools. The remaining 2 carry over."
    );
  });

  it("names the region with its own noun when the hex is what ran out", () => {
    expect(
      productionStatusSentence(
        numbered({
          produced: 6,
          producedName: "iron",
          productionWanted: 40,
          productionRequested: 10,
          productionCappedBy: "region",
          productionRegionName: "iron"
        })
      )
    ).toBe(
      "Requested: 10 irons. This month: 6.\nLimited by this region's iron. The remaining 4 carry over."
    );
  });

  it("falls back to the item's own name for a payload written before the region name existed", () => {
    expect(
      productionStatusSentence(
        numbered({
          produced: 6,
          producedName: "iron",
          productionRequested: 10,
          productionCappedBy: "region",
          productionRegionName: null
        })
      )
    ).toBe(
      "Requested: 10 irons. This month: 6.\nLimited by this region's iron. The remaining 4 carry over."
    );
  });

  // A unit that can make none of it anywhere - below the recipe's level, or in a hex that yields
  // none - has no cap to name: the core answers an empty plan, and the Problems panel's
  // `produce-without-skill` and `produce-not-here` are what say why (the core's own decision,
  // 2026-08-29). The request still carries over, because `rules/produce` applies to every
  // numbered shortfall.
  it("carries over the request without inventing a reason when the core named no cap", () => {
    expect(
      productionStatusSentence(
        numbered({ produced: 0, productionWanted: 0, productionCappedBy: null })
      )
    ).toBe(
      "Requested: 3 swords. This month: none.\nThe remaining 3 carry over."
    );
  });

  it("says nothing for a unit with no priceable PRODUCE, numbered or not", () => {
    expect(
      productionStatusSentence(numbered({ producedName: null }))
    ).toBeUndefined();
  });
});

describe("buyAllSentences (ah-jown)", () => {
  const buyAll = (overrides: Partial<UnitSilver["buyAll"][number]> = {}) =>
    aUnitSilver({
      buyAll: [
        {
          boughtNamed: "19 grain",
          marketNamed: "30 grain",
          bought: 19,
          affordable: 19,
          available: 30,
          marketHas: 30,
          alreadyBought: 0,
          silverAvailable: 356,
          price: 18,
          cappedBy: "silver",
          ...overrides
        }
      ]
    });

  it("names the cap that settled each BUY ALL", () => {
    expect(buyAllSentences(buyAll({ cappedBy: "silver" }))).toEqual([
      "This unit has silver for 19 grain, not the 30 this market offers."
    ]);
    expect(
      buyAllSentences(
        buyAll({ cappedBy: "market", boughtNamed: "5 grain", bought: 5, affordable: 19 })
      )
    ).toEqual(["This market has 5 grain, not the 19 this unit's silver would buy."]);
    expect(
      buyAllSentences(
        buyAll({
          cappedBy: "shared",
          bought: 5,
          available: 5,
          marketHas: 10,
          marketNamed: "10 grain"
        })
      )
    ).toEqual([
      "This unit gets 5 of the 10 grain this market has, because your units in this region are competing for it."
    ]);
    expect(
      buyAllSentences(
        buyAll({
          cappedBy: "silver",
          bought: 0,
          boughtNamed: "no grain",
          affordable: 0,
          available: 30,
          marketHas: 30,
          silverAvailable: 10,
          price: 18
        })
      )
    ).toEqual(["This unit buys no grain: it can have 10 silver and one costs 18."]);
    expect(
      buyAllSentences(
        buyAll({
          cappedBy: "shared",
          bought: 0,
          boughtNamed: "no grain",
          affordable: 19,
          available: 0,
          marketHas: 10
        })
      )
    ).toEqual([
      "This unit buys no grain: your other units in this region have claimed all 10 this market has."
    ]);
  });

  it("says a buy is a floor when the hex's purse could not be settled (ah-3c2t.3)", () => {
    expect(
      buyAllSentences(
        aUnitSilver({
          marketPurseHeldOnly: true,
          buyAll: [
            {
              boughtNamed: "12 horses",
              marketNamed: "100 horses",
              bought: 12,
              affordable: 12,
              available: 100,
              marketHas: 100,
              alreadyBought: 0,
              silverAvailable: 600,
              price: 50,
              cappedBy: "silver"
            }
          ]
        })
      )
    ).toEqual([
      "This unit buys at least 12 horses: what your other units here will earn cannot be worked out, so only the silver they hold is counted."
    ]);
  });

  it("claims a floor only where silver was the cap (ah-3c2t.3)", () => {
    const fallenBack = (overrides: Partial<UnitSilver["buyAll"][number]> = {}) => ({
      ...buyAll(overrides),
      marketPurseHeldOnly: true
    });

    expect(
      buyAllSentences(
        fallenBack({ cappedBy: "market", boughtNamed: "5 grain", bought: 5, affordable: 19 })
      )
    ).toEqual(["This market has 5 grain, not the 19 this unit's silver would buy."]);

    expect(
      buyAllSentences(
        fallenBack({
          cappedBy: "shared",
          bought: 5,
          available: 5,
          marketHas: 10,
          marketNamed: "10 grain"
        })
      )
    ).toEqual([
      "This unit gets 5 of the 10 grain this market has, because your units in this region are competing for it."
    ]);

    expect(
      buyAllSentences(
        fallenBack({
          cappedBy: "already-bought",
          bought: 5,
          boughtNamed: "5 grain",
          alreadyBought: 25,
          available: 30,
          marketHas: 30
        })
      )
    ).toEqual([
      "This unit buys 5 grain: its earlier orders have taken the other 25 of the 30 this market has."
    ]);

    expect(
      buyAllSentences(
        fallenBack({
          cappedBy: "silver",
          bought: 0,
          boughtNamed: "no grain",
          affordable: 0,
          silverAvailable: 10,
          price: 18
        })
      )
    ).toEqual(["This unit buys no grain: it can have 10 silver and one costs 18."]);

    expect(buyAllSentences(buyAll({ cappedBy: "silver" }))).toEqual([
      "This unit has silver for 19 grain, not the 30 this market offers."
    ]);
  });

  it("says nothing for a unit that wrote no BUY ALL", () => {
    expect(buyAllSentences(aUnitSilver())).toEqual([]);
    expect(buyAllSentences(null)).toEqual([]);
    expect(buyAllSentences(undefined)).toEqual([]);
  });

  // `ah-lauy`: a unit's own earlier `BUY` line already took some or all of what this one asks for.
  it("names an earlier order of its own, ahead of every other cap", () => {
    expect(
      buyAllSentences(
        buyAll({
          cappedBy: "already-bought",
          bought: 0,
          boughtNamed: "no grain",
          available: 5,
          marketHas: 5,
          alreadyBought: 5
        })
      )
    ).toEqual([
      "This unit buys no grain: an earlier order of its own has already bought all 5 this market has."
    ]);

    expect(
      buyAllSentences(
        buyAll({
          cappedBy: "already-bought",
          bought: 0,
          boughtNamed: "no grain",
          available: 1,
          marketHas: 1,
          alreadyBought: 1
        })
      )
    ).toEqual([
      "This unit buys no grain: an earlier order of its own has already bought the only one this market has."
    ]);

    expect(
      buyAllSentences(
        buyAll({
          cappedBy: "already-bought",
          bought: 0,
          boughtNamed: "no grain",
          available: 3,
          marketHas: 5,
          alreadyBought: 3
        })
      )
    ).toEqual([
      "This unit buys no grain: an earlier order of its own has already bought all 3 it can have here."
    ]);

    expect(
      buyAllSentences(
        buyAll({
          cappedBy: "already-bought",
          bought: 2,
          boughtNamed: "2 grain",
          available: 5,
          marketHas: 5,
          alreadyBought: 3
        })
      )
    ).toEqual([
      "This unit buys 2 grain: its earlier orders have taken the other 3 of the 5 this market has."
    ]);

    expect(
      buyAllSentences(
        buyAll({
          cappedBy: "already-bought",
          bought: 1,
          boughtNamed: "1 grain",
          available: 4,
          marketHas: 5,
          alreadyBought: 3
        })
      )
    ).toEqual([
      "This unit buys 1 grain: its earlier orders have taken the other 3 of the 4 it can have here."
    ]);
  });
});

// `castCapSentence` is exported (`ah-ofpb.5`, so the ITEMS hover can repeat it), but the note
// itself is still the more complete way to exercise the sentence a unit's SILVER hover shows.
describe("the cast-capped note (ah-ofpb.4)", () => {
  const castCapped = SILVER_NOTES.find((note) => note.id === "cast-capped");
  if (!castCapped) {
    throw new Error("the cast-capped note should be registered in SILVER_NOTES");
  }

  const facts = (silver: Partial<UnitSilver>): SilverFacts => ({
    unit: unit(),
    silver: aUnitSilver(silver),
    warned: false,
    countUpkeep: true
  });

  it("names what a capped cast will make", () => {
    const capped = facts({
      castMade: 2,
      castMadeNamed: "2 amulets of protection",
      castWanted: 3,
      castCappedBy: "silver"
    });
    expect(castCapped.when(capped)).toBe(true);
    expect(castCapped.say(capped)).toBe(
      "This unit has silver for 2 amulets of protection, not the 3 its level could make."
    );
  });

  it("a cast nothing capped says nothing", () => {
    const uncapped = facts({
      castMade: 3,
      castMadeNamed: "3 amulets of protection",
      castWanted: 3,
      castCappedBy: null
    });
    expect(castCapped.when(uncapped)).toBe(false);
  });

  // Round 4's Q13, C1, quoted verbatim: a summon clamped by what the mage may control says "room"
  // and "summon" rather than "materials"/"silver" and "make" (`ah-ofpb.5`).
  it("names the room a summon was clamped by", () => {
    const clamped = facts({
      castMade: 6,
      castMadeNamed: "6 wolves",
      castWanted: 12,
      castCappedBy: "room",
      castSummons: true
    });
    expect(castCapped.when(clamped)).toBe(true);
    expect(castCapped.say(clamped)).toBe(
      "This unit has room for 6 wolves, not the 12 its level could summon."
    );
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
    "doubt-unknown-skills-after-arrivals":
      "This unit's skills after this month's arrivals cannot be worked out, so what it produces cannot be said.",
    "doubt-unpriced-skill": "The ruleset does not say what studying this skill costs.",
    "shipping-distance-unknown":
      "The distance a shipment must travel is not known, so what it costs cannot be said.",
    "shipping-target-unshown": "A shipment's target is not in your report, so what it costs cannot be said.",
    "doubt-unknown-goods":
      "The report does not say what widgets are, so what this sale earns cannot be said.",
    "doubt-estimated-men": "This unit's headcount is an estimate, so its month cannot be priced.",
    "doubt-silver-never-read":
      "This unit's line in the turn report could not be read, so how much silver it holds is not known. It is not zero \u2014 it was never read.",
    "doubt-unit-line-cut-short":
      "Part of this unit's line in the turn report could not be read, so this unit's month cannot be added up.",
    "doubt-contested-region-pool":
      "Another of your units here draws on the same pool and its headcount is an estimate, so this unit's share cannot be worked out.",
    "pool-bounded-by-an-unread-unit":
      "Another of your units here draws on the same pool and its line could not be read from the turn report, so this unit may be paid less than this.",
    "doubt-market-does-not-sell":
      "This region is not selling horses, so what the purchase costs cannot be said.",
    "doubt-gives-a-whole-class":
      "This unit is giving away all its MAGIC items, and this application cannot tell which items those are.",
    "give-consequences-uncertain":
      "Because this GIVE cannot be predicted, what this unit earns or spends afterwards cannot be said.",
    "doubt-unknown-combat-ready":
      "The combat ready men in this region cannot be added up, so what a pillage earns cannot be said.",
    "doubt-contested-faction-food":
      "There is not enough faction food here to feed every unit set to eat it.",
    "wages-too-late":
      "Wages arrive too late to pay for this month's orders, so this unit is 40 short when it buys.",
    "cannot-pay": "This unit cannot pay the 50 its study costs.",
    "shared-silver-pays-orders":
      "A faction-mate's silver in this hex pays for this unit's orders.",
    "buy-all-settled":
      "This unit has silver for 19 grain, not the 30 this market offers.",
    "production-men-left":
      "This unit has men for 3 swords: GIVE and TAKE resolve before production, so the men that leave it this month do not work for it.",
    "production-capped":
      "This unit has silver for 1 catapult, not the 3 its skill and tools could make.",
    "cast-capped":
      "This unit has silver for 2 amulets of protection, not the 3 its level could make.",
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
    "doubt-takes-a-whole-class":
      "Taking a whole class of another unit's items cannot be followed, so this unit's month has no total.",
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

describe("what a drawn cause line already says", () => {
  const drawnAs = (cause: string, entryCause = cause, line: number | null = null): SilverCauseGroup[] => [
    { cause, amount: 1, entries: [{ amount: 1, cause: entryCause as SilverChangeCause, line, other: null }] }
  ];

  it("drops a note the drawn lines restate, and keeps it where nothing is drawn", () => {
    const note = SILVER_NOTES.find((n) => n.id === "includes-gift");
    if (!note) {
      throw new Error("includes-gift is missing");
    }
    const facts = note.example();
    const drawn: SilverCauseGroup[] = [
      {
        cause: "was-given",
        amount: 25,
        entries: [{ amount: 25, cause: "was-given", line: null, other: "Quartermaster (18500)" }]
      }
    ];
    const sentence = "Includes 25 given by Quartermaster (18500) in this hex.";
    expect(silverNoteLines(facts, drawn)).not.toContain(sentence);
    expect(silverNoteLines(facts)).toContain(sentence);
  });

  const RESTATED: [string, SilverCauseGroup[]][] = [
    ["includes-gift", drawnAs("was-given")],
    ["includes-take", drawnAs("took")],
    ["includes-take-unshown", drawnAs("took", "took-unshown")],
    ["given-to-nobody", [{ cause: "discarded", amount: -1, entries: [{ amount: -1, cause: "discarded", line: null, other: null }] }]],
    ["taxes-by-flag", drawnAs("taxed")],
    ["works-by-default", drawnAs("worked")],
    ["shared-silver-pays-orders", drawnAs("was-lent")]
  ];

  it.each(RESTATED)("%s is restated by its own line, and by nothing drawn", (id, drawn) => {
    const note = SILVER_NOTES.find((n) => n.id === id);
    expect(note?.restatedBy?.(drawn)).toBe(true);
    expect(note?.restatedBy?.([])).toBe(false);
  });

  it("does not count a taxing line an order wrote as the flag's", () => {
    const note = SILVER_NOTES.find((n) => n.id === "taxes-by-flag");
    expect(note?.restatedBy?.(drawnAs("taxed", "taxed", 3))).toBe(false);
  });

  it("exactly seven notes declare a restatement", () => {
    expect(
      SILVER_NOTES.filter((n) => n.restatedBy)
        .map((n) => n.id)
        .sort()
    ).toEqual(RESTATED.map(([id]) => id).sort());
  });

  it("folds took-unshown into took and drops a cause whose movements cancel", () => {
    const groups = silverCauseGroups([
      { amount: 5, cause: "took", line: null, other: null },
      { amount: 7, cause: "took-unshown", line: null, other: null },
      { amount: 4, cause: "was-given", line: null, other: null },
      { amount: -4, cause: "was-given", line: null, other: null }
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.cause).toBe("took");
    expect(groups[0]?.amount).toBe(12);
    expect(groups[0]?.entries).toHaveLength(2);
  });

  it("labels a cause, and reads an untaught one as itself", () => {
    expect(silverCauseLabel("cast-spent")).toBe("paid to cast");
    expect(silverCauseLabel("brand-new-cause")).toBe("brand new cause");
  });
});
