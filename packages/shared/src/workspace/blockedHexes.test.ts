import { describe, expect, it } from "vitest";
import { aBlockedMove } from "@atlantis/core-client";
import { blockedHexes, joinNames } from "./blockedHexes";

const HEX = "1:36,50";
const unit = (moverName: string, moverId: string, guardId = "7235") =>
  aBlockedMove({ moverName, moverId, guard: { name: "Unit", id: guardId } });
const ship = (moverId: string) => aBlockedMove({ moverName: "Ship", moverId, fleet: true, guard: null });

describe("blockedHexes", () => {
  it("labels a hex with one guard by its unit number", () => {
    expect(blockedHexes([aBlockedMove()]).get(HEX)?.label).toBe("7235");
  });

  it("lists every unit one guard kept out in one sentence", () => {
    const hex = blockedHexes([unit("Scout", "3744"), unit("Drone", "9616")]).get(HEX);
    expect(hex?.sentences).toEqual(["Unit (7235) kept out Scout (3744) and Drone (9616)."]);
    expect(hex?.label).toBe("7235");
  });

  it("joins three names with commas and a final and", () => {
    const hex = blockedHexes([unit("Scout", "3744"), unit("Drone", "9616"), unit("Drone", "11854")]).get(HEX);
    expect(hex?.sentences).toEqual(["Unit (7235) kept out Scout (3744), Drone (9616) and Drone (11854)."]);
  });

  it("labels several guards by the first and a count", () => {
    const hex = blockedHexes([unit("Scout", "3744", "7235"), unit("Drone", "7181", "6082"), unit("Drone", "9662", "1354")]).get(HEX);
    expect(hex?.label).toBe("7235 +2");
    expect(hex?.sentences).toEqual([
      "Unit (7235) kept out Scout (3744).",
      "Unit (6082) kept out Drone (7181).",
      "Unit (1354) kept out Drone (9662)."
    ]);
  });

  it("labels a hex where only ships were stopped guards", () => {
    const hex = blockedHexes([ship("235")]).get(HEX);
    expect(hex?.label).toBe("guards");
    expect(hex?.sentences).toEqual(["Guards stopped Ship [235]."]);
  });

  it("lists several ships in one sentence", () => {
    expect(blockedHexes([ship("235"), ship("240")]).get(HEX)?.sentences).toEqual(["Guards stopped Ship [235] and Ship [240]."]);
    expect(blockedHexes([ship("235"), ship("240"), ship("241")]).get(HEX)?.sentences).toEqual([
      "Guards stopped Ship [235], Ship [240] and Ship [241]."
    ]);
  });

  it("puts the ship sentence last and never counts ships in +n", () => {
    const hex = blockedHexes([ship("235"), unit("Scout", "3744")]).get(HEX);
    expect(hex?.label).toBe("7235");
    expect(hex?.sentences).toEqual(["Unit (7235) kept out Scout (3744).", "Guards stopped Ship [235]."]);
  });

  it("counts a unit reported twice once", () => {
    const hex = blockedHexes([unit("Scout", "3744"), unit("Scout", "3744")]).get(HEX);
    expect(hex?.sentences).toEqual(["Unit (7235) kept out Scout (3744)."]);
  });

  it("keys each hex by its region id, level included", () => {
    const hexes = blockedHexes([aBlockedMove({ coordinate: { x: 4, y: 6, z: 2 } })]);
    expect([...hexes.keys()]).toEqual(["2:4,6"]);
    expect(hexes.get("2:4,6")?.regionId).toBe("2:4,6");
  });

  it("returns nothing for a report with no blocked move", () => {
    expect(blockedHexes([]).size).toBe(0);
  });
});

describe("joinNames", () => {
  it("reads one, two and three names", () => {
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });
});
