import { describe, expect, it } from "vitest";
import { createWebCoreAdapter, type CoreWasmModule } from "./webCoreAdapter";
import { createMemoryWebStore, type StoredTurnSnapshot } from "./webStore";

/**
 * Stands in for the compiled Rust core.
 *
 * It only needs to be self-consistent, not correct: these tests are about how the adapter routes
 * between logic and storage, and about the overwrite rule. Parsing itself is tested in Rust.
 */
function fakeWasm(overrides: Partial<CoreWasmModule> = {}): CoreWasmModule {
  return {
    get_engine_info: () => ({ id: "atlantis", name: "Atlantis PBEM" }),
    parse_report_state: (raw: string) => ({ raw }),
    parse_report_full_state: (raw: string) => ({ header: {}, regions: [], ordersTemplate: null, raw }),
    parse_report_classified_state: (raw: string, ruleset: string) => ({
      header: {},
      regions: [],
      ordersTemplate: null,
      raw,
      ruleset
    }),
    validate_orders_state: () => ({ diagnostics: [] }),
    plan_route_state: (
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      unitId: string,
      destination: string
    ) => ({
      plan: null,
      problem: { kind: "noKnownRoute" },
      risk: null,
      fullyModelled: false,
      echoed: { rulesetJson, rawReport, rememberedJson, unitId, destination }
    }),
    prepare_report_import_state: (raw: string, confirmedFactionId: string) => {
      const hasTurn = raw.includes("TURN: 12");
      const factionMatches = raw.includes(`FACTION: ${confirmedFactionId}`);
      return {
        turnNumber: hasTurn ? 12 : null,
        candidate: {
          rawReport: raw,
          parsedPayloadJson: `parsed:${raw}`,
          warningsPayloadJson: "[]"
        },
        parseResult: { raw },
        rejection: !hasTurn
          ? "parsed report did not meet minimum import threshold"
          : factionMatches
            ? null
            : "confirmed faction does not exist in parsed report candidates"
      };
    },
    diff_imported_turn_state: (existing: unknown, candidate: unknown) => {
      const stored = existing as StoredTurnSnapshot | null;
      const next = candidate as StoredTurnSnapshot;
      if (!stored) {
        return { exists: false, rawChanged: false, parsedChanged: false, warningsChanged: false };
      }
      return {
        exists: true,
        rawChanged: stored.rawReport !== next.rawReport,
        parsedChanged: stored.parsedPayloadJson !== next.parsedPayloadJson,
        warningsChanged: stored.warningsPayloadJson !== next.warningsPayloadJson
      };
    },
    hydrate_parse_result_state: (json: string) => ({ hydratedFrom: json }),
    ...overrides
  };
}

const REPORT = "TURN: 12 Spring\nFACTION: 17 | Crimson Tide";
const DB = "idb://game";

