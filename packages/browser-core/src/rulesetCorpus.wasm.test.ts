import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NEWAGE_ARCANUM_REPORTS,
  REPORTS,
  readNewAgeArcanumReport,
  readNewAgeArcanumRuleset,
  readReport,
  readRuleset,
  readTridentRuleset,
  type NewAgeArcanumReportKey,
  type ReportKey
} from "@atlantis/fixtures";
import { createCoreClient } from "@atlantis/core-client";
import { checkOpenedReports, parseGameData, type GameDataIndex } from "@atlantis/shared";
import { createWebCoreAdapter } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * Every committed report, through the real core, against the ruleset check (ah-fdmb) under its own
 * ruleset (ah-n30q). A name the check reports here is a gap in our data, not the player's: the
 * check would open its dialog and ask them to report it on the first opening of that sample.
 *
 * Here rather than in `packages/shared` because it needs real parsed reports, and this is the one
 * package that already runs the Wasm core under vitest.
 */
async function realCore() {
  const wasm = await import("./wasm/atlantis_core.js");
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as Parameters<typeof createWebCoreAdapter>[0];
}

function index(text: string): GameDataIndex {
  const parsed = parseGameData(text);
  if (parsed === null) {
    throw new Error("not a ruleset");
  }
  return parsed;
}

const INDEXES = new Map<string, GameDataIndex>([
  ["neworigins", index(readRuleset())],
  ["newage-arcanum", index(readNewAgeArcanumRuleset())],
  ["newage-trident", index(readTridentRuleset())]
]);

const CORPUS: { fileName: string; rulesetId: string; text: string }[] = [
  ...(Object.keys(REPORTS) as ReportKey[]).map((key) => ({
    fileName: REPORTS[key],
    rulesetId: "neworigins",
    text: readReport(key)
  })),
  ...(Object.keys(NEWAGE_ARCANUM_REPORTS) as NewAgeArcanumReportKey[]).map((key) => ({
    fileName: NEWAGE_ARCANUM_REPORTS[key],
    rulesetId: "newage-arcanum",
    text: readNewAgeArcanumReport(key)
  }))
];

describe("the ruleset check across the committed corpus", () => {
  it("finds nothing missing in any committed report under its own ruleset", async () => {
    const client = createCoreClient(createWebCoreAdapter(await realCore(), createMemoryWebStore()));
    const missing: Record<string, unknown> = {};

    for (const { fileName, rulesetId, text } of CORPUS) {
      const report = await client.parseReportFull(text);
      const check = checkOpenedReports([{ fileName, report }], rulesetId, INDEXES);
      if (check === null) {
        throw new Error(`${rulesetId} is not a shipped ruleset`);
      }
      if (check.gaps.count > 0) {
        missing[fileName] = check.gaps.groups;
      }
    }

    expect(missing).toEqual({});
    // The corpus is the point: a fixture list that came back empty would pass this vacuously.
    expect(CORPUS.length).toBeGreaterThan(30);
  }, 120_000);
});
