/**
 * The CLI's own decisions, driven through `main` with a stubbed `argv`.
 *
 * `committed.test.ts` proves the scraper's output, but it calls `buildRuleset` directly - so
 * nothing there would notice the CLI reading a database as if it were a data page, or writing a
 * New Age ruleset over `config/public/ruleset.json`. That last one is the whole safety story for
 * `--database`, and it is only a guard, so it needs a test rather than a comment.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ruleset } from "./build";
import { regenerateArguments, WORLDS } from "./worlds";

const ARCANUM = {
  rules: "tests/fixtures/ruleset/newage-arcanum-rules.html",
  database: "tests/fixtures/ruleset/newage-arcanum-database.json",
  orderLanguage: "new-age-arcanum"
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
      await run([
        "--rules",
        ARCANUM.rules,
        "--database",
        ARCANUM.database,
        "--order-language",
        ARCANUM.orderLanguage,
        "--out",
        out
      ])
    ).toBeNull();

    const written = JSON.parse(readFileSync(out, "utf8")) as Ruleset;
    expect(written.source.dataUrl).toBe(ARCANUM.database);
    expect(written.items.MEAL.maintenanceValue).toBe(30);
    expect(written.movement.terrainCosts.premiums.volcano).toBe(4);
  });

  it("carries source forward from --keep-source rather than the arguments and the clock", async () => {
    const directory = scratchDirectory();
    const kept = join(directory, "kept.json");
    const out = join(directory, "out.json");
    const source = {
      rulesUrl: "https://example.invalid/rules",
      dataUrl: "https://example.invalid/database",
      fetchedAt: "2001-02-03T04:05:06.789Z"
    };
    writeFileSync(kept, JSON.stringify({ source }), "utf8");

    expect(
      await run([
        "--rules",
        ARCANUM.rules,
        "--database",
        ARCANUM.database,
        "--order-language",
        ARCANUM.orderLanguage,
        "--out",
        out,
        "--keep-source",
        kept
      ])
    ).toBeNull();

    const written = JSON.parse(readFileSync(out, "utf8")) as Ruleset;
    expect(written.source).toMatchObject(source);
  });

  it("refuses a --keep-source file with no source block, writing nothing", async () => {
    const directory = scratchDirectory();
    const kept = join(directory, "kept.json");
    const out = join(directory, "out.json");
    writeFileSync(kept, JSON.stringify({ items: {} }), "utf8");

    const error = await run([
      "--rules",
      ARCANUM.rules,
      "--database",
      ARCANUM.database,
      "--order-language",
      ARCANUM.orderLanguage,
      "--out",
      out,
      "--keep-source",
      kept
    ]);

    expect(error?.message).toMatch(/--keep-source .* has no source block/);
    expect(existsSync(out)).toBe(false);
  });

  /**
   * The acceptance of ah-g4r6: the remedy `committed.test.ts` prints, run with only `--out`
   * redirected, writes exactly the committed file - `source` included. Redirected because writing
   * over the committed file would race `committed.test.ts` reading it.
   */
  it.each([...WORLDS])("regenerateArguments($id) rebuilds the committed file exactly", async (world) => {
    const out = join(scratchDirectory(), "regenerated.json");
    const args = regenerateArguments(world);
    const outIndex = args.indexOf("--out");
    expect(args[outIndex + 1]).toBe(world.rulesetPath);
    args[outIndex + 1] = out;

    expect(await run(args)).toBeNull();

    const committed = JSON.parse(
      readFileSync(new URL(`../../../${world.rulesetPath}`, import.meta.url), "utf8")
    ) as Ruleset;
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(committed);
  });

  it("refuses --database without --out rather than overwriting the standard ruleset", async () => {
    const error = await run([
      "--rules",
      ARCANUM.rules,
      "--database",
      ARCANUM.database,
      "--order-language",
      ARCANUM.orderLanguage
    ]);
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
      "--order-language",
      ARCANUM.orderLanguage,
      "--out",
      "unused.json"
    ]);
    expect(error?.message).toMatch(/give one of them/);
  });

  it("refuses a catalogue-less invocation with the usage line", async () => {
    const error = await run(["--rules", ARCANUM.rules, "--order-language", ARCANUM.orderLanguage]);
    expect(error?.message).toMatch(/usage: scrape/);
  });

  it("resolves a relative --out against the repository root", async () => {
    // The directory is gitignored agent scratch space, so it need not exist on a fresh clone or in
    // CI - and `writeFile` does not create parents.
    mkdirSync(new URL("../../../.cerebro/scratch/", import.meta.url), { recursive: true });

    expect(
      await run([
        "--rules",
        ARCANUM.rules,
        "--database",
        ARCANUM.database,
        "--order-language",
        ARCANUM.orderLanguage,
        "--out",
        RELATIVE_OUT
      ])
    ).toBeNull();

    // Read back through the repository root, which is what the assertion is about: resolved
    // against the package directory the file would be under packages/ruleset/ instead.
    const target = new URL(`../../../${RELATIVE_OUT}`, import.meta.url);
    expect(JSON.parse(readFileSync(target, "utf8")).source.rulesUrl).toBe(ARCANUM.rules);
  });
});
