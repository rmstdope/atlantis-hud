import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  itemClassesOf,
  parseBuildingReference,
  parseItemReference,
  parseSkillReference,
  RulesetScrapeError,
  taggedAmounts,
  taggedLevels,
  ungiveableItemsOf
} from "./data";
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

  it("reads an all-skills race ceiling", () => {
    const items = parseItemReference(DATA_HTML);

    // data/LEAD: "This race may study all skills to level 5."
    expect(items.LEAD.skillLimits).toEqual({
      specializedSkills: [],
      specializedLevel: 5,
      defaultLevel: 5
    });
  });

  it("reads specialized and fallback race ceilings", () => {
    const items = parseItemReference(DATA_HTML);

    // data/HUMN and data/WELF preserve the page's specialized-skill order.
    expect(items.HUMN.skillLimits).toEqual({
      specializedSkills: ["BUIL", "RIDI", "COMB", "MINI", "FARM", "COOK"],
      specializedLevel: 4,
      defaultLevel: 2
    });
    expect(items.WELF.skillLimits).toEqual({
      specializedSkills: ["LUMB", "LBOW", "ENTE", "CARP", "FISH", "COOK"],
      specializedLevel: 5,
      defaultLevel: 2
    });
  });

  it("leaves unrecognized race-limit prose absent", () => {
    const html =
      "<html><body><pre>mystery folk [MYST], weight 10. This race may study whatever the " +
      "stars permit.</pre></body></html>";

    const entry = parseItemReference(html).MYST;

    expect(entry.kind).toBe("man");
    expect(entry).not.toHaveProperty("skillLimits");
  });

  it("does not add race limits to an ordinary item", () => {
    const items = parseItemReference(DATA_HTML);

    expect(items.SWOR).not.toHaveProperty("skillLimits");
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

  it("reads the withdrawal price", () => {
    const items = parseItemReference(DATA_HTML);

    // "grain [GRAI], weight 5, costs 37 silver to withdraw."
    expect(items.GRAI.withdrawCost).toBe(37);
  });

  it("an item the page prices nowhere carries no withdrawal price", () => {
    const items = parseItemReference(DATA_HTML);

    // "Longship [LONG]. This is a ship ..." - the page prices no ship for withdrawal.
    expect(items.LONG).not.toHaveProperty("withdrawCost");
  });

  it("reads the maintenance value of each food the page prices", () => {
    const items = parseItemReference(DATA_HTML);

    // "grain [GRAI] ... This item can be eaten to provide 30 silver towards a unit's maintenance
    //  cost." The same clause appears verbatim on livestock, fish and meals.
    for (const tag of ["GRAI", "LIVE", "FISH", "MEAL"]) {
      expect(items[tag]?.maintenanceValue, tag).toBe(30);
    }
  });

  it("leaves an item the page never calls food without a maintenance value", () => {
    const items = parseItemReference(DATA_HTML);

    // "iron [IRON] ..." carries no maintenance clause, so it is not food.
    expect(items.IRON).not.toHaveProperty("maintenanceValue");
  });

  it("parses the number the clause states rather than assuming 30", () => {
    // A synthetic item proves the value is read from the page, not replaced by the committed 30.
    const html =
      "<html><body><pre>manna [MANN], weight 1. This item can be eaten to provide 45 silver " +
      "towards a unit's maintenance cost.</pre></body></html>";
    const items = parseItemReference(html);
    expect(items.MANN?.maintenanceValue).toBe(45);
  });

  it("reads a weapon that needs no skill", () => {
    const items = parseItemReference(DATA_HTML);

    // "sword [SWOR] ... No skill is needed to wield this weapon."
    expect(items.SWOR.weapon).toEqual({ needs: null });
  });

  it("reads a weapon that needs a skill", () => {
    const items = parseItemReference(DATA_HTML);

    // "crossbow [XBOW] ... Knowledge of crossbow [XBOW] is needed to wield this weapon." The
    // captured tag is the *skill* XBOW, which happens to share its spelling with the item.
    expect(items.XBOW.weapon).toEqual({ needs: "XBOW" });
    // "double bow [DBOW] ... Knowledge of longbow [LBOW] is needed ..." - not its own tag.
    expect(items.DBOW.weapon).toEqual({ needs: "LBOW" });
  });

  it("leaves everything that is not a weapon alone", () => {
    const items = parseItemReference(DATA_HTML);

    expect(items.PARM).not.toHaveProperty("weapon");
    expect(items.HORS).not.toHaveProperty("weapon");
    expect(items.GRAI).not.toHaveProperty("weapon");
  });

  it("does not mistake a race for a weapon", () => {
    const items = parseItemReference(DATA_HTML);

    // These four list weaponsmith among the skills they may study; kind "man" is what excludes
    // them.
    for (const tag of ["IDWA", "HDWA", "UDWA", "GBLN"]) {
      expect(items[tag], tag).not.toHaveProperty("weapon");
    }
  });

  it("refuses a wield clause it cannot read", () => {
    const html =
      "<html><body><pre>broken sword [BROK], weight 1. This is a slashing weapon. No skill is " +
      "needed to wield this weapon. Knowledge of longbow [LBOW] is needed to wield this " +
      "weapon.</pre></body></html>";

    expect(() => parseItemReference(html)).toThrowError(RulesetScrapeError);
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

  // `ah-gdfe`: Rust's `ItemKind` carries a tolerant `Unknown` fallback the scraper must never
  // produce - it means "this build has never heard of this kind", and its hand-written
  // `Deserialize` in `crates/core/src/movement/rules.rs` maps every unrecognised string to it so
  // one strange item cannot fail a whole ruleset. The generated union includes it; the scraped
  // data must not.
  it("gives no scraped item an unknown kind", () => {
    const items = parseItemReference(DATA_HTML);

    expect(Object.values(items).filter((entry) => entry.kind === "unknown")).toEqual([]);
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
   * "Longship [LONG]. This is a ship with a capacity of 150 and a speed of 4 hexes per month.
   *  This ship requires a total of 4 levels of sailing skill to sail."
   *
   * "Raft [RAFT]. ... This ship requires a total of 2 levels of sailing skill to sail." - the
   * sentence wraps across physical lines in the fixture, the same shape `cargoOf` already handles.
   */
  it("reads the sailing skill a ship requires", () => {
    const items = parseItemReference(DATA_HTML);

    expect(items.LONG.sailingSkill).toBe(4);
    expect(items.RAFT.sailingSkill).toBe(2);
  });

  /** Every ship on the data page states this; a missing one means the read stopped working. */
  it("every ship states the sailing skill it needs", () => {
    const items = parseItemReference(DATA_HTML);
    const ships = Object.values(items).filter((entry) => entry.kind === "ship");

    for (const ship of ships) {
      expect(ship.sailingSkill, `${ship.tag} has no sailing skill requirement`).toBeGreaterThan(0);
    }
  });

  /**
   * Summon Wind and the windchime talk about "ships requiring up to 12/24 sailing skill points" -
   * close enough wording to trip a careless regex, and neither is itself a ship's own requirement.
   * Summon Wind is a skill (`summon wind [SWIN] 1: ...`), so it is never read as an item at all;
   * windchime is equipment, which the ship-only guard on `cargoOf`'s sibling must also exclude.
   */
  it("does not read a sailing requirement onto something that is not a ship", () => {
    const items = parseItemReference(DATA_HTML);

    expect(items.SWIN).toBeUndefined();
    expect(items.WCHM.kind).not.toBe("ship");
    expect(items.WCHM.sailingSkill).toBeUndefined();
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

/**
 * Which items belong to each class `GIVE [unit] ALL [item class]` accepts (`rules/give`), read off
 * the finished item entries so a class can lean on a fact already scraped - `kind` for MAN and
 * SHIP, the `weapon` block for WEAPON - instead of a second pattern that could disagree with the
 * first.
 *
 * `ADVANCED`, `MAGIC` and `SPECIAL` are absent from every assertion here on purpose: the data page
 * never states them, in any form, so this catalogue must not claim a membership it cannot back.
 */
describe("itemClassesOf", () => {
  it("reads ARMOR exactly", () => {
    const classes = itemClassesOf(parseItemReference(DATA_HTML));

    expect(classes.ARMOR).toEqual(["AARM", "ARNG", "CARM", "CLOA", "LARM", "MARM", "PARM"].sort());
  });

  it("reads FOOD exactly", () => {
    const classes = itemClassesOf(parseItemReference(DATA_HTML));

    expect(classes.FOOD).toEqual(["FISH", "GRAI", "LIVE", "MEAL"].sort());
  });

  it("puts a race that is also a mount in MOUNT alongside the dedicated mounts", () => {
    const classes = itemClassesOf(parseItemReference(DATA_HTML));

    expect(classes.MOUNT).toContain("CTAU");
    expect(classes.MOUNT).toContain("HORS");
  });

  it("reads NORMAL from the withdrawal price, including silver itself", () => {
    const classes = itemClassesOf(parseItemReference(DATA_HTML));

    expect(classes.NORMAL).toContain("SILV");
    expect(classes.NORMAL).toContain("GRAI");
    expect(classes.NORMAL).toContain("WAGO");
  });

  it("never claims a class the data page does not state", () => {
    const classes = itemClassesOf(parseItemReference(DATA_HTML));

    // Asserted with not.toHaveProperty rather than compared to undefined, so a key present with
    // an empty array would fail this too.
    expect(classes).not.toHaveProperty("ADVANCED");
    expect(classes).not.toHaveProperty("MAGIC");
    expect(classes).not.toHaveProperty("SPECIAL");
    // ITEM/ITEMS is everything the holder has; it needs no catalogue and is never emitted.
    expect(classes).not.toHaveProperty("ITEM");
  });
});

/**
 * The tags the data page says may not change hands: `This item cannot be given to other units.`
 * 51 monsters and the imprisoned entity carry it, so `GIVE ... ALL MONSTERS` selects sixty items
 * and can move nine.
 */
describe("ungiveableItemsOf", () => {
  it("records the items the page says cannot change hands", () => {
    const ungiveable = ungiveableItemsOf(parseItemReference(DATA_HTML));

    expect(ungiveable).toHaveLength(52);
    expect(ungiveable).toContain("LION");
    expect(ungiveable).toContain("IENT");
    // The giveable summoned creatures - the whole reason this list is worth having rather than a
    // synonym for "monster".
    expect(ungiveable).not.toContain("SKEL");
    expect(ungiveable).not.toContain("DEMO");
    expect(ungiveable).not.toContain("CATP");
  });
});

/**
 * What a month of study costs, which is the one number order validation cannot do without.
 *
 * A unit ordered to STUDY spends `cost x men` silver, and until this block existed there was no
 * way to say whether it could afford to. The page states the figure once per skill, on the level 1
 * entry: "This skill costs 10 silver per month of study."
 *
 * The item parser deliberately skips these paragraphs - a skill entry reads `mining [MINI] 1:`,
 * with a level and a colon where an item has a comma - so this is a second pass over the same
 * `<pre>` block rather than a widening of the first.
 */
describe("parseSkillReference", () => {
  it("reads the cost stated on a skill's level 1 entry", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "mining [MINI] 1: ... This skill costs 10 silver per month of study."
    expect(skills.MINI).toMatchObject({ tag: "MINI", name: "mining", cost: 10 });
  });

  /**
   * The rules page names the exceptions to the $10 rule: "Stealth and Observation (both of which
   * cost $50), Magic skills (which cost $100), and Tactics (which costs $200)". A parser that read
   * the first cost sentence it found anywhere, or defaulted to 10, would pass on mining alone.
   */
  it("reads each of the costs the rules single out as exceptional", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.STEA.cost).toBe(50);
    expect(skills.OBSE.cost).toBe(50);
    expect(skills.FORC.cost).toBe(100);
    expect(skills.TACT.cost).toBe(200);
  });

  /**
   * Ten tags mean one thing as a skill and another as an item: FISH is both fishing and fish, HERB
   * both herb lore and herbs. Merging the two catalogues would have one overwrite the other.
   */
  it("keeps a skill apart from the item that shares its tag", () => {
    const skills = parseSkillReference(DATA_HTML);
    const items = parseItemReference(DATA_HTML);

    expect(skills.FISH.name).toBe("fishing");
    expect(items.FISH.name).toBe("fish");
  });

  /**
   * Annihilation states no cost at any level, because it "cannot be studied via normal means".
   * Recording it as free, or defaulting it to 10, would invent a number the page refuses to give;
   * a null is what lets the validator stay silent about it instead.
   */
  it("records no cost for a skill the page prices nowhere", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.ANNI).toBeDefined();
    expect(skills.ANNI.cost).toBeNull();
  });

  it("records how far a skill can be studied", () => {
    const skills = parseSkillReference(DATA_HTML);

    // Every skill in the fixture runs from level 1 to level 5.
    expect(skills.MINI.maxLevel).toBe(5);
  });

  /**
   * Guards against silent truncation, as the item parser's own sweep does. The skills share their
   * `<pre>` block with the item and structure reports, so a dropped entry raises no error at all.
   */
  it("skips no paragraph that looks like a skill entry", () => {
    const skills = parseSkillReference(DATA_HTML);
    const looksLikeAnEntry = /^[^.:[\]]{1,40} \[[A-Z0-9]{2,6}\] \d+: /;

    const paragraphs = preformattedText(DATA_HTML)
      .split(/\n[ \t]*\n/)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .filter((paragraph) => looksLikeAnEntry.test(paragraph));

    expect(paragraphs.length).toBeGreaterThan(0);
    for (const paragraph of paragraphs) {
      const tag = paragraph.match(/\[([A-Z0-9]{2,6})\]/)?.[1];
      expect(skills[tag ?? ""], `entry dropped: ${paragraph.slice(0, 70)}`).toBeDefined();
    }
    // Measured from the committed fixture, which is frozen, so this catches drift rather than
    // pinning anything the live page could change under us.
    expect(Object.keys(skills).length).toBe(96);
  });

  it("fails loudly when the page carries no skill entries at all", () => {
    expect(() => parseSkillReference("<html><body><p>nothing here</p></body></html>")).toThrowError(
      RulesetScrapeError
    );
  });

  /**
   * The data page states a skill's prerequisites in its own description - `This skill requires
   * force [FORC] 1 to begin to study.` - and the tag, not the name, is what is matched: the tag is
   * stable and the spelling of the name is the page's business.
   */
  it("reads a single prerequisite", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "fire [FIRE] 1: ... This skill requires force [FORC] 1 to begin to study."
    expect(skills.FIRE.requires).toEqual([{ tag: "FORC", level: 1 }]);
  });

  it("reads two prerequisites joined by and", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "earth lore [EQUA] 1: ... requires force [FORC] 1 and pattern [PATT] 1 ..." - in the page's
    // own order, which is what a reader comparing the two would expect.
    expect(skills.EQUA.requires).toEqual([
      { tag: "FORC", level: 1 },
      { tag: "PATT", level: 1 }
    ]);
  });

  /**
   * Two skills state three requirements, punctuated `a, b and c`. The parser reads the tag/level
   * pairs out of the sentence rather than splitting it on a separator, which is why this form
   * needs no code of its own - but it is pinned here, because splitting on ` and ` (as this parser
   * first did) silently drops the middle one.
   */
  it("reads three prerequisites punctuated with a comma", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "engrave runes of warding [ENGR] 1: ... requires artifact lore [ARTI] 2, energy shield
    //  [ESHI] 3 and spirit shield [SSHI] 3 to begin to study."
    expect(skills.ENGR.requires).toEqual([
      { tag: "ARTI", level: 2 },
      { tag: "ESHI", level: 3 },
      { tag: "SSHI", level: 3 }
    ]);
  });

  /**
   * Empty rather than absent, so a consumer never has to distinguish "states none" from "was not
   * scraped" - the great majority of the catalogue states none.
   */
  it("records no prerequisites for a skill that states none", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.MINI.requires).toEqual([]);
  });

  /**
   * The same tolerant style the rest of this parser keeps: a clause that cannot be read is dropped
   * rather than guessed at, and the skill keeps every other field it stated.
   */
  it("drops an unreadable requirement clause rather than guessing", () => {
    const skills = parseSkillReference(
      "<html><body><pre>mangled [MANG] 1: A skill. This skill requires whatever it takes and " +
        "pattern [PATT] 2 to begin to study. This skill costs 10 silver per month of study.\n\n" +
        "</pre></body></html>"
    );

    expect(skills.MANG.requires).toEqual([{ tag: "PATT", level: 2 }]);
    expect(skills.MANG.cost).toBe(10);
  });

  /**
   * What CASTing the skill consumes, read from the same "via magic at a cost of ..." / "the
   * attempt costs ..." / "may transmute ... into ..." sentences ah-dbb.2 will charge against. Most
   * skills a mage can CAST state no cost at all, which is why `cast` is nullable rather than a
   * bare array.
   */
  it("reads a silver casting cost", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "create ring of invisibility [CRRI] 1: ... via magic at a cost of 600 silver [SILV]."
    expect(skills.CRRI.cast?.costs).toEqual([{ tag: "SILV", amount: 600 }]);
  });

  it("reads an item cost with no number as one", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "enchant swords [ESWO] 1: ... via magic at a cost of sword [SWOR]."
    expect(skills.ESWO.cast?.costs).toEqual([{ tag: "SWOR", amount: 1 }]);
  });

  /**
   * What a CAST creates, read from the "may create N times their level in ... [TAG]" sentences -
   * the arithmetic ah-ofpb.4 will charge against and ah-ofpb.5 will render. `data/ESWO`: "may
   * create 5 times their level in mithril swords [MSWO] via magic at a cost of sword [SWOR]."
   */
  it("reads what a level-scaled spell creates", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.ESWO.cast?.creates).toEqual([
      {
        tag: "MSWO",
        level: 1,
        percentPerLevel: 500,
        levelOffset: 0,
        averaged: false,
        summoned: false,
        control: null
      }
    ]);
  });

  /**
   * "may create their level in amulets of protection [AMPR]" states no number, meaning one per
   * level - a hundred percent per level.
   */
  it("reads a creation stated without a number as one per level", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.CRPA.cast?.creates).toEqual([
      {
        tag: "AMPR",
        level: 1,
        percentPerLevel: 100,
        levelOffset: 0,
        averaged: false,
        summoned: false,
        control: null
      }
    ]);
  });

  it("reads several inputs joined by and, stated on a later level", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "summon wind [SWIN] 3: ... via magic at a cost of 75 floater hides [FLOA] and 75 ironwood
    //  [IRWD]." - the cost is on level 3, not level 1, and the fold has to keep it.
    expect(skills.SWIN.cast?.costs).toEqual([
      { tag: "FLOA", amount: 75 },
      { tag: "IRWD", amount: 75 }
    ]);
  });

  /**
   * Neither punctuation occurs on the committed page - every cast-cost list there is a single item
   * or two joined by ` and `. That is the point: `ah-6qp` shipped a wrong catalogue because the
   * requirement parser was written from the punctuation the page happened to use, and this parser
   * carried the same assumption until this test. The inputs are self-delimiting (`[TAG]`), so the
   * separator is never looked at.
   */
  it("reads a casting cost list however it is punctuated", () => {
    const skills = parseSkillReference(
      "<html><body><pre>brew [BREW] 1: A mage with this skill can create a potion via magic at " +
        "a cost of 5 herbs [HERB], 2 iron [IRON] and mithril [MITH]. This skill costs 100 silver " +
        "per month of study.</pre></body></html>"
    );

    expect(skills.BREW.cast?.costs).toEqual([
      { tag: "HERB", amount: 5 },
      { tag: "IRON", amount: 2 },
      { tag: "MITH", amount: 1 }
    ]);
  });

  it("reads the attempt cost of construct gate", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "construct gate [CGAT] 1: ... the attempt costs 1000 silver."
    expect(skills.CGAT.cast?.costs).toEqual([{ tag: "SILV", amount: 1000 }]);
  });

  /**
   * Construct Gate makes a Gate, a region feature rather than an item, and its sentence says
   * "chance of success" rather than "chance to create ... [TAG]" - no creation pattern matches it,
   * and it must stay that way (the navigator's decision, `ah-ofpb.3`).
   */
  it("records no creation for a spell that makes something the catalogue cannot carry", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.CGAT.cast?.creates).toEqual([]);
  });

  /**
   * Nine summoning skills state their output in the same shapes as the priced spells but state no
   * cost at all, so before this bead they were `cast: null`. The navigator chose to record every
   * creation the page states, priced or not (`ah-ofpb.3`, 2026-08-26).
   */
  it("records what a summoning spell creates, though it states no cost", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "wolf lore [WOLF] 1: ... A mage with this skill may create 2 times their level in wolves
    //  [WOLF] via magic." - no "via magic at a cost of ..." clause anywhere in the paragraph.
    expect(skills.WOLF.cast).toEqual({
      costs: [],
      transmute: {},
      creates: [
        {
          tag: "WOLF",
          level: 1,
          percentPerLevel: 200,
          levelOffset: 0,
          averaged: true,
          summoned: true,
          control: { multiplier: 4, offset: 0, exponent: 2 }
        }
      ]
    });
  });

  /**
   * `data/WOLF` states everything this bead's ruleset fields exist for in one paragraph: an
   * averaged summon with a squared-times control cap (`ah-ofpb.5`).
   */
  it("reads what a summoning spell states: averaged, summoned and its control cap", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "A mage may summon a number of wolves averaging 200 percent times his skill level, and
    //  control a total number of his skill level squared times 4 wolves."
    const wolf = skills.WOLF.cast?.creates[0];
    expect(wolf?.averaged).toBe(true);
    expect(wolf?.summoned).toBe(true);
    expect(wolf?.control).toEqual({ multiplier: 4, offset: 0, exponent: 2 });
  });

  /**
   * Bird lore's prose says "100 percent times his skill level minus 2 eagles per month"; its
   * normalised sentence says "their level in eagles [EAGL]" - one eagle against three, for a
   * level 3 mage. The navigator chose the prose (`ah-ofpb.3`, 2026-08-26), which is why
   * `CastOutput` carries a `levelOffset` at all - it is the only skill on the page needing one.
   */
  it("reads bird lore's eagles from the prose that states the level offset", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.BIRD.cast?.creates).toEqual([
      {
        tag: "EAGL",
        level: 3,
        percentPerLevel: 100,
        levelOffset: -2,
        averaged: true,
        summoned: true,
        control: { multiplier: 2, offset: -2, exponent: 2 }
      }
    ]);
  });

  /**
   * `data/BIRD` is the one cap sentence on the page that spells its multiplier as a word rather
   * than a digit - "squared, times two" - and the one creation with a `levelOffset`, both from the
   * same sentence: "may control a number equal to his skill level minus 2, squared, times two."
   */
  it("reads the eagle cap from a multiplier spelled as a word", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.BIRD.cast?.creates[0]?.control).toEqual({
      multiplier: 2,
      offset: -2,
      exponent: 2
    });
  });

  it("reads what transmutation turns into what, across levels", () => {
    const skills = parseSkillReference(DATA_HTML);

    // Level 1: stone -> rootstone, iron -> mithril. Level 2: wood -> ironwood. Level 3: furs ->
    // floater hide. The fold has to union across levels, not keep only the first.
    expect(skills.TRNS.cast?.transmute).toMatchObject({
      ROOT: "STON",
      MITH: "IRON",
      IRWD: "WOOD",
      FLOA: "FUR"
    });
    expect(skills.TRNS.cast?.costs).toEqual([]);
  });

  /**
   * Transmutation's outputs stated as `creates`, so `ah-ofpb.4` and `ah-ofpb.5` can treat every
   * cast the same way rather than special-casing `transmute`. `2 <source> [TAG] times the skill
   * level into <output> [OUT]` is `percentPerLevel: 200`, and the level is whichever paragraph
   * introduced it - the same order `.transmute` above pins.
   */
  it("reads what transmutation creates, and the level each output arrives at", () => {
    const skills = parseSkillReference(DATA_HTML);

    const transmuted = (tag: string, level: number) => ({
      tag,
      level,
      percentPerLevel: 200,
      levelOffset: 0,
      averaged: false,
      summoned: false,
      control: null
    });
    expect(skills.TRNS.cast?.creates).toEqual([
      transmuted("ROOT", 1),
      transmuted("MITH", 1),
      transmuted("IRWD", 2),
      transmuted("FLOA", 3),
      transmuted("YEW", 4),
      transmuted("WING", 5),
      transmuted("ADMT", 5)
    ]);
    expect(skills.TRNS.cast?.creates.map((made) => made.tag)).toEqual(
      Object.keys(skills.TRNS.cast?.transmute ?? {})
    );
  });

  it("records no casting cost for a spell the page prices nowhere", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "fire [FIRE] 1: A mage with this skill can cast a fireball in battle." - no cost sentence.
    expect(skills.FIRE.cast).toBeNull();
  });

  it("fails loudly on a cost it cannot read", () => {
    const html =
      "<html><body><pre>broken [BROK] 1: A mage with this skill has a chance to create " +
      "something via magic at a cost of some things. To use this spell, the mage should CAST " +
      "Broken.</pre></body></html>";

    expect(() => parseSkillReference(html)).toThrowError(RulesetScrapeError);
  });

  /**
   * "has a 20 percent times their level chance to create a ring of invisibility [RING]" - the
   * chance shape, recorded as the same `percentPerLevel` number as the certain shapes.
   */
  it("reads a creation stated as a chance", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "create ring of invisibility [CRRI] 1: ... has a 20 percent times their level chance to
    //  create a ring of invisibility [RING] via magic at a cost of 600 silver [SILV]."
    expect(skills.CRRI.cast?.creates).toEqual([
      {
        tag: "RING",
        level: 1,
        percentPerLevel: 20,
        levelOffset: 0,
        averaged: false,
        summoned: false,
        control: null
      }
    ]);
  });

  it("fails loudly on a creation it cannot read", () => {
    const html =
      "<html><body><pre>whatnot [WHAT] 1: A mage with this skill may create 3 times their " +
      "level in whatnots. This skill costs 100 silver per month of study.</pre></body></html>";

    expect(() => parseSkillReference(html)).toThrowError(RulesetScrapeError);
  });

  /**
   * `data/DRAG`: "the total number of dragons that a mage may control at one time is equal to
   * his skill level" - the cap stated as the bare level, `{multiplier: 1, offset: 0, exponent: 1}`.
   */
  it("reads a cap stated as the bare level", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.DRAG.cast?.creates[0]?.control).toEqual({
      multiplier: 1,
      offset: 0,
      exponent: 1
    });
    expect(skills.DRAG.cast?.creates[0]?.summoned).toBe(true);
  });

  /**
   * `data/SUBA`: "may only summon a balrog if one is not already under his control" - a flat cap
   * of one, `{multiplier: 1, offset: 0, exponent: 0}`.
   */
  it("reads a cap stated as only one at a time", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.SUBA.cast?.creates[0]?.control).toEqual({
      multiplier: 1,
      offset: 0,
      exponent: 0
    });
  });

  /**
   * A creation whose control sentence this parser cannot read is the page having changed shape,
   * and must stay loud - the same posture the creation clause itself already takes.
   */
  it("a creation whose control sentence cannot be read stops the scrape", () => {
    const html =
      "<html><body><pre>whatnot [WHAT] 1: A mage with this skill may create 3 times their " +
      "level in whatnots [WHAT] via magic, and may control a mysterious number of them. This " +
      "skill costs 100 silver per month of study.</pre></body></html>";

    expect(() => parseSkillReference(html)).toThrowError(RulesetScrapeError);
  });

  /**
   * `data/BIRD` level 1 is about scouting and talks about controlling small birds while creating
   * nothing - the `CONTROL_STATED` guard must not fire on a paragraph with no creation to check.
   * Isolated from the fixture's own level 1 paragraph rather than asserted through the merged
   * `skills.BIRD.cast`, which level 3's real eagle creation would make non-null regardless.
   */
  it("a paragraph that controls without creating is not checked", () => {
    const html =
      "<html><body><pre>bird lore [BIRD] 1: A mage with Bird Lore may control the birds of the " +
      "sky. At skill level 1, the mage can control small birds, sending them to an adjacent " +
      "region to obtain a report on that region. This skill costs 100 silver per month of " +
      "study.</pre></body></html>";

    expect(() => parseSkillReference(html)).not.toThrow();
    const skills = parseSkillReference(html);
    expect(skills.BIRD.cast).toBeNull();
  });

  /**
   * What a skill may PRODUCE, read from the "may PRODUCE ... at a rate of ..." sentences ah-bai.2
   * will use to narrow the PRODUCE completion popup to what the unit standing in the hex can
   * actually make. Most skills state no production at all, which is why `produces` is checked
   * against fact for every skill that does, rather than sampled.
   */
  it("reads what a skill may produce", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "mining [MINI] 1: ... A unit with this skill may PRODUCE iron [IRON] at a rate of 1 per
    //  man-month."
    expect(skills.MINI.produces).toContainEqual({
      tag: "IRON",
      level: 1,
      inputs: [],
      inputsAreAlternatives: false,
      manMonths: 1,
      outputs: 1,
      revealsRegion: false
    });
  });

  it("does not mistake what a product is made from for a product", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "weaponsmith [WEAP] 1: ... may PRODUCE swords [SWOR] from iron [IRON] at a rate of 1 per
    //  man-month, crossbows [XBOW] from wood [WOOD] ..., longbows [LBOW] from wood [WOOD] ...,
    //  picks [PICK] from iron [IRON] ..., spears [SPEA] from wood [WOOD] ..., axes [AXE] from
    //  wood [WOOD] ..., hammers [HAMM] from iron [IRON] ..., and javelins [JAVE] from wood
    //  [WOOD] ..."
    const level1 = skills.WEAP.produces.filter((p) => p.level === 1).map((p) => p.tag);
    expect(level1).toEqual(["SWOR", "XBOW", "LBOW", "PICK", "SPEA", "AXE", "HAMM", "JAVE"]);
    expect(level1).not.toContain("IRON");
    expect(level1).not.toContain("WOOD");
  });

  it("records the level at which each product becomes available", () => {
    const skills = parseSkillReference(DATA_HTML);

    // MINI: iron at 1, mithril at 3, admantium at 5.
    expect(skills.MINI.produces.map((p) => ({ tag: p.tag, level: p.level }))).toEqual([
      { tag: "IRON", level: 1 },
      { tag: "MITH", level: 3 },
      { tag: "ADMT", level: 5 }
    ]);
  });

  it("reads a product whose sentence puts the materials in an odd place", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "cooking [COOK] 1: ... may PRODUCE a number of meals [MEAL] equal to skill level divided by
    //  2, rounded up from any of grain [GRAI], livestock [LIVE] and fish [FISH] at a rate of 1
    //  per man-month."
    expect(skills.COOK.produces).toMatchObject([{ tag: "MEAL", level: 1 }]);
  });

  it("reads several products in one sentence", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "fishing [FISH] 1: ... may PRODUCE fish [FISH] at a rate of 1 per man-month and nets [NET]
    //  from herb [HERB] at a rate of 1 per man-month."
    expect(skills.FISH.produces.filter((p) => p.level === 1)).toMatchObject([
      { tag: "FISH", level: 1 },
      { tag: "NET", level: 1 }
    ]);
  });

  /**
   * How long a production takes is what turns a per-unit price into a per-month one: a carpenter
   * ordered to produce catapults spends 3000 silver per catapult and makes one every four
   * man-months, so ten carpenters spend 6000 in a month. `ah-19l2.2` needs the rate to say so.
   */
  it("reads how long each production takes", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "carpenter [CARP] 4: ... catapults [CATP] ... at a rate of 1 per 4 man-months"
    expect(skills.CARP.produces.find((p) => p.tag === "CATP")).toMatchObject({
      manMonths: 4,
      outputs: 1
    });
    // "armorer [ARMO] 1: ... chain armor [CARM] from iron [IRON] at a rate of 1 per man-month"
    expect(skills.ARMO.produces.find((p) => p.tag === "CARM")).toMatchObject({
      manMonths: 1,
      outputs: 1
    });
    // "weaponsmith [WEAP] 5: ... admantium swords [ASWR] ... at a rate of 1 per 2 man-months"
    expect(skills.WEAP.produces.find((p) => p.tag === "ASWR")).toMatchObject({ manMonths: 2 });
    // "armorer [ARMO] 3: ... plate armor [PARM] from 3 iron [IRON] at a rate of 1 per 3 man-months"
    expect(skills.ARMO.produces.find((p) => p.tag === "PARM")).toMatchObject({ manMonths: 3 });
  });

  it("refuses a production rate it does not recognise", () => {
    const html =
      "<html><body><pre>broken [BROK] 1: A unit with this skill may PRODUCE swords [SWOR] " +
      "from iron [IRON] at a rate of 2 per man-month.</pre></body></html>";

    expect(() => parseSkillReference(html)).toThrowError(RulesetScrapeError);
  });

  it("reads what each production consumes", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "swords [SWOR] from iron [IRON]" - a material with no number is one.
    expect(skills.WEAP.produces.find((p) => p.tag === "SWOR")?.inputs).toEqual([
      { tag: "IRON", amount: 1 }
    ]);
    // "plate armor [PARM] from 3 iron [IRON]"
    expect(skills.ARMO.produces.find((p) => p.tag === "PARM")?.inputs).toEqual([
      { tag: "IRON", amount: 3 }
    ]);
    // "healing potions [HPOT] from herb [HERB] and mushroom [MUSH]"
    expect(skills.HEAL.produces.find((p) => p.tag === "HPOT")?.inputs).toEqual([
      { tag: "HERB", amount: 1 },
      { tag: "MUSH", amount: 1 }
    ]);
    // "gliders [GLID] from 2 floater hides [FLOA]"
    expect(skills.CARP.produces.find((p) => p.tag === "GLID")?.inputs).toEqual([
      { tag: "FLOA", amount: 2 }
    ]);
    // "iron [IRON] at a rate of 1 per man-month" - a raw resource takes labour and nothing else.
    expect(skills.MINI.produces.find((p) => p.tag === "IRON")?.inputs).toEqual([]);
  });

  it("reads silver as an input like any other", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "catapults [CATP] from 250 wood [WOOD], 30 ironwood [IRWD], 80 furs [FUR] and 3000 silver
    //  [SILV]" - in the page's order, silver among the rest.
    expect(skills.CARP.produces.find((p) => p.tag === "CATP")?.inputs).toEqual([
      { tag: "WOOD", amount: 250 },
      { tag: "IRWD", amount: 30 },
      { tag: "FUR", amount: 80 },
      { tag: "SILV", amount: 3000 }
    ]);
    // "steel defenders [STED] from 30 rootstone [ROOT], 250 iron [IRON], 50 furs [FUR] and 3000
    //  silver [SILV]"
    expect(skills.CARP.produces.find((p) => p.tag === "STED")?.inputs).toEqual([
      { tag: "ROOT", amount: 30 },
      { tag: "IRON", amount: 250 },
      { tag: "FUR", amount: 50 },
      { tag: "SILV", amount: 3000 }
    ]);
  });

  it("reads cooking's alternative inputs", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "... from any of grain [GRAI], livestock [LIVE] and fish [FISH]" - one of the three, not all
    // three.
    const meal = skills.COOK.produces.find((p) => p.tag === "MEAL");
    expect(meal?.inputsAreAlternatives).toBe(true);
    expect(meal?.inputs).toEqual([
      { tag: "GRAI", amount: 1 },
      { tag: "LIVE", amount: 1 },
      { tag: "FISH", amount: 1 }
    ]);
  });

  it("reads cooking's formula output as unknown rather than one", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "a number of meals [MEAL] equal to skill level divided by 2, rounded up" - a formula, and
    // this type does not model formulae. A 1 would be wrong at every level above 2.
    expect(skills.COOK.produces.find((p) => p.tag === "MEAL")).toMatchObject({
      outputs: null,
      manMonths: 1
    });
  });

  it('reads cooking\'s product from a sentence that says "from" twice', () => {
    const skills = parseSkillReference(DATA_HTML);

    // "a number of meals [MEAL] equal to skill level divided by 2, rounded up from any of grain
    //  [GRAI], ..." - the materials are what the LAST " from " introduces, which is the rule
    // (`ah-3rxk`) rather than the luck the old first-occurrence split relied on.
    expect(skills.COOK.produces.map((p) => p.tag)).toEqual(["MEAL"]);
  });

  it("takes the materials from the last from, not the first", () => {
    // Two " from "s with the formula phrase between them: splitting on the first leaves "equal to"
    // in the tail, which reads the formula as a count of one and the material list as an exact
    // requirement rather than alternatives.
    const html =
      "<html><body><pre>cookery [COOX] 1: A unit with this skill may PRODUCE a number of " +
      "meals [MEAL] from cooking equal to skill level from any of grain [GRAI] at a rate of 1 " +
      "per man-month. This skill costs 10 silver per month of study.</pre></body></html>";

    const produced = parseSkillReference(html).COOX.produces;

    expect(produced).toMatchObject([
      { tag: "MEAL", outputs: null, inputsAreAlternatives: true, inputs: [{ tag: "GRAI", amount: 1 }] }
    ]);
  });

  it("leaves a production stating one from unchanged", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "swords [SWOR] from iron [IRON] at a rate of 1 per man-month" - the common shape.
    expect(skills.WEAP.produces.find((p) => p.tag === "SWOR")).toMatchObject({
      outputs: 1,
      inputs: [{ tag: "IRON", amount: 1 }]
    });
  });

  it("fails loudly on a production it cannot read", () => {
    const html =
      "<html><body><pre>broken [BROK] 1: A unit with this skill may PRODUCE something odd " +
      "at a rate of 1 per man-month.</pre></body></html>";

    expect(() => parseSkillReference(html)).toThrowError(RulesetScrapeError);
  });

  it("marks the nine productions that also reveal a region", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.HUNT.produces.find((p) => p.tag === "FLOA")).toMatchObject({
      level: 3,
      revealsRegion: true
    });
    expect(skills.HUNT.produces.find((p) => p.tag === "FUR")).toMatchObject({
      revealsRegion: false
    });

    const revealing: string[] = [];
    for (const [tag, skill] of Object.entries(skills)) {
      for (const made of skill.produces) {
        if (made.revealsRegion) {
          revealing.push(`${tag} ${made.level} ${made.tag}`);
        }
      }
    }
    expect(revealing.sort()).toEqual([
      "FISH 3 TURT",
      "HERB 3 MUSH",
      "HORS 5 WING",
      "HUNT 3 FLOA",
      "LUMB 3 IRWD",
      "LUMB 5 YEW",
      "MINI 3 MITH",
      "MINI 5 ADMT",
      "QUAR 3 ROOT"
    ]);
  });

  it("refuses a reveal sentence with no production", () => {
    const html =
      "<html><body><pre>hunting [HUNT] 3: A unit with this skill is able to determine if a " +
      "region contains floater hides.</pre></body></html>";

    expect(() => parseSkillReference(html)).toThrowError(RulesetScrapeError);
  });

  it("refuses a reveal sentence beside two productions", () => {
    const html =
      "<html><body><pre>hunting [HUNT] 3: A unit with this skill may PRODUCE furs [FUR] at a " +
      "rate of 1 per man-month, floater hides [FLOA] at a rate of 1 per man-month. A unit with " +
      "this skill is able to determine if a region contains floater hides.</pre></body></html>";

    expect(() => parseSkillReference(html)).toThrowError(RulesetScrapeError);
  });

  it("records no production for a skill that makes nothing", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "observation [OBSE] 1: A unit with this skill can see stealthy units or ..." - no PRODUCE.
    expect(skills.OBSE.produces).toEqual([]);
  });

  it("keeps the page's order", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.WEAP.produces.map((p) => p.tag)).toEqual([
      "SWOR",
      "XBOW",
      "LBOW",
      "PICK",
      "SPEA",
      "AXE",
      "HAMM",
      "JAVE",
      "PIKE",
      "MSWO",
      "BAXE",
      "MXBO",
      "DBOW",
      "ASWR"
    ]);
  });

  it("reads a product made from several materials with quantities", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "carpenter [CARP] 4: ... may PRODUCE catapults [CATP] from 250 wood [WOOD], 30 ironwood
    //  [IRWD], 80 furs [FUR] and 3000 silver [SILV] at a rate of 1 per 4 man-months and steel
    //  defenders [STED] from ... at a rate of 1 per 4 man-months."
    const level4 = skills.CARP.produces.filter((p) => p.level === 4).map((p) => p.tag);
    expect(level4).toEqual(["CATP", "STED"]);
  });

  /**
   * The data page marks magic nowhere - no flag, no grouping, no "may only be studied by a mage"
   * phrase - so a skill's own level-1 description is the only evidence there is. `ah-a2k.2` needs
   * this to tell a magic skill from a mundane one before it can warn about studying one outside a
   * building.
   */
  it("flags a magic skill from its own description", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.FORC.magic).toBe(true);
    expect(skills.NECR.magic).toBe(true);
    expect(skills.ILLU.magic).toBe(true);
    expect(skills.TELE.magic).toBe(true);
  });

  it("does not flag a mundane skill as magic", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.MINI.magic).toBe(false);
    expect(skills.LUMB.magic).toBe(false);
    expect(skills.COMB.magic).toBe(false);
    expect(skills.SAIL.magic).toBe(false);
    expect(skills.BUIL.magic).toBe(false);
  });

  /**
   * The rules give four ways a unit may TAX, and the fourth is being "a mage who knows a spell
   * which damages enemies" - so a combat mage's men count toward the PILLAGE threshold like any
   * other taxing character (`ah-v585`). The data page marks it nowhere, so it is read from the
   * skill's own description, exactly as `magic` is.
   *
   * The negative cases are the point. A looser pattern on "attack" or "battle" would also select
   * the four shields ("shield against all ranged attacks") and the four summons ("aid in battle"),
   * eight skills whose mages cannot tax on their account.
   */
  it("reads which spells damage enemies", () => {
    const skills = parseSkillReference(DATA_HTML);

    for (const tag of ["FIRE", "EQUA", "STOR", "CALL", "SBLA", "BUND", "BDEM", "DISP"]) {
      expect(skills[tag].damagesEnemies, tag).toBe(true);
    }
    // A shield, a summon, two spells cast at enemies that state no damage, and a mundane skill.
    for (const tag of ["FSHI", "DRAG", "FEAR", "SSTO", "COMB"]) {
      expect(skills[tag].damagesEnemies, tag).toBe(false);
    }
  });

  /**
   * Higher-level paragraphs describe effects and mention magic often enough to misclassify a
   * mundane skill if they were consulted - level 1 is where a skill says what it is.
   */
  it("only consults the level one paragraph to classify a skill", () => {
    const html =
      "<html><body><pre>mundane [MUND] 1: This skill deals with everyday, ordinary work and " +
      "has nothing to do with the arcane. This skill costs 10 silver per month of study.\n\n" +
      "mundane [MUND] 2: At second level a unit with this skill can assist with a minor spell " +
      "in battle.</pre></body></html>";

    const skills = parseSkillReference(html);

    expect(skills.MUND.magic).toBe(false);
  });

  /**
   * Alternation binds more loosely than `\b`, so an unparenthesised `\bmage|cast` would anchor only
   * `mage` and let `cast` match inside an unrelated word. "broadcast" is the case that would have
   * slipped through.
   */
  it("does not mistake cast inside an unrelated word for the CAST order's own name", () => {
    const html =
      "<html><body><pre>signaler [SIGN] 1: A unit with this skill can broadcast orders to " +
      "allies across the region. This skill costs 10 silver per month of study.</pre></body></html>";

    const skills = parseSkillReference(html);

    expect(skills.SIGN.magic).toBe(false);
  });

  /**
   * A leading `\b` only rules out `cast` matching mid-word ("broadcast"); "castle" is a real word
   * that happens to start with `cast`, and the fixture names nine of them - a fortification, not a
   * spell. Caught in review of ah-a2k.1's first draft, which anchored only the left edge.
   */
  it("does not mistake castle for casting a spell", () => {
    const html =
      "<html><body><pre>warden [WARD] 1: A unit with this skill can maintain a castle without " +
      "extra upkeep. This skill costs 10 silver per month of study.</pre></body></html>";

    const skills = parseSkillReference(html);

    expect(skills.WARD.magic).toBe(false);
  });

  /**
   * The negative lookahead must not over-correct: `cast`, `caster` and `casting` all appear in the
   * fixture and must keep classifying a skill as magic.
   */
  it("still recognises cast, caster and casting as magic words", () => {
    expect(parseSkillReference(
      "<html><body><pre>a [AAAA] 1: A mage can cast this. This skill costs 100 silver per " +
        "month of study.</pre></body></html>"
    ).AAAA.magic).toBe(true);
    expect(parseSkillReference(
      "<html><body><pre>b [BBBB] 1: The caster gains a bonus. This skill costs 100 silver per " +
        "month of study.</pre></body></html>"
    ).BBBB.magic).toBe(true);
    expect(parseSkillReference(
      "<html><body><pre>c [CCCC] 1: This skill improves casting speed. This skill costs 100 " +
        "silver per month of study.</pre></body></html>"
    ).CCCC.magic).toBe(true);
  });
});