describe("web core adapter", () => {
  it("routes logic calls to the core rather than to storage", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    expect(await adapter.getEngineInfo()).toEqual({ id: "atlantis", name: "Atlantis PBEM" });
    expect(await adapter.parseReport("anything")).toEqual({ raw: "anything" });
    expect(await adapter.validateOrders("MOVE R1 R2")).toEqual({ diagnostics: [] });
  });

  it("reports no conflict when the turn has never been imported", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    const preview = await adapter.previewReportImport(DB, "p", "17", REPORT);

    expect(preview).toMatchObject({
      turnNumber: 12,
      duplicatePreview: { exists: false, rawChanged: false }
    });
  });

  it("detects a changed re-import of the same turn", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.commitReportImport(DB, "p", "17", REPORT, false);

    const preview = await adapter.previewReportImport(DB, "p", "17", `${REPORT}\nextra`);

    expect(preview).toMatchObject({
      duplicatePreview: { exists: true, rawChanged: true, parsedChanged: true }
    });
  });

  it("refuses to overwrite an existing turn without confirmation", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.commitReportImport(DB, "p", "17", REPORT, false);

    await expect(adapter.commitReportImport(DB, "p", "17", REPORT, false)).rejects.toThrow(
      /requires explicit overwrite confirmation/u
    );
  });

  it("overwrites when confirmation is given", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.commitReportImport(DB, "p", "17", REPORT, false);

    await expect(
      adapter.commitReportImport(DB, "p", "17", `${REPORT}\nextra`, true)
    ).resolves.toMatchObject({ exists: true, rawChanged: true });

    const loaded = await adapter.loadImportedTurn(DB, "p", "17", 12);
    expect(loaded).toMatchObject({ rawReport: `${REPORT}\nextra` });
  });

  it("refuses an import the core rejects, using the core's own wording", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(adapter.commitReportImport(DB, "p", "17", "no header", false)).rejects.toThrow(
      /did not meet minimum import threshold/u
    );
  });

  it("refuses an import under a faction the report does not contain", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(adapter.commitReportImport(DB, "p", "99", REPORT, false)).rejects.toThrow(
      /confirmed faction does not exist/u
    );
  });

  it("treats an absent rejection field as admissible", async () => {
    // serde_wasm_bindgen can emit undefined rather than null for Rust's None. An admissible
    // import must not be refused just because the field arrived in that shape.
    const wasm = fakeWasm({
      prepare_report_import_state: (raw: string) => ({
        turnNumber: 12,
        candidate: {
          rawReport: raw,
          parsedPayloadJson: `parsed:${raw}`,
          warningsPayloadJson: "[]"
        },
        parseResult: { raw }
        // rejection deliberately absent
      })
    });
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());

    await expect(adapter.commitReportImport(DB, "p", "17", REPORT, false)).resolves.toMatchObject({
      exists: false
    });
  });

  it("still previews a report it would refuse to import", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(adapter.previewReportImport(DB, "p", "99", REPORT)).resolves.toMatchObject({
      turnNumber: 12
    });
  });

  it("keeps games apart even when they share a game id", async () => {
    const store = createMemoryWebStore();
    const adapter = createWebCoreAdapter(fakeWasm(), store);

    await adapter.commitReportImport("idb://campaign-a", "p", "17", REPORT, false);

    // Same gameId, different game: must not be seen as a duplicate, and must not collide.
    const preview = await adapter.previewReportImport("idb://campaign-b", "p", "17", REPORT);
    expect(preview).toMatchObject({ duplicatePreview: { exists: false } });

    await adapter.commitReportImport("idb://campaign-b", "p", "17", `${REPORT}\nextra`, false);

    const a = await adapter.loadImportedTurn("idb://campaign-a", "p", "17", 12);
    const b = await adapter.loadImportedTurn("idb://campaign-b", "p", "17", 12);
    expect(a).toMatchObject({ rawReport: REPORT });
    expect(b).toMatchObject({ rawReport: `${REPORT}\nextra` });
  });

  it("keeps order drafts apart across games sharing a game id", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await adapter.saveOrderDraft("idb://campaign-a", "p", "17", 12, "@work", "t0");
    await adapter.saveOrderDraft("idb://campaign-b", "p", "17", 12, "@study comb", "t1");

    expect(await adapter.loadOrderDraft("idb://campaign-a", "p", "17", 12)).toMatchObject({
      orderText: "@work"
    });
    expect(await adapter.loadOrderDraft("idb://campaign-b", "p", "17", 12)).toMatchObject({
      orderText: "@study comb"
    });
  });

  it("rehydrates a stored parse result through the core, not in TypeScript", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await adapter.commitReportImport(DB, "p", "17", REPORT, false);

    const loaded = await adapter.loadImportedTurn(DB, "p", "17", 12);

    expect(loaded).toMatchObject({
      key: { gameId: "p", factionId: "17", turnNumber: 12 },
      parseResult: { hydratedFrom: `parsed:${REPORT}` }
    });
  });

  it("returns null for a turn that was never imported", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    expect(await adapter.loadImportedTurn(DB, "p", "17", 99)).toBeNull();
  });

  it("round trips an order draft", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await adapter.saveOrderDraft(DB, "p", "17", 12, "@work", "2026-08-08T00:00:00Z");

    expect(await adapter.loadOrderDraft(DB, "p", "17", 12)).toEqual({
      key: { gameId: "p", factionId: "17", turnNumber: 12 },
      orderText: "@work",
      updatedAt: "2026-08-08T00:00:00Z"
    });
  });

  it("returns null for an order draft that was never saved", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    expect(await adapter.loadOrderDraft(DB, "p", "17", 12)).toBeNull();
  });

  it("refuses to create a game over an existing one", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    const manifest = {
      manifestVersion: 1,
      metadata: { gameId: "p", gameName: "P" },
      reportSources: []
    };

    await adapter.createGame("/p.json", manifest);

    await expect(adapter.createGame("/p.json", manifest)).rejects.toThrow(/already exists/u);
  });

  it("fails to open a game that was never created", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());
    await expect(adapter.openGame("/missing.json")).rejects.toThrow(/does not exist/u);
  });
});

