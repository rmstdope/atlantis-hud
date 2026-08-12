import { describe, expect, it } from "vitest";
import { importSummaryCopy, viewerFactionQuestion } from "./importSummary";
import type { BatchStep } from "./reportBatch";

/** The index is which of the chosen files this was; nothing in the copy reads it. */
let next = 0;
const imported = (fileName: string, turnNumber: number): BatchStep => ({
  kind: "import",
  index: next++,
  fileName,
  turnNumber
});
const merged = (fileName: string, turnNumber: number): BatchStep => ({
  kind: "merge",
  index: next++,
  fileName,
  turnNumber
});
const skip = (fileName: string, reason: string) => ({ index: next++, fileName, reason });

const summary = (over: Partial<Parameters<typeof importSummaryCopy>[0]> = {}) =>
  importSummaryCopy({
    steps: [],
    skipped: [],
    finalTurn: null,
    viewerFactionLabel: "Borg (95)",
    ...over
  });

describe("the headline of an import", () => {
  it("counts the turns imported and names the faction they belong to", () => {
    expect(
      summary({ steps: [imported("a.rep", 70), imported("b.rep", 71)], finalTurn: 71 }).headline
    ).toBe("Imported 2 turns for Borg (95). Turn 71 is on screen.");
  });

  it("counts one turn as one turn", () => {
    expect(summary({ steps: [imported("a.rep", 71)], finalTurn: 71 }).headline).toBe(
      "Imported 1 turn for Borg (95). Turn 71 is on screen."
    );
  });

  it("counts the allied reports folded in alongside them", () => {
    expect(
      summary({
        steps: [imported("a.rep", 71), merged("b.rep", 71), merged("c.rep", 71)],
        finalTurn: 71
      }).headline
    ).toBe("Imported 1 turn for Borg (95) and merged 2 allied reports. Turn 71 is on screen.");
  });

  /**
   * A batch of nothing but allies leaves the workspace where it was, so there is no turn to
   * announce - only a map that grew.
   */
  it("says what a batch of nothing but allies did", () => {
    expect(summary({ steps: [merged("b.rep", 71)] }).headline).toBe(
      "Merged 1 allied report into Borg (95)’s map."
    );
  });

  it("says plainly when nothing could be imported at all", () => {
    expect(summary({ skipped: [skip("notes.txt", "not a report")] }).headline).toBe(
      "Nothing was imported. 1 file was skipped."
    );
  });

  it("counts what it had to skip", () => {
    expect(
      summary({
        steps: [imported("a.rep", 71)],
        skipped: [skip("notes.txt", "not a report"), skip("old.rep", "not a report")],
        finalTurn: 71
      }).headline
    ).toBe("Imported 1 turn for Borg (95). Turn 71 is on screen. 2 files were skipped.");
  });
});

describe("asking which faction the player is", () => {
  it("says why it cannot tell, and what choosing does", () => {
    expect(viewerFactionQuestion(["Borg TNG (95)", "Borg (73)"])).toEqual([
      "These reports describe Borg TNG (95) and Borg (73) equally well, and there is no turn " +
        "open to say which of them is yours.",
      "Whichever you choose keeps the workspace; the other’s reports are merged into its map " +
        "as an ally’s."
    ]);
  });

  it("lists three factions as a list", () => {
    expect(viewerFactionQuestion(["A (1)", "B (2)", "C (3)"])[0]).toContain(
      "A (1), B (2) and C (3)"
    );
  });
});

describe("the file-by-file account of an import", () => {
  it("says what became of every file, imports and merges in the order they were applied", () => {
    expect(
      summary({
        steps: [imported("f95-t70.rep", 70), imported("f95-t71.rep", 71), merged("f73-t71.rep", 71)],
        skipped: [skip("notes.txt", "the report does not name its faction")],
        finalTurn: 71
      }).lines.map((line) => line.text)
    ).toEqual([
      "f95-t70.rep — imported as turn 70",
      "f95-t71.rep — imported as turn 71",
      "f73-t71.rep — merged into turn 71",
      "notes.txt — skipped: the report does not name its faction"
    ]);
  });

  it("has a line for every file even when every one of them was skipped", () => {
    expect(
      summary({
        skipped: [
          skip("a.txt", "the report does not name its turn"),
          skip("b.txt", "turn 72 is newer than your own turn 71")
        ]
      }).lines.map((line) => line.text)
    ).toEqual([
      "a.txt — skipped: the report does not name its turn",
      "b.txt — skipped: turn 72 is newer than your own turn 71"
    ]);
  });
});
