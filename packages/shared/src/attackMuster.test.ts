import { readFileSync } from "node:fs";
import { aReportRegion, aReportUnit, type ReportRegion, type ReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import {
  attacksInOrders,
  lineWarning,
  readUnitAttackOrders,
  unitRole,
  type MusterUnit
} from "./attackMuster";
import { parseGameData, type GameDataIndex } from "./gameData";

const doc = (...lines: string[]) => ["#atlantis 95", "", ...lines, "", "#end"].join("\n");

describe("reading a unit's attack and flag orders (rules/attack, rules/sequenceofevents)", () => {
  it("collects every target of every ATTACK line, repeated ones included", () => {
    const orders = readUnitAttackOrders(
      doc("unit 812", "ATTACK 1203", "@attack 1204 1205", "unit 815", "WORK"),
      "origins"
    );
    expect(orders.get("812")?.targets).toEqual(["1203", "1204", "1205"]);
    expect(orders.get("815")?.targets).toEqual([]);
  });

  it("reads the pre-combat flag orders, last one winning", () => {
    const orders = readUnitAttackOrders(
      doc("unit 820", "BEHIND 1", "AVOID 1", "AVOID 0", "HOLD 1", "NOAID 1", 'COMBAT "fire"'),
      "origins"
    );
    expect(orders.get("820")?.flags).toEqual({
      behind: true,
      avoid: false,
      hold: true,
      noAid: true,
      combatSpell: true
    });
  });

  it("leaves out comments, TURN blocks and FORM blocks, which are not this unit's month", () => {
    const orders = readUnitAttackOrders(
      doc(
        "unit 812",
        "; ATTACK 1",
        "TURN",
        "ATTACK 2",
        "BEHIND 1",
        "ENDTURN",
        "FORM 1",
        "ATTACK 3",
        "END",
        "ATTACK 4 ; the bandits"
      ),
      "origins"
    );
    expect(orders.get("812")).toEqual({ targets: ["4"], flags: {} });
  });
});

function shippedGameData(): GameDataIndex {
  const index = parseGameData(
    readFileSync(new URL("../../../config/public/ruleset.json", import.meta.url), "utf8")
  );
  if (index === null) {
    throw new Error("expected the shipped ruleset to parse");
  }
  return index;
}

const item = (tag: string, name: string, amount = 1) => ({ tag, name, amount });
const skill = (tag: string, name: string, level = 1) => ({ tag, name, level, points: 30 * level });

describe("a unit's main role in a fight", () => {
  const data = shippedGameData();

  it("is melee for a unit with a weapon that needs no skill (data/SWOR) or with Combat (data/COMB)", () => {
    expect(unitRole(aReportUnit({ items: [item("SWOR", "sword", 5)] }), false, data)).toBe("melee");
    expect(unitRole(aReportUnit({ skills: [skill("COMB", "combat")] }), false, data)).toBe("melee");
  });

  it("is ranged for a ranged weapon wielded with its skill (data/LBOW), and not without it", () => {
    const bow = [item("LBOW", "longbow", 5)];
    expect(
      unitRole(aReportUnit({ items: bow, skills: [skill("LBOW", "longbow")] }), false, data)
    ).toBe("ranged");
    expect(unitRole(aReportUnit({ items: bow }), false, data)).toBe("non-combatant");
  });

  it("is ranged for a javelin, which needs no skill (data/JAVE)", () => {
    expect(unitRole(aReportUnit({ items: [item("JAVE", "javelin")] }), false, data)).toBe("ranged");
  });

  it("is melee, ranged for a unit that can do both", () => {
    const unit = aReportUnit({
      items: [item("LBOW", "longbow")],
      skills: [skill("LBOW", "longbow"), skill("COMB", "combat")]
    });
    expect(unitRole(unit, false, data)).toBe("melee, ranged");
  });

  it("puts mage over tactician over fighter", () => {
    const fighter = { items: [item("SWOR", "sword")], skills: [skill("TACT", "tactics")] };
    expect(unitRole(aReportUnit(fighter), false, data)).toBe("tactician");
    expect(unitRole(aReportUnit(fighter), true, data)).toBe("mage");
    expect(
      unitRole(aReportUnit({ ...fighter, combatSpell: { name: "fire", tag: "FIRE" } }), false, data)
    ).toBe("mage");
  });

  it("is non-combatant with no weapon and no combat skill", () => {
    expect(unitRole(aReportUnit({ items: [item("HORS", "horse", 5)] }), false, data)).toBe(
      "non-combatant"
    );
  });

  it("knows Combat but no weapons without game data", () => {
    expect(unitRole(aReportUnit({ items: [item("SWOR", "sword")] }), false, null)).toBe(
      "non-combatant"
    );
    expect(unitRole(aReportUnit({ skills: [skill("COMB", "combat")] }), false, null)).toBe("melee");
  });
});

describe("a role that does not suit its line", () => {
  it("warns of melee in the backline, but not melee, ranged", () => {
    expect(lineWarning("melee", "backline")).toBe(
      "melee in the backline: cannot fight until the frontline falls"
    );
    expect(lineWarning("melee, ranged", "backline")).toBeNull();
    expect(lineWarning("melee", "frontline")).toBeNull();
  });

  it("warns of a non-combatant, a ranged unit, a mage or a tactician in the frontline", () => {
    expect(lineWarning("non-combatant", "frontline")).toBe(
      "non-combatant in the frontline: likely to be cut down"
    );
    for (const role of ["ranged", "mage", "tactician"] as const) {
      expect(lineWarning(role, "frontline")).toBe(
        `${role} in the frontline: could stand in the backline, safe until the frontline falls`
      );
      expect(lineWarning(role, "backline")).toBeNull();
    }
    expect(lineWarning("melee, ranged", "frontline")).toBeNull();
  });
});

describe("who of ours joins an attack (rules/com_muster)", () => {
  const data = shippedGameData();
  const points = { walk: 2, ride: 4, fly: 4 };
  const plain = { x: 12, y: 4, z: 1 };
  const north = { x: 12, y: 2, z: 1 };
  const forest = { x: 11, y: 5, z: 1 };
  const sea = { x: 13, y: 3, z: 1 };
  const exitTo = (coordinate: { x: number; y: number; z: number }, terrain: string) => ({
    direction: "north",
    terrain,
    coordinate,
    province: "Inhead",
    settlement: null
  });
  const sword = [item("SWOR", "sword", 1)];
  const walking = {
    status: "walk" as const,
    load: 0,
    fly: 0,
    ride: 0,
    walk: 100,
    capacityMode: "walk" as const,
    swim: { kind: "absent" as const }
  };
  const own = (unitId: string, name: string, men: number, more: Partial<ReportUnit> = {}) =>
    aReportUnit({ unitId, name, men, items: sword, movement: walking, ...more });
  const bandit = (unitId: string) =>
    aReportUnit({ unitId, name: "Bandits", own: false, factionId: "31", factionName: "Bandit Kings" });

  function world(options: {
    here: ReportUnit[];
    north?: ReportUnit[];
    forest?: ReportUnit[];
    sea?: ReportUnit[];
  }): ReportRegion[] {
    return [
      aReportRegion({
        coordinate: plain,
        terrain: "plain",
        units: [...options.here, bandit("1203"), bandit("1204")],
        exits: [exitTo(north, "plain"), exitTo(forest, "forest"), exitTo(sea, "ocean")]
      }),
      aReportRegion({ coordinate: north, terrain: "plain", units: options.north ?? [] }),
      aReportRegion({ coordinate: forest, terrain: "forest", units: options.forest ?? [] }),
      aReportRegion({ coordinate: sea, terrain: "ocean", units: options.sea ?? [] })
    ];
  }

  const hexLabel = (regionId: string) => {
    const [, xy] = regionId.split(":");
    const terrain = { "12,4": "Plain", "12,2": "Plain", "11,5": "Forest", "13,3": "Ocean" }[xy ?? ""];
    return `${terrain} (${xy})`;
  };

  function attacks(
    regions: ReportRegion[],
    orders: string[],
    toward: Record<string, string> = {}
  ) {
    return attacksInOrders({
      regions,
      ordersDocument: doc(...orders),
      syntax: "origins",
      declarations: { factionId: "95", toward: new Map(Object.entries(toward)), fallback: null },
      gameData: data,
      movementPoints: points,
      hexLabel
    });
  }

  const names = (units: MusterUnit[]) => units.map((unit) => unit.name);

  it("gives one row per attacking unit, naming every target, in document order", () => {
    const views = attacks(world({ here: [own("812", "Raiders", 20), own("815", "Guards", 15)] }), [
      "unit 815",
      "ATTACK 1203",
      "unit 812",
      "ATTACK 1203 1204"
    ]);
    expect(views.map((view) => [view.attackerId, view.targets])).toEqual([
      ["815", ["Bandits (1203)"]],
      ["812", ["Bandits (1203)", "Bandits (1204)"]]
    ]);
    expect(views[1]).toMatchObject({ key: "812", hex: "Plain (12,4)", attackerName: "Raiders" });
  });

  it("puts the hex's units in the front, the behind ones in the back and the avoiding ones out", () => {
    const [view] = attacks(
      world({
        here: [
          own("812", "Raiders", 20),
          own("820", "Archers", 12, { flags: ["behind"] }),
          own("821", "Swordsmen", 8),
          own("818", "Scouts", 1, { flags: ["avoiding"], items: [] }),
          own("819", "Miners", 30, { items: [] })
        ]
      }),
      ["unit 812", "ATTACK 1203", "unit 821", "BEHIND 1", "unit 819", "AVOID 1"]
    );
    expect(names(view!.frontline)).toEqual(["Raiders"]);
    expect(view!.frontline[0]!.reasons).toEqual(["gave the order"]);
    expect(names(view!.backline)).toEqual(["Archers", "Swordsmen"]);
    expect(view!.backline[0]!.reasons).toEqual([]);
    expect(view!.backline[1]).toMatchObject({
      reasons: ["set by BEHIND 1 in your orders"],
      warning: "melee in the backline: cannot fight until the frontline falls"
    });
    expect(view!.out.map((unit) => [unit.name, unit.reasons])).toEqual([
      ["Scouts", ["avoiding"]],
      ["Miners", ["avoiding — set by AVOID 1 in your orders"]]
    ]);
  });

  it("lets the attacker fight although it is avoiding, and says so", () => {
    const [view] = attacks(world({ here: [own("812", "Raiders", 20, { flags: ["avoiding"] })] }), [
      "unit 812",
      "ATTACK 1203"
    ]);
    expect(view!.frontline[0]!.reasons).toEqual([
      "gave the order, so it fights although it is avoiding"
    ]);
  });

  it("brings in neighbours that can reach, and keeps out holding ones (rules/hold)", () => {
    const [view] = attacks(
      world({
        here: [own("812", "Raiders", 20)],
        north: [own("901", "Knights", 10), own("930", "Cavalry", 12, { flags: ["holding"] })],
        forest: [own("905", "Pikemen", 16, { movement: null, flags: ["behind"] })],
        sea: [own("950", "Marines", 5)]
      }),
      ["unit 812", "ATTACK 1203"]
    );
    expect(view!.frontline.map((unit) => [unit.name, unit.reasons])).toEqual([
      ["Raiders", ["gave the order"]],
      ["Knights", ["from Plain (12,2)"]],
      ["Marines", ["from Ocean (13,3), if they can reach the battle"]]
    ]);
    expect(view!.backline.map((unit) => [unit.name, unit.reasons])).toEqual([
      ["Pikemen", ["from Forest (11,5), if they can reach the battle"]]
    ]);
    expect(view!.out.map((unit) => [unit.name, unit.reasons])).toEqual([
      ["Cavalry", ["in Plain (12,2), holding"]]
    ]);
  });

  it("keeps out neighbours that are avoiding or too loaded to move", () => {
    const [view] = attacks(
      world({
        here: [own("812", "Raiders", 20)],
        north: [
          own("901", "Knights", 10, { flags: ["avoiding"] }),
          own("902", "Wagons", 4, { movement: { ...walking, status: "overloaded" } })
        ]
      }),
      ["unit 812", "ATTACK 1203", "unit 901", "AVOID 1"]
    );
    expect(view!.out.map((unit) => [unit.name, unit.reasons])).toEqual([
      ["Knights", ["in Plain (12,2), avoiding — set by AVOID 1 in your orders"]],
      ["Wagons", ["in Plain (12,2), cannot reach the battle"]]
    ]);
  });

  it("keeps every neighbour home when every one of ours in the hex takes no aid (rules/noaid)", () => {
    const [view] = attacks(
      world({
        here: [own("812", "Raiders", 20, { flags: ["no aid"] }), own("815", "Guards", 15)],
        north: [own("901", "Knights", 10)]
      }),
      ["unit 812", "ATTACK 1203", "unit 815", "NOAID 1"]
    );
    expect(names(view!.frontline)).toEqual(["Raiders", "Guards"]);
    expect(view!.out.map((unit) => [unit.name, unit.reasons])).toEqual([
      ["Knights", ["in Plain (12,2) — none of your units in Plain (12,4) will take aid"]]
    ]);
  });

  it("names a target the report does not show in the hex (rules/com_attacking)", () => {
    const [view] = attacks(world({ here: [own("812", "Raiders", 20)] }), ["unit 812", "ATTACK 77"]);
    expect(view).toMatchObject({ targets: ["unit 77"], missingTargets: ["77"], withdraws: false });
    expect(names(view!.frontline)).toEqual(["Raiders"]);
  });

  it("withdraws from a faction we have declared an ally (rules/com_muster)", () => {
    const [view] = attacks(world({ here: [own("812", "Raiders", 20)] }), ["unit 812", "ATTACK 1203"], {
      "31": "ally"
    });
    expect(view).toMatchObject({ allies: [{ id: "31", name: "Bandit Kings" }], withdraws: true });
  });

  it("leaves out units with no men, and ATTACK orders of units the report does not show", () => {
    const views = attacks(world({ here: [own("812", "Raiders", 20), own("813", "Empty", 0)] }), [
      "unit 812",
      "ATTACK 1203",
      "unit 999",
      "ATTACK 1203"
    ]);
    expect(views.map((view) => view.attackerId)).toEqual(["812"]);
    expect(names(views[0]!.frontline)).toEqual(["Raiders"]);
  });

  it("gives each joining unit its men, its role and its line's warning", () => {
    const [view] = attacks(
      world({ here: [own("812", "Raiders", 20), own("840", "Porters", 25, { items: [] })] }),
      ["unit 812", "ATTACK 1203"]
    );
    expect(view!.frontline[1]).toMatchObject({
      unitId: "840",
      men: 25,
      role: "non-combatant",
      warning: "non-combatant in the frontline: likely to be cut down"
    });
  });
});

describe("where a mustered unit stands", () => {
  it("is the hex the report lists it in, for going to it", () => {
    const here = { x: 1, y: 1, z: 1 };
    const there = { x: 1, y: 3, z: 1 };
    const views = attacksInOrders({
      regions: [
        aReportRegion({
          coordinate: here,
          units: [aReportUnit({ unitId: "812" })],
          exits: [{ direction: "south", terrain: "mountain", coordinate: there, province: "P", settlement: null }]
        }),
        aReportRegion({ coordinate: there, units: [aReportUnit({ unitId: "901" })] })
      ],
      ordersDocument: doc("unit 812", "ATTACK 5"),
      syntax: "origins",
      declarations: { factionId: "95", toward: new Map(), fallback: null },
      gameData: null,
      movementPoints: null,
      hexLabel: (id) => id
    });
    expect(views[0]!.frontline.map((unit) => [unit.unitId, unit.regionId])).toEqual([
      ["812", "1:1,1"],
      ["901", "1:1,3"]
    ]);
  });
});
