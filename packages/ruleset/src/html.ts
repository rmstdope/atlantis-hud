/**
 * Just enough HTML handling for two engine-generated pages.
 *
 * A parser dependency would buy little here: the rules page needs its markup removed so sentences
 * can be matched whole, and the data page is a single `<pre>` block whose line structure is the
 * only structure it has.
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

/**
 * Flattens a page to one long run of text with single spaces between words.
 *
 * Sentences in the rules page wrap across source lines and carry `<a href>` links mid-clause, so
 * matching them requires the markup gone and the whitespace collapsed first.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns the contents of the page's `<pre>` blocks, with markup removed but newlines preserved.
 *
 * The data page puts its whole catalogue in one such block, where a blank line separates entries
 * and indentation continues the previous one.
 */
export function preformattedText(html: string): string {
  const blocks = [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)].map((match) => match[1]);
  return decodeEntities(blocks.join("\n\n").replace(/<[^>]*>/g, ""));
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The header cells and body rows of the first table whose header names every heading given, or
 * `null` when no table's header matches.
 *
 * Shared by {@link tableRows} and {@link tableHeader} so a table is only located once: both read
 * the same match, which keeps the two answers about a lookup by construction rather than by two
 * regexes agreeing by luck.
 */
function findTable(
  html: string,
  headings: string[]
): { header: string[]; body: string[][] } | null {
  const wanted = headings.map((heading) => heading.trim().toLowerCase());

  for (const tableMatch of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) =>
      [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cellMatch) =>
        cellText(cellMatch[1])
      )
    );

    if (rows.length === 0) {
      continue;
    }

    const [header, ...body] = rows;
    const headerCells = header.map((cell) => cell.trim().toLowerCase());
    const matches = wanted.every((heading) => headerCells.includes(heading));
    if (matches) {
      return { header: headerCells, body };
    }
  }

  return null;
}

/**
 * The rows of the first table whose header names every column given, as cells of decoded text.
 *
 * The rules page states the buildings as a table and nothing else in it needs one, so this looks a
 * table up by what its header says rather than by position - a page that grows another table above
 * this one should not silently return that one instead. Empty cells are kept, because the buildings
 * table's header leaves its first cell blank and the column positions have to line up.
 */
export function tableRows(html: string, headings: string[]): string[][] {
  return findTable(html, headings)?.body ?? [];
}

/**
 * The lower-cased header cells of the same table {@link tableRows} would return the body of.
 *
 * Lets a caller find a column by its heading rather than by a fixed index, so a column inserted
 * later does not silently shift another one's meaning.
 */
export function tableHeader(html: string, headings: string[]): string[] | null {
  return findTable(html, headings)?.header ?? null;
}
