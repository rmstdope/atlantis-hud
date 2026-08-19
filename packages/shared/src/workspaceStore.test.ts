import { beforeEach, describe, expect, it } from "vitest";
import { BADGES } from "./workspace/mapThemes/hexView";
import { badgesFromStorage, resetWorkspaceStore, useWorkspaceStore } from "./workspaceStore";

const store = () => useWorkspaceStore.getState();

describe("changing the open game's ruleset", () => {
  beforeEach(resetWorkspaceStore);

  it("updates the ruleset without abandoning the selection", () => {
    // A ruleset change is not a game switch: the hex and unit the player is looking at are still
    // there, and wiping them would make the settings dialog feel like a reload.
    store().openGame({
      gameId: "g1",
      gameName: "Spring campaign",
      databasePath: "idb://g1",
      rulesetId: "neworigins"
    }, null);
    store().selectRegion("1:7,53", "18642");

    store().updateGameRuleset("magicdeep");

    expect(store().game?.rulesetId).toBe("magicdeep");
    expect(store().selectedRegionId).toBe("1:7,53");
    expect(store().selectedUnitId).toBe("18642");
  });

  it("does nothing when no game is open", () => {
    store().updateGameRuleset("magicdeep");

    expect(store().game).toBeNull();
  });
});

describe("renaming the open game", () => {
  beforeEach(resetWorkspaceStore);

  it("updates the name without abandoning the selection", () => {
    // A rename is not a game switch: the hex and unit the player is looking at are still there.
    store().openGame({
      gameId: "g1",
      gameName: "Spring campaign",
      databasePath: "idb://g1",
      rulesetId: "neworigins"
    }, null);
    store().selectRegion("1:7,53", "18642");

    store().updateGameName("Binding of the North");

    expect(store().game?.gameName).toBe("Binding of the North");
    expect(store().selectedRegionId).toBe("1:7,53");
    expect(store().selectedUnitId).toBe("18642");
  });

  it("does nothing when no game is open", () => {
    store().updateGameName("Binding of the North");

    expect(store().game).toBeNull();
  });
});

describe("workspace selection", () => {
  beforeEach(resetWorkspaceStore);

  it("abandons the selected unit when the hex changes", () => {
    // Keeping it would leave the detail panel describing a unit no longer in the list.
    store().selectRegion("1:7,53");
    store().selectUnit("18642");
    expect(store().selectedUnitId).toBe("18642");

    store().selectRegion("1:26,52");

    expect(store().selectedRegionId).toBe("1:26,52");
    expect(store().selectedUnitId).toBeNull();
  });

  it("selects the unit the caller nominates for the new hex", () => {
    // Landing on a hex with nothing selected leaves the detail and orders panels blank for no
    // reason, so the caller passes the first unit standing there.
    store().selectRegion("1:7,53", "18642");
    expect(store().selectedUnitId).toBe("18642");

    store().selectRegion("1:26,52", "13401");
    expect(store().selectedRegionId).toBe("1:26,52");
    expect(store().selectedUnitId).toBe("13401");
  });

  it("selects nothing when the new hex holds no units", () => {
    store().selectRegion("1:7,53", "18642");
    store().selectRegion("1:7,51");
    expect(store().selectedUnitId).toBeNull();
  });

  it("keeps the selected unit when the same hex is chosen again", () => {
    store().selectRegion("1:7,53");
    store().selectUnit("18642");

    store().selectRegion("1:7,53");

    expect(store().selectedUnitId).toBe("18642");
  });

  it("clears both selections when the level changes", () => {
    store().selectRegion("1:7,53");
    store().selectUnit("18642");

    store().setLevel(2);

    expect(store().level).toBe(2);
    expect(store().selectedRegionId).toBeNull();
    expect(store().selectedUnitId).toBeNull();
  });

  it("keeps selections when the same level is chosen again", () => {
    store().selectRegion("1:7,53");
    store().setLevel(1);
    expect(store().selectedRegionId).toBe("1:7,53");
  });

  it("clears selections when a game is opened", () => {
    store().selectRegion("1:7,53");
    store().selectUnit("18642");

    store().openGame({
      gameId: "aug-2026",
      gameName: "NewOrigins Aug 2026",
      databasePath: "/p.sqlite",
      rulesetId: "neworigins"
    }, null);

    expect(store().game?.gameName).toBe("NewOrigins Aug 2026");
    expect(store().selectedRegionId).toBeNull();
    expect(store().selectedUnitId).toBeNull();
  });
});

