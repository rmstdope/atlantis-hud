import { beforeEach, describe, expect, it } from "vitest";
import { resetWorkspaceStore, useWorkspaceStore } from "./workspaceStore";

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
    });
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
    });

    expect(store().game?.gameName).toBe("NewOrigins Aug 2026");
    expect(store().selectedRegionId).toBeNull();
    expect(store().selectedUnitId).toBeNull();
  });
});

describe("panels and layers", () => {
  beforeEach(resetWorkspaceStore);

  it("opens every panel and shows units, structures, staleness and movement by default", () => {
    expect(Object.values(store().collapsed).every((value) => value === false)).toBe(true);
    expect(store().layers.units).toBe(true);
    expect(store().layers.staleness).toBe(true);
    // Movement earned its default when #83 gave it something to draw: a selected unit's own
    // orders, not just a planner mid-gesture. Off by default hid the feature entirely.
    expect(store().layers.movement).toBe(true);
    // Trade routes is gone entirely: it was the last toggle with nothing behind it, and a
    // control that does nothing is worse than no control.
    expect("tradeRoutes" in store().layers).toBe(false);
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
    store().selectRegion("1:7,53");

    const options = useWorkspaceStore.persist.getOptions();
    const raw = await options.storage?.getItem(options.name ?? "atlantis-hud-workspace");
    const persisted = (raw as { state?: Record<string, unknown> } | null)?.state ?? {};

    expect(persisted.collapsed).toMatchObject({ region: true, unit: false });
    expect(persisted.layers).toMatchObject({ staleness: false, units: true });
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
