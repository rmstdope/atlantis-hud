import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NEWAGE_ARCANUM_REPORT_TURNS,
  NEWAGE_ARCANUM_REPORTS,
  REPORT_TURNS,
  REPORTS,
  readNewAgeArcanumReport,
  readReport,
  type NewAgeArcanumReportKey,
  type ReportKey
} from "@atlantis/fixtures";
import { createCoreClient } from "@atlantis/core-client";
import { createWebCoreAdapter } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * The turn each fixture declares (`@atlantis/fixtures`' `REPORT_TURNS`) is the turn the real core
 * derives from that report's date (ah-iuofk).
 *
 * The smoke and native walks take their turn numbers from that table rather than repeating them,
 * so this is where a change to how turns are numbered shows up outside the core's own unit test -
 * once, at unit level, instead of in every walk that mentions a turn.
 */
async function realCore() {
  const wasm = await import("./wasm/atlantis_core.js");
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as Parameters<typeof createWebCoreAdapter>[0];
}

describe("the turn each report fixture declares", () => {
  it("is the turn the core derives from every New Origins fixture's date", async () => {
    const client = createCoreClient(createWebCoreAdapter(await realCore(), createMemoryWebStore()));

    for (const key of Object.keys(REPORTS) as ReportKey[]) {
      const parsed = await client.parseReportFull(readReport(key));
      expect(parsed.header.turnNumber, REPORTS[key]).toBe(REPORT_TURNS[key]);
    }
  });

  it("is the turn the core derives from every New Age Arcanum fixture's date", async () => {
    const client = createCoreClient(createWebCoreAdapter(await realCore(), createMemoryWebStore()));

    for (const key of Object.keys(NEWAGE_ARCANUM_REPORTS) as NewAgeArcanumReportKey[]) {
      const parsed = await client.parseReportFull(readNewAgeArcanumReport(key));
      expect(parsed.header.turnNumber, NEWAGE_ARCANUM_REPORTS[key]).toBe(NEWAGE_ARCANUM_REPORT_TURNS[key]);
    }
  });
});
