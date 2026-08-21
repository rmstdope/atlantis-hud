import { describe, expect, it } from "vitest";
import { lineDepths } from "./orderIndent";

describe("lineDepths", () => {
  const cases: ReadonlyArray<readonly [string, string, number[]]> = [
    ["flat orders", "WORK\nSTUDY COMBAT", [0, 0]],
    ["a TURN block", "TURN\nWORK\nENDTURN", [0, 1, 0]],
    [
      "nesting, with each closer outside its own block",
      "TURN\nFORM 1\nWORK\nEND\nMOVE N\nENDTURN\nWORK",
      [0, 1, 2, 1, 1, 0, 0]
    ],
    ["case and a leading @", "@turn\nWORK\nEndturn", [0, 1, 0]],
    ["a block that is never closed", "FORM 1\nWORK", [0, 1]],
    ["a stray closer of the wrong kind", "FORM 1\nWORK\nENDTURN\nMOVE N", [0, 1, 1, 1]],
    ["a stray closer with nothing open", "WORK\nEND\nSTUDY COMBAT", [0, 0, 0]],
    ["a unit line abandons everything open", "TURN\nunit 42\nWORK", [0, 0, 0]],
    ["a directive abandons everything open", "TURN\n#end\nWORK", [0, 0, 0]],
    ["comments and blank lines sit at the running depth", "TURN\n; a note\n\nWORK\nENDTURN", [0, 1, 1, 1, 0]],
    ["quoted text is not grammar", 'TURN\nNAME UNIT "END of the line"\nENDTURN', [0, 1, 0]],
    ["text after a semicolon is not grammar", "TURN\nWORK ; END\nENDTURN", [0, 1, 0]]
  ];

  for (const [name, text, depths] of cases) {
    it(name, () => {
      expect(lineDepths(text)).toEqual(depths);
    });
  }
});
