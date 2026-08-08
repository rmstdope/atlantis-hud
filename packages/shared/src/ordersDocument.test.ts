import { describe, expect, it } from "vitest";
import {
  commandsOnly,
  findUnitBlocks,
  hasFactionHeader,
  readUnitOrders,
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
