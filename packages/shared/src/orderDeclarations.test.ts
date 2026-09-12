import { describe, expect, it } from "vitest";
import { readDeclareOrders } from "./orderDeclarations";

describe("reading DECLARE out of an orders document", () => {
  it("reads DECLARE DEFAULT, a faction attitude and a cancellation in document order", () => {
    expect(
      readDeclareOrders(
        [
          "#atlantis 12 \"pass\"",
          "DECLARE DEFAULT FRIENDLY",
          "DECLARE 21 HOSTILE",
          "DECLARE 21",
          ""
        ].join("\n")
      )
    ).toEqual([
      { kind: "default", attitude: "friendly" },
      { kind: "toward", factionId: "21", attitude: "hostile" },
      { kind: "reset", factionId: "21" }
    ]);
  });

  it("reads a lower-case order", () => {
    expect(readDeclareOrders("declare 21 friendly")).toEqual([
      { kind: "toward", factionId: "21", attitude: "friendly" }
    ]);
  });

  it("cuts a trailing comment, with and without a space before it", () => {
    expect(readDeclareOrders("DECLARE 21 FRIENDLY ;note")).toEqual([
      { kind: "toward", factionId: "21", attitude: "friendly" }
    ]);
    expect(readDeclareOrders("DECLARE 21 FRIENDLY;note")).toEqual([
      { kind: "toward", factionId: "21", attitude: "friendly" }
    ]);
  });

  it("reads a DECLARE written inside a unit block", () => {
    expect(
      readDeclareOrders(["unit 2517", "  STUDY FORC", "  DECLARE 21 ALLY", "end"].join("\n"))
    ).toEqual([{ kind: "toward", factionId: "21", attitude: "ally" }]);
  });

  it("ignores an unknown attitude and a missing faction", () => {
    expect(readDeclareOrders(["DECLARE 21 BANANA", "DECLARE FRIENDLY", "DECLARE"].join("\n"))).toEqual(
      []
    );
  });
});
