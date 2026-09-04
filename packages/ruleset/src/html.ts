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

/**
 * The rows of the first `<table>` after a named anchor, each row as its cells' text.
 *
 * The rules page's only tabular data is markup rather than prose, and `htmlToText` - which exists
 * to flatten wrapped sentences - cannot express it: it returns one line with the cell boundaries
 * gone. An anchor or a table that is not there yields `[]`; the caller decides whether that is
 * fatal.
 */
export function anchoredTableRows(html: string, anchor: string): string[][] {
  const at = html.search(new RegExp(`<a\\b[^>]*name="${anchor}"`, "i"));
  if (at === -1) {
    return [];
  }
  const table = html.slice(at).match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
  if (!table) {
    return [];
  }
  return [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => htmlToText(cell[1]))
  );
}