describe("the selection epoch that drives the lock-on pulse", () => {
  beforeEach(resetWorkspaceStore);

  it("bumps selectionEpoch, restore and re-selection do not", () => {
    expect(store().selectionEpoch).toBe(0);

    store().selectRegion("1:7,53");
    expect(store().selectionEpoch).toBe(1);

    // Re-selecting the same hex is the store's existing no-op branch; it must not pulse either.
    store().selectRegion("1:7,53");
    expect(store().selectionEpoch).toBe(1);

    // A restored selection (app load) is not a user-initiated change, so it must not pulse.
    store().restoreSelection("1:26,52");
    expect(store().selectedRegionId).toBe("1:26,52");
    expect(store().selectionEpoch).toBe(1);

    // A genuine further selection still bumps.
    store().selectRegion("1:7,51");
    expect(store().selectionEpoch).toBe(2);

    // setLevel resets the epoch along with the selection.
    store().setLevel(2);
    expect(store().selectionEpoch).toBe(0);
  });

  it("resets on openGame and closeGame", () => {
    store().selectRegion("1:7,53");
    expect(store().selectionEpoch).toBe(1);

    store().openGame({
      gameId: "g1",
      gameName: "Spring campaign",
      databasePath: "idb://g1",
      rulesetId: "neworigins"
    }, null);
    expect(store().selectionEpoch).toBe(0);

    store().selectRegion("1:7,53");
    expect(store().selectionEpoch).toBe(1);

    store().closeGame();
    expect(store().selectionEpoch).toBe(0);
  });

  it("clears the selected unit on restore, like selectRegion does with no default", () => {
    store().selectRegion("1:7,53", "18642");
    expect(store().selectedUnitId).toBe("18642");

    store().restoreSelection("1:26,52");

    expect(store().selectedUnitId).toBeNull();
  });
});

describe("the map view (ah-ian)", () => {
  beforeEach(resetWorkspaceStore);

  const GAME = {
    gameId: "g1",
    gameName: "Spring campaign",
    databasePath: "idb://g1",
    rulesetId: "neworigins"
  };
  const SAVED = { viewport: { tx: 5, ty: 6, step: 1 }, level: 2, regionId: "1:7,53" };

  it("has no view before any game is open", () => {
    expect(store().mapView).toEqual({
      gameId: null,
      viewport: null,
      pendingViewport: null,
      framedLevel: null,
      restoredRegionId: null
    });
  });

  it("opening a game on a saved view sets the level, the hex and the pending viewport together", () => {
    store().openGame(GAME, SAVED);

    expect(store().level).toBe(2);
    expect(store().selectedRegionId).toBe("1:7,53");
    expect(store().mapView).toEqual({
      gameId: "g1",
      viewport: null,
      pendingViewport: SAVED.viewport,
      framedLevel: null,
      restoredRegionId: "1:7,53"
    });
  });

  it("opening a game with nothing saved uses the default level and no selection", () => {
    store().openGame(GAME, null);

    expect(store().level).toBe(1);
    expect(store().selectedRegionId).toBeNull();
    expect(store().mapView.gameId).toBe("g1");
    expect(store().mapView.pendingViewport).toBeNull();
  });

  it("commitMapView records the viewport and frames the level", () => {
    store().openGame(GAME, SAVED);

    store().commitMapView({ tx: 1, ty: 1, step: 2 }, 2);

    expect(store().mapView.viewport).toEqual({ tx: 1, ty: 1, step: 2 });
    expect(store().mapView.pendingViewport).toBeNull();
    expect(store().mapView.framedLevel).toBe(2);
  });

  it("selecting another hex ends the restored hex's exemption", () => {
    store().openGame(GAME, SAVED);

    store().selectRegion("1:9,41");

    expect(store().mapView.restoredRegionId).toBeNull();
  });

  it("re-selecting the restored hex itself keeps the exemption", () => {
    store().openGame(GAME, SAVED);

    store().restoreSelection("1:7,53");

    expect(store().mapView.restoredRegionId).toBe("1:7,53");
  });

  it("setLevel ends the exemption, same as clearing the selection", () => {
    store().openGame(GAME, SAVED);

    store().setLevel(3);

    expect(store().mapView.restoredRegionId).toBeNull();
  });

  it("closeGame drops the view along with the selection", () => {
    store().openGame(GAME, SAVED);

    store().closeGame();

    expect(store().mapView).toEqual({
      gameId: null,
      viewport: null,
      pendingViewport: null,
      framedLevel: null,
      restoredRegionId: null
    });
  });
});

