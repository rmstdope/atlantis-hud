/**
 * A world's rules and data pages as an assistant reads them (ah-a97xg.8): the reference file
 * `pnpm run atlantis reference` renders from the committed snapshot (`scripts/atlantisReference.ts`
 * writes the same shape) and the desktop shell serves beside the ruleset. Pure but for the loader,
 * whose fetch is injected.
 */

import { rulesetById } from "../rulesets";

export type RulesReferenceSection = { readonly anchor: string; readonly title: string; readonly text: string };

export type RulesReferenceEntry = {
  readonly section: "skills" | "items" | "objects";
  readonly name: string;
  readonly tag: string | null;
  readonly text: string;
};

export type RulesReference = {
  readonly worldId: string;
  readonly label: string;
  readonly rulesUrl: string;
  readonly catalogueUrl: string;
  /** When the snapshot's pages were fetched. */
  readonly fetchedAt: string;
  readonly edition: string | null;
  readonly lastChange: string | null;
  readonly sections: readonly RulesReferenceSection[];
  readonly data: readonly RulesReferenceEntry[];
};

/** Reads a reference file's text; throws a sentence when it is not one. */
export function parseRulesReference(text: string): RulesReference {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const candidate = parsed as Partial<RulesReference> | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    typeof candidate.label !== "string" ||
    typeof candidate.fetchedAt !== "string" ||
    !Array.isArray(candidate.sections) ||
    !Array.isArray(candidate.data)
  ) {
    throw new Error("the file served is not a rules snapshot");
  }
  return candidate as RulesReference;
}

/** What every answer from a reference says about where it came from. */
export function provenance(reference: RulesReference): {
  world: string;
  snapshot: string;
  edition: string | null;
  lastChange: string | null;
} {
  return {
    world: reference.label,
    snapshot: reference.fetchedAt.slice(0, 10),
    edition: reference.edition,
    lastChange: reference.lastChange
  };
}

export function rulesSections(reference: RulesReference): { anchor: string; title: string }[] {
  return reference.sections.map(({ anchor, title }) => ({ anchor, title }));
}

/** Edit distance, for suggesting an anchor for a mistyped one. */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] as number;
      row[j] = a[i - 1] === b[j - 1] ? diagonal : 1 + Math.min(diagonal, above, row[j - 1] as number);
      diagonal = above;
    }
  }
  return row[b.length] as number;
}

const CLOSEST = 3;

/**
 * Up to three anchors close to `wanted`: those containing it, in page order, then those within two
 * edits, nearest first - the rule `pnpm run atlantis rules` suggests by.
 */
function closestAnchors(reference: RulesReference, wanted: string): string[] {
  const lower = wanted.toLowerCase();
  const anchors = reference.sections.map((section) => section.anchor);
  const containing = anchors.filter((anchor) => anchor.toLowerCase().includes(lower));
  const near = anchors
    .map((anchor) => ({ anchor, distance: editDistance(lower, anchor.toLowerCase()) }))
    .filter(({ distance }) => distance <= 2)
    .sort((a, b) => a.distance - b.distance)
    .map(({ anchor }) => anchor);
  return [...new Set([...containing, ...near])].slice(0, CLOSEST);
}

/** The section under `anchor`, matched regardless of case, or the anchors closest to it. */
export function rulesSectionText(
  reference: RulesReference,
  anchor: string
): RulesReferenceSection | { closest: string[] } {
  const exact = reference.sections.find((section) => section.anchor === anchor);
  const found = exact ?? reference.sections.find((section) => section.anchor.toLowerCase() === anchor.toLowerCase());
  return found ?? { closest: closestAnchors(reference, anchor) };
}

const QUOTED_LINES = 3;

/** Whitespace, line breaks included, as one space: the page hard-wraps its prose at about 72 columns. */
function collapsed(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Up to three places in `lines` that `query` (already collapsed) appears, each quoted as the run of
 * lines it spans, joined into one: a phrase the page wrapped is quoted whole.
 */
function quotedLines(lines: readonly string[], query: string): string[] {
  const quotes: string[] = [];
  let from = 0;
  while (from < lines.length && quotes.length < QUOTED_LINES) {
    let to = from;
    while (!collapsed(lines.slice(from, to + 1).join(" ")).includes(query) && to + 1 < lines.length) {
      to++;
    }
    if (!collapsed(lines.slice(from, to + 1).join(" ")).includes(query)) {
      break;
    }
    // Start the quote at the line the match starts on, not at the line the scan started from.
    let start = from;
    while (start < to && collapsed(lines.slice(start + 1, to + 1).join(" ")).includes(query)) {
      start++;
    }
    quotes.push(lines.slice(start, to + 1).join(" ").replace(/\s+/g, " ").trim());
    from = to + 1;
  }
  return quotes;
}

/**
 * Every section whose text contains `query`, case-insensitively and across the page's line wraps,
 * with up to three of the places it appears.
 */
export function searchRulesText(
  reference: RulesReference,
  query: string
): { anchor: string; title: string; lines: string[] }[] {
  const wanted = collapsed(query);
  if (wanted === "") {
    return [];
  }
  return reference.sections
    .filter((section) => collapsed(section.text).includes(wanted))
    .map(({ anchor, title, text }) => ({ anchor, title, lines: quotedLines(text.split("\n"), wanted) }));
}

/**
 * The data-page entries `query` names: every entry whose name or tag is exactly the query, else the
 * one entry whose name or tag contains it; when several contain it, their names instead, so the
 * assistant can ask again for the one it means.
 */
export function dataEntriesFor(
  reference: RulesReference,
  query: string
): { entries: RulesReferenceEntry[] } | { names: { section: string; name: string; tag: string | null }[] } {
  const lower = query.toLowerCase();
  const exact = reference.data.filter(
    (entry) => entry.name.toLowerCase() === lower || entry.tag?.toLowerCase() === lower
  );
  if (exact.length > 0) {
    return { entries: exact };
  }
  const containing = reference.data.filter(
    (entry) => entry.name.toLowerCase().includes(lower) || (entry.tag?.toLowerCase().includes(lower) ?? false)
  );
  if (containing.length <= 1) {
    return { entries: containing };
  }
  return { names: containing.map(({ section, name, tag }) => ({ section, name, tag })) };
}

/** The part of `fetch` the loader uses. */
export type FetchText = (url: string) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads a world's snapshot text by ruleset id, each world once: the file is part of the build and
 * does not change while the HUD runs. A failed load is forgotten, so the next call tries again.
 * Rejects with a sentence an assistant can read.
 */
export function rulesReferenceLoader(fetchText: FetchText): (rulesetId: string) => Promise<string> {
  const loaded = new Map<string, Promise<string>>();
  return (rulesetId) => {
    const cached = loaded.get(rulesetId);
    if (cached !== undefined) {
      return cached;
    }
    const ruleset = rulesetById(rulesetId);
    const url = ruleset?.referenceUrl;
    if (ruleset === null || url === undefined) {
      return Promise.reject(new Error(`This build carries no rules snapshot for ${ruleset?.label ?? rulesetId}.`));
    }
    const unreadable = (why: string) => new Error(`The rules snapshot for ${ruleset.label} could not be read: ${why}.`);
    const loading = fetchText(url).then(
      (response) => {
        if (!response.ok) {
          throw unreadable(`the shell answered ${response.status}`);
        }
        return response.text().catch((error: unknown) => {
          throw unreadable(messageOf(error));
        });
      },
      (error: unknown) => {
        throw unreadable(messageOf(error));
      }
    );
    loaded.set(rulesetId, loading);
    loading.catch(() => loaded.delete(rulesetId));
    return loading;
  };
}
