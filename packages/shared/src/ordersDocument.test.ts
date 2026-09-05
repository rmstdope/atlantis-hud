import { describe, expect, it } from "vitest";
import { readReport } from "@atlantis/fixtures";
import {
  MOVEMENT_ORDER_COMMANDS,
  aParsedReport,
  aReportHeaderInfo,
  aReportRegion
} from "@atlantis/core-client";
import { REPORT_NAMES_NO_FACTION, judgeReportUsable } from "./reportLoadDecision";
import { isOrdersFile } from "./ordersImport";
import {
  applyUnitOrders,
  blockFor,
  formBlockFor,
  commandsOnly,
  ensureUnitBlock,
  findFormBlocks,
  findUnitBlocks,
  formedAlias,
  regionUnitIdsAt,
  repairFormedUnitBlocks,
  hasFactionHeader,
  LONG_ORDER_COMMANDS,
  longOrderOf,
  readUnitOrders,
  seedOrdersDocument,
  regionBannerLine,
  stripMovementOrderLines,
  stripUnitComments,
  withoutTrailingBlankLines,
  withFactionPassword,
  withUnitComments,
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

  it("finds a unit whatever case the line is written in - the rules' own worked example uses UNIT", () => {
    // "The parser is not case sensitive... [this] applies to the #ATLANTIS and #END lines as well
    // as to order lines" (https://atlantis-pbem.com/rules) - a document is under no obligation to
    // match this app's own lowercase habit, and the rules' own worked example is uppercase.
    const upperCase = ['#ATLANTIS 95 "secret"', "", "UNIT 18642", "@claim 50", "", "#END"].join(
      "\n"
    );
    expect(findUnitBlocks(upperCase).map((block) => block.unitId)).toEqual(["18642"]);
  });

  it("does not let an uppercase #END get folded into the last unit's own orders", () => {
    const upperCase = ['#ATLANTIS 95 "secret"', "", "UNIT 18642", "@claim 50", "", "#END"].join(
      "\n"
    );
    expect(readUnitOrders(upperCase, "18642")).toBe("@claim 50");
  });
});

