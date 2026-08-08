import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseItemReference, RulesetScrapeError } from "./data";
import { preformattedText } from "./html";

const DATA_HTML = readFileSync(
  fileURLToPath(new URL("../../../tests/fixtures/ruleset/neworigins-data.html", import.meta.url)),
  "utf8"
);

/**
 * The item reference is what finally lets a unit line be split into men and equipment, and what
 * gives the risk heuristic something to weigh. Every expected value below is quoted from the
 * fixture's own entry for that item.
 */
describe("parseItemReference", () => {
  it("classifies a race as men, with its weight, capacity and speed", () => {
    const items = parseItemReference(DATA_HTML);

    // "leader [LEAD], weight 10, walking capacity 5, moves 2 hexes per month. This race may
    //  study all skills to level 5."
    expect(items.LEAD).toMatchObject({
      name: "leader",
      kind: "man",
      weight: 10,
      capacity: { walk: 5, ride: 0, fly: 0, swim: 0 },
      moves: 2
    });
  });

  it("reads a swimming race's swim capacity", () => {
    const items = parseItemReference(DATA_HTML);

    // "lizardman [LIZA], weight 10, walking capacity 5, swimming capacity 5, moves 2 hexes..."
    expect(items.LIZA).toMatchObject({ kind: "man", weight: 10, moves: 2 });
    expect(items.LIZA.capacity).toEqual({ walk: 5, ride: 0, fly: 0, swim: 5 });
  });

  it("classifies a mount and reads its riding capacity", () => {
    const items = parseItemReference(DATA_HTML);

    // "horse [HORS], weight 50, walking capacity 20, riding capacity 20, moves 4 hexes per month.
    //  This is a mount."
    expect(items.HORS).toMatchObject({ name: "horse", kind: "mount", weight: 50, moves: 4 });
    expect(items.HORS.capacity).toEqual({ walk: 20, ride: 20, fly: 0, swim: 0 });
  });

  it("reads a flying mount's flying capacity", () => {
    const items = parseItemReference(DATA_HTML);

    // "winged horse [WING], weight 50, walking capacity 20, riding capacity 20, flying capacity
    //  20, moves 4 hexes per month. This is a mount."
    expect(items.WING.capacity).toEqual({ walk: 20, ride: 20, fly: 20, swim: 0 });
  });

  it("classifies plain equipment, including weightless silver", () => {
    const items = parseItemReference(DATA_HTML);

    // "silver [SILV], weight 0. This is the currency of Atlantis."
    expect(items.SILV).toMatchObject({ name: "silver", kind: "equipment", weight: 0 });
    // "grain [GRAI], weight 5, costs 37 silver to withdraw."
    expect(items.GRAI).toMatchObject({ kind: "equipment", weight: 5 });
  });

  it("classifies a monster and reads the numbers the risk heuristic needs", () => {
    const items = parseItemReference(DATA_HTML);

    // "lion [LION] ... This monster attacks with a combat skill of 3 ... This monster has 2 melee
    //  attacks per round and takes 4 hits to kill and each attack deals 1 damage."
    expect(items.LION).toMatchObject({ name: "lion", kind: "monster", weight: 10 });
    expect(items.LION.combat).toEqual({
      skill: 3,
      attacksPerRound: 2,
      hitsToKill: 4,
      damagePerAttack: 1
    });
  });

  it("does not mistake a ship for a man or a monster", () => {
    const items = parseItemReference(DATA_HTML);

    // "Longship [LONG]. This is a ship with a capacity of 150 and a speed of 4 hexes per month."
    expect(items.LONG.kind).toBe("ship");
  });

  it("finds the whole catalogue, and classifies all of it", () => {
    const items = parseItemReference(DATA_HTML);
    const byKind: Record<string, number> = {};
    for (const entry of Object.values(items)) {
      byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    }

    // Measured from the fixture, which is committed and therefore frozen - so an exact count is a
    // stable change-detector here rather than something a live page could break.
    //
    // Counts alone are still weak evidence: an earlier version of this test asserted a breakdown
    // that encoded two misclassifications, and read as ground truth while doing so. The named
    // expectations below are the real assertions; the totals only catch drift.
    expect(Object.keys(items).length).toBe(171);
    expect(byKind).toEqual({ man: 14, mount: 4, equipment: 86, ship: 9, monster: 58 });
  });

  it("classifies every race the fixture names as men", () => {
    const items = parseItemReference(DATA_HTML);

    // Every entry whose prose says "This race may study" is a race, centaur included.
    const races = Object.values(items).filter((entry) => entry.kind === "man").map((e) => e.tag);
    expect(races.sort()).toEqual(
      [
        "CTAU", "DRLF", "GBLN", "GNOL", "GNOM", "HDWA", "HELF",
        "HUMN", "IDWA", "LEAD", "LIZA", "ORC", "UDWA", "WELF"
      ].sort()
    );
  });

  it("finds every ship, including the flying ones, and their holds", () => {
    const items = parseItemReference(DATA_HTML);
    const ships = Object.values(items).filter((entry) => entry.kind === "ship");

    expect(ships.map((ship) => ship.tag).sort()).toEqual(
      ["AIRS", "BALL", "CLOU", "COG", "CORS", "GALL", "GLLY", "LONG", "RAFT"].sort()
    );
    // A ship with no stated hold would mean the capacity sentence stopped being read.
    for (const ship of ships) {
      expect(ship.cargoCapacity, `${ship.tag} has no cargo capacity`).toBeGreaterThan(0);
    }
  });

  /**
   * A structure entry mentions an item tag in passing:
   *
   *   "Dormant Monolith: This is a building. This structure requires a sacrifice of 50 leaders
   *    [LEAD]. This structure cannot be built by players."
   *
   * An opening pattern allowed to wander across sentences read that as the definition of LEAD and
   * overwrote the real one, turning the leader race into a weightless building.
   */
  it("does not let a structure's prose redefine an item it merely mentions", () => {
    const items = parseItemReference(DATA_HTML);

    expect(items.LEAD.kind).toBe("man");
    expect(items.LEAD.name).toBe("leader");
    // toContainEqual, not toContain: toContain compares by Object.is and silently ignores an
    // asymmetric matcher, so the toContain form of this assertion passed even when the array did
    // contain the offending name - it proved nothing at all.
    expect(Object.values(items).map((entry) => entry.name)).not.toContainEqual(
      expect.stringContaining("Dormant Monolith")
    );
  });

  /**
   * A centaur is both: "centaur [CTAU], weight 50, walking capacity 20, riding capacity 20, moves 4
   * hexes per month. This race may study ... This is a mount."
   *
   * Classifying it as a mount defeats the point of the catalogue, which exists to tell men from
   * equipment. A unit of forty centaurs would contribute nobody to a strength estimate. Centaurs
   * appear in the committed turn 71 report, so this is not hypothetical.
   */
  it("counts a creature that is both a race and a mount as men", () => {
    const items = parseItemReference(DATA_HTML);

    expect(items.CTAU.kind).toBe("man");
    expect(items.CTAU.capacity).toEqual({ walk: 20, ride: 20, fly: 0, swim: 0 });
  });

  /**
   * "Balloon [BALL]. This is a flying 'ship' with a capacity of 100 and a speed of 4 hexes per
   * month." Demanding the literal "This is a ship" left the three flying ships as equipment.
   */
  it("recognises a flying ship as a ship", () => {
    const items = parseItemReference(DATA_HTML);

    expect(items.BALL.kind).toBe("ship");
    expect(items.BALL.cargoCapacity).toBe(100);
    expect(items.BALL.moves).toBe(4);

    // "Longship [LONG]. This is a ship with a capacity of 150 and a speed of 4 hexes per month."
    expect(items.LONG.cargoCapacity).toBe(150);
  });

  /**
   * "wagon [WAGO], weight 50, walking capacity 200 when hitched to a horse".
   *
   * Storing 200 unconditionally is a plausible-but-wrong number: the rules page is explicit that
   * "otherwise the excess wagons count as weight, not capacity". Recording the condition is what
   * stops a later consumer treating it as free capacity.
   */
  it("records that a capacity is conditional rather than dropping the condition", () => {
    const items = parseItemReference(DATA_HTML);

    expect(items.WAGO.capacity.walk).toBe(200);
    expect(items.WAGO.capacityCondition).toBe("when hitched to a horse");
    // An unconditional capacity carries no condition.
    expect(items.HORS.capacityCondition).toBeUndefined();
  });

  /**
   * A dragon's entry states damage twice: first for its breath spell ("This ability does between 2
   * and 60 energy attacks and each attack deals 1 damage"), later for melee. An unanchored pattern
   * takes the spell's number. Every value in this fixture happens to be 1, so the bug is invisible
   * today - and would silently substitute a spell's damage the day a melee attack differs.
   */
  it("reads the dragon's melee attacks and hits from the melee sentence", () => {
    const items = parseItemReference(DATA_HTML);

    expect(items.DRAG.combat).toMatchObject({ attacksPerRound: 50, hitsToKill: 60 });
  });

  /**
   * Every damage figure in the committed fixture is 1, so no assertion against the real page can
   * tell the spell sentence from the melee one - the fixture does not vary along the axis under
   * test. This input does: the spell deals 9, the melee deals 4.
   */
  it("does not take a spell's damage when the melee sentence says otherwise", () => {
    const items = parseItemReference(
      `<html><body><pre>
drake [DRKE], weight 10, walking capacity 5, moves 4 hexes per month.
  This is a monster. This monster attacks with a combat skill of 5
  This ability does between 2 and 60 energy attacks and each attack
  deals 9 damage. This monster has 3 melee attacks per round and takes
  7 hits to kill and each attack deals 4 damage.
</pre></body></html>`
    );

    expect(items.DRKE.combat).toEqual({
      skill: 5,
      attacksPerRound: 3,
      hitsToKill: 7,
      damagePerAttack: 4
    });
  });

  /**
   * Every illusory monster has a combat skill of -5, so a pattern demanding digits alone dropped
   * the combat block for all nine of them while leaving the entries themselves looking fine.
   */
  it("reads negative combat skills", () => {
    const items = parseItemReference(DATA_HTML);

    expect(items.IWOLF.kind).toBe("monster");
    expect(items.IWOLF.combat?.skill).toBe(-5);

    const monstersWithoutCombat = Object.values(items).filter(
      (entry) => entry.kind === "monster" && !entry.combat
    );
    expect(monstersWithoutCombat).toEqual([]);
  });

  /**
   * Thirteen entries state a capability without a number - `livestock [LIVE], weight 50, can walk`
   * and the nine illusory creatures, which read `can walk, can ride, can fly`. Recording only the
   * numeric form left those as capacity 0, which reads as "cannot walk" rather than "walks itself
   * and carries nothing".
   *
   * The contribution such an item makes is derivable, contrary to what an earlier version of this
   * comment claimed: the engine prints capacity net of the item's own weight, so the bare form is
   * printed exactly when net capacity is zero. Such an item therefore carries itself and nothing
   * more. `capacity.test.ts` gates on `selfMobile` for that reason.
   */
  it("records a capability stated without a number", () => {
    const items = parseItemReference(DATA_HTML);

    expect(items.LIVE.selfMobile).toEqual({ walk: true, ride: false, fly: false, swim: false });
    expect(items.LIVE.capacity.walk).toBe(0);

    expect(items.IWOLF.selfMobile).toEqual({ walk: true, ride: true, fly: true, swim: false });
  });

  it("treats a numeric capacity as implying the capability", () => {
    const items = parseItemReference(DATA_HTML);

    // "horse [HORS], weight 50, walking capacity 20, riding capacity 20"
    expect(items.HORS.selfMobile).toEqual({ walk: true, ride: true, fly: false, swim: false });
    // "silver [SILV], weight 0." - carries nothing and goes nowhere by itself.
    expect(items.SILV.selfMobile).toEqual({ walk: false, ride: false, fly: false, swim: false });
  });

  /**
   * Guards against silent truncation. The catalogue shares its `<pre>` block with the skill and
   * structure reports, so an unwrapping bug would drop entries without any error.
   */
  it("skips no paragraph that looks like an item entry", () => {
    const items = parseItemReference(DATA_HTML);
    const looksLikeAnEntry = /\[[A-Z0-9]{2,6}\], weight \d/;

    const paragraphs = preformattedText(DATA_HTML)
      .split(/\n[ \t]*\n/)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .filter((paragraph) => looksLikeAnEntry.test(paragraph));

    expect(paragraphs.length).toBeGreaterThan(0);
    for (const paragraph of paragraphs) {
      const tag = paragraph.match(/\[([A-Z0-9]{2,6})\]/)?.[1];
      expect(items[tag ?? ""], `entry dropped: ${paragraph.slice(0, 70)}`).toBeDefined();
    }
  });

  it("fails loudly when the page carries no item entries at all", () => {
    expect(() => parseItemReference("<html><body><p>nothing here</p></body></html>")).toThrowError(
      RulesetScrapeError
    );
  });
});
