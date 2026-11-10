import { describe, expect, it } from "vitest";
import { editsSinceSeen, newAssistantSeen, noteSeen } from "./assistantSeen";

const TURN = "game-1/3/12";

describe("what the assistant last saw", () => {
  it("lists a unit whose orders changed since it was seen, with both versions", () => {
    const seen = newAssistantSeen();
    noteSeen(seen, TURN, [["100", "work"], ["101", ""]]);

    const edits = editsSinceSeen(seen, TURN, new Map([["100", "tax"], ["101", ""]]));

    expect(edits).toEqual([{ unitId: "100", before: "work", now: "tax" }]);
  });

  it("does not list a unit changed back to what was seen", () => {
    const seen = newAssistantSeen();
    noteSeen(seen, TURN, [["100", "work"]]);

    expect(editsSinceSeen(seen, TURN, new Map([["100", "work"]]))).toEqual([]);
  });

  it("does not list a unit it never saw", () => {
    const seen = newAssistantSeen();
    noteSeen(seen, TURN, [["100", "work"]]);

    expect(editsSinceSeen(seen, TURN, new Map([["100", "work"], ["101", "tax"]]))).toEqual([]);
  });

  it("keeps the latest sighting of a unit", () => {
    const seen = newAssistantSeen();
    noteSeen(seen, TURN, [["100", "work"]]);
    noteSeen(seen, TURN, [["100", "tax"]]);

    expect(editsSinceSeen(seen, TURN, new Map([["100", "tax"]]))).toEqual([]);
  });

  it("lists edits in the order the current orders are given", () => {
    const seen = newAssistantSeen();
    noteSeen(seen, TURN, [["101", "a"], ["100", "b"]]);

    const edits = editsSinceSeen(seen, TURN, new Map([["100", "B"], ["101", "A"]]));

    expect(edits.map((edit) => edit.unitId)).toEqual(["100", "101"]);
  });

  it("forgets one turn's sightings when another turn is seen or asked about", () => {
    const seen = newAssistantSeen();
    noteSeen(seen, TURN, [["100", "work"]]);

    expect(editsSinceSeen(seen, "game-1/3/13", new Map([["100", "tax"]]))).toEqual([]);

    noteSeen(seen, TURN, [["100", "work"]]);
    noteSeen(seen, "game-1/3/13", [["101", "tax"]]);
    expect(editsSinceSeen(seen, "game-1/3/13", new Map([["100", "tax"], ["101", "tax"]]))).toEqual([]);
  });
});
