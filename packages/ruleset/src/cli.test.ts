/**
 * The CLI's own decisions, driven through `main` with a stubbed `argv`.
 *
 * `committed.test.ts` proves the scraper's output, but it calls `buildRuleset` directly - so
 * nothing there would notice the CLI reading a database as if it were a data page, or writing a
 * New Age ruleset over `config/public/ruleset.json`. That last one is the whole safety story for
 * `--database`, and it is only a guard, so it needs a test rather than a comment.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ruleset } from "./build";

const ARCANUM = {
  rules: "tests/fixtures/ruleset/newage-arcanum-rules.html",
  database: "tests/fixtures/ruleset/newage-arcanum-database.json"
};

/** Repository-relative, so the case proves where a relative `--out` actually lands. */
const RELATIVE_OUT = ".cerebro/scratch/ruleset-cli-test.json";

/** Runs the CLI with these arguments, returning what it threw, if anything. */
async function run(args: string[]): Promise<Error | null> {
  // `cli.ts` reads `argv` from `node:process`, which is bound to the array object itself - so it
  // is mutated in place. Replacing `process.argv` would leave the module reading the old array.
  process.argv.length = 0;
  process.argv.push("node", "cli.ts", ...args);
  vi.resetModules();
  const { main } = await import("./cli");
  try {
    await main();
    return null;
  } catch (error) {
    return error as Error;
  }
}

const REAL_ARGV = [...process.argv];

/** Temporary directories this file made, removed after each case rather than left in /tmp. */
const scratchDirectories: string[] = [];

function scratchDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "ruleset-cli-"));
  scratchDirectories.push(directory);
  return directory;
}

afterEach(() => {
  process.argv.length = 0;
  process.argv.push(...REAL_ARGV);
  rmSync(new URL(`../../../${RELATIVE_OUT}`, import.meta.url), { force: true });
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("the scraper CLI", () => {
  it("reads a JSON database as a catalogue and writes it where --out says", async () => {
    const out = join(scratchDirectory(), "arcanum.json");

    expect(
      await run(["--rules", ARCANUM.rules, "--database", ARCANUM.database, "--out", out])
    ).toBeNull();

    const written = JSON.parse(readFileSync(out, "utf8")) as Ruleset;
    expect(written.source.dataUrl).toBe(ARCANUM.database);
    expect(written.items.MEAL.maintenanceValue).toBe(30);
    expect(written.movement.terrainCosts.premiums.volcano).toBe(4);
  });

  it("refuses --database without --out rather than overwriting the standard ruleset", async () => {
    const error = await run(["--rules", ARCANUM.rules, "--database", ARCANUM.database]);
    expect(error?.message).toMatch(/--database needs --out/);
  });

  it("refuses --data and --database together", async () => {
    const error = await run([
      "--rules",
      ARCANUM.rules,
      "--data",
      "tests/fixtures/ruleset/neworigins-data.html",
      "--database",
      ARCANUM.database,
      "--out",
      "unused.json"
    ]);
    expect(error?.message).toMatch(/give one of them/);
  });

  it("refuses a catalogue-less invocation with the usage line", async () => {
    const error = await run(["--rules", ARCANUM.rules]);
    expect(error?.message).toMatch(/usage: scrape/);
  });

  it("resolves a relative --out against the repository root", async () => {
    // The directory is gitignored agent scratch space, so it need not exist on a fresh clone or in
    // CI - and `writeFile` does not create parents.
    mkdirSync(new URL("../../../.cerebro/scratch/", import.meta.url), { recursive: true });

    expect(
      await run(["--rules", ARCANUM.rules, "--database", ARCANUM.database, "--out", RELATIVE_OUT])
    ).toBeNull();

    // Read back through the repository root, which is what the assertion is about: resolved
    // against the package directory the file would be under packages/ruleset/ instead.
    const target = new URL(`../../../${RELATIVE_OUT}`, import.meta.url);
    expect(JSON.parse(readFileSync(target, "utf8")).source.rulesUrl).toBe(ARCANUM.rules);
  });
});
