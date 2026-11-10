import { describe, expect, it } from "vitest";
import { editedOrders, ordersVersion, parseUnitWrites } from "./assistantWrites";

describe("ordersVersion", () => {
  it("is the same for the same orders and eight hex digits long", () => {
    expect(ordersVersion("work\nclaim 10")).toBe(ordersVersion("work\nclaim 10"));
    expect(ordersVersion("work")).toMatch(/^[0-9a-f]{8}$/u);
    expect(ordersVersion("")).toMatch(/^[0-9a-f]{8}$/u);
  });

  it("moves with any change to the orders", () => {
    const versions = new Set(["work", "work ", "Work", "work\n", "", "study FARM"].map(ordersVersion));

    expect(versions.size).toBe(6);
  });
});

describe("editedOrders", () => {
  it("removes the named lines and appends the added ones at the end", () => {
    expect(editedOrders("work\nclaim 10\nbuy 1 HORS", { remove: ["claim 10"], add: ["give 200 10 SILV"] })).toBe(
      "work\nbuy 1 HORS\ngive 200 10 SILV"
    );
  });

  it("matches a line to remove ignoring surrounding spaces, and removes only the first match", () => {
    expect(editedOrders("  claim 10\nwork\nclaim 10", { remove: ["claim 10 "] })).toBe("work\nclaim 10");
  });

  it("adds to a unit with no orders yet", () => {
    expect(editedOrders("", { add: ["work"] })).toBe("work");
  });

  it("answers the lines it could not find instead of guessing", () => {
    expect(editedOrders("work", { remove: ["claim 10", "work", "tax"] })).toEqual({ missing: ["claim 10", "tax"] });
  });
});

describe("parseUnitWrites", () => {
  it("reads a replace and a line edit", () => {
    expect(
      parseUnitWrites([
        { unitId: "100", version: "abcd0123", orders: "work" },
        { unitId: 101, version: "0000ffff", add: ["tax"], remove: ["work"] }
      ])
    ).toEqual([
      { unitId: "100", version: "abcd0123", orders: "work" },
      { unitId: "101", version: "0000ffff", add: ["tax"], remove: ["work"] }
    ]);
  });

  it.each([
    ["no units", [], /at least one unit/u],
    ["not a list", "100", /at least one unit/u],
    ["a unit without an id", [{ version: "a", orders: "work" }], /unitId/u],
    ["a unit without a version", [{ unitId: "100", orders: "work" }], /version/u],
    ["both orders and line edits", [{ unitId: "100", version: "a", orders: "work", add: ["tax"] }], /either/u],
    ["neither orders nor line edits", [{ unitId: "100", version: "a" }], /either/u],
    ["lines that are not text", [{ unitId: "100", version: "a", add: [1] }], /add/u],
    ["the same unit twice", [{ unitId: "100", version: "a", orders: "work" }, { unitId: "100", version: "a", add: ["tax"] }], /twice/u]
  ])("refuses %s", (_case, units, message) => {
    expect(() => parseUnitWrites(units)).toThrow(message);
  });
});