describe("the region panel's problems toggle", () => {
  beforeEach(resetWorkspaceStore);

  it("the region panel shows its problems until told otherwise", () => {
    expect(store().regionProblemsShown).toBe(true);
  });

  it("toggling the problems section is remembered", async () => {
    store().toggleRegionProblems();
    expect(store().regionProblemsShown).toBe(false);

    const options = useWorkspaceStore.persist.getOptions();
    const raw = await options.storage?.getItem(options.name ?? "atlantis-hud-workspace");
    const persisted = (raw as { state?: Record<string, unknown> } | null)?.state ?? {};

    expect(persisted.regionProblemsShown).toBe(false);
  });

  it("a stored layout written before this flag existed still shows the problems", () => {
    // The upgrade case: a record persisted before this flag existed rehydrates with the key
    // absent, and a missing key must read as shown - the dangerous direction is hiding every
    // player's diagnostics on upgrade with nothing on screen to say why.
    const merge = useWorkspaceStore.persist.getOptions().merge;
    const merged = merge?.({ collapsed: {}, layers: {}, badges: {} }, store()) as
      | ReturnType<typeof store>
      | undefined;

    expect(merged?.regionProblemsShown).toBe(true);
  });

  it("a stored value that is not a boolean is ignored", () => {
    const merge = useWorkspaceStore.persist.getOptions().merge;

    for (const bogus of ["yes", 0, null]) {
      const merged = merge?.(
        { collapsed: {}, layers: {}, badges: {}, regionProblemsShown: bogus },
        store()
      ) as ReturnType<typeof store> | undefined;

      expect(merged?.regionProblemsShown).toBe(true);
    }
  });
});