/**
 * The buildings reference. The data page is the game's own object list, so it - and not the rules
 * page's generic table - is what says which structures this game has and how many mages each seats.
 * Every expected value below is quoted from the fixture's own entry.
 */
describe("parseBuildingReference", () => {
  it("reads a building's size from the men it protects", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    // "Tower: ... This structure provides defense to the first 10 men inside it."
    expect(buildings.TOWER).toMatchObject({ size: 10 });
    // "Citadel: ... provides defense to the first 1000 men inside it."
    expect(buildings.CITADEL).toMatchObject({ size: 1000 });
  });

  it("reads a mage capacity written as a numeral", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    // "Castle: ... will allow up to 2 mages to study above level 2."
    expect(buildings.CASTLE.mages).toBe(2);
    expect(buildings["MAGICAL CITADEL"].mages).toBe(50);
  });

  it("reads a mage capacity written as the word one", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    // "will allow one mage to study above level 2" - a word, not a digit.
    expect(buildings.FORT.mages).toBe(1);
    expect(buildings.STOCKADE.mages).toBe(1);
    expect(buildings["HERMITS HUT"].mages).toBe(1);
  });

  it("a building that says nothing about mages seats none", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    // A Tower's entry never mentions mages, and that silence is the ruleset's answer: a mage
    // studying in one loses half the month.
    expect(buildings.TOWER.mages).toBe(0);
  });

  it("a paragraph that is not a building is not one", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    expect(buildings.LEADER).toBeUndefined();
    expect(buildings.MINING).toBeUndefined();
    expect(buildings.BUILDING).toBeUndefined();
  });

  it("keeps every entry the page calls a building", () => {
    // The fixture carries 59 paragraphs opening "<Name>: This is a building." Only the ten that
    // also state a defence used to survive.
    expect(Object.keys(parseBuildingReference(DATA_HTML))).toHaveLength(58);
  });

  it("the repeated Lair does not lose an entry", () => {
    // 59 paragraphs, 58 keys: the page names "Lair" twice - once for Trents, once for Illyrthil -
    // and the map is keyed by the upper-cased name, so the second entry wins. Neither carries a
    // figure, so last-wins costs nothing here; a future page repeating a name that does carry one
    // is where this would go wrong quietly.
    expect(parseBuildingReference(DATA_HTML).LAIR).toBeDefined();
  });

  it("keeps a Mine, a road and a lair", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    expect(buildings.MINE).toBeDefined();
    expect(buildings["ROAD SE"]).toBeDefined();
    expect(buildings.LAIR).toBeDefined();
  });

  it("a Mine states no size", () => {
    // The entry says nothing about defence, and an absent field says that - where a 0 would claim
    // the page had stated it.
    expect(parseBuildingReference(DATA_HTML).MINE.size).toBeUndefined();
  });

  it("a lair states no cost and no materials", () => {
    const lair = parseBuildingReference(DATA_HTML).LAIR;

    expect(lair.cost).toBeUndefined();
    expect(lair.materials).toBeUndefined();
  });

  it("a Tower still seats no mages and a Fort still seats one", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    // The ten fortifications are untouched by the widening.
    expect(buildings.TOWER).toMatchObject({ size: 10, cost: 10, materials: ["stone"], mages: 0 });
    expect(buildings.FORT.mages).toBe(1);
  });

  it("keeps the description the page gives", () => {
    expect(parseBuildingReference(DATA_HTML).MINE.description).toBe(
      "This is a building. Units may enter this structure. This trade structure increases the " +
        "amount of iron available in the region."
    );
  });

  it("keeps the description of a fortification too", () => {
    // The ten that were already kept gain prose as well.
    expect(parseBuildingReference(DATA_HTML).TOWER.description).toContain(
      "This structure provides defense to the first 10 men inside it."
    );
  });

  it("reads what a trade structure produces", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    expect(buildings.MINE.produces).toBe("iron");
    expect(buildings["ARCANE MINE"].produces).toBe("mithril");
    expect(buildings["SACRED GROVE"].produces).toBe("yew");
    expect(buildings["FAERIE RING"].produces).toBe("mushrooms");
  });

  it("a road produces nothing and a fortification produces nothing", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    expect(buildings["ROAD SE"].produces).toBeUndefined();
    expect(buildings.TOWER.produces).toBeUndefined();
  });

  it("a Mine costs what the skill says", () => {
    // Pass two already read this clause and discarded it for want of a Mine in the object list.
    expect(parseBuildingReference(DATA_HTML).MINE).toMatchObject({
      cost: 10,
      materials: ["wood", "stone"]
    });
  });

  it("reads cost and material from the skill that builds it", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    // "building [BUIL] 3: ... may BUILD a Citadel from 800 stone [STON] ..."
    expect(buildings.CITADEL).toMatchObject({ cost: 800, materials: ["stone"] });
    // "building [BUIL] 1: ... a Tower from 10 stone [STON] ..."
    expect(buildings.TOWER).toMatchObject({ cost: 10, materials: ["stone"] });
  });

  it("reads alternative materials as a list", () => {
    // "a Caravanserai from 20 wood [WOOD] or stone [STON]" is the shape; a Caravanserai is not a
    // fortification, so the alternatives are pinned on a fortification the page words the same way
    // - a Tower built "from 10 wood [WOOD] or stone [STON]" in a page shaped like the real one.
    const html =
      "<pre>building [BUIL] 1: A unit with this skill may BUILD a Tower from 10 wood [WOOD] or " +
      "stone [STON].\n\n" +
      "Tower: This is a building. This structure provides defense to the first 10 men inside it.</pre>";

    expect(parseBuildingReference(html).TOWER).toMatchObject({
      cost: 10,
      materials: ["wood", "stone"]
    });
  });

  it("does not read a second structure as another material", () => {
    // "quarrying [QUAR] 3: ... may BUILD a Quarry from 10 wood [WOOD] or stone [STON] or a
    //  Mystic Quarry from 10 rootstone [ROOT]." - two structures, the first with two materials.
    // Neither Quarry is a fortification, so this is checked on the clause split itself, using the
    // structures the same statement shape produces in the object list.
    const html =
      "<pre>building [BUIL] 1: A unit with this skill may BUILD a Tower from 10 wood [WOOD] or " +
      "stone [STON] or a Fort from 40 rootstone [ROOT].\n\n" +
      "Tower: This is a building. This structure provides defense to the first 10 men inside it.\n\n" +
      "Fort: This is a building. This structure provides defense to the first 50 men inside it.</pre>";

    const buildings = parseBuildingReference(html);
    expect(buildings.TOWER).toMatchObject({ cost: 10, materials: ["wood", "stone"] });
    expect(buildings.FORT).toMatchObject({ cost: 40, materials: ["rootstone"] });
    expect(buildings["STONE [STON]"]).toBeUndefined();
  });

  it("does not read a ship as a building", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    // "may BUILD Longships [LONG] from 10 wood [WOOD]" - plural, tagged, no article.
    expect(buildings.LONGSHIP).toBeUndefined();
    expect(buildings.LONGSHIPS).toBeUndefined();
  });

  it("a structure named by a skill but not in the object list is ignored", () => {
    const html =
      "<pre>building [BUIL] 1: A unit with this skill may BUILD a Tower from 10 stone [STON] " +
      "or a Zeppelin Dock from 5 wood [WOOD].\n\n" +
      "Tower: This is a building. This structure provides defense to the first 10 men inside it." +
      "</pre>";

    const buildings = parseBuildingReference(html);

    expect(Object.keys(buildings)).toEqual(["TOWER"]);
    expect(buildings.TOWER).toEqual({
      description: "This is a building. This structure provides defense to the first 10 men inside it.",
      size: 10,
      cost: 10,
      materials: ["stone"],
      mages: 0,
      buildSkill: "BUIL",
      buildLevel: 1
    });
  });
});

