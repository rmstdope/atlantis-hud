import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseBuildingReference,
  parseItemReference,
  parseSkillReference,
  RulesetScrapeError
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
    expect(skills.CRRI.cast).toEqual({ costs: [{ tag: "SILV", amount: 600 }], transmute: {} });
  });

  it("reads an item cost with no number as one", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "enchant swords [ESWO] 1: ... via magic at a cost of sword [SWOR]."
    expect(skills.ESWO.cast).toEqual({ costs: [{ tag: "SWOR", amount: 1 }], transmute: {} });
  });

  it("reads several inputs joined by and, stated on a later level", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "summon wind [SWIN] 3: ... via magic at a cost of 75 floater hides [FLOA] and 75 ironwood
    //  [IRWD]." - the cost is on level 3, not level 1, and the fold has to keep it.
    expect(skills.SWIN.cast).toEqual({
      costs: [
        { tag: "FLOA", amount: 75 },
        { tag: "IRWD", amount: 75 }
      ],
      transmute: {}
    });
  });

  it("reads the attempt cost of construct gate", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "construct gate [CGAT] 1: ... the attempt costs 1000 silver."
    expect(skills.CGAT.cast).toEqual({ costs: [{ tag: "SILV", amount: 1000 }], transmute: {} });
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
   * What a skill may PRODUCE, read from the "may PRODUCE ... at a rate of ..." sentences ah-bai.2
   * will use to narrow the PRODUCE completion popup to what the unit standing in the hex can
   * actually make. Most skills state no production at all, which is why `produces` is checked
   * against fact for every skill that does, rather than sampled.
   */
  it("reads what a skill may produce", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "mining [MINI] 1: ... A unit with this skill may PRODUCE iron [IRON] at a rate of 1 per
    //  man-month."
    expect(skills.MINI.produces).toContainEqual({ tag: "IRON", level: 1 });
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
    expect(skills.MINI.produces).toEqual([
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
    expect(skills.COOK.produces).toEqual([{ tag: "MEAL", level: 1 }]);
  });

  it("reads several products in one sentence", () => {
    const skills = parseSkillReference(DATA_HTML);

    // "fishing [FISH] 1: ... may PRODUCE fish [FISH] at a rate of 1 per man-month and nets [NET]
    //  from herb [HERB] at a rate of 1 per man-month."
    expect(skills.FISH.produces.filter((p) => p.level === 1)).toEqual([
      { tag: "FISH", level: 1 },
      { tag: "NET", level: 1 }
    ]);
  });

  it("fails loudly on a production it cannot read", () => {
    const html =
      "<html><body><pre>broken [BROK] 1: A unit with this skill may PRODUCE something odd " +
      "at a rate of 1 per man-month.</pre></body></html>";

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
    // A trade structure is a building the page never fortifies, and the catalogue stays silent
    // about it rather than claiming it seats nobody.
    expect(buildings.MINE).toBeUndefined();
    expect(buildings["ROAD SE"]).toBeUndefined();
    expect(buildings.MINING).toBeUndefined();
    expect(buildings.BUILDING).toBeUndefined();
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
    expect(buildings.TOWER).toEqual({ size: 10, cost: 10, materials: ["stone"], mages: 0 });
  });
});
