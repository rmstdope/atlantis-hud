import { describe, expect, it } from "vitest";
import {
  keepsRestoredHex,
  mapViewCommitted,
  mapViewDecision,
  mapViewOpened,
  mapViewSelectionChanged,
  NO_MAP_VIEW,
  shouldFollowSelection,
  travelsToSelection,
  type MapViewState
} from "./mapViewState";
import type { SavedMapView } from "./mapViewportStorage";

const GAME = "g1";

const SAVED: SavedMapView = {
  viewport: { tx: 120, ty: -40, step: 3 },
  level: 1,
  regionId: "1:7,53"
};

/** A view for `GAME`, with a viewport pending and a given framed level. */
function viewWith(pendingViewport: MapViewState["viewport"], framedLevel: number | null): MapViewState {
  return {
    gameId: GAME,
    viewport: null,
    pendingViewport,
    framedLevel,
    restoredRegionId: null
  };
}

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
      mapViewDecision({
        view: viewWith(SAVED.viewport, null),
        gameId: GAME,
        level: 1,
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
      mapViewDecision({
        view: viewWith(SAVED.viewport, null),
        gameId: GAME,
        level: 2,
        hasHexes: true
      })
    ).toEqual({ kind: "restore", viewport: SAVED.viewport });
  });

  it("fits over a restored view once the level is corrected", () => {
    // The restore has been consumed by then, and the corrected level has never been framed.
    expect(
      mapViewDecision({ view: viewWith(null, 2), gameId: GAME, level: 1, hasHexes: true })
    ).toEqual({ kind: "fit" });
  });

  it("fits when there is no saved view and this level has not been framed", () => {
    expect(
      mapViewDecision({ view: viewWith(null, null), gameId: GAME, level: 1, hasHexes: true })
    ).toEqual({ kind: "fit" });
  });

  it("fits when the level changes to one that has not been framed", () => {
    expect(
      mapViewDecision({ view: viewWith(null, 1), gameId: GAME, level: 2, hasHexes: true })
    ).toEqual({ kind: "fit" });
  });

  // The point of the whole guard: a turn landing in the open game changes the model, and the
  // player is still looking at the same level they framed. Re-fitting would throw their view away.
  it("holds the view when this level has already been framed", () => {
    expect(
      mapViewDecision({ view: viewWith(null, 1), gameId: GAME, level: 1, hasHexes: true })
    ).toEqual({ kind: "hold" });
  });

  // A game with no report yet has nothing to frame. Fitting an empty level would frame nowhere and
  // count as framed, so the first report to arrive would never be framed at all.
  it("holds when there is nothing on this level to frame", () => {
    expect(
      mapViewDecision({ view: viewWith(null, null), gameId: GAME, level: 1, hasHexes: false })
    ).toEqual({ kind: "hold" });
  });

  // A view left over from another game is not this game's view: its framed level says nothing
  // about whether this game's current level has been framed.
  it("fits when the view belongs to a different game", () => {
    expect(
      mapViewDecision({
        view: viewWith(null, 1),
        gameId: "g2",
        level: 1,
        hasHexes: true
      })
    ).toEqual({ kind: "fit" });
  });

  // The strip a fit is computed against is measured, not assumed: fitting before it is known is
  // exactly the one-shot-against-a-too-small-strip mistake ah-2r3 paid two hours for. Defaults to
  // `true` in the fixture above (via `viewWith`'s callers), so every other case in this describe
  // block is unaffected.
  it("waits for the strip before the first fit, but restores without it", () => {
    expect(
      mapViewDecision({
        view: viewWith(null, null),
        gameId: GAME,
        level: 1,
        hasHexes: true,
        stripKnown: false
      })
    ).toEqual({ kind: "hold" });

    expect(
      mapViewDecision({
        view: viewWith(SAVED.viewport, null),
        gameId: GAME,
        level: 1,
        hasHexes: true,
        stripKnown: false
      })
    ).toEqual({ kind: "restore", viewport: SAVED.viewport });
  });
});

/**
 * The map view's transitions.
 *
 * Each is a pure function from one state to the next, so the decisions above can be tested against
 * plain data rather than against refs and effect order.
 */
