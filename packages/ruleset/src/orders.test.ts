import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseOrderReference } from "./orders";
import { RulesetScrapeError } from "./rules";

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../tests/fixtures/ruleset/${name}`, import.meta.url)),
    "utf8"
  );
}

const ORIGINS = parseOrderReference(fixture("neworigins-rules.html"));
const ARCANUM = parseOrderReference(fixture("newage-arcanum-rules.html"));
const TRIDENT = parseOrderReference(fixture("newage-trident-rules.html"));

describe("parseOrderReference (rules/orders)", () => {
  it("reads one record per order section, keyed by the keyword", () => {
    expect(Object.keys(ORIGINS)).toHaveLength(60);
    expect(Object.keys(ARCANUM)).toHaveLength(62);
    expect(ORIGINS.ANNIHILATE).toBeDefined();
    expect(ARCANUM.CAPITAL).toBeDefined();
    expect(ARCANUM.ANNIHILATE).toBeUndefined();
  });

  it("gives GIVE its five forms in page order (rules/give)", () => {
    expect(ORIGINS.GIVE.forms).toEqual([
      "GIVE [unit] [quantity] [item]",
      "GIVE [unit] ALL [item]",
      "GIVE [unit] ALL [item] EXCEPT [quantity]",
      "GIVE [unit] ALL [item class]",
      "GIVE [unit] UNIT"
    ]);
  });

  it("collapses a form that wraps across source lines", () => {
    expect(ORIGINS.EXCHANGE.forms).toEqual([
      "EXCHANGE [unit] [quantity given] [item given] [quantity expected] [item expected]"
    ]);
  });

  it("keeps the prose paragraph by paragraph, with the links' words and no markup", () => {
    const give = ORIGINS.GIVE.description;
    expect(give[0]).toMatch(/^The first form of the GIVE order gives a quantity of an item/);
    expect(give.at(-1)).toBe("If 0 is specified as the unit number, then the items are discarded.");
    expect(give.some((paragraph) => paragraph.includes("with a GIVE order."))).toBe(true);
    expect(give.join(" ")).not.toMatch(/<|Examples/);
  });

  it("pairs each example sentence with its order line, dedented", () => {
    expect(ORIGINS.GIVE.examples[0]).toEqual({
      text: "Give 10 swords to unit 4573.",
      order: "GIVE 4573 10 swords"
    });
    expect(ORIGINS.GIVE.examples[1]).toEqual({
      text: "Give 5 chain armor to the new unit, alias 2, belonging to faction 14.",
      order: 'GIVE FACTION 14 NEW 2 5 "Chain armor"'
    });
    expect(ARCANUM.GIVE.examples[0]?.order).toBe("GIVE 4573 10 swords");
  });

  it("keeps an example's inner indentation and its line breaks", () => {
    const order = ORIGINS.FORM.examples[0]?.order ?? "";
    expect(order.split("\n").slice(0, 4)).toEqual([
      "UNIT 17",
      "FORM 1",
      '    NAME UNIT "Merlin\'s Guards"',
      "    BUY 5 Plainsmen"
    ]);
    expect(order.endsWith("GIVE NEW 2 2000 silver")).toBe(true);
  });

  it("finds the examples behind a marker written without its colon (ARMOR)", () => {
    expect(ORIGINS.ARMOR.examples).toEqual([
      { text: "Set the unit to select chain armor before plate armor.", order: "ARMOR CARM PARM" },
      { text: "Clear the preferred armor list.", order: "ARMOR" }
    ]);
    expect(ORIGINS.ARMOR.description.join(" ")).not.toContain("Examples");
  });

  it("keeps a closing example sentence that has no order line (TAKE)", () => {
    expect(ORIGINS.TAKE.examples.at(-1)).toEqual({
      text: "See the TURN order for an example of a caravan using TAKE FROM.",
      order: null
    });
  });

  it("reads a table row and a list item as paragraphs of their own", () => {
    expect(ORIGINS.OPTION.description).toContain("~~~~ — OCEAN HEX");
    expect(
      TRIDENT.QUEST.description.some((paragraph) =>
        paragraph.startsWith("• RESOURCE — reward drawn from the raw materials pool")
      )
    ).toBe(true);
  });

  it("gives no record to an order without a section of its own", () => {
    expect(ORIGINS.END).toBeUndefined();
    expect(ORIGINS.ENDTURN).toBeUndefined();
    expect(ARCANUM.DISTRIBUTE).toBeUndefined();
  });

  it("stops the run when the page has no order section at all", () => {
    expect(() => parseOrderReference("<html><body><p>Nothing here</p></body></html>")).toThrow(
      RulesetScrapeError
    );
  });
});
