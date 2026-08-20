/**
 * The fleet writes retrospectives and, until this file, nothing read them.
 *
 * Every retrospective ends on a `**Seen before.**` paragraph naming earlier beads that hit the
 * same thing - deliberately, because a third sighting is the strongest evidence the fleet produces
 * that something needs fixing rather than tolerating. Nothing aggregated that line, so the
 * apt/Playwright stall reached nine sightings before it was fixed, two days after sighting three.
 *
 * The corpus is read as text with anchored regexes rather than parsed as markdown - the label is
 * uniform at column 0 in every entry, which is enough to anchor on, and the payload after it is
 * free prose that no parser would help with anyway. The prose has four traps and each is handled
 * where it arises: paragraphs wrap (`seenBeforeParagraphs`), a `None found` paragraph may name
 * beads as counter-examples (`citationsIn`), citations are transitive, and ids are written bare,
 * backticked or as paths.
 *
 * Citations are treated as a graph and findings are its connected components. That is what makes
 * the transitive case harmless - a bead naming both its predecessor and everything its predecessor
 * named adds only edges that were already implied - and what turns ten separate bead ids about one
 * full disk into one finding of ten rather than ten findings.
 *
 * It surfaces; it does not fix. Every hour it saves depends on the navigator acting on what it
 * shows.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** One retrospective, as read. */
export type Retro = { beadId: string; path: string; text: string };

/** A root cause, as the citation graph reveals it. */
export type Finding = {
  /** Every distinct bead id in this component, sorted. */
  beadIds: string[];
  /** How many beads sighted it - `beadIds.length`. */
  sightings: number;
  /** The oldest sighting's own `##` headline, and the bead it came from. */
  name: { beadId: string; headline: string } | null;
  /** The most recent sighting, by the file's `- **Date:**` line. */
  last: { beadId: string; date: string | null };
};

/** How many beads must have sighted a cause before it is worth the navigator's attention. */
export const DEFAULT_THRESHOLD = 3;

/**
 * A bead id, in the only shape this repository uses: `ah-` and an alphanumeric stem, optionally a
 * `.N` sub-bead suffix. Requiring a digit after the dot is what keeps `ah-2sy.` at the end of a
 * sentence from being confused with `ah-8m0.2`.
 */
const BEAD_ID = /ah-[a-z0-9]+(?:\.\d+)?/gu;

/** The label, uniform at column 0 across every entry in the corpus. */
const SEEN_BEFORE = /^\*\*Seen before\.\*\*\s?/u;

/** Any other bold run-in - `**Prevent by.**` and friends - which ends the paragraph before it. */
const RUN_IN = /^\*\*[^*]+\.?\*\*/u;

/**
 * Every `Seen before` paragraph in one file, reassembled.
 *
 * 87% of them wrap onto continuation lines and one runs to six, so reading only the label's own
 * line loses most citations. The paragraph runs until a blank line, the next bold run-in, or the
 * next `##` heading - a file may hold two findings, so this returns a list, never one string.
 */
export function seenBeforeParagraphs(markdown: string): string[] {
  const lines = markdown.split("\n");
  const paragraphs: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!SEEN_BEFORE.test(lines[i])) {
      continue;
    }

    const body = [lines[i]];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === "" || RUN_IN.test(line) || line.startsWith("##")) {
        break;
      }
      body.push(line);
    }

    paragraphs.push(body.join("\n"));
  }

  return paragraphs;
}

/** Whether a paragraph opens by saying it found nothing, in any of the qualified forms. */
function isNegative(paragraph: string): boolean {
  return /^(?:none|nothing)\b/iu.test(paragraph.replace(SEEN_BEFORE, "").trimStart());
}

/**
 * The bead ids one paragraph actually cites - empty for a negative.
 *
 * A paragraph opening `None found` cites nothing, whatever ids appear later in it: nine of them
 * name ids as explicit counter-examples, and reading those as citations records the opposite of
 * what was written - and silently merges unrelated components, which is invisible in the output.
 */
export function citationsIn(paragraph: string): string[] {
  if (isNegative(paragraph)) {
    return [];
  }

  const seen = new Set<string>();
  for (const [id] of paragraph.matchAll(BEAD_ID)) {
    seen.add(id);
  }

  return [...seen];
}

