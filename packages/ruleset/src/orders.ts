/**
 * Reads what the rules page says about each order: the order sections of `rules/orders`, between
 * the `ordersummary` and `sequenceofevents` anchors, each closed by a `<div class="rule">`.
 *
 * Carried into the ruleset for the game data dialog (ah-mlls.6), verbatim. Every section opens with
 * one `<h4>` per form, then prose in `<p>`, then - behind a paragraph reading `Example:`,
 * `Examples:` or `Examples` (`rules/armor` drops the colon) - sentence and `<pre>` pairs.
 *
 * Sections are split on the divider and keyed by the first word of their first heading rather
 * than by anchor: New Age's CREATE section is anchored `create_village`, and DISTRIBUTE's anchor
 * sits inside TRANSPORT's section, which has no heading of its own to give it.
 *
 * Tolerant, like the item catalogue: a section that reads oddly costs only itself. Only a page with
 * no order section at all stops the run.
 */

import type { OrderEntry } from "./generated/OrderEntry";
import type { OrderExample } from "./generated/OrderExample";
import { htmlToText, preText } from "./html";
import { RulesetScrapeError } from "./rules";

export type { OrderEntry } from "./generated/OrderEntry";
export type { OrderExample } from "./generated/OrderExample";

/** Every order the page describes, keyed by its keyword in capitals. */
export type OrderReference = Record<string, OrderEntry>;

const EXAMPLES_MARKER = /^Examples?:?$/i;

type Block = { tag: string; inner: string };

function blocksOf(section: string): Block[] {
  return [...section.matchAll(/<(h4|p|pre|ul|table)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => ({
    tag: match[1].toLowerCase(),
    inner: match[2]
  }));
}

/** A list's items, or a table's rows, as the paragraphs they read as. */
function paragraphsOf(block: Block): string[] {
  if (block.tag === "ul") {
    return [...block.inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((item) => htmlToText(item[1]))
      .filter((text) => text !== "")
      .map((text) => `• ${text}`);
  }
  if (block.tag === "table") {
    return [...block.inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((row) =>
        [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
          .map((cell) => htmlToText(cell[1]))
          .filter((text) => text !== "")
          .join(" — ")
      )
      .filter((text) => text !== "");
  }
  const text = htmlToText(block.inner);
  return text === "" ? [] : [text];
}

function readSection(blocks: readonly Block[]): OrderEntry {
  const forms: string[] = [];
  const description: string[] = [];
  const examples: OrderExample[] = [];
  let inExamples = false;
  for (const block of blocks) {
    if (block.tag === "h4") {
      forms.push(htmlToText(block.inner));
      continue;
    }
    if (block.tag === "pre") {
      const order = preText(block.inner);
      const last = examples[examples.length - 1];
      if (last === undefined) {
        // An order block before any sentence has nothing to illustrate; kept as prose.
        description.push(order);
      } else {
        last.order = last.order === null ? order : `${last.order}\n\n${order}`;
      }
      continue;
    }
    const paragraphs = paragraphsOf(block);
    if (!inExamples && paragraphs.length === 1 && EXAMPLES_MARKER.test(paragraphs[0])) {
      inExamples = true;
      continue;
    }
    if (inExamples) {
      for (const text of paragraphs) {
        examples.push({ text, order: null });
      }
    } else {
      description.push(...paragraphs);
    }
  }
  return { forms, description, examples };
}

/** Reads every order section of the rules page. */
export function parseOrderReference(rulesHtml: string): OrderReference {
  const from = rulesHtml.search(/<a\b[^>]*name="ordersummary"/i);
  const to = rulesHtml.search(/<a\b[^>]*name="sequenceofevents"/i);
  if (from === -1) {
    throw new RulesetScrapeError(
      'could not read orders from the rules page: no "ordersummary" anchor opens the order sections'
    );
  }
  const region = rulesHtml.slice(from, to === -1 ? undefined : to);

  // A null prototype, as `parseRegionResources` uses: a keyword is a key, never a property lookup.
  const orders: OrderReference = Object.create(null) as OrderReference;
  for (const section of region.split(/<div\b[^>]*class="rule"[^>]*>[\s\S]*?<\/div>/i)) {
    const blocks = blocksOf(section);
    const heading = blocks.find((block) => block.tag === "h4");
    if (heading === undefined) {
      continue;
    }
    const keyword = htmlToText(heading.inner).split(" ")[0]?.toUpperCase() ?? "";
    if (!/^[A-Z]+$/.test(keyword)) {
      continue;
    }
    const entry = readSection(blocks);
    const known = orders[keyword];
    orders[keyword] =
      known === undefined
        ? entry
        : {
            forms: [...known.forms, ...entry.forms],
            description: [...known.description, ...entry.description],
            examples: [...known.examples, ...entry.examples]
          };
  }
  if (Object.keys(orders).length === 0) {
    throw new RulesetScrapeError(
      "could not read orders from the rules page: no order section opens with a heading"
    );
  }
  return orders;
}
