import { describe, expect, it } from "vitest";
import {
  commandsOnly,
  findUnitBlocks,
  hasFactionHeader,
  readUnitOrders,
  stripUnitComments,
  withoutTrailingBlankLines,
  writeUnitOrders
} from "./ordersDocument";

/** Shaped exactly like the template a real report carries. */
const DOCUMENT = [
  '#atlantis 95 "secret"',
  "",
  ";*** mountain (7,53) in Inhead ***",
  "",
  "unit 18642",
  ";Seven of Eight (18642), avoiding, behind, leader [LEAD].",
  "@claim 50",
  "@study obse",
  "",
  "unit 13401",
  ";Drone (13401), behind.",
  "",
  "#end"
].join("\n");

describe("finding unit blocks", () => {
  it("finds every unit in the document", () => {
    expect(findUnitBlocks(DOCUMENT).map((block) => block.unitId)).toEqual(["18642", "13401"]);
  });

  it("does not let a unit swallow the document's closing directive", () => {
    const last = findUnitBlocks(DOCUMENT)[1];
    const lines = DOCUMENT.split("\n");
    expect(lines[last.lastLine]).toBe(";Drone (13401), behind.");
  });
});

describe("reading a unit's orders", () => {
  it("returns the unit's own lines, comments included", () => {
    expect(readUnitOrders(DOCUMENT, "18642")).toBe(
      [";Seven of Eight (18642), avoiding, behind, leader [LEAD].", "@claim 50", "@study obse"].join(
        "\n"
      )
    );
  });

  it("returns nothing for a unit the document does not list", () => {
    expect(readUnitOrders(DOCUMENT, "99999")).toBeNull();
  });

  it("distinguishes a unit with no orders from one that is absent", () => {
    const empty = ["#atlantis 95 \"secret\"", "unit 100", "", "#end"].join("\n");
    expect(readUnitOrders(empty, "100")).toBe("");
    expect(readUnitOrders(empty, "200")).toBeNull();
  });
});

describe("writing a unit's orders", () => {
  it("leaves every other byte of the document untouched", () => {
    const updated = writeUnitOrders(DOCUMENT, "18642", "@work");

    expect(updated).toContain('#atlantis 95 "secret"');
    expect(updated).toContain(";*** mountain (7,53) in Inhead ***");
    expect(updated).toContain("unit 13401");
    expect(updated).toContain(";Drone (13401), behind.");
    expect(updated.trimEnd().endsWith("#end")).toBe(true);
  });

  it("replaces only the edited unit's lines", () => {
    const updated = writeUnitOrders(DOCUMENT, "18642", "@work");

    expect(readUnitOrders(updated, "18642")).toBe("@work");
    expect(readUnitOrders(updated, "13401")).toBe(";Drone (13401), behind.");
  });

  it("round trips a document when nothing is changed", () => {
    const unchanged = writeUnitOrders(DOCUMENT, "18642", readUnitOrders(DOCUMENT, "18642") ?? "");
    expect(unchanged).toBe(DOCUMENT);
  });

  it("preserves the faction header, which carries the password", () => {
    const updated = writeUnitOrders(DOCUMENT, "13401", "@work");
    expect(hasFactionHeader(updated)).toBe(true);
    expect(updated.split("\n")[0]).toBe('#atlantis 95 "secret"');
  });

  it("clears a unit's orders without collapsing the document", () => {
    const updated = writeUnitOrders(DOCUMENT, "18642", "");

    expect(readUnitOrders(updated, "18642")).toBe("");
    expect(updated).toContain("unit 13401");
    expect(hasFactionHeader(updated)).toBe(true);
  });

  it("refuses to invent a block for a unit the server never listed", () => {
    // Such an orders file would be rejected, so leaving the document alone is the honest outcome.
    expect(writeUnitOrders(DOCUMENT, "99999", "@work")).toBe(DOCUMENT);
  });
});

/**
 * Two regions, as every real report has.
 *
 * The banner announcing the second region sits after the first region's last unit and before the
 * second region's first one - which is to say, in the middle, where a naive reading of "everything
 * until the next unit line" hands it to the unit above.
 */
