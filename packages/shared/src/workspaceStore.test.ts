import { beforeEach, describe, expect, it } from "vitest";
import { resetWorkspaceStore, useWorkspaceStore } from "./workspaceStore";

const store = () => useWorkspaceStore.getState();

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

  it("clears selections when a project is opened", () => {
    store().selectRegion("1:7,53");
    store().selectUnit("18642");

    store().openProject({
      projectFilePath: "/p.json",
      databasePath: "/p.sqlite",
      projectId: "faction-95",
      factionId: "95",
      turnNumber: 71
    });

    expect(store().project?.factionId).toBe("95");
    expect(store().selectedRegionId).toBeNull();
    expect(store().selectedUnitId).toBeNull();
  });
});

describe("panels and layers", () => {
  beforeEach(resetWorkspaceStore);

  it("opens every panel and shows units, structures and staleness by default", () => {
    expect(Object.values(store().collapsed).every((value) => value === false)).toBe(true);
    expect(store().layers.units).toBe(true);
    expect(store().layers.staleness).toBe(true);
    // Toggles with nothing behind them yet start off, so they cannot mislead.
    expect(store().layers.tradeRoutes).toBe(false);
    expect(store().layers.movement).toBe(false);
  });

  it("folds one panel without disturbing the others", () => {
    store().togglePanel("region");

    expect(store().collapsed.region).toBe(true);
    expect(store().collapsed.unit).toBe(false);
    expect(store().collapsed.orders).toBe(false);
    expect(store().collapsed.units).toBe(false);
  });

  it("toggles a layer back and forth", () => {
    store().toggleLayer("staleness");
    expect(store().layers.staleness).toBe(false);
    store().toggleLayer("staleness");
    expect(store().layers.staleness).toBe(true);
  });
});
