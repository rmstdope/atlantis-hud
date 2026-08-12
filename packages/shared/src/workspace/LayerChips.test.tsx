import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { LayerChips } from "./LayerChips";
import { resetWorkspaceStore } from "../workspaceStore";

const draw = (levels = [1]) => renderToStaticMarkup(<LayerChips levels={levels} />);

describe("the strip of controls over the map", () => {
  beforeEach(resetWorkspaceStore);

  it("keeps only what is not a badge as a chip of its own", () => {
    // Units and structures went into the badge popover: each spoke for a whole family of marks,
    // and ten checkboxes will not fit in a strip that shares the map's top band with the zoom
    // cluster. What is left here is what the badges do not cover.
    const markup = draw();

    expect(markup).toContain("Staleness");
    expect(markup).toContain("Movement");
    expect((markup.match(/type="checkbox"/g) ?? []).length).toBe(2);
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