const TWO_REGIONS = [
  '#atlantis 95 "secret"',
  "",
  ";*** mountain (7,53) in Inhead, contains Inholm [city] ***",
  "",
  "unit 18642",
  ";Seven of Eight (18642), avoiding, behind, leader [LEAD].",
  "@claim 50",
  "@study obse",
  "",
  ";*** desert (15,63) in Feltiuckfex, contains Trasicy [city] ***",
  "",
  "unit 1688",
  ";Drone (1688), avoiding, behind.",
  "@work",
  "",
  "#end"
].join("\n");

describe("a region banner belongs to the document, not to the unit above it", () => {
  it("stops a unit's block at the banner announcing the next region", () => {
    expect(readUnitOrders(TWO_REGIONS, "18642")).toBe(
      [";Seven of Eight (18642), avoiding, behind, leader [LEAD].", "@claim 50", "@study obse"].join(
        "\n"
      )
    );
  });

  it("ends the block on the unit's own last line", () => {
    const block = findUnitBlocks(TWO_REGIONS)[0];
    expect(TWO_REGIONS.split("\n")[block.lastLine]).toBe("@study obse");
  });

  it("leaves the banner standing when that unit's orders are rewritten", () => {
    const updated = writeUnitOrders(TWO_REGIONS, "18642", "@work");

    expect(updated).toContain(";*** desert (15,63) in Feltiuckfex, contains Trasicy [city] ***");
    expect(readUnitOrders(updated, "18642")).toBe("@work");
    expect(readUnitOrders(updated, "1688")).toBe([";Drone (1688), avoiding, behind.", "@work"].join("\n"));
  });

  it("keeps both banners out of the editor once the descriptions are dropped", () => {
    const stripped = stripUnitComments(TWO_REGIONS);

    expect(readUnitOrders(stripped, "18642")).toBe(["@claim 50", "@study obse"].join("\n"));
    expect(readUnitOrders(stripped, "1688")).toBe("@work");
    expect(stripped).toContain(";*** mountain (7,53) in Inhead, contains Inholm [city] ***");
    expect(stripped).toContain(";*** desert (15,63) in Feltiuckfex, contains Trasicy [city] ***");
  });
});

/** A unit's description as the server really sends it: wrapped, every line marked. */
const WRAPPED = [
  '#atlantis 73 "secret"',
  "",
  ";*** mountain (13,63) in Liou'ecpu, contains Rihead [town] ***",
  "",
  "unit 793",
  ";Three of Five (793), behind, revealing faction, leader [LEAD]. Weight:",
  ";  10. Capacity: 0/0/15/0. Skills: observation [OBSE] 1 (35), force",
  ";  [FORC] 1 (35), pattern [PATT] 1 (30), spirit [SPIR] 1 (30).",
  "@study obse",
  "",
  "unit 1382",
  ";Unit (1382), behind, revealing faction, leader [LEAD]. Weight: 10.",
  ";  Capacity: 0/0/15/0. Skills: force [FORC] 1 (60).",
  "",
  "#end"
].join("\n");

