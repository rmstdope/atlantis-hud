import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCoreClient } from "@atlantis/core-client";
import { diffTurns } from "@atlantis/shared";
import { createWebCoreAdapter } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * Proves `diffTurns` against the real parser, not hand-built factories.
 *
 * `packages/shared` cannot parse a `.rep` (it depends only on `@atlantis/core-client`'s types), so
 * the fixture-backed half of the turn-diff proof lives here instead, the same way
 * `parseReportFull.test.ts` exercises the real WebAssembly core rather than a stand-in. Both sides
 * of every diff go through `parseReportFull` - never a mix with `parseReportClassified` - because
 * `men`/`menEstimated`/`menByRace` differ between the two parse paths for the same report and would
 * otherwise produce phantom changes.
 */

function loadFixture(name: string): string {
  return readFileSync(new URL(`../../../tests/fixtures/reports/${name}`, import.meta.url), "utf8");
}

async function realCore() {
  const wasm = await import("./wasm/atlantis_core.js");
  // The `--target web` glue fetches the payload relative to its own URL, which Node cannot do, so
  // the bytes are handed over directly. The browser path is exercised by the Playwright suite.
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as Parameters<typeof createWebCoreAdapter>[0];
}

describe("diffTurns against real consecutive-turn reports", () => {
  it("names the differences between t23 and t24 of g5-f21", async () => {
    const client = createCoreClient(createWebCoreAdapter(await realCore(), createMemoryWebStore()));
    const older = await client.parseReportFull(loadFixture("neworigins-3.0.0-g5-f21-t23.rep"));
    const newer = await client.parseReportFull(loadFixture("neworigins-3.0.0-g5-f21-t24.rep"));

    const diff = diffTurns(older, newer);

    // An own unit formed in t24, standing in a structure that did not exist in t23 - verified by
    // reading both .rep files directly.
    expect(diff.units.added.map((unit) => unit.unitId)).toContain("10575");
    const added = diff.units.added.find((unit) => unit.unitId === "10575");
    expect(added?.regionId).toBe("1:36,44");

    // An own unit whose cargo changed turn over turn - a Drone's silver grew from 7 to 9.
    const cargoChange = diff.units.changed.find((change) => change.unitId === "4330");
    expect(cargoChange?.changes).toEqual([
      { field: "items", before: "1 centaur, 7 silver", after: "1 centaur, 9 silver" }
    ]);

    // A TransportDrone that moved regions and unloaded its cargo in the same turn - one entry, not
    // an add and a remove.
    const moved = diff.units.changed.find((change) => change.unitId === "6029");
    expect(moved).toMatchObject({ movedFrom: "1:36,44", movedTo: "1:36,42" });
    expect(diff.units.added.some((unit) => unit.unitId === "6029")).toBe(false);
    expect(diff.units.removed.some((unit) => unit.unitId === "6029")).toBe(false);

    // A region whose economy moved turn over turn, and gained a structure.
    const regionChange = diff.regions.changed.find((change) => change.regionId === "1:34,44");
    expect(regionChange?.changes).toContainEqual({
      field: "structures",
      before: "—",
      after: "Building (1), Building (2)"
    });
    expect(regionChange?.changes.some((change) => change.field === "population")).toBe(true);

    // No unit is reported in more than one bucket.
    const addedIds = new Set(diff.units.added.map((unit) => unit.unitId));
    const removedIds = new Set(diff.units.removed.map((unit) => unit.unitId));
    const changedIds = new Set(diff.units.changed.map((change) => change.unitId));
    for (const id of addedIds) {
      expect(removedIds.has(id)).toBe(false);
      expect(changedIds.has(id)).toBe(false);
    }
    for (const id of removedIds) {
      expect(changedIds.has(id)).toBe(false);
    }
  });

  it("reports nothing when a report is diffed against itself", async () => {
    const client = createCoreClient(createWebCoreAdapter(await realCore(), createMemoryWebStore()));
    const t24 = await client.parseReportFull(loadFixture("neworigins-3.0.0-g5-f21-t24.rep"));

    const diff = diffTurns(t24, t24);

    expect(diff).toEqual({
      units: { added: [], removed: [], changed: [] },
      regions: { onlyInNewer: [], onlyInOlder: [], changed: [] }
    });
  });

  it("reports nothing when a larger report is diffed against itself, at scale", async () => {
    const client = createCoreClient(createWebCoreAdapter(await realCore(), createMemoryWebStore()));
    const t71 = await client.parseReportFull(loadFixture("neworigins-3.0.0-g7-f95-t71.rep"));

    const diff = diffTurns(t71, t71);

    expect(diff).toEqual({
      units: { added: [], removed: [], changed: [] },
      regions: { onlyInNewer: [], onlyInOlder: [], changed: [] }
    });
  });
});
