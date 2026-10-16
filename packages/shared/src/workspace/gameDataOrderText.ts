/**
 * Where an order's text mentions another order, for the game data dialog's links (ah-mlls.6).
 *
 * A mention is the keyword in capitals followed by `order` or `orders` - "see the GIVE order", the
 * way the rules page writes them (`rules/form`, `rules/take`) - and only for a keyword the world's
 * grammar lists. Agreed with the navigator so that ordinary words are never linked: "the order
 * DISTRIBUTE", "TAKE FROM" and "the END keyword" stay plain text. The entry's own order is never a
 * link, since following it would go nowhere.
 */

import { orderEntryId } from "../gameData";

export type OrderTextPart = { text: string } | { text: string; entryId: string };

const MENTION = /\b([A-Z]+)(?= orders?\b)/g;

/** Splits `text` into plain runs and linked keywords; joined back, the parts are `text` again. */
export function orderMentions(
  text: string,
  orders: ReadonlySet<string>,
  self: string
): OrderTextPart[] {
  const parts: OrderTextPart[] = [];
  let from = 0;
  for (const match of text.matchAll(MENTION)) {
    const keyword = match[1];
    if (keyword === self || !orders.has(keyword)) {
      continue;
    }
    if (match.index > from) {
      parts.push({ text: text.slice(from, match.index) });
    }
    parts.push({ text: keyword, entryId: orderEntryId(keyword) });
    from = match.index + keyword.length;
  }
  if (from < text.length || parts.length === 0) {
    parts.push({ text: text.slice(from) });
  }
  return parts;
}