describe("the map view's transitions", () => {
  it("opens on a saved view: pending viewport and restored hex, nothing framed yet", () => {
    expect(mapViewOpened(GAME, SAVED)).toEqual({
      gameId: GAME,
      viewport: null,
      pendingViewport: SAVED.viewport,
      framedLevel: null,
      restoredRegionId: SAVED.regionId
    });
  });

  it("opens with nothing saved: every field but the game id is null", () => {
    expect(mapViewOpened(GAME, null)).toEqual({ ...NO_MAP_VIEW, gameId: GAME });
  });

  it("a saved record with a focus but no viewport opens with nothing pending", () => {
    const saved: SavedMapView = { viewport: null, level: 1, regionId: "1:7,53" };
    expect(mapViewOpened(GAME, saved)).toEqual({
      gameId: GAME,
      viewport: null,
      pendingViewport: null,
      framedLevel: null,
      restoredRegionId: "1:7,53"
    });
  });

  it("commits a viewport: sets it, spends the pending one, frames the level", () => {
    const opened = mapViewOpened(GAME, SAVED);
    const committed = mapViewCommitted(opened, { tx: 1, ty: 2, step: 0 }, 1);

    expect(committed).toEqual({
      gameId: GAME,
      viewport: { tx: 1, ty: 2, step: 0 },
      pendingViewport: null,
      framedLevel: 1,
      restoredRegionId: SAVED.regionId
    });
  });

  it("a selection on the restored hex keeps the exemption, and the same object", () => {
    const opened = mapViewOpened(GAME, SAVED);
    expect(mapViewSelectionChanged(opened, SAVED.regionId)).toBe(opened);
  });

  it("a selection elsewhere ends the exemption", () => {
    const opened = mapViewOpened(GAME, SAVED);
    expect(mapViewSelectionChanged(opened, "1:9,41").restoredRegionId).toBeNull();
  });

  it("clearing the selection ends the exemption too, as changing level does", () => {
    const opened = mapViewOpened(GAME, SAVED);
    expect(mapViewSelectionChanged(opened, null).restoredRegionId).toBeNull();
  });

  it("has no exemption to end when nothing was restored", () => {
    const opened = mapViewOpened(GAME, null);
    expect(mapViewSelectionChanged(opened, "1:9,41")).toBe(opened);
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

/**
 * Whether the follow-selection effect should travel now.
 *
 * The effect also depends on `size` and `insets` so it can measure "off screen" once it decides to
 * travel, and a container that resizes mid-import re-runs it for a reason that has nothing to do
 * with the selection. `travelsToSelection` is what tells a genuine arrival apart from a resize: the
 * same (selectedRegionId, restoredRegionId) pair as last time is not a new arrival, whatever the
 * layout just did.
 */
describe("travelsToSelection", () => {
  it("travels to a selection that has just arrived", () => {
    expect(
      travelsToSelection(
        { selectedRegionId: "1:9,41", restoredRegionId: null, pickEpoch: 0 },
        { selectedRegionId: "1:7,53", restoredRegionId: null, pickEpoch: 0 }
      )
    ).toBe(true);
  });

  it("does not travel again for the same selection", () => {
    expect(
      travelsToSelection(
        { selectedRegionId: "1:9,41", restoredRegionId: null, pickEpoch: 0 },
        { selectedRegionId: "1:9,41", restoredRegionId: null, pickEpoch: 0 }
      )
    ).toBe(false);
  });

  it("does not travel to the hex a restore put back", () => {
    expect(
      travelsToSelection(
        { selectedRegionId: "1:7,53", restoredRegionId: "1:7,53", pickEpoch: 0 },
        { selectedRegionId: null, restoredRegionId: null, pickEpoch: 0 }
      )
    ).toBe(false);
  });

  it("travels once the restore exemption ends", () => {
    expect(
      travelsToSelection(
        { selectedRegionId: "1:7,53", restoredRegionId: null, pickEpoch: 0 },
        { selectedRegionId: "1:7,53", restoredRegionId: "1:7,53", pickEpoch: 0 }
      )
    ).toBe(true);
  });

  it("does not travel when nothing is selected", () => {
    expect(
      travelsToSelection(
        { selectedRegionId: null, restoredRegionId: "1:7,53", pickEpoch: 0 },
        { selectedRegionId: null, restoredRegionId: "1:7,53", pickEpoch: 0 }
      )
    ).toBe(false);
  });

  it("travels when the player picks the hex already selected", () => {
    expect(
      travelsToSelection(
        { selectedRegionId: "1:7,53", restoredRegionId: null, pickEpoch: 4 },
        { selectedRegionId: "1:7,53", restoredRegionId: null, pickEpoch: 3 }
      )
    ).toBe(true);
  });

  it("does not travel when nothing changed, pick epoch included", () => {
    expect(
      travelsToSelection(
        { selectedRegionId: "1:7,53", restoredRegionId: null, pickEpoch: 3 },
        { selectedRegionId: "1:7,53", restoredRegionId: null, pickEpoch: 3 }
      )
    ).toBe(false);
  });

  it("does not travel for the restored hex without a pick", () => {
    expect(
      travelsToSelection(
        { selectedRegionId: "1:7,53", restoredRegionId: "1:7,53", pickEpoch: 3 },
        { selectedRegionId: "1:7,53", restoredRegionId: "1:7,53", pickEpoch: 2 }
      )
    ).toBe(false);
  });
});
