import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { LayerChips } from "./LayerChips";
import { resetWorkspaceStore } from "../workspaceStore";

const draw = () => renderToStaticMarkup(<LayerChips />);

describe("the strip of controls over the map", () => {
  beforeEach(resetWorkspaceStore);

  it("holds nothing but the badge chip", () => {
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



});
