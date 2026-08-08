import type { CoreClient, ParsedReport, RememberedRegion } from "@atlantis/core-client";
import { describe, expect, it, vi } from "vitest";
import {
  openOrCreateProject,
  projectPathFor,
  rememberTurn,
  toStoredRegions
} from "./projectMemory";

function region(regionId: string, x: number, y: number) {
  return {
    regionId,
    coordinate: { x, y, z: 1 },
    terrain: "plain",
    province: "Nowhere",
    settlement: null,
    population: null,
    race: null,
    taxBase: null,
    wages: null,
    maxWages: null,
    entertainment: null,
    products: [],
    wanted: [],
    forSale: [],
    exits: [],
    structures: [],
    units: []
  };
}

function report(factionId: string | null): ParsedReport {
  return {
    header: {
      factionId,
      factionName: "Borg TNG",
      factionTypes: [],
      month: "January",
      year: 6,
      turnNumber: 71,
      engineVersion: null,
      ruleset: null,
      rulesetVersion: null,
      unclaimedSilver: null,
      errors: [],
      events: []
    },
    regions: [],
    ordersTemplate: null
  };
}

function client(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    openProject: vi.fn().mockRejectedValue(new Error("no such project")),
    createProject: vi.fn().mockResolvedValue({
      projectFilePath: "p.json",
      databasePath: "p.sqlite",
      schemaVersion: 4,
      manifest: { manifestVersion: 1, metadata: { projectId: "faction-95", projectName: "Borg TNG" }, reportSources: [] }
    }),
    commitReportImport: vi.fn().mockResolvedValue({}),
    loadRegionSightings: vi.fn().mockResolvedValue([]),
    ...overrides
  } as unknown as CoreClient;
}

describe("finding a faction's project", () => {
  it("names the project after the faction, so nobody has to choose a path", () => {
    expect(projectPathFor("95")).toContain("faction-95");
  });

  it("opens the project when it is already there", async () => {
    const openProject = vi.fn().mockResolvedValue({
      projectFilePath: "existing.json",
      databasePath: "existing.sqlite",
      schemaVersion: 4,
      manifest: { manifestVersion: 1, metadata: { projectId: "faction-95", projectName: "x" }, reportSources: [] }
    });
    const core = client({ openProject });

    const project = await openOrCreateProject(core, "95", "Borg TNG");

    expect(project.databasePath).toBe("existing.sqlite");
    expect(core.createProject).not.toHaveBeenCalled();
  });

  /** The first import of a faction has no project yet. That is ordinary, not a failure. */
  it("creates the project the first time, without complaining", async () => {
    const core = client();

    const project = await openOrCreateProject(core, "95", "Borg TNG");

    expect(project.databasePath).toBe("p.sqlite");
    expect(core.createProject).toHaveBeenCalledOnce();
  });
});

describe("remembering a turn", () => {
  it("commits the report and reads back everything the faction has seen", async () => {
    const remembered: RememberedRegion[] = [
      { region: region("1:1,1", 1, 1), lastSeenTurn: 40 },
      { region: region("1:2,2", 2, 2), lastSeenTurn: 71 }
    ];
    const core = client({ loadRegionSightings: vi.fn().mockResolvedValue(remembered) });

    const outcome = await rememberTurn(core, report("95"), "raw text");

    expect(outcome.warning).toBeNull();
    expect(outcome.remembered).toHaveLength(2);
    expect(outcome.remembered[0].lastSeenTurn).toBe(40);
    expect(core.commitReportImport).toHaveBeenCalledWith(
      "p.sqlite",
      "faction-95",
      "95",
      "raw text",
      true
    );
  });

  /**
   * A report that parsed perfectly well must still be usable when the database will not cooperate.
   * Refusing to show it would trade something that works for something that does not.
   */
  it("warns rather than failing when the turn cannot be remembered", async () => {
    const core = client({
      commitReportImport: vi.fn().mockRejectedValue(new Error("disk is full"))
    });

    const outcome = await rememberTurn(core, report("95"), "raw text");

    expect(outcome.warning).toContain("disk is full");
    expect(outcome.remembered).toEqual([]);
    expect(outcome.project).toBeNull();
  });

  it("says so when the report does not name its faction", async () => {
    const core = client();

    const outcome = await rememberTurn(core, report(null), "raw text");

    expect(outcome.warning).toContain("faction");
    expect(core.commitReportImport).not.toHaveBeenCalled();
  });
});

describe("handing remembered regions to the map", () => {
  it("keeps the turn each was seen in, which is what staleness is drawn from", () => {
    const stored = toStoredRegions([{ region: region("1:7,53", 7, 53), lastSeenTurn: 63 }]);

    expect(stored).toEqual([
      {
        regionId: "1:7,53",
        coordinate: { x: 7, y: 53, z: 1 },
        terrain: "plain",
        province: "Nowhere",
        label: "plain (7,53) in Nowhere",
        lastSeenTurn: 63,
        region: region("1:7,53", 7, 53)
      }
    ]);
  });
});
