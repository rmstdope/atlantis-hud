import { describe, expect, it } from "vitest";
import type { Battle, BattleUnit } from "@atlantis/core-client";
import { aBattle, aBattleUnit } from "@atlantis/core-client";
import { allegianceOf, assassinationView, roundLabel, rosterCounts, summarise } from "./battles";

const hexLabel = (regionId: string) => `hex ${regionId}`;

/**
 * The turn-71 fixture's first battle (`AA Tomb's Guards (7280) attacks Pirates (14789) in ocean
 * (25,55)`), trimmed to what these tests read - the full roster is 157 attackers and is exercised
 * against the real fixture by the smoke walk instead of typed out here.
 */
function battle(overrides: Partial<Battle> = {}): Battle {
  return aBattle({
    casualties: [
      { combatant: { name: "Pirates", id: "14789" }, lost: 15, text: "Pirates (14789) loses 15" },
      {
        combatant: { name: "AA Tomb's Guards", id: "7280" },
        lost: 0,
        text: "AA Tomb's Guards (7280) loses 0"
      }
    ],
    damagedUnits: ["14789"],
    spoils: "3 magic crossbows [MXBO], 2 battle axes [BAXE]",
    ...overrides
  });
}

function unit(overrides: Partial<BattleUnit> = {}): BattleUnit {
  return aBattleUnit({ name: "Some Unit", id: "1", faction: { name: "Some Faction", id: "1" }, body: "", ...overrides });
}

describe("the one-line summary of a battle", () => {
  it("states participants, hex, losses and whether there were spoils", () => {
    const summary = summarise(battle(), hexLabel);

    expect(summary.attacker).toBe("AA Tomb's Guards (7280)");
    expect(summary.defender).toBe("Pirates (14789)");
    expect(summary.hex).toBe("hex 1:25,55");
    expect(summary.attackerLosses).toBe(0);
    expect(summary.defenderLosses).toBe(15);
    expect(summary.hasSpoils).toBe(true);
  });

  it("says there were no spoils when the battle left none", () => {
    const summary = summarise(battle({ spoils: null }), hexLabel);

    expect(summary.hasSpoils).toBe(false);
  });

  it("has no hex to show when the headline named no coordinate", () => {
    const summary = summarise(battle({ coordinate: null }), hexLabel);

    expect(summary.hex).toBeNull();
  });

  it("falls back to the verbatim headline when it was not recognised", () => {
    const unrecognised = battle({
      headline: "something the parser could not read",
      attacker: null,
      defender: null,
      coordinate: null,
      casualties: [],
      spoils: null
    });

    const summary = summarise(unrecognised, hexLabel);

    expect(summary.headline).toBe("something the parser could not read");
    expect(summary.attacker).toBeNull();
    expect(summary.defender).toBeNull();
    expect(summary.hex).toBeNull();
    expect(summary.attackerLosses).toBeNull();
    expect(summary.defenderLosses).toBeNull();
    expect(summary.hasSpoils).toBe(false);
  });
});

describe("whose unit is whose", () => {
  it("is own when the faction id matches the viewer's", () => {
    const own = unit({ faction: { name: "Borg TNG", id: "95" } });
    expect(allegianceOf(own, "95")).toBe("own");
  });

  it("is another faction's when the id differs", () => {
    const other = unit({ faction: { name: "Greywolf", id: "33" } });
    expect(allegianceOf(other, "95")).toBe("other");
  });

  it("cannot be told when the roster line printed no faction at all", () => {
    const unattributed = unit({ faction: null });
    expect(allegianceOf(unattributed, "95")).toBe("unknown");
  });

  it("counts the roster and how many of it are the viewer's own", () => {
    const roster = [
      unit({ id: "1", faction: { name: "Borg TNG", id: "95" } }),
      unit({ id: "2", faction: { name: "Borg TNG", id: "95" } }),
      unit({ id: "3", faction: { name: "Greywolf", id: "33" } }),
      unit({ id: "4", faction: null })
    ];

    const counts = rosterCounts(roster, "95");

    expect(counts.total).toBe(4);
    expect(counts.own).toBe(2);
  });
});

describe("the round heading", () => {
  it("names a numbered round", () => {
    expect(roundLabel({ number: 3, lines: [], losses: [], statistics: [] })).toBe("Round 3");
  });

  it("names a free round, opened by a rout, without inventing a number", () => {
    expect(roundLabel({ number: null, lines: [], losses: [], statistics: [] })).toBe("Free round");
  });
});

describe("an assassination battle", () => {
  const assassination = battle({
    headline: "L Arslan (1446) is assassinated in forest (43,79) in Utso!",
    attacker: null,
    defender: { name: "L Arslan", id: "1446" },
    terrain: "forest",
    coordinate: { x: 43, y: 79, z: 1 },
    province: "Utso",
    assassination: true,
    casualties: []
  });

  it("shows an unknown attacker, the victim as defender, and the plain casualty text", () => {
    const view = assassinationView(assassination);

    expect(view).not.toBeNull();
    expect(view?.attackers).toEqual(["?"]);
    expect(view?.defenders).toEqual(["L Arslan (1446)"]);
    expect(view?.casualtyText).toBe("L Arslan (1446) is assassinated");
  });

  it("is null for a battle that was not an assassination", () => {
    expect(assassinationView(battle())).toBeNull();
  });

  it("summarises with a hex, since the coordinate was parsed from the headline", () => {
    const summary = summarise(assassination, hexLabel);

    expect(summary.hex).toBe("hex 1:43,79");
  });
});
