/**
 * `pnpm run atlantis <command>` — look a fact up on the Atlantis rules or data page instead of
 * recalling it. Argument parsing, file reads, network and `process.exit` live here; every parse
 * and render lives in `scripts/atlantisLookup.ts`, which has no I/O and is what the tests exercise
 * directly.
 *
 * Every side effect is injected through `Io`, the same shape `finishRelease` takes in
 * `scripts/releaseSupport.ts`, so `run` itself never touches the filesystem or the network and a
 * test never performs either.
 *
 * This repository pins pnpm@9.12.0, and on that version `pnpm run <script> -- <args>` does not
 * strip the `--` the way a newer pnpm does — it arrives in argv as a literal first element. So the
 * command surface below is documented in its plain form only, and `run` drops a single leading
 * `--` defensively, for a pnpm upgrade or a habit picked up elsewhere.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pid } from "node:process";
import { fileURLToPath } from "node:url";
import type { Ruleset, ScrapedWorld } from "@atlantis/ruleset";
import { buildRuleset, catalogueDataPage, preformattedText, WORLDS, worldById } from "@atlantis/ruleset";
import type { RefreshOutcome, WorldRefresh } from "./atlantisRefresh";
import {
  dataEntries,
  type DataEntry,
  type DataSection,
  findDataEntries,
  nearestAnchors,
  renderDataEntries,
  renderDataIndex,
  rulesAnchors,
  rulesProvenance,
  rulesSection,
  searchRules
} from "./atlantisLookup";

/** The world every plain lookup answers from. Throws at module load if the table lost it. */
const STANDARD: ScrapedWorld =
  worldById("neworigins") ??
  (() => {
    throw new Error("WORLDS no longer carries 'neworigins', which every plain lookup answers from");
  })();

/**
 * Kept because `.github/workflows/atlantis-rules-refresh.yml`'s documented surface (ah-97ij.2) and
 * `scripts/atlantis.test.ts` both name them. Derived from `WORLDS` so there is one source of truth.
 */
export const RULES_URL = STANDARD.rulesUrl;
export const DATA_URL = STANDARD.catalogueUrl;

const NEWAGE_PREFIX = "newage-";

/** `newage-arcanum` -> `arcanum`: the short word the CLI takes after `newage`. */
function newAgeWord(world: ScrapedWorld): string {
  return world.id.slice(NEWAGE_PREFIX.length);
}

/** The New Age worlds in `WORLDS`, keyed by that short word, in table order. */
function newAgeWorlds(): Map<string, ScrapedWorld> {
  return new Map(
    WORLDS.filter((world) => world.id.startsWith(NEWAGE_PREFIX)).map((world) => [
      newAgeWord(world),
      world
    ])
  );
}

/** A world named on the command line, and the arguments left after the words that named it. */
export type WorldChoice = {
  world: ScrapedWorld;
  rest: string[];
  /** True when the caller wrote `newage <world>`; false for a plain lookup. */
  explicit: boolean;
};

/**
 * Reads a leading `newage <world>`. A plain command yields `STANDARD` with `explicit: false` and
 * `rest` unchanged. Returns a message - never throws - when `newage` is given without a world this
 * repository commits.
 */
export function resolveWorld(args: string[]): WorldChoice | { error: string } {
  if (args[0] !== "newage") {
    return { world: STANDARD, rest: args, explicit: false };
  }

  const worlds = newAgeWorlds();
  const committed = `Committed New Age worlds: ${[...worlds.keys()].join(", ")}`;
  const named = args[1];
  if (named === undefined) {
    return { error: `usage: atlantis newage <world> rules|data ...\n${committed}` };
  }
  const world = worlds.get(named);
  if (!world) {
    return { error: `'${named}' is not a New Age world.\n${committed}` };
  }
  return { world, rest: args.slice(2), explicit: true };
}

/** The worlds a plain lookup did not answer from, or null when this repository commits only one. */
function otherWorldsFooter(): string | null {
  const others = [...newAgeWorlds().keys()].map((word) => `newage ${word}`);
  return others.length === 0 ? null : `# other committed worlds: ${others.join(", ")}`;
}

