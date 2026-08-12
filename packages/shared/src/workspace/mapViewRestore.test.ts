import { describe, expect, it } from "vitest";
import { keepsRestoredHex, mapViewDecision, shouldFollowSelection } from "./mapViewRestore";
import type { SavedMapView } from "./mapViewportStorage";

const SAVED: SavedMapView = {
  viewport: { tx: 120, ty: -40, step: 3 },
  level: 1,
  regionId: "1:7,53"
};

/**
 * What the map does with the view it is handed.
 *
 * The decision lives outside the component because it has been wrong twice: once when a restored
 * position was overwritten by the default fit, and once when every new turn threw the position
 * away. Neither is visible in a render test, and both are one line in a table.
 */
describe("mapViewDecision", () => {
  it("restores a saved view on the level it was saved for", () => {
    expect(
      mapViewDecision({ pending: SAVED, level: 1, framedLevel: null, hasHexes: true })
    ).toEqual({ kind: "restore", viewport: SAVED.viewport });
  });

  // Blobs written before the level was stored still hold a good pan and zoom, and the level they
  // belong to is whichever one the map opens on.
  it("restores a saved view that names no level", () => {
    expect(
      mapViewDecision({
        pending: { ...SAVED, level: null },
        level: 1,
        framedLevel: null,
        hasHexes: true
      })
    ).toEqual({ kind: "restore", viewport: SAVED.viewport });
  });

  // The shell applies the saved level as the game is entered, so the two normally agree by now.
  // Where they cannot - a saved level this game no longer draws - the shell moves the level
  // afterwards and the fit below lands over the top. Waiting for a match instead would strand the
  // map at the origin, because that match would never come.
  it("restores a saved view rather than waiting for the level to agree", () => {
    expect(
      mapViewDecision({ pending: SAVED, level: 2, framedLevel: null, hasHexes: true })
    ).toEqual({ kind: "restore", viewport: SAVED.viewport });
  });

  it("fits over a restored view once the level is corrected", () => {
    // The restore has been consumed by then, and the corrected level has never been framed.
    expect(
      mapViewDecision({ pending: null, level: 1, framedLevel: 2, hasHexes: true })
    ).toEqual({ kind: "fit" });
  });

  it("fits when there is no saved view and this level has not been framed", () => {
    expect(
      mapViewDecision({ pending: null, level: 1, framedLevel: null, hasHexes: true })
    ).toEqual({ kind: "fit" });
  });

  it("fits when a saved record holds a focus but no viewport", () => {
    expect(
      mapViewDecision({
        pending: { viewport: null, level: 1, regionId: "1:7,53" },
        level: 1,
        framedLevel: null,
        hasHexes: true
      })
    ).toEqual({ kind: "fit" });
  });

  it("fits when the level changes to one that has not been framed", () => {
    expect(
      mapViewDecision({ pending: null, level: 2, framedLevel: 1, hasHexes: true })
    ).toEqual({ kind: "fit" });
  });

  // The point of the whole guard: a turn landing in the open game changes the model, and the
  // player is still looking at the same level they framed. Re-fitting would throw their view away.
  it("holds the view when this level has already been framed", () => {
    expect(
      mapViewDecision({ pending: null, level: 1, framedLevel: 1, hasHexes: true })
    ).toEqual({ kind: "hold" });
  });

  // A game with no report yet has nothing to frame. Fitting an empty level would frame nowhere and
  // count as framed, so the first report to arrive would never be framed at all.
  it("holds when there is nothing on this level to frame", () => {
    expect(
      mapViewDecision({ pending: null, level: 1, framedLevel: null, hasHexes: false })
    ).toEqual({ kind: "hold" });
  });
});

/**
 * Whether the map should travel to the selection.
 *
 * It should, whenever the player picks a hex from somewhere other than the map. It should not for
 * the one hex that was put back by the restore: the saved view is where the player left the map,
 * and pulling it to a selection they had already panned away from is exactly the reset this is
 * about.
 */
describe("shouldFollowSelection", () => {
  it("does not follow the hex the saved view was restored with", () => {
    expect(shouldFollowSelection("1:7,53", "1:7,53")).toBe(false);
  });

  it("follows a hex picked after the restore", () => {
    expect(shouldFollowSelection("1:9,41", "1:7,53")).toBe(true);
  });

  it("follows when no view was restored", () => {
    expect(shouldFollowSelection("1:7,53", null)).toBe(true);
  });

  it("has nowhere to follow when nothing is selected", () => {
    expect(shouldFollowSelection(null, "1:7,53")).toBe(false);
  });
});

/**
 * When the exemption ends.
 *
 * Asked separately because it has to end on a path that follows nothing: changing level clears the
 * selection outright, and a hex still exempt after that would be one the map refuses to travel to
 * when the player picks it again.
 */
describe("keepsRestoredHex", () => {
  it("keeps the exemption while the restored hex is the one selected", () => {
    expect(keepsRestoredHex("1:7,53", "1:7,53")).toBe(true);
  });

  it("ends the exemption when the selection moves elsewhere", () => {
    expect(keepsRestoredHex("1:9,41", "1:7,53")).toBe(false);
  });

  it("ends the exemption when the selection is cleared, as changing level does", () => {
    expect(keepsRestoredHex(null, "1:7,53")).toBe(false);
  });

  it("has no exemption to keep when nothing was restored", () => {
    expect(keepsRestoredHex(null, null)).toBe(false);
  });
});
