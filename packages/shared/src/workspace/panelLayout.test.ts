import { describe, expect, it } from "vitest";
import type { PanelName } from "../workspaceStore";
import {
  clampOrdersHeight,
  clampRailWidth,
  clampUnitsHeight,
  dragOrdersHeight,
  dragRailWidth,
  dragUnitsHeight,
  ordersSlotClass,
  ordersSlotStyle,
  railHasRoomToDrag,
  railRemFor,
  railWidthStyle,
  rightColumnFloorsRem,
  rightColumnRemFor,
  ORDERS_MIN_REM,
  RAIL_GAP_REM,
  RAIL_MAX_REM,
  RAIL_MIN_REM,
  SLOT_MIN_REM,
  slotClass,
  unitsSlotClass,
  unitsSlotStyle,
  UNITS_DEFAULT_REM,
  UNITS_MAX_REM,
  UNITS_MIN_REM
} from "./panelLayout";

/** Everything open, which is where a fresh workspace starts. */
const OPEN: Record<PanelName, boolean> = {
  region: false,
  unit: false,
  orders: false,
  units: false
};

const folded = (...panels: PanelName[]): Record<PanelName, boolean> => ({
  ...OPEN,
  ...Object.fromEntries(panels.map((panel) => [panel, true]))
});

describe("slotClass", () => {
  it("gives the shared slot the slack while it is open", () => {
    expect(slotClass(OPEN)).toContain("flex-1");
  });

  it("shrinks the slot to the title bar once the panel is folded", () => {
    expect(slotClass(folded("unit"))).toBe("flex-none");
  });

  it("keeps the slack when some other panel is folded", () => {
    expect(slotClass(folded("orders", "region", "units"))).toContain("flex-1");
  });

  it("gives the shared slot a floor so a tall Movement panel cannot crush it", () => {
    // `min-h-0` is what let the slot be squeezed to 2px with the planner open.
    expect(slotClass(OPEN)).toContain("min-h-[5.75rem]");
    expect(slotClass(OPEN)).not.toContain("min-h-0");
  });

  it("writes the floor class with the same number the constant carries", () => {
    expect(slotClass(OPEN)).toContain(`min-h-[${SLOT_MIN_REM}rem]`);
  });
});