/**
 * The footer a plain answer ends with, printed after the section so it survives being piped.
 * Printed for a `rules <anchor>` and both `data <term>` answers only - never for a name list an
 * agent pipes, and never for an answer that already names its world.
 */
function printOtherWorlds(explicit: boolean, io: Io): void {
  if (explicit) {
    return;
  }
  const footer = otherWorldsFooter();
  if (footer !== null) {
    io.out(footer);
  }
}

export type Io = {
  out: (line: string) => void;
  err: (line: string) => void;
  readFile: (path: string) => string;
  writeFile: (path: string, contents: string) => void;
  fetchText: (url: string) => Promise<string>;
  /** Runs the scraper. Throws with the scraper's own message when it refuses. */
  scrape: (args: string[]) => void;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const HELP_TEXT = [
  "pnpm run atlantis <command>",
  "",
  "Looks a fact up in a committed Atlantis ruleset instead of recalling it. Every world's sources",
  "are committed to this repository under tests/fixtures/ruleset/ and read from there.",
  "",
  "  atlantis rules <anchor>                    the rendered section, under a provenance header",
  "  atlantis newage <world> rules <anchor>     the same, from a committed New Age world",
  "  atlantis newage <world> data <term>        the same, from that world's own catalogue",
  "  atlantis rules --list                      all anchor names, one per line",
  "  atlantis rules --search <term>             anchors whose text contains the term",
  "  atlantis data <term>                       full entries for one name, or an index for several",
  "  atlantis data --list skills|items|objects  one line per distinct name in that section",
  "  atlantis verify                            every world's committed ruleset vs generated output",
  "  atlantis check                             fetches every world's sources, compares their bytes",
  "  atlantis refresh                           re-fetches, rewrites every world's sources and ruleset",
  "  atlantis refresh --json                    same, but prints the outcome as one JSON object",
  "",
  "A plain lookup answers from New Origins and ends with a line naming the other committed worlds;",
  "verify, check and refresh cover every committed world and take no world of their own.",
  "",
  "verify compares only what the scraper models — items, skills, buildings and movement — not prose.",
  "Verification uses committed rules and data pages plus documented overrides: regenerate with",
  "'atlantis refresh', never edit a ruleset.json by hand. refresh is all-or-nothing across the",
  "worlds: one world the scraper cannot read leaves every world's files untouched. --json is for the",
  "scheduled refresh."
].join("\n");

function printRulesHeader(anchor: string, html: string, world: ScrapedWorld, io: Io): void {
  const { edition, lastChange } = rulesProvenance(html);
  const bits = [edition, lastChange ? `last changed ${lastChange}` : null].filter(
    (bit): bit is string => bit !== null
  );
  const meta = bits.length > 0 ? `${bits.join(", ")} (committed snapshot)` : "(committed snapshot)";
  io.out(`# rules/${anchor} — ${world.label} — ${world.rulesUrl}`);
  io.out(`# ${meta}`);
}

function runRulesList(html: string, io: Io): number {
  for (const anchor of rulesAnchors(html)) {
    io.out(anchor);
  }
  return 0;
}

function runRulesSearch(html: string, term: string | undefined, io: Io): number {
  if (!term) {
    io.err("usage: atlantis rules --search <term>");
    return 1;
  }
  const found = searchRules(html, term);
  if (found.length === 0) {
    io.err(`no rules text matches '${term}'.`);
    return 1;
  }
  for (const anchor of found) {
    io.out(anchor);
  }
  return 0;
}

function runRulesAnchor(
  html: string,
  anchor: string,
  world: ScrapedWorld,
  explicit: boolean,
  io: Io
): number {
  const section = rulesSection(html, anchor);
  if (section === null) {
    const anchors = rulesAnchors(html);
    const suggestions = nearestAnchors(anchor, anchors);
    const lines = [`no anchor named '${anchor}' on the rules page.`, ""];
    if (suggestions.length > 0) {
      lines.push(`Closest matches:  ${suggestions.join(", ")}`);
    }
    lines.push(`All ${anchors.length} names:    pnpm run atlantis rules --list`);
    lines.push(`Search the text:  pnpm run atlantis rules --search "${anchor}"`);
    io.err(lines.join("\n"));
    return 1;
  }

  printRulesHeader(anchor, html, world, io);
  io.out(section);
  printOtherWorlds(explicit, io);
  return 0;
}

function runRules(args: string[], io: Io, world: ScrapedWorld, explicit: boolean): number {
  const rulesHtml = io.readFile(world.rulesFixture);

  if (args[0] === "--list") {
    return runRulesList(rulesHtml, io);
  }
  if (args[0] === "--search") {
    return runRulesSearch(rulesHtml, args[1], io);
  }
  if (!args[0]) {
    io.err(HELP_TEXT);
    return 1;
  }
  return runRulesAnchor(rulesHtml, args[0], world, explicit, io);
}

function dataFailureMessage(term: string, entries: DataEntry[]): string {
  const skillCount = entries.filter((entry) => entry.section === "skills").length;
  const itemCount = entries.filter((entry) => entry.section === "items").length;
  const objectCount = entries.filter((entry) => entry.section === "objects").length;

  return [
    `nothing on the data page matches '${term}'.`,
    "",
    `The data page has ${skillCount} skill levels, ${itemCount} items and ${objectCount} objects.`,
    "List them:  pnpm run atlantis data --list items",
    "",
    "This is an answer: the game has no such thing. Do not assume it exists",
    "because you remember one."
  ].join("\n");
}

function runDataList(entries: DataEntry[], section: string | undefined, io: Io): number {
  if (section !== "skills" && section !== "items" && section !== "objects") {
    io.err("usage: atlantis data --list skills|items|objects");
    return 1;
  }
  const names = [
    ...new Set(entries.filter((entry) => entry.section === section).map((entry) => entry.name))
  ];
  for (const name of names) {
    io.out(name);
  }
  return 0;
}

function runDataTerm(
  entries: DataEntry[],
  term: string,
  world: ScrapedWorld,
  explicit: boolean,
  io: Io
): number {
  const matched = findDataEntries(entries, term);
  if (matched.length === 0) {
    io.err(dataFailureMessage(term, entries));
    return 1;
  }

  const names = new Set(matched.map((entry) => entry.name));
  if (names.size === 1) {
    const [name] = names;
    const { section, tag } = matched[0];
    io.out(`# data/${section} — ${name}${tag ? ` [${tag}]` : ""} — ${world.label} — ${world.catalogueUrl}`);
    io.out("# committed snapshot");
    io.out(renderDataEntries(matched));
    printOtherWorlds(explicit, io);
    return 0;
  }

  const sections = [...new Set(matched.map((entry) => entry.section))];
  const sectionLabel: DataSection | "data" = sections.length === 1 ? sections[0] : "data";
  io.out(
    `# data/${sectionLabel} — '${term}' matches ${names.size} names — ${world.label} — ${world.catalogueUrl}`
  );
  io.out("# committed snapshot");
  for (const line of renderDataIndex(matched).split("\n")) {
    io.out(line);
  }
  printOtherWorlds(explicit, io);
  return 0;
}

function runData(args: string[], io: Io, world: ScrapedWorld, explicit: boolean): number {
  const dataHtml = catalogueDataPage(world.catalogueSource, io.readFile(world.catalogueFixture));
  const entries = dataEntries(preformattedText(dataHtml));

  if (args[0] === "--list") {
    return runDataList(entries, args[1], io);
  }
  if (!args[0]) {
    io.err(HELP_TEXT);
    return 1;
  }
  return runDataTerm(entries, args[0], world, explicit, io);
}

/** Structural equality over plain JSON values - key order must not matter. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => deepEqual(aRecord[key], bRecord[key]));
}

function compareCollection(
  path: string,
  built: Record<string, unknown>,
  committed: Record<string, unknown>,
  disagreements: string[]
): { agree: number; total: number } {
  const keys = Object.keys(built);
  let agree = 0;
  for (const key of keys) {
    if (deepEqual(built[key], committed[key])) {
      agree++;
    } else {
      disagreements.push(
        `  ${path}.${key}  committed ${JSON.stringify(committed[key])}, generated ${JSON.stringify(built[key])}`
      );
    }
  }
  return { agree, total: keys.length };
}

/** Compares one world's committed ruleset to what its own committed sources generate. */
function verifyWorld(world: ScrapedWorld, io: Io): boolean {
  const committed = JSON.parse(io.readFile(world.rulesetPath)) as Ruleset;
  const built = buildRuleset({
    rulesHtml: io.readFile(world.rulesFixture),
    dataHtml: catalogueDataPage(world.catalogueSource, io.readFile(world.catalogueFixture)),
    rulesUrl: committed.source.rulesUrl,
    dataUrl: committed.source.dataUrl,
    fetchedAt: committed.source.fetchedAt
  });

  const disagreements: string[] = [];
  let anyDisagree = false;

  io.out(`${world.id}:`);

  for (const collection of ["items", "skills", "buildings", "itemClasses"] as const) {
    const { agree, total } = compareCollection(
      collection,
      built[collection] as unknown as Record<string, unknown>,
      committed[collection] as unknown as Record<string, unknown>,
      disagreements
    );
    io.out(`${collection}: ${agree} / ${total} agree`);
    if (agree !== total) {
      anyDisagree = true;
    }
  }

  const { agree: movementAgree, total: movementTotal } = compareCollection(
    "movement",
    built.movement as unknown as Record<string, unknown>,
    committed.movement as unknown as Record<string, unknown>,
    disagreements
  );
  io.out(`movement: ${movementAgree} / ${movementTotal} agree`);
  if (movementAgree !== movementTotal) {
    anyDisagree = true;
  }

  // A bare array, not a keyed collection, so compareCollection's "N / N" count does not fit it -
  // that count means "how many keys matched", and a flat list has no key to count per item.
  if (deepEqual(built.ungiveableItems, committed.ungiveableItems)) {
    io.out("ungiveableItems: agree");
  } else {
    io.out("ungiveableItems: DISAGREE");
    disagreements.push(
      `  ungiveableItems  committed ${JSON.stringify(committed.ungiveableItems)}, generated ${JSON.stringify(built.ungiveableItems)}`
    );
    anyDisagree = true;
  }

  // Printed inside this world's block, so a disagreement is read under the world it belongs to.
  for (const line of disagreements) {
    io.out(line);
  }

  return anyDisagree;
}

function runVerify(io: Io): number {
  let anyDisagree = false;
  for (const world of WORLDS) {
    if (verifyWorld(world, io)) {
      anyDisagree = true;
    }
  }

  if (anyDisagree) {
    io.out("");
    io.out("Committed rules and data plus documented overrides are the arbiter — regenerate with");
    io.out("pnpm run atlantis refresh, do not edit ruleset.json by hand.");
    return 1;
  }

  return 0;
}

/** One world's two live sources, as served. */
type WorldSources = { rules: string; catalogue: string };

async function fetchWorldSources(world: ScrapedWorld, io: Io): Promise<WorldSources> {
  const [rules, catalogue] = await Promise.all([
    io.fetchText(world.rulesUrl),
    io.fetchText(world.catalogueUrl)
  ]);
  return { rules, catalogue };
}

/**
 * Every committed world's live sources, or the exit code 2 with the site's own message on stderr.
 * Fetched up front so `check` and `refresh` both act on a complete picture - `refresh` is
 * all-or-nothing, and a world that could not be reached must not leave the others half-refreshed.
 */
async function fetchEverything(io: Io): Promise<Map<string, WorldSources> | number> {
  try {
    const fetched = await Promise.all(WORLDS.map((world) => fetchWorldSources(world, io)));
    return new Map(WORLDS.map((world, index) => [world.id, fetched[index]]));
  } catch (error) {
    io.err(`could not reach the site: ${messageOf(error)}`);
    return 2;
  }
}

/** `data page` or `database`, so a line never claims a page where there is a JSON API. */
function catalogueLabel(world: ScrapedWorld): string {
  return world.catalogueSource === "database" ? "database" : "data page";
}

async function runCheck(io: Io): Promise<number> {
  const fetched = await fetchEverything(io);
  if (typeof fetched === "number") {
    return fetched;
  }

  let anyChanged = false;
  for (const world of WORLDS) {
    const live = fetched.get(world.id)!;
    const rulesChanged = live.rules !== io.readFile(world.rulesFixture);
    const catalogueChanged = live.catalogue !== io.readFile(world.catalogueFixture);
    io.out(
      `${world.id}: rules page ${rulesChanged ? "changed" : "unchanged"}, ` +
        `${catalogueLabel(world)} ${catalogueChanged ? "changed" : "unchanged"}`
    );
    anyChanged = anyChanged || rulesChanged || catalogueChanged;
  }

  return anyChanged ? 1 : 0;
}

/** A deep diff of two JSON values, one line per changed leaf; the caller decides which keys matter. */
function diffLeaves(before: unknown, after: unknown, path: string, out: string[]): void {
  if (deepEqual(before, after)) {
    return;
  }
  const bothPlainObjects =
    typeof before === "object" &&
    before !== null &&
    !Array.isArray(before) &&
    typeof after === "object" &&
    after !== null &&
    !Array.isArray(after);

  if (bothPlainObjects) {
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
    for (const key of keys) {
      diffLeaves(beforeRecord[key], afterRecord[key], path ? `${path}.${key}` : key, out);
    }
    return;
  }

  out.push(`  ${path}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
}

const REFRESH_TRACKED_KEYS = ["items", "skills", "buildings", "movement", "gaps", "risk"] as const;

/**
 * `refresh`'s prose report is for a person at a terminal. `refresh --json` needs the same facts
 * structured for `.github/workflows/atlantis-rules-refresh.yml` (ah-97ij.2) to branch on, without
 * parsing wording that exists to be readable. Both renderings come from this one run, so there is
 * one definition of what refreshing means.
 *
 * All-or-nothing across the worlds: every world is trial-scraped into temp files before anything
 * committed is written, so one world the scraper cannot read leaves every world's files untouched
 * and the issue's promise that nothing on disk changed stays literally true.
 */
async function runRefresh(io: Io, json: boolean): Promise<number> {
  const fetched = await fetchEverything(io);
  if (typeof fetched === "number") {
    return fetched;
  }

  // Trial run first, against real OS temp files rather than the fixtures - the scraper resolves
  // a relative path against the repository root, so these are absolute deliberately. The world id
  // is in each name so two worlds in one run cannot overwrite each other.
  for (const world of WORLDS) {
    const live = fetched.get(world.id)!;
    const tempRules = join(tmpdir(), `atlantis-${world.id}-rules.${pid}.html`);
    const tempCatalogue = join(tmpdir(), `atlantis-${world.id}-catalogue.${pid}`);
    const tempOut = join(tmpdir(), `atlantis-${world.id}-ruleset.${pid}.json`);

    io.writeFile(tempRules, live.rules);
    io.writeFile(tempCatalogue, live.catalogue);

    try {
      io.scrape([
        "--rules",
        tempRules,
        world.catalogueSource === "database" ? "--database" : "--data",
        tempCatalogue,
        "--out",
        tempOut
      ]);
    } catch (error) {
      const message = messageOf(error);
      if (json) {
        io.out(
          JSON.stringify({
            kind: "scrape-failed",
            world: world.id,
            message
          } satisfies RefreshOutcome)
        );
      } else {
        io.err(`${world.id}: the site no longer scrapes cleanly: ${message}`);
        io.err("nothing on disk was changed.");
      }
      return 3;
    }
  }

  const refreshed: WorldRefresh[] = [];
  const prose: string[] = [];
  let changeCount = 0;

  for (const world of WORLDS) {
    const live = fetched.get(world.id)!;
    const rulesChanged = live.rules !== io.readFile(world.rulesFixture);
    const catalogueChanged = live.catalogue !== io.readFile(world.catalogueFixture);
    const before = io.readFile(world.rulesetPath);

    io.writeFile(world.rulesFixture, live.rules);
    io.writeFile(world.catalogueFixture, live.catalogue);

    // The canonical committed arguments from committed.test.ts, so each world's ruleset gets the
    // right `source` fields; --out is passed for every world, including New Origins, so the three
    // commands read the same.
    io.scrape([
      "--rules",
      world.rulesFixture,
      world.catalogueSource === "database" ? "--database" : "--data",
      world.catalogueFixture,
      "--out",
      world.rulesetPath
    ]);

    const after = io.readFile(world.rulesetPath);
    const changes: string[] = [];
    const beforeParsed = JSON.parse(before) as Record<string, unknown>;
    const afterParsed = JSON.parse(after) as Record<string, unknown>;
    for (const key of REFRESH_TRACKED_KEYS) {
      diffLeaves(beforeParsed[key], afterParsed[key], key, changes);
    }
    changeCount += changes.length;

    const changedSources = [
      ...(rulesChanged ? ["rules"] : []),
      ...(catalogueChanged ? [catalogueLabel(world) === "database" ? "database" : "data"] : [])
    ];

    if (changedSources.length > 0) {
      refreshed.push({
        world: world.id,
        changedSources,
        rulesetChanges: changes.map((line) => line.trim())
      });
      prose.push(
        `${world.id}: ${changedSources.map((source) => `${source} changed`).join(", ")}`
      );
    } else {
      prose.push(`${world.id}: unchanged`);
    }
    prose.push(...changes);
  }

  if (json) {
    const outcome: RefreshOutcome =
      refreshed.length === 0 ? { kind: "unchanged" } : { kind: "refreshed", worlds: refreshed };
    io.out(JSON.stringify(outcome));
    return 0;
  }

  for (const line of prose) {
    io.out(line);
  }
  io.out(`${changeCount} changes. Review them before committing — these are numbers the planner routes with.`);

  return 0;
}

/** Returns the process exit code. Never calls `process.exit` itself. */
export async function run(argv: string[], io: Io): Promise<number> {
  const args = argv[0] === "--" ? argv.slice(1) : argv;

  if (args[0] === undefined || args[0] === "--help") {
    io.out(HELP_TEXT);
    return 0;
  }

  const chosen = resolveWorld(args);
  if ("error" in chosen) {
    io.err(chosen.error);
    return 1;
  }
  const { world, rest: resolved, explicit } = chosen;
  const [command, ...rest] = resolved;

  // `newage <world>` with nothing after it: the outer guard above saw `newage`, not a command, so
  // this is where a world named on its own lands. Printing the table beats `unknown command
  // 'undefined'`.
  if (command === undefined) {
    io.err(HELP_TEXT);
    return 1;
  }

  // verify, check and refresh are about the repository rather than about one world, so naming a
  // world before them is refused rather than silently scoped.
  if (explicit && (command === "verify" || command === "check" || command === "refresh")) {
    io.err(
      `'${command}' covers every committed world at once - run it without naming one:\n` +
        `  pnpm run atlantis ${command}`
    );
    return 1;
  }

  if (command === "rules") {
    return runRules(rest, io, world, explicit);
  }
  if (command === "data") {
    return runData(rest, io, world, explicit);
  }
  if (command === "verify") {
    return runVerify(io);
  }
  if (command === "check") {
    return runCheck(io);
  }
  if (command === "refresh") {
    return runRefresh(io, rest[0] === "--json");
  }

  io.err(`unknown command '${command}'.\n\n${HELP_TEXT}`);
  return 1;
}

const REPOSITORY_ROOT = new URL("../", import.meta.url);

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : fileURLToPath(new URL(path, REPOSITORY_ROOT));
}

function scrapeStderr(error: unknown): string {
  const stderr = (error as { stderr?: Buffer | string } | null)?.stderr;
  const text = typeof stderr === "string" ? stderr : stderr instanceof Buffer ? stderr.toString("utf8") : "";
  return text.trim() || messageOf(error);
}

const realIo: Io = {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
  readFile: (path) => readFileSync(resolvePath(path), "utf8"),
  writeFile: (path, contents) => writeFileSync(resolvePath(path), contents, "utf8"),
  fetchText: async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status} ${response.statusText}`);
    }
    return response.text();
  },
  scrape: (args) => {
    try {
      execFileSync("pnpm", ["--filter", "@atlantis/ruleset", "scrape", "--", ...args], {
        cwd: fileURLToPath(REPOSITORY_ROOT),
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      throw new Error(scrapeStderr(error));
    }
  }
};

const invokedDirectly =
  process.argv[1] !== undefined && existsSync(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  run(process.argv.slice(2), realIo).then((code) => {
    process.exit(code);
  });
}
