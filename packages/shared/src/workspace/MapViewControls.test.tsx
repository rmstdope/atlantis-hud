import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { MapViewControls } from "./MapViewControls";
import { resetWorkspaceStore } from "../workspaceStore";

const draw = () =>
  renderToStaticMarkup(<MapViewControls onZoomBy={() => undefined} onFrameAll={() => undefined} />);

describe("the strip of view controls over the map", () => {
  beforeEach(resetWorkspaceStore);

  it("has no staleness or movement toggles left on it", () => {
    // Staleness and movement moved into Settings > Global (ah-l9mp): both are set once and then
    // forgotten, and the band they took is the part of the canvas the map most wants. Badges
    // stayed, because it is flicked while reading a crowded hex.
    const markup = draw();

    expect(markup).not.toContain("Staleness");
    expect(markup).not.toContain("Movement");
    expect(markup).toContain("Badges");
    expect((markup.match(/type="checkbox"/g) ?? []).length).toBe(0);
  });

  it("keeps the testid the smoke suite addresses the strip by", () => {
    expect(draw()).toContain('data-testid="layer-chips"');
  });

  it("calls the badge trigger 'Badges', with the caret hidden from the accessible name", () => {
    // The caret is decoration: read out, it becomes part of what a screen reader announces and
    // part of what a role-and-name query has to match. Every other popover trigger in this
    // workspace hides it, and the button is addressed by name from the smoke suite.
    const markup = draw();

    expect(markup).toMatch(/Badges<span aria-hidden[^>]*>▾<\/span>/);
  });

  it("says on the trigger itself whether the map is showing everything", () => {
    // Only the "everything is on" case is provable here: zustand serves its *initial* state to
    // `useSyncExternalStore`'s server snapshot, so a store changed and re-rendered under
    // `renderToStaticMarkup` comes back unchanged. That the mark lights when a badge goes off is
    // the smoke suite's to prove, against a real store in a real browser.
    expect(draw()).toContain('data-badges-all="true"');
  });




  it("holds the badge chip and the three zoom buttons, in that order", () => {
    // ah-ljil: every control that acts on the map view in one place. The zoom buttons used to sit
    // in the map's own top-right corner, which put the two halves of one job in two corners.
    const markup = draw();
    const order = ["Badges", "Zoom in", "Zoom out", "Zoom to fit"].map((label) =>
      markup.indexOf(label)
    );

    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("keeps the badge chip in a pill of its own rather than restyling it as a fourth button", () => {
    // The chip lights when the map is showing less than everything, and it reads as its own thing
    // only while it keeps its own border. The zoom buttons keep theirs.
    const markup = draw();

    expect(markup).toMatch(/Badges/);
    expect(markup).toContain('aria-label="Zoom in"');
    expect((markup.match(/class="h-7 w-7 rounded border/g) ?? []).length).toBe(3);
  });
});