describe("planning a route", () => {
  /**
   * Planning is pure, so the adapter has nothing to do but pass the four arguments through in the
   * right order. Getting that order wrong would plan somebody else's move, so it is worth pinning.
   */
  it("passes the request straight to the core, unshuffled", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    const answer = (await adapter.planRoute(
      "{ruleset}",
      "{report}",
      "[remembered]",
      "18642",
      "1:7,51"
    )) as { echoed: Record<string, string> };

    expect(answer.echoed).toEqual({
      rulesetJson: "{ruleset}",
      rawReport: "{report}",
      rememberedJson: "[remembered]",
      unitId: "18642",
      destination: "1:7,51"
    });
  });
});

describe("remembering the map across turns", () => {
  /**
   * The browser's half of what the desktop does into SQLite. Without it the map only ever knows the
   * latest report, and no route can be longer than one step - a report describes its neighbours but
   * not theirs.
   */
  it("remembers every region a committed import described", async () => {
    const wasm = fakeWasm({
      parse_report_full_state: () => ({
        regions: [
          { regionId: "1:1,1", terrain: "plain", exits: [] },
          { regionId: "1:2,2", terrain: "mountain", exits: [] }
        ]
      })
    });
    const adapter = createWebCoreAdapter(wasm, createMemoryWebStore());

    await adapter.commitReportImport("/db", "p", "12", "TURN: 12\nFACTION: 12", true);
    const remembered = await adapter.loadRegionSightings("/db", "p", "12");

    expect(remembered).toEqual([
      { region: { regionId: "1:1,1", terrain: "plain", exits: [] }, lastSeenTurn: 12 },
      { region: { regionId: "1:2,2", terrain: "mountain", exits: [] }, lastSeenTurn: 12 }
    ]);
  });

  /** A hex seen again replaces the older memory of it rather than accumulating a duplicate. */
  it("keeps one memory per hex, not one per turn", async () => {
    const store = createMemoryWebStore();
    const seen = (terrain: string) => ({ regions: [{ regionId: "1:1,1", terrain, exits: [] }] });

    let terrain = "plain";
    const adapter = createWebCoreAdapter(
      fakeWasm({ parse_report_full_state: () => seen(terrain) }),
      store
    );

    await adapter.commitReportImport("/db", "p", "12", "TURN: 12\nFACTION: 12", true);
    terrain = "mountain";
    await adapter.commitReportImport("/db", "p", "12", "TURN: 12\nFACTION: 12", true);

    const remembered = (await adapter.loadRegionSightings("/db", "p", "12")) as Array<{
      region: { terrain: string };
    }>;
    expect(remembered).toHaveLength(1);
    expect(remembered[0].region.terrain).toBe("mountain");
  });

  it("has nothing to remember before anything is imported", async () => {
    const adapter = createWebCoreAdapter(fakeWasm(), createMemoryWebStore());

    await expect(adapter.loadRegionSightings("/db", "p", "12")).resolves.toEqual([]);
  });

  /** A payload an older build wrote may not parse. Losing one hex beats losing the whole map. */
  it("skips a memory it cannot read rather than failing the lot", async () => {
    const store = createMemoryWebStore();
    await store.putRegionSightings([
      { databasePath: "/db", gameId: "p", factionId: "12", regionId: "1:1,1", lastSeenTurn: 9, payloadJson: "{" },
      { databasePath: "/db", gameId: "p", factionId: "12", regionId: "1:2,2", lastSeenTurn: 9, payloadJson: '{"regionId":"1:2,2"}' }
    ]);
    const adapter = createWebCoreAdapter(fakeWasm(), store);

    const remembered = await adapter.loadRegionSightings("/db", "p", "12");
    expect(remembered).toEqual([{ region: { regionId: "1:2,2" }, lastSeenTurn: 9 }]);
  });
});