describe("panels and layers", () => {
  beforeEach(resetWorkspaceStore);

  it("opens every panel and shows staleness, movement and every badge by default", () => {
    expect(Object.values(store().collapsed).every((value) => value === false)).toBe(true);
    expect(store().layers.staleness).toBe(true);
    // Movement earned its default when #83 gave it something to draw: a selected unit's own
    // orders, not just a planner mid-gesture. Off by default hid the feature entirely.
    expect(store().layers.movement).toBe(true);
    // Trade routes is gone entirely: it was the last toggle with nothing behind it, and a
    // control that does nothing is worse than no control.
    expect("tradeRoutes" in store().layers).toBe(false);
    // Units and structures were two blunt chips over nine kinds of mark; each mark now has its
    // own toggle, and the chip strip keeps only what is not a badge.
    expect("units" in store().layers).toBe(false);
    expect("structures" in store().layers).toBe(false);
    expect(BADGES.map(({ name }) => name).every((name) => store().badges[name])).toBe(true);
  });

  it("toggles one badge without disturbing the others", () => {
    store().toggleBadge("ships");

    expect(store().badges.ships).toBe(false);
    expect(store().badges.buildings).toBe(true);
    expect(store().badges.roads).toBe(true);

    store().toggleBadge("ships");
    expect(store().badges.ships).toBe(true);
  });

  it("clears and restores the whole set in one press", () => {
    store().setAllBadges(false);
    expect(Object.values(store().badges).every((on) => on === false)).toBe(true);

    store().setAllBadges(true);
    expect(Object.values(store().badges).every((on) => on === true)).toBe(true);
  });

  it("turns a badge it has never heard of on, rather than silently hiding a mark", () => {
    // Storage is hand-editable and outlives a release. A record persisted before a badge existed
    // rehydrates with that key missing, and a missing key reads as off - a mark gone from the map
    // with a checkbox that says it is showing.
    const restored = badgesFromStorage({ ships: false });

    expect(restored.ships).toBe(false);
    expect(restored.buildings).toBe(true);
    expect(Object.keys(restored).sort()).toEqual(BADGES.map(({ name }) => name).sort());
  });

  it("reads only the preferences back out of storage, never an action", () => {
    // Zustand replaces the whole state with what `merge` returns, so a hand-edited record must
    // not be able to put a number where `toggleBadge` should be.
    const merge = useWorkspaceStore.persist.getOptions().merge;
    const merged = merge?.(
      { layers: { staleness: false }, toggleBadge: 1, game: { gameId: "ghost" } },
      store()
    ) as typeof store | undefined;
    const state = merged as unknown as ReturnType<typeof store>;

    expect(typeof state.toggleBadge).toBe("function");
    expect(state.game).toBeNull();
    expect(state.layers.staleness).toBe(false);
  });

  it("shows region names by default, and yields them on for a badge set saved before they existed", () => {
    // Every player sees the map decorated with province names after this update; opting out is
    // the badge menu's job from then on, not a migration one.
    expect(store().badges.regions).toBe(true);
    expect(badgesFromStorage({ settlements: false }).regions).toBe(true);
  });

  it("ignores a badge name from outside the set", () => {
    expect(badgesFromStorage({ dragons: true } as Record<string, boolean>)).not.toHaveProperty(
      "dragons"
    );
  });

  it("folds one panel without disturbing the others", () => {
    store().togglePanel("region");

    expect(store().collapsed.region).toBe(true);
    expect(store().collapsed.unit).toBe(false);
    expect(store().collapsed.orders).toBe(false);
    expect(store().collapsed.units).toBe(false);
  });

  it("writes the layout to storage, and only the layout", async () => {
    // A reload builds a fresh store and hydrates it from here, so what is written decides what
    // survives. Selections deliberately are not: a reload leaves no report loaded, and restoring a
    // hex that no longer exists would put stale headings over empty panels.
    store().togglePanel("region");
    store().toggleLayer("staleness");
    store().toggleBadge("lairs");
    store().selectRegion("1:7,53");

    const options = useWorkspaceStore.persist.getOptions();
    const raw = await options.storage?.getItem(options.name ?? "atlantis-hud-workspace");
    const persisted = (raw as { state?: Record<string, unknown> } | null)?.state ?? {};

    expect(persisted.collapsed).toMatchObject({ region: true, unit: false });
    expect(persisted.layers).toMatchObject({ staleness: false, movement: true });
    expect(persisted.badges).toMatchObject({ lairs: false, ships: true });
    expect(persisted).not.toHaveProperty("selectedRegionId");
    expect(persisted).not.toHaveProperty("game");
  });

  it("toggles a layer back and forth", () => {
    store().toggleLayer("staleness");
    expect(store().layers.staleness).toBe(false);
    store().toggleLayer("staleness");
    expect(store().layers.staleness).toBe(true);
  });
});

