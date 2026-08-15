import { describe, expect, it } from "vitest";
import type { PanelName } from "../workspaceStore";
import {
  clampOrdersHeight,
  clampRailWidth,
  dragOrdersHeight,
  dragRailWidth,
  ordersSlotClass,
  ordersSlotStyle,
  railWidthStyle,
  RAIL_MAX_REM,
  RAIL_MIN_REM,
  unitSlotClass
} from "./panelLayout";

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
  it("keeps the pinned default while no height is stored", () => {
    expect(ordersSlotStyle(OPEN, null)).toBeNull();
    expect(ordersSlotClass(OPEN, false)).toContain("h-[19rem]");
  });

  it("holds the editor at its own height while both it and the unit panel are open", () => {
    // The unit panel is the flexible one in that arrangement, so orders must not also grow.
    expect(ordersSlotClass(OPEN, false)).toContain("h-[19rem]");
    expect(ordersSlotClass(OPEN, false)).not.toContain("flex-1");
  });

  it("hands the editor the space a folded unit panel leaves", () => {
    const className = ordersSlotClass(folded("unit"), false);
    expect(className).toContain("flex-1");
    // The pinning has to go with it, or the editor would grow to 19rem and stop.
    expect(className).not.toContain("h-[19rem]");
    expect(className).not.toContain("max-h-");
  });

  it("shrinks the slot to the title bar once the editor is folded", () => {
    expect(ordersSlotClass(folded("orders"), false)).toBe("flex-none");
  });

  it("stays a title bar when both it and the unit panel are folded", () => {
    // Nothing is left to take the space, and it goes to the map rather than to a folded panel.
    expect(ordersSlotClass(folded("orders", "unit"), false)).toBe("flex-none");
  });

  it("drops the pin classes for a custom height, keeping the floor", () => {
    const className = ordersSlotClass(OPEN, true);
    expect(className).not.toContain("h-[19rem]");
    expect(className).not.toContain("max-h-");
    expect(className).toContain("min-h-[9rem]");
    expect(className).toContain("flex-none");
  });

  it("ignores a custom height once a panel is folded", () => {
    expect(ordersSlotClass(folded("unit"), true)).toContain("flex-1");
    expect(ordersSlotClass(folded("orders"), true)).toBe("flex-none");
    expect(ordersSlotClass(folded("orders", "unit"), true)).toBe("flex-none");
  });
});

describe("clampOrdersHeight", () => {
  it("treats non-finite input as no preference", () => {
    expect(clampOrdersHeight(undefined)).toBeNull();
    expect(clampOrdersHeight(null)).toBeNull();
    expect(clampOrdersHeight("nope")).toBeNull();
    expect(clampOrdersHeight(NaN)).toBeNull();
  });

  it("clamps a finite value into the stored range", () => {
    expect(clampOrdersHeight(2.5)).toBe(9);
    expect(clampOrdersHeight(500)).toBe(60);
    expect(clampOrdersHeight(20)).toBe(20);
  });
});

describe("dragOrdersHeight", () => {
  const RAIL = 40;

  it("resolves a plain move within the rail", () => {
    const result = dragOrdersHeight(19, 2, RAIL);
    expect(result).toEqual({ rem: 21, atLimit: false });
  });

  it("clamps at the orders minimum", () => {
    const result = dragOrdersHeight(9, -5, RAIL);
    expect(result.rem).toBe(9);
    expect(result.atLimit).toBe(true);
  });

  it("clamps at the unit-panel floor on a tall rail", () => {
    // RAIL - UNIT_MIN_REM(6) - RAIL_GAP_REM(0.625) = 33.375
    const result = dragOrdersHeight(19, 20, RAIL);
    expect(result.rem).toBeCloseTo(33.375, 3);
    expect(result.atLimit).toBe(true);
  });

  it("flags atLimit only when the raw value overshot", () => {
    const result = dragOrdersHeight(19, 1, RAIL);
    expect(result.atLimit).toBe(false);
  });

  it("floors to the orders minimum on a rail too short to hold both minimums", () => {
    // A rail below 15.625rem (ORDERS_MIN 9 + UNIT_MIN 6 + GAP 0.625) inverts the range.
    const result = dragOrdersHeight(9, 0, 12);
    expect(result.rem).toBe(9);
    expect(result.atLimit).toBe(true);
  });
});

describe("ordersSlotStyle", () => {
  it("is null while no custom height is stored", () => {
    expect(ordersSlotStyle(OPEN, null)).toBeNull();
  });

  it("carries the stored height and the fit ceiling while both panels are open", () => {
    expect(ordersSlotStyle(OPEN, 24)).toEqual({
      height: "24rem",
      maxHeight: "calc(100% - 6.625rem)"
    });
  });

  it("is null once either panel folds, even with a stored height", () => {
    expect(ordersSlotStyle(folded("unit"), 24)).toBeNull();
    expect(ordersSlotStyle(folded("orders"), 24)).toBeNull();
  });
});

describe("clampRailWidth", () => {
  it("treats non-finite input as no preference", () => {
    expect(clampRailWidth(undefined)).toBeNull();
    expect(clampRailWidth(null)).toBeNull();
    expect(clampRailWidth("nope")).toBeNull();
    expect(clampRailWidth(NaN)).toBeNull();
  });

  it("clamps a finite value into the stored range", () => {
    expect(clampRailWidth(2)).toBe(RAIL_MIN_REM);
    expect(clampRailWidth(500)).toBe(RAIL_MAX_REM);
    expect(clampRailWidth(20)).toBe(20);
  });
});

describe("dragRailWidth", () => {
  it("resolves a plain move", () => {
    const result = dragRailWidth(19, 2, 100);
    expect(result).toEqual({ rem: 21, atLimit: false });
  });

  it("clamps at the rail minimum", () => {
    const result = dragRailWidth(RAIL_MIN_REM, -5, 100);
    expect(result.rem).toBe(RAIL_MIN_REM);
    expect(result.atLimit).toBe(true);
  });

  it("caps at half the host", () => {
    // hostRem 60 -> ceiling 30, below RAIL_MAX_REM.
    const result = dragRailWidth(19, 20, 60);
    expect(result.rem).toBe(30);
    expect(result.atLimit).toBe(true);
  });

  it("caps at the rail maximum on a wide host", () => {
    // hostRem 200 -> half is 100, well above RAIL_MAX_REM, so the fixed ceiling rules.
    const result = dragRailWidth(19, 100, 200);
    expect(result.rem).toBe(RAIL_MAX_REM);
    expect(result.atLimit).toBe(true);
  });

  it("flags atLimit only when the raw value overshot", () => {
    const result = dragRailWidth(19, 1, 100);
    expect(result.atLimit).toBe(false);
  });

  it("lets the fixed maximum rule when the host is unmeasurable", () => {
    const result = dragRailWidth(19, 1000, Infinity);
    expect(result.rem).toBe(RAIL_MAX_REM);
    expect(result.atLimit).toBe(true);
  });
});

describe("railWidthStyle", () => {
  it("is null while no width is stored", () => {
    expect(railWidthStyle(null)).toBeNull();
  });

  it("carries the stored width", () => {
    expect(railWidthStyle(24)).toEqual({ width: "24rem" });
  });
});
