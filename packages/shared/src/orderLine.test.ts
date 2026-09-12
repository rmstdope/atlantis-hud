import { describe, expect, it } from "vitest";
import { lexOrderLine } from "./orderLine";

describe("lexOrderLine", () => {
  const texts = (line: string, syntax: "origins" | "trident") =>
    lexOrderLine(line, syntax).tokens;

  it("ends a Trident token at an unquoted semicolon wherever it lands", () => {
    // Trident `rules/orders`: "A semicolon ends whatever word it lands in, so it starts a comment
    // wherever it appears".
    expect(texts("WORK;note", "trident")).toEqual(["WORK"]);
    expect(texts("GUARD 1;note", "trident")).toEqual(["GUARD", "1"]);
    expect(texts("GIVE 42 1 SILV;note", "trident")).toEqual(["GIVE", "42", "1", "SILV"]);
    expect(texts("unit 42;note", "trident")).toEqual(["unit", "42"]);
    expect(texts("#end;note", "trident")).toEqual(["#end"]);
    expect(texts("FORM 1;note", "trident")).toEqual(["FORM", "1"]);
    expect(texts("END;note", "trident")).toEqual(["END"]);
  });

  it("keeps a New Origins semicolon that is in the middle of a word", () => {
    // New Origins `rules/orders`: a comment starts at a semicolon "provided the semicolon is not
    // in the middle of a word".
    expect(texts("WORK;note", "origins")).toEqual(["WORK;note"]);
    expect(texts("GIVE 42 1 SILV;note", "origins")).toEqual(["GIVE", "42", "1", "SILV;note"]);
    // One at the end of a word, or with whitespace after it, comments in both worlds.
    expect(texts("WORK ;note", "origins")).toEqual(["WORK"]);
    expect(texts("WORK;", "origins")).toEqual(["WORK"]);
  });

  it("leaves a semicolon inside a quoted name alone in both worlds", () => {
    expect(texts('NAME UNIT "A;B"', "trident")).toEqual(["NAME", "UNIT", "A;B"]);
    expect(texts('NAME UNIT "A;B"', "origins")).toEqual(["NAME", "UNIT", "A;B"]);
  });

  it("reads the repeating @ and the comment it precedes", () => {
    expect(lexOrderLine("@WORK;note", "trident")).toEqual({
      repeat: true,
      tokens: ["WORK"],
      commentAt: 5
    });
    expect(lexOrderLine("@;keep going", "origins")).toEqual({
      repeat: true,
      tokens: [],
      commentAt: 1
    });
    expect(lexOrderLine(";a whole comment", "trident").tokens).toEqual([]);
  });

  it("keeps the rest of an unterminated quote, as the Rust lexer does", () => {
    expect(texts('NAME UNIT "Half typed', "trident")).toEqual(["NAME", "UNIT", "Half typed"]);
  });
});