describe("the orders panel's stored height", () => {
  beforeEach(resetWorkspaceStore);

  it("remembers the orders height across a reload", async () => {
    store().setOrdersHeight(24);
    expect(store().ordersHeightRem).toBe(24);

    const options = useWorkspaceStore.persist.getOptions();
    const raw = await options.storage?.getItem(options.name ?? "atlantis-hud-workspace");
    const persisted = (raw as { state?: Record<string, unknown> } | null)?.state ?? {};
    expect(persisted.ordersHeightRem).toBe(24);

    const merge = options.merge;
    const merged = merge?.(persisted, store()) as ReturnType<typeof store> | undefined;
    expect(merged?.ordersHeightRem).toBe(24);
  });

  it("starts out null, meaning the default pin applies", () => {
    expect(store().ordersHeightRem).toBeNull();
  });

  it("reconciles garbage in storage to null rather than trusting it", () => {
    const merge = useWorkspaceStore.persist.getOptions().merge;
    const merged = merge?.({ ordersHeightRem: "not a number" }, store()) as
      | ReturnType<typeof store>
      | undefined;

    expect(merged?.ordersHeightRem).toBeNull();
  });

  it("resets to the default pin", () => {
    store().setOrdersHeight(30);
    store().setOrdersHeight(null);
    expect(store().ordersHeightRem).toBeNull();
  });

  it("is cleared by resetWorkspaceStore", () => {
    store().setOrdersHeight(30);
    resetWorkspaceStore();
    expect(store().ordersHeightRem).toBeNull();
  });
});

describe("the units pane's stored height", () => {
  beforeEach(resetWorkspaceStore);

  it("remembers the units pane's height, clamped", () => {
    store().setUnitsHeight(30);
    expect(store().unitsHeightRem).toBe(30);

    store().setUnitsHeight(2);
    // UNITS_MIN_REM: one row plus the pane's own furniture. It went up with ROW_HEIGHT when the
    // pane type scale did (ah-v09e).
    expect(store().unitsHeightRem).toBe(5.75);

    store().setUnitsHeight(null);
    expect(store().unitsHeightRem).toBeNull();
  });

  it("restores a stored units height and clamps a wild one", async () => {
    store().setUnitsHeight(30);
    const options = useWorkspaceStore.persist.getOptions();
    const raw = await options.storage?.getItem(options.name ?? "atlantis-hud-workspace");
    const persisted = (raw as { state?: Record<string, unknown> } | null)?.state ?? {};
    expect(persisted.unitsHeightRem).toBe(30);

    const merge = options.merge;
    const merged = merge?.({ unitsHeightRem: 400 }, store()) as
      | ReturnType<typeof store>
      | undefined;
    expect(merged?.unitsHeightRem).toBe(60);
  });

  it("is cleared by resetWorkspaceStore", () => {
    store().setUnitsHeight(30);
    resetWorkspaceStore();
    expect(store().unitsHeightRem).toBeNull();
  });
});

describe("the rails' stored widths", () => {
  beforeEach(resetWorkspaceStore);

  it("remembers a rail's width across a reload", async () => {
    store().setRailWidth("left", 24);
    expect(store().leftRailWidthRem).toBe(24);

    const options = useWorkspaceStore.persist.getOptions();
    const raw = await options.storage?.getItem(options.name ?? "atlantis-hud-workspace");
    const persisted = (raw as { state?: Record<string, unknown> } | null)?.state ?? {};
    expect(persisted.leftRailWidthRem).toBe(24);

    const merge = options.merge;
    const merged = merge?.(persisted, store()) as ReturnType<typeof store> | undefined;
    expect(merged?.leftRailWidthRem).toBe(24);
  });

  it("starts out null for both rails, meaning the default width applies", () => {
    expect(store().leftRailWidthRem).toBeNull();
    expect(store().rightRailWidthRem).toBeNull();
  });

  it("resizes each rail independently", () => {
    store().setRailWidth("left", 24);
    store().setRailWidth("right", 30);
    expect(store().leftRailWidthRem).toBe(24);
    expect(store().rightRailWidthRem).toBe(30);
  });

  it("reconciles garbage in storage to null rather than trusting it", () => {
    const merge = useWorkspaceStore.persist.getOptions().merge;
    const merged = merge?.(
      { leftRailWidthRem: "not a number", rightRailWidthRem: "also not" },
      store()
    ) as ReturnType<typeof store> | undefined;

    expect(merged?.leftRailWidthRem).toBeNull();
    expect(merged?.rightRailWidthRem).toBeNull();
  });

  it("clamps a stored value into the rail's range", () => {
    const merge = useWorkspaceStore.persist.getOptions().merge;
    const merged = merge?.({ leftRailWidthRem: 500, rightRailWidthRem: 1 }, store()) as
      | ReturnType<typeof store>
      | undefined;

    expect(merged?.leftRailWidthRem).toBe(45);
    expect(merged?.rightRailWidthRem).toBe(12);
  });

  it("resets to the default width", () => {
    store().setRailWidth("left", 30);
    store().setRailWidth("left", null);
    expect(store().leftRailWidthRem).toBeNull();
  });

  it("is cleared by resetWorkspaceStore", () => {
    store().setRailWidth("left", 30);
    store().setRailWidth("right", 30);
    resetWorkspaceStore();
    expect(store().leftRailWidthRem).toBeNull();
    expect(store().rightRailWidthRem).toBeNull();
  });

  it("survives opening a game and changing level - a layout preference outlives the game", () => {
    store().setRailWidth("left", 24);
    store().openGame({
      gameId: "g1",
      gameName: "Spring campaign",
      databasePath: "idb://g1",
      rulesetId: "neworigins"
    }, null);
    expect(store().leftRailWidthRem).toBe(24);
    store().setLevel(1);
    expect(store().leftRailWidthRem).toBe(24);
    store().closeGame();
    expect(store().leftRailWidthRem).toBe(24);
  });
});

