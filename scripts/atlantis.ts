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
import type { Ruleset } from "@atlantis/ruleset";
import { buildRuleset, preformattedText } from "@atlantis/ruleset";
import type { RefreshOutcome } from "./atlantisRefresh";
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

export const RULES_URL = "https://atlantis-pbem.com/rules";
export const DATA_URL = "https://atlantis-pbem.com/data";

const RULES_FIXTURE = "tests/fixtures/ruleset/neworigins-rules.html";
const DATA_FIXTURE = "tests/fixtures/ruleset/neworigins-data.html";
const RULESET_PATH = "config/public/ruleset.json";

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
  "Looks a fact up on the Atlantis rules or data page instead of recalling it. Both pages are",
  "committed to this repository under tests/fixtures/ruleset/ and read from there.",
  "",
  "  atlantis rules <anchor>                    the rendered section, under a provenance header",
  "  atlantis rules --list                       all anchor names, one per line",
  "  atlantis rules --search <term>               anchors whose text contains the term",
  "  atlantis data <term>                        full entries for one name, or an index for several",
  "  atlantis data --list skills|items|objects   one line per distinct name in that section",
  "  atlantis verify                             compares the committed ruleset to generated output",
  "  atlantis check                              fetches both pages, compares bytes to the fixtures",
  "  atlantis refresh                            re-fetches, rewrites the fixtures and the ruleset",
  "  atlantis refresh --json                     same, but prints the outcome as one JSON object",
  "",
  "verify compares only what the scraper models — items, skills, buildings and movement — not prose.",
  "Verification uses committed rules and data pages plus documented overrides: regenerate with",
  "'atlantis refresh', never edit config/public/ruleset.json by hand. --json is for scheduled refresh."
].join("\n");