describe("dropping the server's unit descriptions", () => {
  it("removes a description however many lines it wraps to", () => {
    const stripped = stripUnitComments(WRAPPED);

    expect(stripped).not.toContain("Three of Five");
    expect(stripped).not.toContain("Capacity");
    expect(stripped).not.toContain("[FORC]");
  });

  it("leaves the orders the player has already written", () => {
    expect(readUnitOrders(stripUnitComments(WRAPPED), "793")).toBe("@study obse");
  });

  it("keeps the region banners, which belong to the document and not to any unit", () => {
    expect(stripUnitComments(WRAPPED)).toContain(
      ";*** mountain (13,63) in Liou'ecpu, contains Rihead [town] ***"
    );
  });

  it("keeps the faction header, which carries the password, and the closing directive", () => {
    const stripped = stripUnitComments(WRAPPED);

    expect(hasFactionHeader(stripped)).toBe(true);
    expect(stripped.split("\n")[0]).toBe('#atlantis 73 "secret"');
    expect(stripped.trimEnd().endsWith("#end")).toBe(true);
  });

  it("leaves a unit whose block was nothing but description ready to be ordered", () => {
    // Empty, not absent: an empty block still accepts orders, where a missing one is refused.
    expect(readUnitOrders(stripUnitComments(WRAPPED), "1382")).toBe("");
    expect(readUnitOrders(stripUnitComments(WRAPPED), "9999")).toBeNull();
  });

  it("keeps every unit's block, so no unit becomes unorderable", () => {
    expect(findUnitBlocks(stripUnitComments(WRAPPED)).map((block) => block.unitId)).toEqual([
      "793",
      "1382"
    ]);
  });

  it("leaves a repeating comment alone, which is an order rather than a description", () => {
    // `@;` repeats a comment into next turn's template. The server does not write them; a player
    // might, and dropping one would delete something they typed.
    const withRepeat = ["unit 793", "@;remember to tax here", "@study obse"].join("\n");
    expect(stripUnitComments(withRepeat)).toBe(withRepeat);
  });

  it("goes by the first non-blank character, so indentation hides nothing and spares nothing", () => {
    const indented = ["unit 793", "  ;an indented description", "  @;keep me", "@study obse"].join(
      "\n"
    );

    expect(stripUnitComments(indented)).toBe(
      ["unit 793", "  @;keep me", "@study obse"].join("\n")
    );
  });

  it("leaves a document that carries no descriptions exactly as it was", () => {
    const plain = ["#atlantis 73 \"secret\"", "unit 793", "@study obse", "#end"].join("\n");
    expect(stripUnitComments(plain)).toBe(plain);
  });
});

describe("trailing blank lines", () => {
  it("cannot survive the round trip, which is why the editor keeps its own draft", () => {
    // A blank line at the end of a block is indistinguishable from the separator before the next
    // unit, so the document cannot hold one. The panel guards against this rather than fighting it.
    const updated = writeUnitOrders(DOCUMENT, "18642", "@work\n");
    expect(readUnitOrders(updated, "18642")).toBe("@work");
  });

  it("are dropped from the end and nowhere else", () => {
    expect(withoutTrailingBlankLines("@work\n")).toBe("@work");
    expect(withoutTrailingBlankLines("@work\n\n\n")).toBe("@work");
    expect(withoutTrailingBlankLines("@work\n\n@study obse")).toBe("@work\n\n@study obse");
    expect(withoutTrailingBlankLines("@work")).toBe("@work");
    expect(withoutTrailingBlankLines("")).toBe("");
    expect(withoutTrailingBlankLines("\n\n")).toBe("");
  });

  it("counts a line of nothing but spaces as blank, since the server reads it as one", () => {
    expect(withoutTrailingBlankLines("@work\n   \n")).toBe("@work");
  });

  it("changes nothing in the document when the draft merely ends in one", () => {
    expect(writeUnitOrders(DOCUMENT, "18642", "@work\n")).toBe(
      writeUnitOrders(DOCUMENT, "18642", "@work")
    );
  });

  /**
   * The editor keeps a trailing blank line the document cannot, which is what makes Enter work. If
   * the document took a copy of it anyway it would keep it forever: the read back excludes it, so
   * the next write lands above it and leaves it there. Every line opened would leave one behind.
   */
  it("does not pile up as line after line is opened and filled", () => {
    let document = DOCUMENT;
    for (let cycle = 1; cycle <= 4; cycle += 1) {
      const opened = `${readUnitOrders(document, "18642")}\n`;
      document = writeUnitOrders(document, "18642", opened);
      document = writeUnitOrders(document, "18642", `${opened}@order${cycle}`);
    }

    expect(document).toBe(
      writeUnitOrders(
        DOCUMENT,
        "18642",
        [
          ";Seven of Eight (18642), avoiding, behind, leader [LEAD].",
          "@claim 50",
          "@study obse",
          "@order1",
          "@order2",
          "@order3",
          "@order4"
        ].join("\n")
      )
    );
  });
});

describe("reading orders without the commentary", () => {
  it("drops the game's descriptive comments", () => {
    expect(commandsOnly(readUnitOrders(DOCUMENT, "18642") ?? "")).toEqual([
      "@claim 50",
      "@study obse"
    ]);
  });

  it("reports no commands for a unit that only carries a comment", () => {
    expect(commandsOnly(readUnitOrders(DOCUMENT, "13401") ?? "")).toEqual([]);
  });
});