/**
 * The prose an entry carries, which ah-3cj4.2 keeps so a reference dialog can say more than
 * numbers. Every expected value below is quoted from the fixture's own entry.
 */
describe("entry descriptions", () => {
  it("keeps what the page says about an item", () => {
    const items = parseItemReference(DATA_HTML);

    // "chain armor [CARM], weight 1, costs 150 silver to withdraw. This is a type of armor. ..."
    expect(items.CARM.description).toMatch(/^This is a type of armor\./);
    expect(items.CARM.description).not.toContain("weight 1");
    expect(items.CARM.description).not.toContain("[CARM]");
  });

  it("keeps the prose of a ship", () => {
    const items = parseItemReference(DATA_HTML);

    expect(items.LONG.description).toMatch(/^This is a ship with a capacity of 150/);
  });

  it("an item whose preamble carries a comma list is still cut at the tag", () => {
    const items = parseItemReference(DATA_HTML);

    // "leader [LEAD], weight 10, walking capacity 5, moves 2 hexes per month. This race may ..."
    expect(items.LEAD.description).toBe("This race may study all skills to level 5.");
  });

  it("an entry that is only a preamble carries no description", () => {
    const items = parseItemReference(
      "<pre>widget [WIDG], weight 3, walking capacity 0, moves 0 hexes per month.</pre>"
    );

    expect(items.WIDG).toBeDefined();
    expect("description" in items.WIDG).toBe(false);
  });

  it("keeps what a skill says at each level", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.MINI.levels?.map((entry) => entry.level)).toEqual([1, 3, 5]);
    expect(skills.MINI.levels?.[0].description).toMatch(
      /^This skill deals with all aspects of extracting raw metals/
    );
    expect(skills.MINI.levels?.[1].description).toMatch(/PRODUCE mithril \[MITH\]/);
  });

  it("drops the levels that say No skill report", () => {
    const skills = parseSkillReference(DATA_HTML);

    for (const entry of skills.MINI.levels ?? []) {
      expect(entry.description).not.toContain("No skill report");
    }
    expect(skills.MINI.levels?.some((entry) => entry.level === 2 || entry.level === 4)).toBe(false);
  });

  it("a skill with one useful level keeps exactly one", () => {
    const skills = parseSkillReference(DATA_HTML);

    // 71 of the 96 say something at one level only, so this is the ordinary case rather than a
    // special one; the count is what pins that the placeholders are being dropped everywhere and
    // not only on mining.
    const single = Object.values(skills).filter((skill) => (skill.levels ?? []).length === 1);
    expect(single.length).toBe(71);
  });

  it("the levels come out in level order", () => {
    const skills = parseSkillReference(DATA_HTML);

    for (const skill of Object.values(skills)) {
      const levels = (skill.levels ?? []).map((entry) => entry.level);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
    }
  });

  it("a skill that says nothing at any level carries no levels key", () => {
    // Hand-built, because no skill in the committed fixture is empty at every level - the rule is
    // there so a future page produces no key rather than an empty list.
    const skills = parseSkillReference(
      "<pre>hush [HUSH] 1: No skill report.\n\nhush [HUSH] 2: No skill report.</pre>"
    );

    expect(skills.HUSH).toBeDefined();
    expect("levels" in skills.HUSH).toBe(false);
  });

  it("keeps every item and skill it kept before", () => {
    expect(Object.keys(parseItemReference(DATA_HTML)).length).toBe(171);
    expect(Object.keys(parseSkillReference(DATA_HTML)).length).toBe(96);
  });

  it("a skill's existing fields are unchanged", () => {
    const skills = parseSkillReference(DATA_HTML);

    expect(skills.MINI).toMatchObject({
      cost: 10,
      maxLevel: 5,
      magic: false,
      requires: []
    });
    expect(skills.MINI.produces.map((entry) => entry.tag)).toEqual(["IRON", "MITH", "ADMT"]);
  });
});

