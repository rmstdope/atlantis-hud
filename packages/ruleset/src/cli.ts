/**
 * Fetches one game's rules page and catalogue and writes that game's ruleset.
 *
 *   pnpm --filter @atlantis/ruleset scrape -- \
 *     --rules https://atlantis-pbem.com/rules \
 *     --data  https://atlantis-pbem.com/data
 *
 *   pnpm --filter @atlantis/ruleset scrape -- \
 *     --rules    https://atlantis-newage.com/api/worlds/arcanum/game/rules \
 *     --database https://atlantis-newage.com/api/worlds/arcanum/game/database \
 *     --out      config/public/ruleset-newage-arcanum.json
 *
 * A world serving its catalogue as an HTML data page is read with `--data`; one serving it as a
 * JSON database with `--database`, which is converted to a data page before anything else happens.
 * Without `--out` the standard `config/public/ruleset.json` is written, which is why `--database`
 * requires one.
 *
 * Any argument may be a local file instead of a URL, which is how the committed fixtures are
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
import { catalogueDataPage } from "./worlds";
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

/** The whole of the command, exported so `cli.test.ts` can drive it with a stubbed `argv`. */
export async function main(): Promise<void> {
  const rulesUrl = readArgument("rules");
  const dataUrl = readArgument("data");
  const databaseUrl = readArgument("database");
  const output = readArgument("out");

  if (!rulesUrl || (!dataUrl && !databaseUrl)) {
    throw new Error(
      "usage: scrape --rules <url|path> (--data <url|path> | --database <url|path>) [--out <path>]\n" +
        "Point --rules at the rules page of the game you are playing, and either --data at its " +
        "data page\nor --database at its JSON database. --database needs --out."
    );
  }

  if (dataUrl && databaseUrl) {
    throw new Error("--data and --database name the same thing two ways; give one of them");
  }

  if (databaseUrl && !output) {
    throw new Error(
      "--database needs --out: a world's ruleset has its own file, and writing it to the default " +
        "output would overwrite config/public/ruleset.json"
    );
  }

  const catalogueUrl = dataUrl ?? databaseUrl;
  if (!catalogueUrl) {
    // Unreachable: the usage guard above already refuses both being absent. It is here so the
    // type narrows without a cast, and nothing below is written against `string | undefined`.
    throw new Error("--data or --database is required");
  }

  const [rulesHtml, catalogueText] = await Promise.all([load(rulesUrl), load(catalogueUrl)]);
  const dataHtml = catalogueDataPage(databaseUrl ? "database" : "data-page", catalogueText);

  const ruleset = buildRuleset({
    rulesHtml,
    dataHtml,
    rulesUrl,
    dataUrl: catalogueUrl,
    fetchedAt: new Date().toISOString()
  });

  // pathToFileURL rather than hand-building `file://${cwd()}`: a working directory containing a
  // `#` or `?` silently truncates a hand-built URL, writing to a different directory entirely.
  // A relative --out is resolved against the repository root, exactly as `load` resolves a
  // relative input: `pnpm run` executes this from the package directory, so
  // `--out config/public/ruleset-newage-arcanum.json` would otherwise land under packages/ruleset.
  const target = output
    ? isAbsolute(output)
      ? pathToFileURL(resolve(output))
      : new URL(output, REPOSITORY_ROOT)
    : DEFAULT_OUTPUT;

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
  const premiums = Object.entries(ruleset.movement.terrainCosts.premiums)
    .map(([name, cost]) => `${name} ${cost}`)
    .join(", ");
  console.log(`  terrain premiums: ${premiums}`);
  console.log(`  food maintenance: ${ruleset.items.MEAL?.maintenanceValue ?? "unknown"} silver`);
  console.log(`  items: ${items}`);
}

// Only when run as the command, so importing this module in a test does not scrape anything.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  main().catch((error: unknown) => {
    if (error instanceof RulesetScrapeError) {
      // The page did not say what we needed. Naming the value is the whole point: the fix is to
      // update the pattern in rules.ts, never to invent a number.
      console.error(`ruleset scrape failed: ${error.message}`);
      console.error("the ruleset was left untouched.");
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    exit(1);
  });
}
