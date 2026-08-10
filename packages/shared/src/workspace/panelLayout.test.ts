import { describe, expect, it } from "vitest";
import type { PanelName } from "../workspaceStore";
import { ordersSlotClass, unitSlotClass } from "./panelLayout";

/** Everything open, which is where a fresh workspace starts. */
const OPEN: Record<PanelName, boolean> = {
  region: false,
  unit: false,
  orders: false,
  units: false,
  planner: false
};

const folded = (...panels: PanelName[]): Record<PanelName, boolean> => ({
  ...OPEN,
  ...Object.fromEntries(panels.map((panel) => [panel, true]))
});

describe("unitSlotClass", () => {
  it("gives the unit panel the slack while it is open", () => {
    expect(unitSlotClass(OPEN)).toContain("flex-1");
  });

  it("shrinks the slot to the title bar once the panel is folded", () => {
    expect(unitSlotClass(folded("unit"))).toBe("flex-none");
  });

  it("keeps the slack when some other panel is folded", () => {
    expect(unitSlotClass(folded("orders", "region", "units"))).toContain("flex-1");
  });
});

describe("ordersSlotClass", () => {
  it("holds the editor at its own height while both it and the unit panel are open", () => {
    // The unit panel is the flexible one in that arrangement, so orders must not also grow.
    expect(ordersSlotClass(OPEN)).toContain("h-[19rem]");
    expect(ordersSlotClass(OPEN)).not.toContain("flex-1");
  });

  it("hands the editor the space a folded unit panel leaves", () => {
    const className = ordersSlotClass(folded("unit"));
    expect(className).toContain("flex-1");
    // The pinning has to go with it, or the editor would grow to 19rem and stop.
    expect(className).not.toContain("h-[19rem]");
    expect(className).not.toContain("max-h-");
  });

  it("shrinks the slot to the title bar once the editor is folded", () => {
    expect(ordersSlotClass(folded("orders"))).toBe("flex-none");
  });

  it("stays a title bar when both it and the unit panel are folded", () => {
    // Nothing is left to take the space, and it goes to the map rather than to a folded panel.
    expect(ordersSlotClass(folded("orders", "unit"))).toBe("flex-none");
  });
});