describe("the planner's own state", () => {
  /**
   * Arming is a one-shot, not a mode. The map means one thing at a time, and a mode you can forget
   * you are in turns every later click into a surprise.
   */
  it("arms for one pick and disarms once a destination is chosen", () => {
    const store = useWorkspaceStore.getState();
    expect(store.planner).toEqual({ armed: false, destinationId: null });

    store.armPlanner();
    expect(useWorkspaceStore.getState().planner.armed).toBe(true);

    useWorkspaceStore.getState().planTo("1:7,51");
    expect(useWorkspaceStore.getState().planner).toEqual({
      armed: false,
      destinationId: "1:7,51"
    });
  });

  it("clears the route and any armed pick together", () => {
    useWorkspaceStore.getState().armPlanner();
    useWorkspaceStore.getState().planTo("1:7,51");

    useWorkspaceStore.getState().clearPlan();

    expect(useWorkspaceStore.getState().planner).toEqual({ armed: false, destinationId: null });
  });

  /**
   * A route is about a unit and a turn, and both change. Persisting one would restore a plan for a
   * unit that may not exist any more, which is worse than restoring nothing.
   */
  it("is not among the things that survive a reload", () => {
    useWorkspaceStore.getState().planTo("1:7,51");

    const storage = useWorkspaceStore.persist.getOptions().storage;
    const persisted = storage?.getItem("atlantis-hud-workspace") as
      | { state?: Record<string, unknown> }
      | null
      | undefined;

    expect(persisted?.state).toBeDefined();
    expect(persisted?.state).not.toHaveProperty("planner");
  });
});

describe("the units table's stored column shares (ah-1owr.2)", () => {
  beforeEach(resetWorkspaceStore);

  it("remembers dragged column shares and forgets them on reset", () => {
    expect(useWorkspaceStore.getState().unitColumnShares).toBeNull();

    useWorkspaceStore.getState().setUnitColumnShares({ name: 0.2, faction: 0.1 });
    expect(useWorkspaceStore.getState().unitColumnShares).toEqual({ name: 0.2, faction: 0.1 });

    useWorkspaceStore.getState().resetUnitColumnShares();
    expect(useWorkspaceStore.getState().unitColumnShares).toBeNull();
  });

  it("merges each commit, so only the columns actually dragged are recorded", () => {
    useWorkspaceStore.getState().setUnitColumnShares({ name: 0.2, faction: 0.1 });
    useWorkspaceStore.getState().setUnitColumnShares({ faction: 0.15, men: 0.05 });
    expect(useWorkspaceStore.getState().unitColumnShares).toEqual({
      name: 0.2,
      faction: 0.15,
      men: 0.05
    });
  });

  it("is cleared by resetWorkspaceStore", () => {
    useWorkspaceStore.getState().setUnitColumnShares({ name: 0.2 });
    resetWorkspaceStore();
    expect(useWorkspaceStore.getState().unitColumnShares).toBeNull();
  });
});
