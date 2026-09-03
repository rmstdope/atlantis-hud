import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REPORTS, readReport, type ReportKey } from "@atlantis/fixtures";
import { createCoreClient } from "@atlantis/core-client";
import {
  ensureUnitBlock,
  findUnitBlocks,
  hasFactionHeader,
  levelFieldOf,
  readUnitOrders,
  regionBannerLine,
  seedOrdersDocument,
  writeUnitOrders
} from "@atlantis/shared";
import { createWebCoreAdapter } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * Every committed report, through the real core, against the document functions that write blocks.
 *
 * Here rather than in `packages/shared` because it needs real parsed reports, and this is the one
 * package that already runs the Wasm core under vitest. Two things are being guarded (ah-0gs8):
 * that a banner this app reconstructs is byte for byte the server's - a banner that differs would
 * put a duplicate region heading into a file a player mails - and that every own unit in every
 * fixture can actually be given an order, including in the fixture that carries no template at all.
 */
async function realCore() {
  const wasm = await import("./wasm/atlantis_core.js");
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as Parameters<typeof createWebCoreAdapter>[0];
}

const KEYS = Object.keys(REPORTS) as ReportKey[];

describe("blocks and banners across the committed corpus", () => {
  it("every banner in every committed template is reproduced exactly", async () => {
    const client = createCoreClient(createWebCoreAdapter(await realCore(), createMemoryWebStore()));
    let checked = 0;

    for (const key of KEYS) {
      const parsed = await client.parseReportFull(readReport(key));
      const template = parsed.ordersTemplate?.text;
      if (!template) {
        continue;
      }
      // Membership, not equality: a report describes regions its template has no banner for, so the
      // reconstructed set is legitimately the larger one.
      const ours = new Set(
        parsed.regions.map((region) => regionBannerLine(region, levelFieldOf(region.coordinate.z)))
      );
      for (const line of template.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith(";***")) {
          continue;
        }
        expect(ours, `${key}: ${trimmed}`).toContain(trimmed);
        checked += 1;
      }
    }

    expect(checked).toBeGreaterThan(100);
  }, 120_000);

  it("every own unit in every fixture can be given an order", async () => {
    const client = createCoreClient(createWebCoreAdapter(await realCore(), createMemoryWebStore()));

    for (const key of KEYS) {
      const parsed = await client.parseReportFull(readReport(key));
      let document = seedOrdersDocument(
        parsed.ordersTemplate?.text ?? "",
        parsed.header.factionId
      );

      for (const region of parsed.regions) {
        const banner = regionBannerLine(region, levelFieldOf(region.coordinate.z));
        for (const unit of region.units.filter((candidate) => candidate.own)) {
          document = ensureUnitBlock(document, unit.unitId, banner);
          document = writeUnitOrders(document, unit.unitId, "@work");
          expect(readUnitOrders(document, unit.unitId), `${key}: unit ${unit.unitId}`).toContain(
            "@work"
          );
        }
      }

      if (parsed.header.factionId !== null) {
        expect(hasFactionHeader(document), key).toBe(true);
      }

      const ids = findUnitBlocks(document).map((block) => block.unitId);
      expect(new Set(ids).size, `${key}: duplicate unit blocks`).toBe(ids.length);
    }
  }, 120_000);
});
