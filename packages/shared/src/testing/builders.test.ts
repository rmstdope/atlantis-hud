import { describe, expect, it } from "vitest";
import { aKnownMapHex } from "@atlantis/core-client";
import { hexNodeOf } from "../hexMapModel";
import { aHexNode } from "./builders";

describe("aHexNode", () => {
  it("is the screen's view of the default known hex", () => {
    expect(aHexNode()).toEqual(hexNodeOf(aKnownMapHex(), 71));
  });

  it("follows its coordinate unless the region id and label are given", () => {
    const node = aHexNode({ coordinate: { x: 1, y: 3, z: 2 } });
    expect(node.regionId).toBe("2:1,3");
    expect(node.label).toBe(hexNodeOf(aKnownMapHex({ coordinate: { x: 1, y: 3, z: 2 } }), 71).label);
    expect(aHexNode({ coordinate: { x: 1, y: 3, z: 2 }, regionId: "custom", label: "Here" })).toMatchObject({
      regionId: "custom",
      label: "Here"
    });
  });

  it("lets overrides win, shallowly", () => {
    expect(aHexNode({ knowledge: "stale", ownUnitCount: 2 })).toMatchObject({ knowledge: "stale", ownUnitCount: 2 });
  });
});
