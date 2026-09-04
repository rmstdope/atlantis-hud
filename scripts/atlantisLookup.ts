/**
 * Pure parsing and rendering over the Atlantis rules and data pages — no I/O, no network.
 *
 * `scripts/atlantis.ts` does the file reads, the fetches and the CLI plumbing; everything that can
 * be tested without touching the filesystem lives here instead, the same split
 * `scripts/releaseSupport.ts` makes beside `scripts/release.ts`.
 */

// ---- shared: entity decoding --------------------------------------------------------------

/**
 * `packages/ruleset/src/html.ts` keeps its own copy of this private; nothing there exports it, and
 * `htmlToText` is the wrong tool here (see the header on `rulesSection` below), so this stays a
 * second, small copy rather than a shared dependency for a dozen lines.
 */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// ---- the rules page -------------------------------------------------------------------------

const ANCHOR_RE = /<a name="([^"]*)">/g;

/** Every `<a name="…">` on the rules page, in document order. 129 on the committed page. */
export function rulesAnchors(html: string): string[] {
  const anchors: string[] = [];
  const re = new RegExp(ANCHOR_RE);
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    anchors.push(match[1]);
  }
  return anchors;
}

type Segment = { kind: "table" | "pre" | "prose"; raw: string };

/**
 * Splits a slice of the rules page into protected blocks (tables and `<pre>`s, which must keep
 * their internal whitespace) and prose runs (which get their whitespace collapsed). Collapsing a
 * table's whitespace the same way prose gets collapsed destroys its column alignment - the bug the
 * first attempt at this renderer had.
 */
function splitProtected(segment: string): Segment[] {
  const segments: Segment[] = [];
  const re = /<table\b[^>]*>[\s\S]*?<\/table>|<pre\b[^>]*>[\s\S]*?<\/pre>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(segment)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "prose", raw: segment.slice(lastIndex, match.index) });
    }
    segments.push({
      kind: match[0].toLowerCase().startsWith("<table") ? "table" : "pre",
      raw: match[0]
    });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < segment.length) {
    segments.push({ kind: "prose", raw: segment.slice(lastIndex) });
  }
  return segments;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Renders a `<table>` as aligned columns: every cell's tags stripped and whitespace collapsed to
 * one space, every row padded to the widest row's cell count, every column left-padded to its
 * widest cell and joined with two spaces, each row's trailing padding trimmed.
 *
 * A naive `</td>` → separator replacement is not enough - the cell text sits on its own source
 * line inside the `<td>`, so the source newline splits the row before any separator is added.
 * Stripping tags and collapsing whitespace on the whole cell first is what avoids that.
 */
function renderTable(raw: string): string {
  const rows = [...raw.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) =>
    [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cellMatch) =>
      decodeEntities(stripTags(cellMatch[1]))
        .replace(/\s+/g, " ")
        .trim()
    )
  );

  const width = Math.max(0, ...rows.map((row) => row.length));
  const padded = rows.map((row) => {
    const filled = [...row];
    while (filled.length < width) {
      filled.push("");
    }
    return filled;
  });
  const columnWidths = Array.from({ length: width }, (_, column) =>
    Math.max(0, ...padded.map((row) => row[column].length))
  );

  return padded
    .map((row) => row.map((cell, column) => cell.padEnd(columnWidths[column])).join("  ").trimEnd())
    .join("\n");
}