/**
 * What builds a structure, and at what level. Both facts live in the opening of the *skill's* own
 * entry - `mining [MINI] 3: ...` - which is the paragraph pass two is already holding when it
 * reads the `may BUILD` sentence out of it.
 */
describe("parseBuildingReference build requirements", () => {
  it("says which skill builds a structure, and at what level", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    // "mining [MINI] 3: ... A unit with this skill may BUILD a Mine from 10 stone [STON] ..."
    expect(buildings.MINE).toMatchObject({ buildSkill: "MINI", buildLevel: 3 });
    // "building [BUIL] 1: ... may BUILD a Tower ..."
    expect(buildings.TOWER).toMatchObject({ buildSkill: "BUIL", buildLevel: 1 });
    // "building [BUIL] 3: ... may BUILD a Citadel ..."
    expect(buildings.CITADEL).toMatchObject({ buildSkill: "BUIL", buildLevel: 3 });
  });

  it("leaves the requirement absent for a structure no skill builds", () => {
    const lair = parseBuildingReference(DATA_HTML).LAIR;

    // The catalogue does not say - which is not the same claim as "no skill needed".
    expect(lair.buildSkill).toBeUndefined();
    expect(lair.buildLevel).toBeUndefined();
  });

  it("never states one half of the requirement without the other", () => {
    const buildings = parseBuildingReference(DATA_HTML);

    const halfFilled = Object.entries(buildings).filter(
      ([, entry]) => (entry.buildSkill === undefined) !== (entry.buildLevel === undefined)
    );
    expect(halfFilled).toEqual([]);
  });
});

