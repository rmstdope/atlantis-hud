import { describe, expect, it } from "vitest";
import { importSummaryCopy, viewerFactionQuestion } from "./importSummary";
import type { BatchStep } from "./reportBatch";

/** The index is which of the chosen files this was; nothing in the copy reads it. */
let next = 0;
const imported = (fileName: string, turnNumber: number): BatchStep => ({
  kind: "import",
  index: next++,
  fileName,
  turnNumber,
  unreadableCount: 0
});
const merged = (fileName: string, turnNumber: number): BatchStep => ({
  kind: "merge",
  index: next++,
  fileName,
  turnNumber,
  unreadableCount: 0
});
const mapped = (fileName: string, hexesAdded: number, turnNumber = 71): BatchStep => ({
  kind: "mapExport",
  index: next++,
  fileName,
  turnNumber,
  hexesAdded
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

describe("the lines a batch could not read", () => {
  it("names the lines a batch could not read", () => {
    const copy = importSummaryCopy({
      steps: [
        { kind: "import", index: 0, fileName: "a.rep", turnNumber: 71, unreadableCount: 4 },
        { kind: "merge", index: 1, fileName: "b.rep", turnNumber: 71, unreadableCount: 2 },
        { kind: "merge", index: 2, fileName: "c.rep", turnNumber: 70, unreadableCount: 0 }
      ],
      skipped: [],
      finalTurn: 71,
      viewerFactionLabel: "Borg (73)"
    });

    expect(copy.lines.at(-1)).toEqual({
      index: -1,
      text: "6 lines across 2 of these reports could not be read."
    });
  });

  it("says nothing at all when every report was read completely", () => {
    const copy = importSummaryCopy({
      steps: [{ kind: "import", index: 0, fileName: "a.rep", turnNumber: 71, unreadableCount: 0 }],
      skipped: [],
      finalTurn: 71,
      viewerFactionLabel: "Borg (73)"
    });

    expect(copy.lines.some((line) => line.text.includes("could not be read"))).toBe(false);
  });
});

/**
 * A map export lands hexes and nothing else - no turn changes hands and nothing moves on screen -
 * so a batch of nothing but map exports used to read `Nothing was imported.` while eleven hexes
 * had just been added. Its own sentence after the turns, which is what the navigator chose over a
 * third clause on the turn sentence (variant B, 2026-08-29).
 */
describe("the headline of a batch holding map exports", () => {
  it("counts the hexes of several map exports together", () => {
    expect(summary({ steps: [mapped("a.txt", 8), mapped("b.txt", 3)] }).headline).toBe(
      "11 hexes added to your map from 2 map exports."
    );
  });

  it("names a single map export as one rather than counting it", () => {
    expect(summary({ steps: [mapped("a.txt", 8)] }).headline).toBe(
      "8 hexes added to your map from a map export."
    );
  });

  it("counts one hex as one hex", () => {
    expect(summary({ steps: [mapped("a.txt", 1)] }).headline).toBe(
      "1 hex added to your map from a map export."
    );
  });

  it("puts the hexes after the turns and before the turn on screen", () => {
    expect(
      summary({
        steps: [imported("a.rep", 69), imported("b.rep", 70), imported("c.rep", 71), mapped("m.txt", 8)],
        finalTurn: 71
      }).headline
    ).toBe(
      "Imported 3 turns for Borg (95). 8 hexes added to your map from a map export. Turn 71 is on screen."
    );
  });

  it("says all three of turns, allies and map exports", () => {
    expect(
      summary({
        steps: [imported("a.rep", 71), merged("b.rep", 71), mapped("m.txt", 8), mapped("n.txt", 3)],
        finalTurn: 71
      }).headline
    ).toBe(
      "Imported 1 turn for Borg (95) and merged 1 allied report. 11 hexes added to your map from 2 map exports. Turn 71 is on screen."
    );
  });

  /**
   * Words rather than `0 hexes added`, which reads like a fault worth looking into - and it echoes
   * the single-file status line the navigator chose in ah-jpcj's round 3.
   */
  it("says in words when a map export held nothing new", () => {
    expect(summary({ steps: [mapped("a.txt", 0)] }).headline).toBe(
      "Nothing added to your map — the map export held nothing new."
    );
  });

  it("says the same of several that held nothing new", () => {
    expect(summary({ steps: [mapped("a.txt", 0), mapped("b.txt", 0)] }).headline).toBe(
      "Nothing added to your map — the map exports held nothing new."
    );
  });

  /** A batch of nothing but map exports is not a batch that did nothing. */
  it("never says nothing was imported when a map export landed", () => {
    expect(summary({ steps: [mapped("a.txt", 0)], skipped: [skip("x.txt", "not a report")] }).headline).toBe(
      "Nothing added to your map — the map export held nothing new. 1 file was skipped."
    );
  });

  it("still says plainly when nothing landed at all", () => {
    expect(summary({ skipped: [skip("notes.txt", "not a report")] }).headline).toBe(
      "Nothing was imported. 1 file was skipped."
    );
  });
});

describe("the file-by-file account of a map export", () => {
  it("counts the hexes it added", () => {
    expect(summary({ steps: [mapped("ally-map.txt", 8)] }).lines.map((line) => line.text)).toEqual([
      "ally-map.txt — map export, 8 hexes added"
    ]);
  });

  it("counts one hex as one hex", () => {
    expect(summary({ steps: [mapped("ally-map.txt", 1)] }).lines.map((line) => line.text)).toEqual([
      "ally-map.txt — map export, 1 hex added"
    ]);
  });

  it("says in words when it held nothing new", () => {
    expect(summary({ steps: [mapped("ally-map.txt", 0)] }).lines.map((line) => line.text)).toEqual([
      "ally-map.txt — map export, nothing new to your map"
    ]);
  });

  /** One the batch would not act on at all takes the ordinary skip line, in its own words. */
  it("skips an unimportable one on the batch's own skip line", () => {
    expect(
      summary({
        skipped: [skip("bad-map.txt", "the map export does not say which turn it was written on")]
      }).lines.map((line) => line.text)
    ).toEqual([
      "bad-map.txt — skipped: the map export does not say which turn it was written on"
    ]);
  });
});

describe("a mage sheet in the summary", () => {
  const sheet = (over: Partial<Extract<BatchStep, { kind: "mageSheet" }>> = {}) =>
    ({
      kind: "mageSheet" as const,
      index: 0,
      fileName: "mages-Borg-turn-23.txt",
      turnNumber: 23,
      factionId: "21",
      factionLabel: "Borg (21)",
      mageCount: 4,
      discarded: 0,
      ...over
    });

  it("names each sheet, and what it discarded", () => {
    const copy = importSummaryCopy({
      steps: [sheet()],
      skipped: [],
      finalTurn: null,
      viewerFactionLabel: "Borg TNG (95)"
    });

    expect(copy.lines[0]?.text).toBe(
      "mages-Borg-turn-23.txt — mage sheet from Borg (21), turn 23: 4 mages taken in"
    );

    const discarded = importSummaryCopy({
      steps: [sheet({ discarded: 2 })],
      skipped: [],
      finalTurn: null,
      viewerFactionLabel: "Borg TNG (95)"
    });
    expect(discarded.lines[0]?.text).toBe(
      "mages-Borg-turn-23.txt — mage sheet from Borg (21), turn 23: 4 mages taken in, " +
        "2 no longer in the sheet discarded"
    );

    const empty = importSummaryCopy({
      steps: [sheet({ mageCount: 0 })],
      skipped: [],
      finalTurn: null,
      viewerFactionLabel: "Borg TNG (95)"
    });
    expect(empty.lines[0]?.text).toBe(
      "mages-Borg-turn-23.txt — mage sheet from Borg (21), turn 23: no mages in it"
    );
  });

  it("counts the sheets in the headline, and never says nothing was imported", () => {
    const copy = importSummaryCopy({
      steps: [sheet()],
      skipped: [],
      finalTurn: null,
      viewerFactionLabel: "Borg TNG (95)"
    });

    expect(copy.headline).toBe("1 mage sheet taken in.");
    expect(copy.headline).not.toContain("Nothing was imported.");
  });
});
