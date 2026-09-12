/**
 * This turn's own `DECLARE` orders, read straight out of the orders document.
 *
 * Nothing else does this: `DECLARE` is in the grammar (`crates/core/src/orders/grammar.rs:232-239`)
 * and in `intents.rs`'s `FREE_ORDERS`, but produces no `Intent`, so `OrdersPreviewResponse` carries
 * no faction-level state at all and `ordersDocument.ts` models unit blocks and the `#atlantis`
 * header only.
 *
 * Pure string work, in `packages/shared` because that is where the planner's rules live and the
 * package has no jsdom (ah-nass).
 *
 * **Comments are cut at the first `;` outside a quoted run, and that is deliberately not coupled to
 * any per-world comment policy.** The only case two comment rules could disagree about is a
 * semicolon inside a bare word, and no well-formed `DECLARE` argument contains one: its arguments
 * are `DEFAULT`, a faction number and an attitude word.
 */

/** One attitude word, lower-cased. `ATTITUDES` in `grammar.rs:119` is the list. */
export type Attitude = "ally" | "friendly" | "neutral" | "unfriendly" | "hostile";

const ATTITUDES: readonly Attitude[] = ["ally", "friendly", "neutral", "unfriendly", "hostile"];

/** What one `DECLARE` line of an orders document says. */
export type DeclareChange =
  /** `DECLARE DEFAULT FRIENDLY` - sets our faction's default attitude. */
  | { kind: "default"; attitude: Attitude }
  /** `DECLARE 21 FRIENDLY` - sets our attitude toward one faction. */
  | { kind: "toward"; factionId: string; attitude: Attitude }
  /** `DECLARE 21` - cancels it, so the default applies again. */
  | { kind: "reset"; factionId: string };

/** The line with any comment removed. A `;` inside a `"` quoted run is not a comment. */
function withoutComment(line: string): string {
  let quoted = false;
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ";" && !quoted) {
      return line.slice(0, at);
    }
  }
  return line;
}

function attitudeOf(word: string): Attitude | null {
  const lower = word.toLowerCase();
  return ATTITUDES.find((one) => one === lower) ?? null;
}

/**
 * Every `DECLARE` this document carries, in document order. Malformed lines are ignored.
 *
 * Every line is scanned, not only the ones above the first unit block: `DECLARE` is a faction order
 * and the engine takes it wherever it is written, so a reader that stopped at the first `unit` line
 * would silently miss one a player typed low down.
 */
export function readDeclareOrders(document: string): DeclareChange[] {
  const changes: DeclareChange[] = [];
  for (const raw of document.split("\n")) {
    const words = withoutComment(raw).trim().split(/\s+/).filter((word) => word !== "");
    if (words.length === 0 || words[0].toUpperCase() !== "DECLARE") {
      continue;
    }
    const target = words[1];
    if (target === undefined) {
      continue;
    }
    if (target.toUpperCase() === "DEFAULT") {
      const attitude = words[2] === undefined ? null : attitudeOf(words[2]);
      if (attitude !== null) {
        changes.push({ kind: "default", attitude });
      }
      continue;
    }
    if (!/^[0-9]+$/.test(target)) {
      continue;
    }
    if (words[2] === undefined) {
      changes.push({ kind: "reset", factionId: target });
      continue;
    }
    const attitude = attitudeOf(words[2]);
    if (attitude !== null) {
      changes.push({ kind: "toward", factionId: target, attitude });
    }
  }
  return changes;
}
