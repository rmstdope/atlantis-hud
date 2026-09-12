import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readReport, readRuleset } from "@atlantis/fixtures";
import { createWebCoreAdapter, type CoreWasmModule } from "./webCoreAdapter";
import { createMemoryWebStore } from "./webStore";

/**
 * The wire road a silver forecast travels, through the real WebAssembly core rather than the
 * routing stand-in (`ah-0n2k.1`).
 *
 * Every other link of the chain this forecast crosses has a test: the Rust core pins the booleans
 * it sets (`crates/core/tests/a_hex_shared_with_an_unread_unit.rs`), the generated binding is
 * compared by `check:generated`, and the renderers are pinned against builders in
 * `packages/shared`. The boundary itself had none - and it is the one link that failed in front
 * of a person: the SILVER column kept reading exact figures beside an unread hex-mate because the
 * app serves a gitignored module built from whatever sources were current when it was last
 * built, and the shell that drove that verification had a module older than the feature. Nothing
 * in the tracked code was wrong; nothing could have said so either.
 *
 * So this file loads the same artifact the dev server serves, cuts one unit's report line the
 * way the Rust wiring test does, and asserts the bound arrives in the JavaScript object the
 * shell actually reads. Run wherever the artifact is stale - a checkout whose module predates
 * the field, a worktree whose prewarm was skipped - it fails on `incomeInTimeAtMost` being
 * absent rather than on anything subtle.
 */

async function realCore(): Promise<CoreWasmModule> {
  const wasm = await import("./wasm/atlantis_core.js");
  const bytes = readFileSync(new URL("./wasm/atlantis_core_bg.wasm", import.meta.url));
  await wasm.default({ module_or_path: bytes });
  return wasm as unknown as CoreWasmModule;
}

/** The committed report the Rust wiring test cuts, as its own text. */
const REPORT = readReport("g5f21t39");

/** The ruleset the app serves for this fixture's game (`rulesetUrlFor`, `ah-qled.8`). */
const RULESET = readRuleset();

const NEEDLE = "* Drone (8537), Borg (21), avoiding, behind, revealing faction,";
const CUT = "* Drone (8537), Borg (21), avoiding, revealing faction,";
const TAXER = "1288";
const CUT_UNIT = "8537";

/**
 * Replaces the one physical line containing `needle` with `replacement`, and fails loudly if the
 * fixture no longer holds it - a silent no-op here would make every assertion below vacuous.
 */
function cutShort(report: string): string {
  let found = false;
  const out = report.split("\n").map((line) => {
    if (line.includes(NEEDLE)) {
      expect(found, `${NEEDLE} should appear on exactly one line`).toBe(false);
      found = true;
      return CUT;
    }
    return line;
  });
  expect(found, "the fixture should still hold the line this file cuts").toBe(true);
  return out.join("\n");
}

/** Every own unit's forecast of one report, by unit id, as the shell's `getSilver` reads them. */
async function silverOf(report: string): Promise<Map<string, UnitSilverRow>> {
  const adapter = createWebCoreAdapter(await realCore(), createMemoryWebStore());
  const parsed = await adapter.parseReportClassified(report, RULESET);
  const orders = parsed.ordersTemplate?.text ?? "";
  const result = await adapter.validateOrders(orders, RULESET, report, null, null, null);
  return new Map(result.silver.map((entry) => [entry.unitId, entry]));
}

type UnitSilverRow = { unitId: string } & Record<string, unknown>;

describe("a silver forecast, across the WebAssembly boundary", () => {
  it("bounds the silver that arrives in time for a unit beside a hex-mate that was not read", async () => {
    const cut = await silverOf(cutShort(REPORT));

    // The cut took: the hex-mate whose line was shortened is unread, which is the precondition
    // the failed verification checked before anything else. Without this every assertion below
    // is vacuous.
    expect(cut.get(CUT_UNIT)?.doubt).toBe("silver-never-read");

    const taxer = cut.get(TAXER);
    expect(taxer?.incomeInTimeAtMost).toBe(true);
    expect(taxer?.lateIncomeAtMost).toBe(false);
    expect(taxer?.doubt).toBeNull();
  });

  it("keeps the figure itself and leaves a fully read hex untouched", async () => {
    const whole = await silverOf(REPORT);
    const cut = await silverOf(cutShort(REPORT));

    // The figure is the same number the untouched report gave - only the label changes, which is
    // the whole of the agreed answer.
    expect(cut.get(TAXER)?.atMonthEnd).toBe(whole.get(TAXER)?.atMonthEnd);
    expect(cut.get(TAXER)?.income).toBe(whole.get(TAXER)?.income);

    // And on a hex whose every line was read, nothing is bounded anywhere.
    expect(whole.get(TAXER)?.incomeInTimeAtMost).toBe(false);
    expect(whole.get(TAXER)?.lateIncomeAtMost).toBe(false);
  });
});