/** Renders a `<pre>` block: tags stripped, entities decoded, leading/trailing newlines stripped. */
function renderPre(raw: string): string {
  const inner = raw.replace(/^<pre\b[^>]*>/i, "").replace(/<\/pre>$/i, "");
  return decodeEntities(stripTags(inner))
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

const PROSE_BREAK_CLOSERS = /<\/(p|div|h[1-6]|li|blockquote)>/gi;
const PROSE_BREAK_BR = /<br\s*\/?>/gi;

/**
 * Renders a prose run: known block closers and `<br>` become newlines, remaining tags are
 * stripped, entities decoded, then each line has its runs of spaces/tabs collapsed and trimmed,
 * with consecutive blank lines dropped.
 */
function renderProse(raw: string): string {
  const withBreaks = raw.replace(PROSE_BREAK_CLOSERS, "\n").replace(PROSE_BREAK_BR, "\n");
  const flat = decodeEntities(stripTags(withBreaks));

  const collapsed: string[] = [];
  for (const rawLine of flat.split("\n")) {
    const line = rawLine.replace(/[ \t]+/g, " ").trim();
    if (line === "" && collapsed[collapsed.length - 1] === "") {
      continue;
    }
    collapsed.push(line);
  }

  return collapsed.join("\n").trim();
}

function renderRulesSegment(segment: string): string {
  const withoutScriptsOrStyles = segment.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  const rendered = splitProtected(withoutScriptsOrStyles).map((piece) => {
    if (piece.kind === "table") {
      return renderTable(piece.raw);
    }
    if (piece.kind === "pre") {
      return renderPre(piece.raw);
    }
    return renderProse(piece.raw);
  });

  return rendered
    .filter((piece) => piece.trim().length > 0)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The rendered text between one anchor and the next, or null when there is no such anchor. Tables
 * render as aligned columns and `<pre>` blocks keep their line breaks.
 */
export function rulesSection(html: string, anchor: string): string | null {
  const tag = `<a name="${anchor}">`;
  const start = html.indexOf(tag);
  if (start === -1) {
    return null;
  }

  const contentStart = start + tag.length;
  const nextAnchor = new RegExp(ANCHOR_RE);
  nextAnchor.lastIndex = contentStart;
  const next = nextAnchor.exec(html);
  const end = next ? next.index : html.length;

  return renderRulesSegment(html.slice(contentStart, end));
}

/** Anchors whose rendered text contains `term`, case-insensitively, in document order. */
export function searchRules(html: string, term: string): string[] {
  const lower = term.toLowerCase();
  return rulesAnchors(html).filter((anchor) => {
    const section = rulesSection(html, anchor);
    return section !== null && section.toLowerCase().includes(lower);
  });
}

/** Classic edit distance - written here rather than pulled in as a dependency for twelve lines. */
function levenshteinDistance(a: string, b: string): number {
  const previousRow = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i++) {
    let diagonal = previousRow[0];
    previousRow[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = previousRow[j];
      previousRow[j] =
        a[i - 1] === b[j - 1] ? diagonal : 1 + Math.min(diagonal, previousRow[j], previousRow[j - 1]);
      diagonal = temp;
    }
  }

  return previousRow[b.length];
}

/**
 * Up to `limit` (default 3) anchors closest to a mistyped name, best first; empty when none are
 * close. Every anchor containing `wanted` as a case-insensitive substring, in document order, then
 * every anchor within Levenshtein distance 2 of `wanted`, nearest first, deduped.
 */
export function nearestAnchors(wanted: string, anchors: string[], limit = 3): string[] {
  const lower = wanted.toLowerCase();

  const substringMatches = anchors.filter((anchor) => anchor.toLowerCase().includes(lower));
  const closeMatches = anchors
    .map((anchor) => ({ anchor, distance: levenshteinDistance(lower, anchor.toLowerCase()) }))
    .filter(({ distance }) => distance <= 2)
    .sort((a, b) => a.distance - b.distance)
    .map(({ anchor }) => anchor);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const anchor of [...substringMatches, ...closeMatches]) {
    if (seen.has(anchor)) {
      continue;
    }
    seen.add(anchor);
    result.push(anchor);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

/**
 * The rules page's own banner: the first `<h1>`'s text, and whatever follows `Last Change:`
 * wherever on the page it appears. Both null rather than throwing when the page has neither - a
 * provenance line is a courtesy, and a page that has lost its banner is still answerable.
 *
 * Quoting the page beats matching one server's wording: the New Origins page writes
 * `Rules for NewOrigins v8.0.0` in an `<h1>` and its date in an `<h3>`, while a New Age world
 * writes `NewAge 1.2 Rules — Arcanum` and puts its date in a `<p>`.
 */
export function rulesProvenance(html: string): { edition: string | null; lastChange: string | null } {
  // The first h1 only: the New Origins page carries a second one, `Based on Atlantis v5.2.5`,
  // which is the engine version rather than the edition.
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const edition = heading ? heading[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : null;

  // Anchored on the text rather than on the element, because the two servers put it in different
  // ones - an `<h3>` on New Origins and a `<p>` on a New Age world. The first occurrence is taken
  // to be the banner's; a page that discussed the phrase in prose above its banner would report
  // that instead, which is why this is a courtesy line and never something a fact is cited from.
  const change = html.match(/Last Change:\s*([^<]*)/);
  const lastChange = change ? change[1].replace(/\s+/g, " ").trim() : null;

  return { edition: edition || null, lastChange: lastChange || null };
}

// ---- the data page ---------------------------------------------------------------------------

export type DataSection = "skills" | "items" | "objects";

export type DataEntry = {
  section: DataSection;
  /** The entry's first source line, e.g. `mining [MINI] 1: This skill deals with all aspects of…` */
  head: string;
  /** The whole entry, continuation lines included, newlines preserved, trailing blank lines removed. */
  text: string;
  /** `mining`, `mithril sword`, `Tower` — the name as the page writes it. */
  name: string;
  /** `MINI`, `MSWO`. Null for objects, which carry no bracketed tag. */
  tag: string | null;
  /** 1–5 for a skill entry; null for items and objects. */
  level: number | null;
  /** True when the entry's body is exactly `No skill report.` */
  empty: boolean;
};

const SECTION_HEADINGS: Record<string, DataSection> = {
  "Skill reports:": "skills",
  "Item reports:": "items",
  "Object reports:": "objects"
};

// name [TAG] level: body   — tags are not uniformly four letters (some items are three or five).
const SKILL_HEAD_RE = /^(.+?) \[([A-Z]+)\] (\d+): /;
// name [TAG], body   or   name [TAG]. body   (ships use a full stop, everything else a comma)
const ITEM_HEAD_RE = /^(.+?) \[([A-Z]+)\][,.] /;
// name: body   — objects carry no bracketed tag at all
const OBJECT_HEAD_RE = /^([^:[]+): /;

function makeEntry(section: DataSection, lines: string[]): DataEntry {
  const head = lines[0];
  const text = lines.join("\n").replace(/\n+$/, "");

  if (section === "skills") {
    const match = head.match(SKILL_HEAD_RE);
    const body = match ? head.slice(match[0].length) : head;
    return {
      section,
      head,
      text,
      name: match?.[1] ?? "",
      tag: match?.[2] ?? null,
      level: match ? Number(match[3]) : null,
      empty: body.trim() === "No skill report."
    };
  }

  if (section === "items") {
    const match = head.match(ITEM_HEAD_RE);
    return {
      section,
      head,
      text,
      name: match?.[1] ?? "",
      tag: match?.[2] ?? null,
      level: null,
      empty: false
    };
  }

  const match = head.match(OBJECT_HEAD_RE);
  return {
    section,
    head,
    text,
    name: match?.[1] ?? "",
    tag: null,
    level: null,
    empty: false
  };
}

/**
 * Every entry on the data page. An entry starts at a line with no leading whitespace; its
 * continuation lines are indented; a blank line ends it. Three lines are section headings rather
 * than entries - a short line at column 0 ending in a colon - and they set the section for
 * everything that follows.
 */
export function dataEntries(preText: string): DataEntry[] {
  const entries: DataEntry[] = [];
  let section: DataSection | null = null;
  let current: string[] | null = null;

  const flush = () => {
    if (current && current.length > 0 && section) {
      entries.push(makeEntry(section, current));
    }
    current = null;
  };

  for (const line of preText.split("\n")) {
    const trimmed = line.trim();

    if (trimmed === "") {
      flush();
      continue;
    }

    const heading = SECTION_HEADINGS[trimmed];
    if (heading && line === trimmed) {
      flush();
      section = heading;
      continue;
    }

    const isEntryStart = line === line.trimStart();
    if (isEntryStart) {
      flush();
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  flush();

  return entries;
}

/** Entries whose `name` or `tag` contains `term`, case-insensitively. */
export function findDataEntries(entries: DataEntry[], term: string): DataEntry[] {
  const lower = term.toLowerCase();
  return entries.filter(
    (entry) =>
      entry.name.toLowerCase().includes(lower) || (entry.tag?.toLowerCase().includes(lower) ?? false)
  );
}

/** Full text of the matched entries, with empty skill levels collapsed into one trailing line. */
export function renderDataEntries(matched: DataEntry[]): string {
  const withContent = matched.filter((entry) => !entry.empty);
  const emptyLevels = matched
    .filter((entry) => entry.empty && entry.level !== null)
    .map((entry) => entry.level as number)
    .sort((a, b) => a - b);

  const parts = withContent.map((entry) => entry.text);
  if (emptyLevels.length > 0) {
    parts.push(`levels ${emptyLevels.join(", ")}: no skill report`);
  }

  return parts.join("\n\n");
}

/** One line per distinct name, in the order the entries were matched - for the ambiguous case and for `--list`. */
export function renderDataIndex(matched: DataEntry[]): string {
  return [...new Set(matched.map((entry) => entry.name))].join("\n");
}
