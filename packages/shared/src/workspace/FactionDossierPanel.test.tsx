import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FactionDossier } from "../factionDossier";
import { FactionDossierPanel } from "./FactionDossierPanel";
import { findByTestId, queryByTestId } from "../testing/elementTree";

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

const panel = (overrides: Partial<Parameters<typeof FactionDossierPanel>[0]> = {}) => (
  <FactionDossierPanel
    dossier={DOSSIER}
    labelFor={labelFor}
    onHoverHex={() => {}}
    onFocusHex={() => {}}
    onSelectHex={() => {}}
    unitCount={DOSSIER.units.length}
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

  it("lists the hexes with a unit count each", () => {
    const markup = draw();
    expect(markup).toContain("hex 1:7,53");
    expect(markup).toContain("hex 1:8,54");
  });

  it("the dossier no longer lists the faction's units", () => {
    // The units dock's `Other factions` source replaces it and does it better - sorting, filtering,
    // columns, and rows that can be dragged into an Army (`ah-1mpx.5`, R2).
    const markup = draw();

    expect(markup).not.toContain("Known units");
    expect(markup).not.toContain("A unit hiding its faction is not counted here.");
    expect(markup).not.toContain("dossier-unit-101");
    expect(markup).not.toContain("Scout");
    expect(markup).not.toContain("Trader");
  });

  it("the dossier offers to show the faction's units in the list", () => {
    const onShowUnits = vi.fn();
    const row = findByTestId(panel({ onShowUnits }), "dossier-show-units");

    expect(row?.props.type).toBe("button");
    expect(draw({ onShowUnits })).toContain("Show their 3 units in the list");
    (row?.props.onClick as () => void)();
    expect(onShowUnits).toHaveBeenCalled();
  });

  it("says one unit in the singular", () => {
    expect(draw({ onShowUnits: () => {}, unitCount: 1 })).toContain(
      "Show their 1 unit in the list"
    );
  });

  it("a faction with no units this turn is offered no line", () => {
    // A line that leads to an empty table is worse than no line at all.
    expect(queryByTestId(panel({ onShowUnits: () => {}, unitCount: 0 }), "dossier-show-units")).toBeNull();
    // And with no shell to act on it - a component test - it is not drawn either.
    expect(queryByTestId(panel(), "dossier-show-units")).toBeNull();
  });

  it("states the Seen in limit, so an empty faction reads as unseen rather than as absent", () => {
    expect(draw()).toContain("Where their units are this turn. Earlier turns are not remembered.");
  });

  it("states the limit even when nothing was seen", () => {
    const markup = draw({ dossier: { ...DOSSIER, hexes: [], units: [] }, unitCount: 0 });
    expect(markup).toContain("Where their units are this turn. Earlier turns are not remembered.");
  });

  it("makes every hex and unit row a button with an accessible name", () => {
    const markup = draw();
    const buttons = markup.match(/<button[^>]*>/g) ?? [];
    // two hex rows plus the close button, at least
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const row of ["dossier-hex-1:7,53", "dossier-hex-1:8,54"]) {
      const found = findByTestId(panel(), row);
      expect(found?.props.type).toBe("button");
      expect(found?.props["aria-label"]).toMatch(/\S/);
    }
  });

  it("reports the hex a row is on down the pointer's path and the keyboard's, and nothing when the reader looks away", () => {
    const onHoverHex = vi.fn();
    const onFocusHex = vi.fn();
    const row = findByTestId(panel({ onHoverHex, onFocusHex }), "dossier-hex-1:8,54");
    (row?.props.onPointerEnter as () => void)();
    expect(onHoverHex).toHaveBeenLastCalledWith("1:8,54");
    (row?.props.onPointerLeave as () => void)();
    expect(onHoverHex).toHaveBeenLastCalledWith(null);
    // Every row is a button, so this list is tabbed through: a hover-only feature would show a
    // keyboard reader nothing at all. Focus reports down its own callback (ah-mwqa) because the map
    // treats the two differently, but both ring the hex.
    (row?.props.onFocus as () => void)();
    expect(onFocusHex).toHaveBeenLastCalledWith("1:8,54");
    (row?.props.onBlur as () => void)();
    expect(onFocusHex).toHaveBeenLastCalledWith(null);
  });

  it("selects the hex and closes when a hex row is clicked", () => {
    const onSelectHex = vi.fn();
    const onDismiss = vi.fn();
    const row = findByTestId(panel({ onSelectHex, onDismiss }), "dossier-hex-1:7,53");
    (row?.props.onClick as () => void)();
    expect(onSelectHex).toHaveBeenCalledWith("1:7,53");
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
    expect(queryByTestId(panel(), "dossier-back")).toBeNull();
  });
});

describe("a hovered row peeks; a focused row settles", () => {
  it("tells the two apart on a hex row", () => {
    const onHoverHex = vi.fn();
    const onFocusHex = vi.fn();
    const row = findByTestId(panel({ onHoverHex, onFocusHex }), "dossier-hex-1:7,53");
    (row?.props.onPointerEnter as () => void)();
    (row?.props.onFocus as () => void)();
    (row?.props.onPointerLeave as () => void)();
    (row?.props.onBlur as () => void)();
    expect(onHoverHex.mock.calls).toEqual([["1:7,53"], [null]]);
    expect(onFocusHex.mock.calls).toEqual([["1:7,53"], [null]]);
  });

});

