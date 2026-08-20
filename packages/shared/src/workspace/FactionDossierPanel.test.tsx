import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FactionDossier } from "../factionDossier";
import { FactionDossierPanel } from "./FactionDossierPanel";

const labelFor = (regionId: string) => `hex ${regionId}`;

const DOSSIER: FactionDossier = {
  id: "2",
  name: "Creatures",
  attitude: "hostile",
  hexes: [
    { regionId: "1:7,53", unitCount: 2 },
    { regionId: "1:8,54", unitCount: 1 }
  ],
  units: [
    { unitId: "101", name: "Scout", regionId: "1:7,53" },
    { unitId: "102", name: "Guard", regionId: "1:7,53" },
    { unitId: "104", name: "Trader", regionId: "1:8,54" }
  ]
};

/**
 * Finds the first element in an unrendered React element tree carrying the given `data-testid` -
 * the same walk `TradePanel.test.tsx` uses, and for the same reason: this package has no jsdom, so
 * a hover or a click is exercised by calling the button's own prop rather than dispatching an event.
 */
function findByTestId(node: unknown, testId: string): { props: Record<string, unknown> } | null {
  if (node === null || typeof node !== "object") {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child, testId);
      if (found) {
        return found;
      }
    }
    return null;
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.props?.["data-testid"] === testId) {
    return element as { props: Record<string, unknown> };
  }
  if (typeof element.type === "function") {
    return findByTestId((element.type as (props: unknown) => unknown)(element.props), testId);
  }
  return findByTestId(element.props?.children, testId);
}

const panel = (overrides: Partial<Parameters<typeof FactionDossierPanel>[0]> = {}) => (
  <FactionDossierPanel
    dossier={DOSSIER}
    labelFor={labelFor}
    onHoverHex={() => {}}
    onSelectHex={() => {}}
    onSelectUnit={() => {}}
    onDismiss={() => {}}
    {...overrides}
  />
);

const draw = (overrides: Partial<Parameters<typeof FactionDossierPanel>[0]> = {}) =>
  renderToStaticMarkup(panel(overrides));

describe("FactionDossierPanel", () => {
  it("names the faction and the attitude declared toward it", () => {
    const markup = draw();
    expect(markup).toContain("Creatures");
    expect(markup).toContain("(2)");
    expect(markup).toContain("hostile");
  });

  it("says the attitude is not declared when the report never names one", () => {
    expect(draw({ dossier: { ...DOSSIER, attitude: null } })).toContain("not declared");
  });

  it("lists the hexes with a unit count each, and the known units", () => {
    const markup = draw();
    expect(markup).toContain("hex 1:7,53");
    expect(markup).toContain("hex 1:8,54");
    expect(markup).toContain("Scout");
    expect(markup).toContain("Trader");
    expect(markup).toContain("101");
  });

  it("states both limits, so an empty faction reads as unseen rather than as absent", () => {
    const markup = draw();
    expect(markup).toContain("Where their units are this turn. Earlier turns are not remembered.");
    expect(markup).toContain("A unit hiding its faction is not counted here.");
  });

  it("states the limits even when nothing was seen", () => {
    const markup = draw({ dossier: { ...DOSSIER, hexes: [], units: [] } });
    expect(markup).toContain("Where their units are this turn. Earlier turns are not remembered.");
    expect(markup).toContain("A unit hiding its faction is not counted here.");
  });

  it("makes every hex and unit row a button with an accessible name", () => {
    const markup = draw();
    const buttons = markup.match(/<button[^>]*>/g) ?? [];
    // three hex/unit rows plus the close button, at least
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    for (const row of ["dossier-hex-1:7,53", "dossier-unit-101"]) {
      const found = findByTestId(panel(), row);
      expect(found?.props.type).toBe("button");
      expect(found?.props["aria-label"]).toMatch(/\S/);
    }
  });

  it("reports the hex a row is on, on hover AND on focus, and nothing when the reader looks away", () => {
    const onHoverHex = vi.fn();
    const row = findByTestId(panel({ onHoverHex }), "dossier-hex-1:8,54");
    (row?.props.onPointerEnter as () => void)();
    expect(onHoverHex).toHaveBeenLastCalledWith("1:8,54");
    (row?.props.onPointerLeave as () => void)();
    expect(onHoverHex).toHaveBeenLastCalledWith(null);
    // Every row is a button, so this list is tabbed through: a hover-only feature would show a
    // keyboard reader nothing at all.
    (row?.props.onFocus as () => void)();
    expect(onHoverHex).toHaveBeenLastCalledWith("1:8,54");
    (row?.props.onBlur as () => void)();
    expect(onHoverHex).toHaveBeenLastCalledWith(null);
  });

  it("reports the hex a unit stands in when its row is hovered or focused", () => {
    const onHoverHex = vi.fn();
    const row = findByTestId(panel({ onHoverHex }), "dossier-unit-104");
    (row?.props.onPointerEnter as () => void)();
    expect(onHoverHex).toHaveBeenLastCalledWith("1:8,54");
    (row?.props.onFocus as () => void)();
    expect(onHoverHex).toHaveBeenLastCalledWith("1:8,54");
  });

  it("selects the hex and closes when a hex row is clicked", () => {
    const onSelectHex = vi.fn();
    const onDismiss = vi.fn();
    const row = findByTestId(panel({ onSelectHex, onDismiss }), "dossier-hex-1:7,53");
    (row?.props.onClick as () => void)();
    expect(onSelectHex).toHaveBeenCalledWith("1:7,53");
    expect(onDismiss).toHaveBeenCalled();
  });

  it("selects the unit and closes when a unit row is clicked", () => {
    const onSelectUnit = vi.fn();
    const onDismiss = vi.fn();
    const row = findByTestId(panel({ onSelectUnit, onDismiss }), "dossier-unit-102");
    (row?.props.onClick as () => void)();
    expect(onSelectUnit).toHaveBeenCalledWith("102");
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("the way back, when the dossier replaced the faction popover's contents", () => {
  it("offers a back control that returns rather than closing outright", () => {
    const onBack = vi.fn();
    const onDismiss = vi.fn();
    const back = findByTestId(panel({ onBack, onDismiss }), "dossier-back");
    expect(back?.props.type).toBe("button");
    (back?.props.onClick as () => void)();
    expect(onBack).toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("offers no back control when the dossier stands on its own", () => {
    expect(findByTestId(panel(), "dossier-back")).toBeNull();
  });
});