describe("hasFactionHeader", () => {
  it("finds a lowercase header, this app's own habit", () => {
    expect(hasFactionHeader('#atlantis 95 "secret"')).toBe(true);
  });

  it("finds an uppercase header just as well - the rules' own worked example uses #ATLANTIS", () => {
    expect(hasFactionHeader('#ATLANTIS 95 "secret"')).toBe(true);
  });

  it("is false for a document with no header at all", () => {
    expect(hasFactionHeader("unit 18642\n@claim 50")).toBe(false);
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

/** The real report the export test pins against, and the long-format template it carries. */
const TURN_71_REPORT = readReport("g7f95t71");
const TEMPLATE_MARKER = "Orders Template (Long Format):\n\n";
const TEMPLATE_START = TURN_71_REPORT.indexOf(TEMPLATE_MARKER);
// Fail loudly rather than slicing from a bogus offset if the fixture ever loses the marker.
if (TEMPLATE_START === -1) {
  throw new Error(`fixture is missing "${TEMPLATE_MARKER.trim()}"`);
}
const TURN_71_TEMPLATE = TURN_71_REPORT.slice(TEMPLATE_START + TEMPLATE_MARKER.length).trimEnd();

describe("restoring the server's unit descriptions", () => {
  it("puts the server's description back under the unit line", () => {
    const stripped = stripUnitComments(WRAPPED);

    expect(withUnitComments(stripped, WRAPPED)).toBe(WRAPPED);
  });

  it("leaves a unit the template does not know", () => {
    const document = ["unit 793", "@study obse", "", "unit 9999", "@work", "", "#end"].join("\n");

    const restored = withUnitComments(document, WRAPPED);

    expect(readUnitOrders(restored, "9999")).toBe("@work");
  });

  it("keeps the player's own note, once, below the restored description", () => {
    const document = ["unit 793", ";remember to check this", "@study obse"].join("\n");

    const restored = withUnitComments(document, WRAPPED);

    expect(restored).toBe(
      [
        "unit 793",
        ";Three of Five (793), behind, revealing faction, leader [LEAD]. Weight:",
        ";  10. Capacity: 0/0/15/0. Skills: observation [OBSE] 1 (35), force",
        ";  [FORC] 1 (35), pattern [PATT] 1 (30), spirit [SPIR] 1 (30).",
        ";remember to check this",
        "@study obse"
      ].join("\n")
    );
  });

  it("does not touch an @; repeating comment", () => {
    const document = ["unit 793", "@;remember to tax here", "@study obse"].join("\n");

    const restored = withUnitComments(document, WRAPPED);

    expect(restored).toBe(
      [
        "unit 793",
        ";Three of Five (793), behind, revealing faction, leader [LEAD]. Weight:",
        ";  10. Capacity: 0/0/15/0. Skills: observation [OBSE] 1 (35), force",
        ";  [FORC] 1 (35), pattern [PATT] 1 (30), spirit [SPIR] 1 (30).",
        "@;remember to tax here",
        "@study obse"
      ].join("\n")
    );
  });

  it("returns the document unchanged when the template is empty", () => {
    const document = ["unit 793", "@study obse"].join("\n");

    expect(withUnitComments(document, "")).toBe(document);
  });

  it("is the exact inverse of stripUnitComments, over a real report's template", () => {
    const stripped = stripUnitComments(TURN_71_TEMPLATE);

    expect(stripUnitComments(withUnitComments(stripped, TURN_71_TEMPLATE))).toBe(stripped);
  });

  it("gives every unit with a description in the template exactly those lines", () => {
    const stripped = stripUnitComments(TURN_71_TEMPLATE);
    const restored = withUnitComments(stripped, TURN_71_TEMPLATE);
    const restoredLines = restored.split("\n");
    const restoredBlocks = findUnitBlocks(restored);
    const templateLines = TURN_71_TEMPLATE.split("\n");

    let checked = 0;
    for (const templateBlock of findUnitBlocks(TURN_71_TEMPLATE)) {
      const description = templateLines
        .slice(templateBlock.firstLine, templateBlock.lastLine + 1)
        .filter((line) => line.trim().startsWith(";"));
      if (description.length === 0) {
        continue;
      }

      const restoredBlock = restoredBlocks.find((block) => block.unitId === templateBlock.unitId);
      expect(restoredBlock).toBeDefined();
      const restoredDescription = restoredLines.slice(
        (restoredBlock?.headerLine ?? 0) + 1,
        (restoredBlock?.headerLine ?? 0) + 1 + description.length
      );
      expect(restoredDescription).toEqual(description);
      checked += 1;
    }

    // A fixture that discriminated nothing would let every assertion above pass vacuously.
    expect(checked).toBeGreaterThan(0);
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

describe("stripping a unit's existing movement order", () => {
  it("drops a MOVE line so a newly planned route replaces it", () => {
    expect(stripMovementOrderLines("@claim 50\nMOVE SE SE\n@study obse")).toBe(
      "@claim 50\n@study obse"
    );
  });

  it("drops an ADVANCE line the same way", () => {
    expect(stripMovementOrderLines("ADVANCE N\n@study obse")).toBe("@study obse");
  });

  /** A planned sea route replaces an existing SAIL just as a land route replaces a MOVE. */
  it("drops a SAIL line so a newly planned sea route replaces it", () => {
    expect(stripMovementOrderLines("@claim 50\nSAIL N NE\n@study obse")).toBe(
      "@claim 50\n@study obse"
    );
  });

  it("drops a repeating @MOVE line too", () => {
    expect(stripMovementOrderLines("@MOVE SE\n@study obse")).toBe("@study obse");
  });

  it("leaves orders with no movement line untouched", () => {
    expect(stripMovementOrderLines("@claim 50\n@study obse")).toBe("@claim 50\n@study obse");
  });

  it("drops every movement order the core knows", () => {
    for (const command of MOVEMENT_ORDER_COMMANDS) {
      expect(stripMovementOrderLines(`${command} N\n@study obse`)).toBe("@study obse");
    }
  });
});

describe("withFactionPassword", () => {
  it("writes the typed password into the #atlantis line and changes nothing else", () => {
    const rewritten = withFactionPassword(DOCUMENT, "typed-one");

    expect(rewritten.split("\n")[0]).toBe('#atlantis 95 "typed-one"');
    expect(rewritten.split("\n").slice(1)).toEqual(DOCUMENT.split("\n").slice(1));
  });

  it("keeps the faction id the document already carried", () => {
    expect(withFactionPassword('#atlantis 7\nunit 1\n', "p").split("\n")[0]).toBe('#atlantis 7 "p"');
  });

  it("rewrites the header wherever it sits, leaving the lines above it alone", () => {
    const document = ['; a comment', '', '#atlantis 95 "old"', "#end"].join("\n");
    expect(withFactionPassword(document, "new")).toBe(
      ['; a comment', '', '#atlantis 95 "new"', "#end"].join("\n")
    );
  });

  it("keeps a CRLF document's line endings", () => {
    expect(withFactionPassword('#atlantis 42 "old"\r\nunit 1\r\n#end\r\n', "new")).toBe(
      '#atlantis 42 "new"\r\nunit 1\r\n#end\r\n'
    );
  });

  it("keeps the line's own indentation and drops nothing else on it", () => {
    expect(withFactionPassword('  #atlantis 42 "old"\n', "new")).toBe('  #atlantis 42 "new"\n');
  });

  it("is not fooled by a word that merely starts with #atlantis", () => {
    const document = '#atlantisfoo\n#atlantis 42 "old"\n';
    expect(withFactionPassword(document, "new")).toBe('#atlantisfoo\n#atlantis 42 "new"\n');
  });

  it("does not mistake an existing password for the faction id", () => {
    expect(withFactionPassword('#atlantis "oldpw"\n', "new")).toBe('#atlantis "new"\n');
  });

  it("refuses a password that would forge a line rather than writing it in", () => {
    expect(() => withFactionPassword(DOCUMENT, 'a"\n#atlantis 9 "x')).toThrow();
  });

  it("returns a document with no #atlantis line unchanged", () => {
    const document = "unit 18642\n@work\n#end";
    expect(withFactionPassword(document, "p")).toBe(document);
  });
});

/**
 * The month-long commands are the ruleset's own list, not derived from anything the core exports:
 * "A unit can also do exactly one action that takes up the entire month, such as harvesting
 * resources or moving from one region to another. The orders which take an entire month are
 * ADVANCE, BUILD, ENTERTAIN, MOVE, PILLAGE, PRODUCE, SAIL, STUDY, TAX, TEACH and WORK."
 */
describe("finds the one order that takes the whole month", () => {
  it("recognises every one of the eleven month-long commands", () => {
    for (const command of LONG_ORDER_COMMANDS) {
      expect(longOrderOf(`@claim 50\n${command} thing`)).toBe(`${command} thing`);
    }
  });

  it("finds the month-long line among a unit's other orders", () => {
    expect(longOrderOf('@claim 50\nproduce yew\nguard 1')).toBe("produce yew");
  });

  it("keeps a repeated order exactly as typed", () => {
    expect(longOrderOf("@tax")).toBe("@tax");
  });

  it("ignores the game's own descriptive comments", () => {
    expect(longOrderOf("; a comment about MOVE\nguard 1")).toBeNull();
  });

  it("is null when the unit has no month-long order at all", () => {
    expect(longOrderOf("@GIVE 1 50 SILV\nguard 1")).toBeNull();
  });

  it("does not match a command that merely starts with the same letters", () => {
    expect(longOrderOf("taxation 1")).toBeNull();
  });

  it("returns the first one when a document somehow holds two", () => {
    expect(longOrderOf("produce yew\n@tax")).toBe("produce yew");
  });
});

describe("regionBannerLine", () => {
  it("writes the banner a report writes", () => {
    expect(
      regionBannerLine(
        {
          terrain: "mountain",
          coordinate: { x: 43, y: 81, z: 1 },
          province: "Derngill",
          settlement: { name: "Onthead", size: "city" }
        },
        null
      )
    ).toBe(";*** mountain (43,81) in Derngill, contains Onthead [city] ***");

    expect(
      regionBannerLine(
        {
          terrain: "forest",
          coordinate: { x: 43, y: 79, z: 1 },
          province: "Utso",
          settlement: null
        },
        null
      )
    ).toBe(";*** forest (43,79) in Utso ***");

    expect(
      regionBannerLine(
        {
          terrain: "nexus",
          coordinate: { x: 0, y: 0, z: 0 },
          province: "The Void",
          settlement: null
        },
        "nexus"
      )
    ).toBe(";*** nexus (0,0,nexus) in The Void ***");
  });
});

const BANNER_43_81 = ";*** mountain (43,81) in Derngill, contains Onthead [city] ***";

describe("ensureUnitBlock", () => {
  const region = [
    "#atlantis 62",
    "",
    BANNER_43_81,
    "",
    "unit 1655",
    "@tax",
    "",
    "unit 3832",
    "@study stea",
    "",
    "#end",
    ""
  ].join("\n");

  it("leaves a unit that already has a block alone", () => {
    expect(ensureUnitBlock(region, "3832", BANNER_43_81)).toBe(region);
  });

  it("adds a block after the last unit under its own banner", () => {
    expect(ensureUnitBlock(region, "1656", BANNER_43_81)).toBe(
      [
        "#atlantis 62",
        "",
        BANNER_43_81,
        "",
        "unit 1655",
        "@tax",
        "",
        "unit 3832",
        "@study stea",
        "",
        "unit 1656",
        "",
        "#end",
        ""
      ].join("\n")
    );
  });

  it("adds a block straight under a banner that has no units yet", () => {
    const empty = ["#atlantis 62", "", BANNER_43_81, "", "#end", ""].join("\n");
    expect(ensureUnitBlock(empty, "1656", BANNER_43_81)).toBe(
      ["#atlantis 62", "", BANNER_43_81, "", "unit 1656", "", "#end", ""].join("\n")
    );
  });

  it("writes the banner too, before #end, when the document has no banner for the region", () => {
    const seeded = ["#atlantis 62", "", "#end", ""].join("\n");
    expect(ensureUnitBlock(seeded, "1656", BANNER_43_81)).toBe(
      ["#atlantis 62", "", BANNER_43_81, "", "unit 1656", "", "#end", ""].join("\n")
    );
  });

  it("writeUnitOrders fills the block ensureUnitBlock created", () => {
    const seeded = ["#atlantis 62", "", "#end", ""].join("\n");
    const withBlock = ensureUnitBlock(seeded, "1656", BANNER_43_81);
    expect(writeUnitOrders(withBlock, "1656", "buy 1 humn\nstudy forc")).toBe(
      [
        "#atlantis 62",
        "",
        BANNER_43_81,
        "",
        "unit 1656",
        "buy 1 humn",
        "study forc",
        "",
        "#end",
        ""
      ].join("\n")
    );
  });
});

const SEEDED = [
  "; This report carried no orders template, so this file was started from scratch.",
  '; If your faction has a password, add it: #atlantis 62 "your password"',
  "#atlantis 62",
  "",
  "#end"
].join("\n");

describe("seedOrdersDocument", () => {
  it("leaves a report's own template alone", () => {
    expect(seedOrdersDocument(DOCUMENT, "62")).toBe(DOCUMENT);
  });

  it("seeds a header, a note and #end when the report carried no template", () => {
    expect(seedOrdersDocument("", "62")).toBe(SEEDED);
    expect(seedOrdersDocument("   \n\n", "62")).toBe(SEEDED);
  });

  it("seeds nothing when the report names no faction", () => {
    expect(seedOrdersDocument("", null)).toBe("");
  });

  // seedOrdersDocument's null-faction branch is defence only: the doors refuse such a report
  // first (ah-brd). If this ever goes green-to-red, the doc comment above that branch is wrong.
  it("the import doors refuse a report that names no faction", () => {
    expect(
      judgeReportUsable(
        aParsedReport({
          header: aReportHeaderInfo({ factionId: null, month: "January" }),
          regions: [aReportRegion()]
        })
      )
    ).toEqual({ ok: false, reason: REPORT_NAMES_NO_FACTION });
  });

  it("the seeded document is still recognised as an orders file and still takes a password", () => {
    expect(isOrdersFile(SEEDED)).toBe(true);
    expect(hasFactionHeader(SEEDED)).toBe(true);
    const withPassword = withFactionPassword(SEEDED, "secret");
    expect(withPassword.split("\n")[0]).toBe(
      "; This report carried no orders template, so this file was started from scratch."
    );
    expect(withPassword.split("\n")[1]).toBe(
      '; If your faction has a password, add it: #atlantis 62 "your password"'
    );
    expect(withPassword.split("\n")[2]).toBe('#atlantis 62 "secret"');
  });
});

describe("applyUnitOrders", () => {
  const seeded = ["#atlantis 62", "", "#end", ""].join("\n");

  it("creates the block under the region's banner on the first order", () => {
    expect(applyUnitOrders(seeded, "1656", "buy 1 humn", BANNER_43_81)).toBe(
      ["#atlantis 62", "", BANNER_43_81, "", "unit 1656", "buy 1 humn", "", "#end", ""].join("\n")
    );
  });

  it("creates nothing for an edit that carries no text", () => {
    expect(applyUnitOrders(seeded, "1656", "", BANNER_43_81)).toBe(seeded);
  });

  it("creates nothing when there is no banner to put it under", () => {
    expect(applyUnitOrders(seeded, "1656", "buy 1 humn", null)).toBe(seeded);
  });

  it("leaves an existing block where it is", () => {
    const existing = ["#atlantis 62", "", BANNER_43_81, "", "unit 1656", "@tax", "", "#end", ""].join(
      "\n"
    );
    expect(applyUnitOrders(existing, "1656", "@work", BANNER_43_81)).toBe(
      ["#atlantis 62", "", BANNER_43_81, "", "unit 1656", "@work", "", "#end", ""].join("\n")
    );
  });
});

describe("finding FORM blocks", () => {
  const formed = [
    "#atlantis 62",
    "",
    BANNER_43_81,
    "",
    "unit 1922",
    "form 1",
    "buy 1 hdwa",
    "study comb",
    "end",
    "give new 1 100 silv",
    "",
    "#end",
    ""
  ].join("\n");

  it("finds a FORM block's own lines, inside the unit block that holds it", () => {
    const blocks = findFormBlocks(formed);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      alias: "1",
      unitId: "1922",
      parentIndex: null,
      headerLine: 5,
      firstLine: 6,
      lastLine: 7
    });
  });

  it("rule 5: a FORM opened inside a TURN block is next month's and is not returned", () => {
    const document = ["unit 1922", "turn", "form 1", "buy 1 hdwa", "end", "endturn"].join("\n");
    expect(findFormBlocks(document)).toEqual([]);
  });

  it("rule 6: an alias that is not a number of at least one is not returned", () => {
    expect(findFormBlocks(["unit 1922", "form a", "buy 1 hdwa", "end"].join("\n"))).toEqual([]);
    expect(findFormBlocks(["unit 1922", "form 0", "buy 1 hdwa", "end"].join("\n"))).toEqual([]);
  });

  it("rule 2: a FORM inside a unit block naming no reported unit is not returned", () => {
    expect(findFormBlocks(["unit new-1", "form 1", "buy 1 hdwa", "end"].join("\n"))).toEqual([]);
  });

  it("rule 6: a FORM nested inside one that was not returned is not returned either", () => {
    const document = ["unit 1922", "form 0", "form 2", "buy 1 hdwa", "end", "end"].join("\n");
    expect(findFormBlocks(document)).toEqual([]);
  });

  it("a nested FORM points at the block enclosing it", () => {
    const document = [
      "unit 1922",
      "form 1",
      "buy 1 hdwa",
      "form 2",
      "study comb",
      "end",
      "end"
    ].join("\n");
    const blocks = findFormBlocks(document);
    expect(blocks.map((block) => [block.alias, block.parentIndex])).toEqual([
      ["1", null],
      ["2", 0]
    ]);
    expect(blocks[1]).toMatchObject({ unitId: "1922", firstLine: 4, lastLine: 4 });
  });

  it("rule for comments and @: @form 1 is a block and ; form 1 is not", () => {
    expect(
      findFormBlocks(["unit 1922", "@form 1", "buy 1 hdwa", "end"].join("\n")).map((b) => b.alias)
    ).toEqual(["1"]);
    expect(findFormBlocks(["unit 1922", "; form 1", "buy 1 hdwa"].join("\n"))).toEqual([]);
  });

  it("rule 7: an unterminated FORM runs to the line before the next unit line", () => {
    const document = [
      "unit 1922",
      "form 1",
      "buy 1 hdwa",
      "",
      "unit 1923",
      "@tax"
    ].join("\n");
    expect(findFormBlocks(document)[0]).toMatchObject({ firstLine: 2, lastLine: 2 });
  });

  it("rule 7: an empty FORM block gives lastLine below firstLine", () => {
    const document = ["unit 1922", "form 1", "end"].join("\n");
    const block = findFormBlocks(document)[0];
    expect(block?.lastLine).toBeLessThan(block?.firstLine ?? 0);
  });

  it("rule 1: a directive closes an open FORM and clears the enclosing unit", () => {
    const document = ["unit 1922", "form 1", "buy 1 hdwa", "#end", "form 2", "study comb"].join(
      "\n"
    );
    expect(findFormBlocks(document).map((block) => block.alias)).toEqual(["1"]);
  });

  it("rule 3: endturn closes a TURN and only a TURN", () => {
    const document = ["unit 1922", "turn", "endturn", "form 1", "buy 1 hdwa", "end"].join("\n");
    expect(findFormBlocks(document).map((block) => block.alias)).toEqual(["1"]);
  });
});

describe("formedAlias", () => {
  it("reads the alias out of a formed unit's id, and nothing out of a reported one", () => {
    expect(formedAlias("new-1")).toBe("1");
    expect(formedAlias("1922")).toBeNull();
  });
});

describe("formBlockFor and blockFor", () => {
  const region = new Set(["1922", "1923"]);

  it("the first form 1 in a region wins, and the second is swallowed", () => {
    const document = [
      "unit 1922",
      "form 1",
      "buy 1 hdwa",
      "end",
      "unit 1923",
      "form 1",
      "study comb",
      "end"
    ].join("\n");
    expect(formBlockFor(document, "1", region)).toMatchObject({ unitId: "1922", firstLine: 2 });
  });

  it("a form 1 under a unit in another region does not match", () => {
    const document = ["unit 4000", "form 1", "buy 1 hdwa", "end"].join("\n");
    expect(formBlockFor(document, "1", region)).toBeNull();
  });

  it("a FORM nested inside a swallowed duplicate is swallowed with it", () => {
    const document = [
      "unit 1922",
      "form 1",
      "buy 1 hdwa",
      "end",
      "unit 1923",
      "form 1",
      "form 2",
      "study comb",
      "end",
      "end"
    ].join("\n");
    expect(formBlockFor(document, "2", region)).toBeNull();
  });

  it("blockFor gives the unit block for a reported id and null for a new-1 with no region", () => {
    const document = ["unit 1922", "form 1", "buy 1 hdwa", "end"].join("\n");
    expect(blockFor(document, "1922")).toMatchObject({ unitId: "1922", headerLine: 0 });
    expect(blockFor(document, "new-1")).toBeNull();
    expect(blockFor(document, "new-1", region)).toMatchObject({
      unitId: "new-1",
      headerLine: 1,
      firstLine: 2,
      lastLine: 2
    });
  });
});

describe("a formed unit's own orders", () => {
  const region = new Set(["1922"]);
  const document = [
    "#atlantis 62",
    "",
    BANNER_43_81,
    "",
    "unit 1922",
    "@claim 200",
    "form 1",
    "buy 1 hdwa",
    "study comb",
    "end",
    "give new 1 100 silv",
    "",
    "#end",
    ""
  ].join("\n");

  it("reads the lines between form 1 and end, and nothing else", () => {
    expect(readUnitOrders(document, "new-1", region)).toBe("buy 1 hdwa\nstudy comb");
  });

  it("writes a formed unit's orders back inside its FORM block", () => {
    expect(writeUnitOrders(document, "new-1", "buy 1 hdwa\nstudy comb\n@work", region)).toBe(
      [
        "#atlantis 62",
        "",
        BANNER_43_81,
        "",
        "unit 1922",
        "@claim 200",
        "form 1",
        "buy 1 hdwa",
        "study comb",
        "@work",
        "end",
        "give new 1 100 silv",
        "",
        "#end",
        ""
      ].join("\n")
    );
  });

  it("emptying a formed unit's orders leaves its form and end standing", () => {
    const emptied = writeUnitOrders(document, "new-1", "", region);
    expect(emptied.split("\n").filter((line) => line.trim() !== "")).toEqual([
      "#atlantis 62",
      BANNER_43_81,
      "unit 1922",
      "@claim 200",
      "form 1",
      "end",
      "give new 1 100 silv",
      "#end"
    ]);
    expect(readUnitOrders(emptied, "new-1", region)).toBe("");
  });

  it("never invents a unit new-1 block", () => {
    const noForm = ["#atlantis 62", "", BANNER_43_81, "", "unit 1922", "@tax", "", "#end", ""].join(
      "\n"
    );
    expect(applyUnitOrders(noForm, "new-1", "buy 1 hdwa", BANNER_43_81, region)).toBe(noForm);
    expect(ensureUnitBlock(noForm, "new-1", BANNER_43_81)).toBe(noForm);
  });

  it("applyUnitOrders edits an existing FORM block", () => {
    expect(applyUnitOrders(document, "new-1", "@work", BANNER_43_81, region)).toContain(
      "form 1\n@work\nend"
    );
  });
});

describe("regionUnitIdsAt", () => {
  const TWO_REGIONS = [
    "#atlantis 3",
    "",
    ";*** plain (7,53) in Inhead ***",
    "unit 1922",
    "@tax",
    "",
    "unit 3001",
    "study comb",
    "",
    ";*** forest (9,55) in Elsewhere ***",
    "unit 4100",
    "work",
    "",
    "#end",
    ""
  ].join("\n");

  it("the region's reported units are the ones under the same banner", () => {
    expect([...regionUnitIdsAt(TWO_REGIONS, 3)].sort()).toEqual(["1922", "3001"]);
    expect([...regionUnitIdsAt(TWO_REGIONS, 10)]).toEqual(["4100"]);
  });

  it("a document with no banners is one region", () => {
    const document = ["unit 1922", "@tax", "", "unit 4100", "work", ""].join("\n");
    expect([...regionUnitIdsAt(document, 0)].sort()).toEqual(["1922", "4100"]);
  });

  it("a stale unit new-1 block is not a reported unit", () => {
    const document = [
      ";*** plain (7,53) in Inhead ***",
      "unit 1922",
      "@tax",
      "",
      "unit new-1",
      "study comb",
      ""
    ].join("\n");
    expect([...regionUnitIdsAt(document, 4)]).toEqual(["1922"]);
  });
});

describe("repairFormedUnitBlocks", () => {
  const BANNER = ";*** plain (7,53) in Inhead ***";
  const OTHER = ";*** forest (9,55) in Elsewhere ***";

  it("a stale unit new-1 block is folded into the form 1 that creates it", () => {
    const document = [
      BANNER,
      "unit 1922",
      "@tax",
      "form 1",
      "buy 5 plainsmen",
      "end",
      "",
      "unit new-1",
      "study comb",
      "",
      "#end",
      ""
    ].join("\n");
    const repair = repairFormedUnitBlocks(document);
    expect(repair.document).not.toContain("unit new-1");
    expect(repair.document.split("\n")).toEqual([
      BANNER,
      "unit 1922",
      "@tax",
      "form 1",
      "buy 5 plainsmen",
      "study comb",
      "end",
      "",
      "#end",
      ""
    ]);
    expect(repair.moved).toEqual([{ alias: "1", orderCount: 1 }]);
    expect(repair.emptied).toEqual([]);
    expect(repair.orphaned).toEqual([]);
  });

  it("an empty unit new-1 block loses its header and nothing else", () => {
    const document = [
      BANNER,
      "unit 1922",
      "@tax",
      "form 1",
      "end",
      "",
      "unit new-1",
      "",
      "#end",
      ""
    ].join("\n");
    const repair = repairFormedUnitBlocks(document);
    expect(repair.document.split("\n")).toEqual([
      BANNER,
      "unit 1922",
      "@tax",
      "form 1",
      "end",
      "",
      "#end",
      ""
    ]);
    expect(repair.emptied).toEqual(["new-1"]);
    expect(repair.moved).toEqual([]);
    expect(repair.orphaned).toEqual([]);
  });

  it("an empty unit new-1 block with no form 1 anywhere still loses its header", () => {
    const document = [BANNER, "unit 1922", "@tax", "", "unit new-1", "", "#end", ""].join("\n");
    const repair = repairFormedUnitBlocks(document);
    expect(repair.document.split("\n")).toEqual([BANNER, "unit 1922", "@tax", "", "#end", ""]);
    expect(repair.emptied).toEqual(["new-1"]);
  });

  it("the first form 1 in the region takes the lines", () => {
    const document = [
      BANNER,
      "unit 1922",
      "form 1",
      "buy 5 plainsmen",
      "end",
      "",
      "unit 3001",
      "form 1",
      "work",
      "end",
      "",
      "unit new-1",
      "study comb",
      "",
      "#end",
      ""
    ].join("\n");
    const repair = repairFormedUnitBlocks(document);
    expect(repair.document.split("\n")).toEqual([
      BANNER,
      "unit 1922",
      "form 1",
      "buy 5 plainsmen",
      "study comb",
      "end",
      "",
      "unit 3001",
      "form 1",
      "work",
      "end",
      "",
      "#end",
      ""
    ]);
    expect(repair.moved).toEqual([{ alias: "1", orderCount: 1 }]);
  });

  it("a form 1 in another region is not a match, and the block is left alone", () => {
    const document = [
      BANNER,
      "unit 1922",
      "form 1",
      "buy 5 plainsmen",
      "end",
      "",
      OTHER,
      "unit 4100",
      "work",
      "",
      "unit new-1",
      "study comb",
      "",
      "#end",
      ""
    ].join("\n");
    const repair = repairFormedUnitBlocks(document);
    expect(repair.document).toBe(document);
    expect(repair.orphaned).toEqual(["new-1"]);
    expect(repair.moved).toEqual([]);
  });

  it("a unit new-1 block with orders and no form anywhere is left alone", () => {
    const document = [BANNER, "unit 1922", "@tax", "", "unit new-1", "study comb", "", "#end", ""].join(
      "\n"
    );
    const repair = repairFormedUnitBlocks(document);
    expect(repair.document).toBe(document);
    expect(repair.orphaned).toEqual(["new-1"]);
  });

  it("a stale block's own form and end move verbatim, indentation and all", () => {
    const document = [
      BANNER,
      "unit 1922",
      "form 2",
      "buy 5 plainsmen",
      "end",
      "",
      "unit new-2",
      "  form 9",
      "  buy 1 hdwa",
      "  end",
      "",
      "#end",
      ""
    ].join("\n");
    const repair = repairFormedUnitBlocks(document);
    expect(repair.document.split("\n")).toEqual([
      BANNER,
      "unit 1922",
      "form 2",
      "buy 5 plainsmen",
      "  form 9",
      "  buy 1 hdwa",
      "  end",
      "end",
      "",
      "#end",
      ""
    ]);
    expect(repair.moved).toEqual([{ alias: "2", orderCount: 3 }]);
  });

  it("a form 1 nested inside another form is matched", () => {
    const document = [
      BANNER,
      "unit 1922",
      "form 2",
      "form 1",
      "buy 5 plainsmen",
      "end",
      "end",
      "",
      "unit new-1",
      "study comb",
      "",
      "#end",
      ""
    ].join("\n");
    const repair = repairFormedUnitBlocks(document);
    expect(repair.document.split("\n")).toEqual([
      BANNER,
      "unit 1922",
      "form 2",
      "form 1",
      "buy 5 plainsmen",
      "study comb",
      "end",
      "end",
      "",
      "#end",
      ""
    ]);
    expect(repair.moved).toEqual([{ alias: "1", orderCount: 1 }]);
  });

  it("a unit NEW-1 header is repaired too", () => {
    const document = [
      BANNER,
      "unit 1922",
      "form 1",
      "end",
      "",
      "unit NEW-1",
      "STUDY COMB",
      "",
      "#end",
      ""
    ].join("\n");
    const repair = repairFormedUnitBlocks(document);
    expect(repair.document).not.toContain("NEW-1");
    expect(repair.moved).toEqual([{ alias: "1", orderCount: 1 }]);
  });

  it("a second run of the repair changes nothing", () => {
    const document = [
      BANNER,
      "unit 1922",
      "form 1",
      "buy 5 plainsmen",
      "end",
      "",
      "unit new-1",
      "study comb",
      "",
      "unit new-2",
      "",
      OTHER,
      "unit 4100",
      "work",
      "",
      "unit new-7",
      "work",
      "",
      "#end",
      ""
    ].join("\n");
    const first = repairFormedUnitBlocks(document);
    expect(first.moved).toEqual([{ alias: "1", orderCount: 1 }]);
    expect(first.emptied).toEqual(["new-2"]);
    expect(first.orphaned).toEqual(["new-7"]);

    const second = repairFormedUnitBlocks(first.document);
    expect(second.document).toBe(first.document);
    expect(second.moved).toEqual([]);
    expect(second.emptied).toEqual([]);
    expect(second.orphaned).toEqual(["new-7"]);
  });

  it("a document with nothing to repair comes back by reference", () => {
    const document = [BANNER, "unit 1922", "@tax", "", "#end", ""].join("\n");
    expect(repairFormedUnitBlocks(document).document).toBe(document);
  });
});