/** The `##` headline - "the symptom, not the cause" - or null. */
export function headlineOf(markdown: string): string | null {
  const match = markdown.match(/^##\s+(.+?)\s*$/mu);
  return match ? match[1] : null;
}

/** The `- **Date:**` line's value, or null. */
export function dateOf(markdown: string): string | null {
  const match = markdown.match(/^-\s+\*\*Date:\*\*\s*(.+?)\s*$/mu);
  return match ? match[1] : null;
}

/**
 * The bead a retrospective file belongs to.
 *
 * Not every file is `ah-<id>.md`: `ah-wxk.1-verifier.md` is `<bead id>-<role>.md`, so the id is
 * what the pattern matches at the front rather than the whole stem.
 */
export function beadIdFromRetroPath(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const match = name.match(/^ah-[a-z0-9]+(?:\.\d+)?/u);
  return match ? match[0] : null;
}

/** Union-find over bead ids, which is all the graph this needs. */
function components(edges: readonly (readonly [string, string])[], nodes: Iterable<string>) {
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    parent.set(id, root);
    while (root !== parent.get(root)) {
      root = parent.get(root)!;
    }
    let walk = id;
    while (walk !== root) {
      const next = parent.get(walk)!;
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };

  for (const node of nodes) {
    parent.set(node, parent.get(node) ?? node);
  }
  for (const [a, b] of edges) {
    parent.set(find(a), find(b));
  }

  const grouped = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    grouped.set(root, [...(grouped.get(root) ?? []), id]);
  }

  return [...grouped.values()].map((ids) => [...ids].sort());
}

