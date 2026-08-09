/**
 * Fetches a game's rules and data pages and writes `config/public/ruleset.json`.
 *
 *   pnpm --filter @atlantis/ruleset scrape -- \
 *     --rules https://atlantis-pbem.com/rules \
 *     --data  https://atlantis-pbem.com/data
 *
 * Either argument may be a local file instead of a URL, which is how the committed fixtures are
 * re-read without touching the network.
 *
 * Nothing is written unless every required value was read. A half-written ruleset would be worse
 * than none: routes would be costed against numbers this game does not use, and presented as fact.
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { argv, exit, pid } from "node:process";
import { pathToFileURL } from "node:url";
import { buildRuleset } from "./build";
import { RulesetScrapeError } from "./rules";

const DEFAULT_OUTPUT = new URL("../../../config/public/ruleset.json", import.meta.url);

/**
 * Reads `--name value`.
 *
 * A missing value is rejected rather than swallowed: `--rules --data x` would otherwise take
 * `--data` as the filename and fail several steps later with a confusing ENOENT.
 */
function readArgument(name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }

  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${name} needs a value`);
  }
  return value;
}

const REPOSITORY_ROOT = new URL("../../../", import.meta.url);

/**
 * Reads a source that may be either a URL or a path on disk.
 *
 * A relative path is resolved against the repository root rather than the working directory,
 * because `pnpm run` executes the script from the package directory - so the obvious
 * `--rules tests/fixtures/...` would otherwise fail depending on how it was invoked.
 */
async function load(location: string): Promise<string> {
  if (/^https?:\/\//i.test(location)) {
    const response = await fetch(location);
    if (!response.ok) {
      throw new Error(`${location} returned ${response.status} ${response.statusText}`);
    }
    return response.text();
  }
  return readFile(isAbsolute(location) ? location : new URL(location, REPOSITORY_ROOT), "utf8");
}

async function main(): Promise<void> {
  const rulesUrl = readArgument("rules");
  const dataUrl = readArgument("data");
  const output = readArgument("out");

  if (!rulesUrl || !dataUrl) {
    throw new Error(
      "usage: fetch --rules <url|path> --data <url|path> [--out <path>]\n" +
        "Point these at the rules and data pages of the game you are playing."
    );
  }

  const [rulesHtml, dataHtml] = await Promise.all([load(rulesUrl), load(dataUrl)]);

  const ruleset = buildRuleset({
    rulesHtml,
    dataHtml,
    rulesUrl,
    dataUrl,
    fetchedAt: new Date().toISOString()
  });

  // pathToFileURL rather than hand-building `file://${cwd()}`: a working directory containing a
  // `#` or `?` silently truncates a hand-built URL, writing to a different directory entirely.
  const target = output ? pathToFileURL(resolve(output)) : DEFAULT_OUTPUT;

  // Written beside the target and renamed into place. A rename is atomic, so an interrupt or a
  // full disk leaves the previous ruleset intact rather than a half-written one - which is what
  // this file's own header promises.
  const temporary = new URL(`${target.pathname.split("/").pop()}.${pid}.tmp`, target);
  await writeFile(temporary, `${JSON.stringify(ruleset, null, 2)}\n`, "utf8");
  await rename(temporary, target);

  const items = Object.keys(ruleset.items).length;
  const { walk, ride, fly } = ruleset.movement.movementPoints;
  console.log(`wrote ${target.pathname}`);
  console.log(`  movement points: walk ${walk}, ride ${ride}, fly ${fly}`);
  console.log(`  doubled terrain: ${ruleset.movement.terrainCosts.doubled.join(", ")}`);
  console.log(`  items: ${items}`);
}

main().catch((error: unknown) => {
  if (error instanceof RulesetScrapeError) {
    // The page did not say what we needed. Naming the value is the whole point: the fix is to
    // update the pattern in rules.ts, never to invent a number.
    console.error(`ruleset scrape failed: ${error.message}`);
    console.error("config/public/ruleset.json was left untouched.");
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  exit(1);
});