function printRulesHeader(anchor: string, html: string, io: Io): void {
  const provenance = rulesProvenance(html);
  const bits: string[] = [];
  if (provenance.version) {
    bits.push(`NewOrigins ${provenance.version}`);
  }
  if (provenance.lastChange) {
    bits.push(`last changed ${provenance.lastChange}`);
  }
  const meta = bits.length > 0 ? `${bits.join(", ")} (committed snapshot)` : "(committed snapshot)";
  io.out(`# rules/${anchor} — ${RULES_URL}`);
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

function runRulesAnchor(html: string, anchor: string, io: Io): number {
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

  printRulesHeader(anchor, html, io);
  io.out(section);
  return 0;
}

function runRules(args: string[], io: Io): number {
  const rulesHtml = io.readFile(RULES_FIXTURE);

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
  return runRulesAnchor(rulesHtml, args[0], io);
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

function runDataTerm(entries: DataEntry[], term: string, io: Io): number {
  const matched = findDataEntries(entries, term);
  if (matched.length === 0) {
    io.err(dataFailureMessage(term, entries));
    return 1;
  }

  const names = new Set(matched.map((entry) => entry.name));
  if (names.size === 1) {
    const [name] = names;
    const { section, tag } = matched[0];
    io.out(`# data/${section} — ${name}${tag ? ` [${tag}]` : ""} — ${DATA_URL}`);
    io.out("# committed snapshot");
    io.out(renderDataEntries(matched));
    return 0;
  }

  const sections = [...new Set(matched.map((entry) => entry.section))];
  const sectionLabel: DataSection | "data" = sections.length === 1 ? sections[0] : "data";
  io.out(`# data/${sectionLabel} — '${term}' matches ${names.size} names — ${DATA_URL}`);
  io.out("# committed snapshot");
  for (const line of renderDataIndex(matched).split("\n")) {
    io.out(line);
  }
  return 0;
}

function runData(args: string[], io: Io): number {
  const dataHtml = io.readFile(DATA_FIXTURE);
  const entries = dataEntries(preformattedText(dataHtml));

  if (args[0] === "--list") {
    return runDataList(entries, args[1], io);
  }
  if (!args[0]) {
    io.err(HELP_TEXT);
    return 1;
  }
  return runDataTerm(entries, args[0], io);
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

function runVerify(io: Io): number {
  const rulesHtml = io.readFile(RULES_FIXTURE);
  const dataHtml = io.readFile(DATA_FIXTURE);
  const committed = JSON.parse(io.readFile(RULESET_PATH)) as Ruleset;

  const built = buildRuleset({
    rulesHtml,
    dataHtml,
    rulesUrl: committed.source.rulesUrl,
    dataUrl: committed.source.dataUrl,
    fetchedAt: committed.source.fetchedAt
  });

  const disagreements: string[] = [];
  let anyDisagree = false;

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

  for (const line of disagreements) {
    io.out(line);
  }

  if (anyDisagree) {
    io.out("");
    io.out("Committed rules and data plus documented overrides are the arbiter — regenerate with");
    io.out("pnpm run atlantis refresh, do not edit ruleset.json by hand.");
    return 1;
  }

  return 0;
}

async function fetchBothPages(io: Io): Promise<{ rules: string; data: string } | number> {
  try {
    const [rules, data] = await Promise.all([io.fetchText(RULES_URL), io.fetchText(DATA_URL)]);
    return { rules, data };
  } catch (error) {
    io.err(`could not reach the site: ${messageOf(error)}`);
    return 2;
  }
}

async function runCheck(io: Io): Promise<number> {
  const fetched = await fetchBothPages(io);
  if (typeof fetched === "number") {
    return fetched;
  }

  const rulesCommitted = io.readFile(RULES_FIXTURE);
  const dataCommitted = io.readFile(DATA_FIXTURE);

  const rulesChanged = fetched.rules !== rulesCommitted;
  const dataChanged = fetched.data !== dataCommitted;

  io.out(`rules page: ${rulesChanged ? "changed" : "unchanged"}`);
  io.out(`data page: ${dataChanged ? "changed" : "unchanged"}`);

  return rulesChanged || dataChanged ? 1 : 0;
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
 */
async function runRefresh(io: Io, json: boolean): Promise<number> {
  const fetched = await fetchBothPages(io);
  if (typeof fetched === "number") {
    return fetched;
  }

  const rulesBefore = io.readFile(RULES_FIXTURE);
  const dataBefore = io.readFile(DATA_FIXTURE);

  // Trial run first, against real OS temp files rather than the fixtures - the scraper resolves
  // a relative path against the repository root, so these are absolute deliberately. Nothing
  // under the committed tree is touched until this succeeds, so a page the scraper cannot read
  // leaves the working copy exactly as it was.
  const tempRules = join(tmpdir(), `atlantis-rules.${pid}.html`);
  const tempData = join(tmpdir(), `atlantis-data.${pid}.html`);
  const tempOut = join(tmpdir(), `atlantis-ruleset.${pid}.json`);

  io.writeFile(tempRules, fetched.rules);
  io.writeFile(tempData, fetched.data);

  try {
    io.scrape(["--rules", tempRules, "--data", tempData, "--out", tempOut]);
  } catch (error) {
    const message = messageOf(error);
    if (json) {
      io.out(JSON.stringify({ kind: "scrape-failed", message } satisfies RefreshOutcome));
    } else {
      io.err(`the site no longer scrapes cleanly: ${message}`);
      io.err("nothing on disk was changed.");
    }
    return 3;
  }

  const before = io.readFile(RULESET_PATH);

  io.writeFile(RULES_FIXTURE, fetched.rules);
  io.writeFile(DATA_FIXTURE, fetched.data);

  // The canonical committed arguments from committed.test.ts, so config/public/ruleset.json gets
  // the right `source` fields and stays byte-identical to what that suite expects.
  io.scrape(["--rules", RULES_FIXTURE, "--data", DATA_FIXTURE]);

  const after = io.readFile(RULESET_PATH);

  const changes: string[] = [];
  const beforeParsed = JSON.parse(before) as Record<string, unknown>;
  const afterParsed = JSON.parse(after) as Record<string, unknown>;
  for (const key of REFRESH_TRACKED_KEYS) {
    diffLeaves(beforeParsed[key], afterParsed[key], key, changes);
  }

  if (json) {
    const changedPages = [
      ...(rulesBefore !== fetched.rules ? ["rules"] : []),
      ...(dataBefore !== fetched.data ? ["data"] : [])
    ];
    const outcome: RefreshOutcome =
      changedPages.length === 0
        ? { kind: "unchanged" }
        : { kind: "refreshed", changedPages, rulesetChanges: changes.map((line) => line.trim()) };
    io.out(JSON.stringify(outcome));
    return 0;
  }

  for (const line of changes) {
    io.out(line);
  }
  io.out(`${changes.length} changes. Review them before committing — these are numbers the planner routes with.`);

  return 0;
}

/** Returns the process exit code. Never calls `process.exit` itself. */
export async function run(argv: string[], io: Io): Promise<number> {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, ...rest] = args;

  if (command === undefined || command === "--help") {
    io.out(HELP_TEXT);
    return 0;
  }
  if (command === "rules") {
    return runRules(rest, io);
  }
  if (command === "data") {
    return runData(rest, io);
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
