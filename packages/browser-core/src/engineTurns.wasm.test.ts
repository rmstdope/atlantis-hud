import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CoreWasmModule } from "./webCoreAdapter";
import { atlaClientCapsJson, rowCapped, rowOnEngineTurns } from "./webStore";

/**
 * ah-m6pw, ah-aguu: a game database below version 7 numbered every turn one low (February of Year 1
 * was turn 1). Its upgrade moves each row by the core's one list of stored turns
 * (`atlantis_hud_core::stored_turns`), which a backup restore uses too - so these cases cross the
 * real WebAssembly boundary rather than a stand-in.
 */
async function realCore(): Promise<CoreWasmModule> {
  const wasm = await import("./wasm/atlantis_core.js");
  // The `--target web` glue fetches the payload relative to its own URL, which Node cannot do, so
  // the bytes are handed over directly. The browser path is exercised by the Playwright suite.
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as CoreWasmModule;
}

describe("moving a stored row to the engine's turn numbers, through the core", () => {
  it("names the eight stores whose rows hold a turn", async () => {
    const core = await realCore();

    expect(core.collections_naming_a_turn_state()).toEqual([
      "importedTurns",
      "orderDrafts",
      "mergedReports",
      "regionSightings",
      "hexNotes",
      "alliedMages",
      "armies",
      "studyPlans"
    ]);
  });

  it("moves an imported turn's key and its payload's turn, and keeps the store's own keys", async () => {
    const core = await realCore();
    const row = {
      databasePath: "idb://game-g7",
      gameId: "g7",
      factionId: "95",
      turnNumber: 71,
      parsedPayloadJson: JSON.stringify({ turnHeader: { turnNumber: 71, season: "December" } }),
      warningsPayloadJson: "[]"
    };

    const moved = rowOnEngineTurns(core, "importedTurns", row);

    const { parsedPayloadJson, ...rest } = moved;
    expect(rest).toEqual({
      databasePath: "idb://game-g7",
      gameId: "g7",
      factionId: "95",
      turnNumber: 72,
      warningsPayloadJson: "[]"
    });
    expect(JSON.parse(parsedPayloadJson)).toEqual({
      turnHeader: { turnNumber: 72, season: "December" }
    });
    expect(row.turnNumber).toBe(71);
  });

  it("keeps a goal's turn 0 and moves a cast's", async () => {
    const core = await realCore();

    const moved = rowOnEngineTurns(core, "studyPlans", {
      factionId: "21",
      unitId: "9001",
      goals: [
        { kind: "study", turn: 0, skill: "FORC" },
        { kind: "study", turn: 24, skill: "FIRE" }
      ],
      casts: [{ turn: 0, spell: "FARS" }]
    });

    expect(moved.goals).toEqual([
      { kind: "study", turn: 0, skill: "FORC" },
      { kind: "study", turn: 25, skill: "FIRE" }
    ]);
    expect(moved.casts).toEqual([{ turn: 1, spell: "FARS" }]);
  });

  it("moves an army member's turn", async () => {
    const core = await realCore();

    expect(
      rowOnEngineTurns(core, "armies", { id: "a1", members: [{ unitId: "1", seenTurn: 66 }] }).members
    ).toEqual([{ unitId: "1", seenTurn: 67 }]);
  });

  it("caps an AtlaClient sighting before the move, so a version-6 row lands on the newest turn", async () => {
    const core = await realCore();
    // Stored on version 6's count: newest report 71, the AtlaClient hex one above it at 72 (ah-vtgk).
    const caps = atlaClientCapsJson(
      core,
      [{ factionId: "95", turnNumber: 71, mergedFactionId: "atlaclient" }],
      [["95", 71]]
    );

    const row = rowOnEngineTurns(
      core,
      "regionSightings",
      rowCapped(core, caps, { factionId: "95", regionId: "1:1,1", lastSeenTurn: 72 })
    );

    expect(row.lastSeenTurn).toBe(72);
  });

  it("caps only a faction holding an AtlaClient merge, and keeps the store's own keys", async () => {
    const core = await realCore();
    const caps = atlaClientCapsJson(
      core,
      [
        { factionId: "95", turnNumber: 72, mergedFactionId: "atlaclient" },
        { factionId: "73", turnNumber: 72, mergedFactionId: "21" }
      ],
      [
        ["95", 71],
        ["95", 72],
        ["73", 72]
      ]
    );

    expect(
      rowCapped(core, caps, { databasePath: "idb://game-g7", factionId: "95", regionId: "1:1,1", lastSeenTurn: 73 })
    ).toEqual({ databasePath: "idb://game-g7", factionId: "95", regionId: "1:1,1", lastSeenTurn: 72 });
    expect(rowCapped(core, caps, { factionId: "73", regionId: "1:1,1", lastSeenTurn: 73 }).lastSeenTurn).toBe(73);
  });
});