/**
 * The data page's `[TAG]` clauses, read in one place. The principle these pin - that the separator
 * is never looked at - had been written into three comments and asserted nowhere, after the same
 * assumption shipped a wrong catalogue twice (`ah-6qp`, `ah-bet5`).
 */
describe("taggedAmounts", () => {
  it("reads a clause with one pair", () => {
    expect(taggedAmounts("2 stone [STON]")).toEqual([{ tag: "STON", amount: 2 }]);
  });

  it("counts a bare name as one", () => {
    expect(taggedAmounts("iron [IRON]")).toEqual([{ tag: "IRON", amount: 1 }]);
  });

  it("never looks at the separator", () => {
    const expected = [
      { tag: "STON", amount: 2 },
      { tag: "IRON", amount: 1 },
      { tag: "WOOD", amount: 3 }
    ];
    expect(taggedAmounts("2 stone [STON] and iron [IRON] and 3 wood [WOOD]")).toEqual(expected);
    expect(taggedAmounts("2 stone [STON], iron [IRON] and 3 wood [WOOD]")).toEqual(expected);
    expect(taggedAmounts("2 stone [STON]; iron [IRON]; 3 wood [WOOD]")).toEqual(expected);
  });

  it("reads nothing from a clause naming no pair", () => {
    // Not a throw: what an empty clause means is the caller's policy, and the two callers differ.
    expect(taggedAmounts("skill level divided by 2, rounded up")).toEqual([]);
  });
});

describe("taggedLevels", () => {
  it("reads each requirement's level", () => {
    expect(taggedLevels("force [FORC] 1 and pattern [PATT] 2")).toEqual([
      { tag: "FORC", level: 1 },
      { tag: "PATT", level: 2 }
    ]);
  });

  it("passes over a clause stating no level", () => {
    expect(taggedLevels("force [FORC]")).toEqual([]);
  });
});