describe("rightColumnRemFor", () => {
  it("is the 249px the right-hand column actually gets at 1280x720", () => {
    // Measured from the running application: header 73px, the column 121-370, so 249px tall.
    expect(rightColumnRemFor(720, 73, 16, UNITS_DEFAULT_REM) * 16).toBeCloseTo(249, 3);
  });

  it("the right column's floors fit the pinned 1280x720 window", () => {
    expect(rightColumnFloorsRem()).toBeLessThanOrEqual(
      rightColumnRemFor(720, 73, 16, UNITS_DEFAULT_REM)
    );
  });

  it("counts both floors and the gap between them", () => {
    expect(rightColumnFloorsRem()).toBeCloseTo(SLOT_MIN_REM + RAIL_GAP_REM + ORDERS_MIN_REM, 5);
  });

  it("never goes below zero, however tall the header or the units pane", () => {
    expect(rightColumnRemFor(720, 900, 16, UNITS_DEFAULT_REM)).toBe(0);
    expect(rightColumnRemFor(720, 73, 16, 100)).toBe(0);
  });

  it("is zero rather than infinite when the root font size is nonsense", () => {
    expect(rightColumnRemFor(720, 73, 0, UNITS_DEFAULT_REM)).toBe(0);
    expect(rightColumnRemFor(720, 73, Number.NaN, UNITS_DEFAULT_REM)).toBe(0);
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

  it("hands the slot back its own class once the unit panel unfolds", () => {
    // The other half of ah-zh5i.4's claim, kept out of the browser: folding hands the column to
    // the editor and unfolding gives it back exactly the class it had, with no path through a
    // rendered pixel that a late header row can move.
    const before = ordersSlotClass(OPEN, true);

    expect(ordersSlotClass(folded("unit"), true)).toContain("flex-1");
    expect(ordersSlotClass(OPEN, true)).toBe(before);
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
    // RAIL - SLOT_MIN_REM(5.75) - RAIL_GAP_REM(0.625) = 33.625
    const result = dragOrdersHeight(19, 20, RAIL);
    expect(result.rem).toBeCloseTo(33.625, 3);
    expect(result.atLimit).toBe(true);
  });

  it("flags atLimit only when the raw value overshot", () => {
    const result = dragOrdersHeight(19, 1, RAIL);
    expect(result.atLimit).toBe(false);
  });

  it("floors to the orders minimum on a rail too short to hold both minimums", () => {
    // A rail below 15.375rem (ORDERS_MIN 9 + SLOT_MIN 5.75 + GAP 0.625) inverts the range.
    const result = dragOrdersHeight(9, 0, 12);
    expect(result.rem).toBe(9);
    expect(result.atLimit).toBe(true);
  });
});

describe("railRemFor", () => {
  it("gives the rail whatever the header leaves, in rem", () => {
    // 720px window, 64px header, 16px root: (720 - 64) / 16 = 41
    expect(railRemFor(720, 64, 16)).toBeCloseTo(41, 5);
    // A taller header leaves less: (720 - 128) / 16 = 37
    expect(railRemFor(720, 128, 16)).toBeCloseTo(37, 5);
    // A bigger type scale costs rail too, at the same pixel header: (720 - 64) / 20 = 32.8
    expect(railRemFor(720, 64, 20)).toBeCloseTo(32.8, 5);
  });

  it("never goes below zero, however tall the header", () => {
    expect(railRemFor(720, 900, 16)).toBe(0);
  });

  it("is zero rather than infinite when the root font size is nonsense", () => {
    expect(railRemFor(720, 64, 0)).toBe(0);
    expect(railRemFor(720, 64, Number.NaN)).toBe(0);
  });
});

describe("railHasRoomToDrag", () => {
  it("is true while the rail can still spare room above the unit floor", () => {
    expect(railHasRoomToDrag(41)).toBe(true);
  });

  it("is false when the header has eaten the rail", () => {
    // SLOT_MIN_REM(5.75) + RAIL_GAP_REM(0.625) = 6.375: at or below that there is nothing to drag into.
    expect(railHasRoomToDrag(6.375)).toBe(false);
    expect(railHasRoomToDrag(4)).toBe(false);
  });

  it("agrees with dragOrdersHeight's own ceiling rather than re-deriving it", () => {
    for (const railRem of [4, 6.375, 6.4, 10, 15.375, 16, 41]) {
      const stuck = dragOrdersHeight(ORDERS_MIN_REM, 100, railRem).rem <= ORDERS_MIN_REM;
      const ceilingPositive = railRem - SLOT_MIN_REM - RAIL_GAP_REM > 0;
      expect(railHasRoomToDrag(railRem)).toBe(ceilingPositive);
      // Where the seam says there is no room, a maximal drag is already pinned at the floor.
      if (!ceilingPositive) {
        expect(stuck).toBe(true);
      }
    }
  });
});

describe("ordersSlotStyle", () => {
  it("is null while no custom height is stored", () => {
    expect(ordersSlotStyle(OPEN, null)).toBeNull();
  });

  it("carries the stored height and the fit ceiling while both panels are open", () => {
    expect(ordersSlotStyle(OPEN, 24)).toEqual({
      height: "24rem",
      maxHeight: "calc(100% - 6.375rem)"
    });
  });

  it("is null once either panel folds, even with a stored height", () => {
    expect(ordersSlotStyle(folded("unit"), 24)).toBeNull();
    expect(ordersSlotStyle(folded("orders"), 24)).toBeNull();
  });

  it("hands the slot back its own height once the unit panel unfolds", () => {
    // ah-zh5i.4: the fold/unfold round trip returns the identical style object, so the height the
    // editor comes back to is decided here rather than by whatever the window happened to measure.
    const rem = 18.49609375;
    const before = ordersSlotStyle(OPEN, rem);

    expect(ordersSlotStyle(folded("unit"), rem)).toBeNull();
    expect(ordersSlotStyle(OPEN, rem)).toEqual(before);
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

describe("clampUnitsHeight", () => {
  it("treats non-finite input as no preference", () => {
    expect(clampUnitsHeight(undefined)).toBeNull();
    expect(clampUnitsHeight(null)).toBeNull();
    expect(clampUnitsHeight("nope")).toBeNull();
    expect(clampUnitsHeight(NaN)).toBeNull();
  });

  it("clamps a finite value into the stored range", () => {
    expect(clampUnitsHeight(2)).toBe(UNITS_MIN_REM);
    expect(clampUnitsHeight(500)).toBe(UNITS_MAX_REM);
    expect(clampUnitsHeight(20)).toBe(20);
  });
});

describe("dragUnitsHeight", () => {
  it("caps at seven tenths of the host", () => {
    // host 40 -> ceiling 28, below UNITS_MAX_REM.
    const result = dragUnitsHeight(20, 20, 40);
    expect(result.rem).toBe(28);
    expect(result.atLimit).toBe(true);
  });

  it("floors at one row", () => {
    const result = dragUnitsHeight(6, -5, 40);
    expect(result.rem).toBe(UNITS_MIN_REM);
    expect(result.atLimit).toBe(true);
  });

  it("lets the sanity ceiling rule when the host is unmeasurable", () => {
    const result = dragUnitsHeight(20, 1000, Infinity);
    expect(result.rem).toBe(UNITS_MAX_REM);
    expect(result.atLimit).toBe(true);
  });

  it("floors outright when the host cannot hold the floor", () => {
    // host 5 -> 70% ceiling is 3.5, under UNITS_MIN_REM, so the floor wins outright.
    const result = dragUnitsHeight(6, 0, 5);
    expect(result.rem).toBe(UNITS_MIN_REM);
    expect(result.atLimit).toBe(true);
  });

  it("flags atLimit only when the raw value overshot", () => {
    const result = dragUnitsHeight(20, 1, 40);
    expect(result.atLimit).toBe(false);
  });
});

describe("unitsSlotClass", () => {
  it("shrinks to the title bar once folded", () => {
    expect(unitsSlotClass(folded("units"), false)).toBe("flex-none");
  });

  it("carries the pinned default while no height is stored", () => {
    const className = unitsSlotClass(OPEN, false);
    expect(className).toContain("h-[20.625rem]");
    expect(className).toContain("max-h-[70%]");
    expect(className).toContain("min-h-[5.75rem]");
  });

  it("drops the pin classes for a custom height, keeping the floor", () => {
    const className = unitsSlotClass(OPEN, true);
    expect(className).not.toContain("h-[20.625rem]");
    expect(className).not.toContain("max-h-");
    expect(className).toContain("min-h-[5.75rem]");
    expect(className).toContain("flex-none");
  });

  it("stays a title bar once folded even with a custom height", () => {
    expect(unitsSlotClass(folded("units"), true)).toBe("flex-none");
  });
});

describe("unitsSlotStyle", () => {
  it("is null while no height is stored", () => {
    expect(unitsSlotStyle(OPEN, null)).toBeNull();
  });

  it("is null once folded, even with a stored height", () => {
    expect(unitsSlotStyle(folded("units"), 22)).toBeNull();
  });

  it("carries the stored height and the 70% clamp-to-fit", () => {
    expect(unitsSlotStyle(OPEN, 22)).toEqual({ height: "22rem", maxHeight: "70%" });
  });
});