/** Every root cause sighted `threshold` times or more, largest first. */
export function findings(
  retros: readonly Retro[],
  threshold: number = DEFAULT_THRESHOLD
): Finding[] {
  const byBead = new Map<string, Retro>();
  const edges: [string, string][] = [];
  const nodes = new Set<string>();

  for (const retro of retros) {
    byBead.set(retro.beadId, retro);
    nodes.add(retro.beadId);
    for (const paragraph of seenBeforeParagraphs(retro.text)) {
      for (const cited of citationsIn(paragraph)) {
        if (cited === retro.beadId) {
          continue;
        }
        nodes.add(cited);
        edges.push([retro.beadId, cited]);
      }
    }
  }

  // A bead nobody links to is a component of one; only a component of `threshold` beads is a
  // repeated finding, and the count is beads rather than files - a cited bead that wrote no
  // retrospective of its own still sighted the thing.
  const found = components(edges, nodes)
    .filter((beadIds) => beadIds.length >= threshold)
    .map((beadIds) => {
      const dated = beadIds
        .map((beadId) => ({ beadId, retro: byBead.get(beadId) }))
        .filter((member): member is { beadId: string; retro: Retro } => member.retro !== undefined)
        .map((member) => ({ beadId: member.beadId, retro: member.retro, date: dateOf(member.retro.text) }));

      // Ties on the date - and there are many, since a bad day produces several - break on bead id,
      // so the name of a finding is stable from one sweep to the next.
      const oldestFirst = [...dated].sort(
        (a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.beadId.localeCompare(b.beadId)
      );
      const named = oldestFirst.find((member) => headlineOf(member.retro.text) !== null);
      const newest = oldestFirst[oldestFirst.length - 1];

      return {
        beadIds,
        sightings: beadIds.length,
        name: named ? { beadId: named.beadId, headline: headlineOf(named.retro.text)! } : null,
        last: newest ? { beadId: newest.beadId, date: newest.date } : { beadId: beadIds[0], date: null }
      };
    });

  return found.sort(
    (a, b) => b.sightings - a.sightings || (b.last.date ?? "").localeCompare(a.last.date ?? "")
  );
}

/** Whether any bead in a finding has been dismissed, which silences the whole component. */
function isDismissed(finding: Finding, dismissed: ReadonlySet<string>): boolean {
  return finding.beadIds.some((beadId) => dismissed.has(beadId));
}

/**
 * The report, as printed.
 *
 * One line per finding with the count first, because the count is what decides whether to act, and
 * because this is read inside Cerebro's greeting where a full chain of ids per finding would push
 * everything else off screen. `newSinceSweep` is null when there is no watermark at all.
 */
export function formatReport(
  found: readonly Finding[],
  dismissed: ReadonlySet<string>,
  newSinceSweep: readonly string[] | null
): string {
  const shown = found.filter((finding) => !isDismissed(finding, dismissed));
  const lines: string[] = [];

  if (shown.length === 0) {
    lines.push("No finding has been sighted three times.");
  } else {
    lines.push(`Repeated findings (${DEFAULT_THRESHOLD}+ sightings)`);
    const countWidth = Math.max(...shown.map((finding) => String(finding.sightings).length));
    const bodies = shown.map((finding) =>
      finding.name ? `${finding.name.beadId}: ${finding.name.headline}` : finding.beadIds.join(", ")
    );
    const bodyWidth = Math.max(...bodies.map((body) => body.length));

    shown.forEach((finding, index) => {
      const count = String(finding.sightings).padStart(countWidth);
      lines.push(`  ${count}  ${bodies[index].padEnd(bodyWidth)}  last: ${finding.last.beadId}`);
    });
  }

  lines.push("");
  if (newSinceSweep === null) {
    lines.push("  every retrospective is new");
  } else {
    const noun = newSinceSweep.length === 1 ? "retrospective" : "retrospectives";
    lines.push(`  ${newSinceSweep.length} new ${noun} since the last sweep`);
  }

  return lines.join("\n");
}

/** The repository root, which is this file's parent's parent. */
function repositoryRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Every retrospective, from the working tree and from `origin/main` both.
 *
 * Several files from the interesting window are not in the working tree at HEAD, so listing only
 * the directory would lose exactly the sightings this tool exists to count. Each path is read from
 * disk when it is there and from git when it is not; `git checkout` is never used, because the
 * checkout is shared with the navigator and with every other agent.
 */
export function readCorpus(root: string): Retro[] {
  const directory = join(root, "docs", "retrospectives");
  const onDisk = existsSync(directory)
    ? readdirSync(directory).map((name) => `docs/retrospectives/${name}`)
    : [];
  const committed = git(root, [
    "ls-tree",
    "-r",
    "--name-only",
    "origin/main",
    "--",
    "docs/retrospectives/"
  ])
    .split("\n")
    .filter((line) => line.trim() !== "");

  const paths = [...new Set([...onDisk, ...committed])]
    .filter((path) => path.endsWith(".md") && !path.endsWith("README.md"))
    .sort();

  const retros: Retro[] = [];
  for (const path of paths) {
    const beadId = beadIdFromRetroPath(path);
    if (beadId === null) {
      continue;
    }
    const absolute = join(root, path);
    const text = existsSync(absolute)
      ? readFileSync(absolute, "utf8")
      : git(root, ["show", `origin/main:${path}`]);
    // Two files for one bead - `ah-wxk.1.md` and `ah-wxk.1-verifier.md` - are two records of the
    // same bead sighting things, so their paragraphs are read together rather than as two beads.
    const existing = retros.find((retro) => retro.beadId === beadId);
    if (existing) {
      existing.text = `${existing.text}\n\n${text}`;
    } else {
      retros.push({ beadId, path, text });
    }
  }

  return retros;
}

/** A `bd` memory, or null when the key has never been written - `bd recall` exits 1 for that. */
export function recall(key: string): string | null {
  try {
    return execFileSync("bd", ["recall", key], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/** Store a `bd` memory. `--key` is never omitted: a bare argument recalls instead of storing. */
function remember(key: string, value: string): void {
  execFileSync("bd", ["remember", value, "--key", key], { stdio: "ignore" });
}

/** The bead ids whose retrospectives were committed after the watermark's commit. */
function newSince(root: string, watermark: string | null): string[] | null {
  if (watermark === null) {
    return null;
  }

  const sha = watermark.split(/\s+/u)[0];
  const changed = git(root, [
    "diff",
    "--name-only",
    `${sha}..origin/main`,
    "--",
    "docs/retrospectives/"
  ])
    .split("\n")
    .filter((line) => line.trim() !== "");

  return [...new Set(changed.map(beadIdFromRetroPath).filter((id): id is string => id !== null))];
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const root = repositoryRoot();
  const argv = process.argv.slice(2);
  const dismissAt = argv.indexOf("--dismiss");

  const retros = readCorpus(root);
  const found = findings(retros);
  const dismissed = new Set((recall("retro-dismissed") ?? "").split(/\s+/u).filter(Boolean));

  if (dismissAt !== -1) {
    const beadId = argv[dismissAt + 1];
    const target = found.find((finding) => finding.beadIds.includes(beadId));
    if (beadId === undefined || target === undefined) {
      // Loudly, rather than remembering an id that silences nothing: a dismissal that quietly does
      // not apply leaves the navigator believing a finding was dealt with.
      console.error(`no finding contains ${beadId ?? "<no bead given>"}`);
      process.exit(1);
    }
    remember("retro-dismissed", [...dismissed, beadId].join(" "));
    console.log(`dismissed the finding containing ${beadId} (${target.sightings} sightings)`);
    console.log("it will stay hidden even as more beads join it");
    process.exit(0);
  }

  const watermark = recall("retro-watermark");
  console.log(formatReport(found, dismissed, newSince(root, watermark)));

  // After printing, never before: a session that dies mid-sweep then re-reads a range rather than
  // skipping it silently.
  const head = git(root, ["rev-parse", "origin/main"]).trim();
  remember("retro-watermark", `${head} ${new Date().toISOString().replace(/\.\d+Z$/u, "Z")}`);
}
