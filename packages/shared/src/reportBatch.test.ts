import { describe, expect, it } from "vitest";
import { chooseViewerFaction, planReportBatch, type BatchCandidate } from "./reportBatch";

/** A candidate, named the way the summary will name it. */
const file = (
  fileName: string,
  factionId: string | null,
  turnNumber: number | null
): BatchCandidate => ({ fileName, factionId, turnNumber });

const borg = (turnNumber: number | null, name = `f95-t${turnNumber}.rep`) =>
  file(name, "95", turnNumber);
const ally = (turnNumber: number | null, name = `f73-t${turnNumber}.rep`) =>
  file(name, "73", turnNumber);

describe("choosing whose faction a batch belongs to", () => {
  const decided = (factionId: string | null) => ({ kind: "decided", factionId });

  it("keeps the faction already on screen, however the batch is made up", () => {
    expect(chooseViewerFaction("95", [ally(71), ally(70), ally(69)])).toEqual(decided("95"));
  });

  /**
   * With nothing on screen there is no faction to keep, so the batch has to say. The player's own
   * run of turns is the bulk of any real selection; an ally contributes a report or two.
   */
  it("takes the faction with the most reports when nothing is on screen", () => {
    expect(chooseViewerFaction(null, [ally(71), borg(69), borg(70), borg(71)])).toEqual(
      decided("95")
    );
  });

  it("breaks a tie on the highest turn", () => {
    expect(chooseViewerFaction(null, [ally(70), borg(71)])).toEqual(decided("95"));
    expect(chooseViewerFaction(null, [ally(72), borg(71)])).toEqual(decided("73"));
  });

  it("ignores reports that name no faction", () => {
    expect(chooseViewerFaction(null, [file("notes.txt", null, null), ally(70)])).toEqual(
      decided("73")
    );
  });

  it("answers nothing when no report names a faction", () => {
    expect(chooseViewerFaction(null, [file("notes.txt", null, null)])).toEqual(decided(null));
    expect(chooseViewerFaction(null, [])).toEqual(decided(null));
  });

  /**
   * Two of your turns and two of an ally's: an ordinary selection, and one that ties on both the
   * count and the newest turn. Guessing here is expensive - picked wrongly, the ally's turns import
   * as yours and your own units stop being commandable - so the batch asks instead.
   */
  it("asks when two factions describe the batch equally well", () => {
    expect(chooseViewerFaction(null, [ally(71), borg(71), ally(2), borg(70)])).toEqual({
      kind: "ask",
      factionIds: ["73", "95"]
    });
  });

  /**
   * A report whose turn cannot be read is one the plan will throw away, so counting it decides the
   * viewer on the strength of files that never land. Three undated reports from an ally would
   * otherwise outvote two good turns of your own - and then be skipped, leaving your own reports
   * merged into the ally's map as though they were the visitor.
   */
  it("does not count reports whose turn cannot be read", () => {
    expect(
      chooseViewerFaction(null, [
        ally(null, "a.rep"),
        ally(null, "b.rep"),
        ally(null, "c.rep"),
        borg(70),
        borg(71)
      ])
    ).toEqual(decided("95"));
  });

  /** The question is only ever raised with nothing on screen: what is open already answers it. */
  it("does not ask when a faction is already on screen", () => {
    expect(chooseViewerFaction("95", [ally(71), borg(71), ally(2), borg(70)])).toEqual(
      decided("95")
    );
  });
});

describe("planning a batch of reports", () => {
  const viewer = (factionId: string | null, turnNumber: number | null = null) => ({
    factionId,
    turnNumber
  });

  it("imports the viewer's own reports oldest turn first, whatever order they were chosen in", () => {
    const plan = planReportBatch(viewer("95"), [borg(71), borg(69), borg(70)]);

    expect(plan.steps).toEqual([
      { kind: "import", index: 1, fileName: "f95-t69.rep", turnNumber: 69 },
      { kind: "import", index: 2, fileName: "f95-t70.rep", turnNumber: 70 },
      { kind: "import", index: 0, fileName: "f95-t71.rep", turnNumber: 71 }
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("ends on the newest own turn in the batch", () => {
    expect(planReportBatch(viewer("95"), [borg(69), borg(71), borg(70)]).finalTurn).toBe(71);
  });

  /**
   * Even when that turn is older than the one already open. The navigator chose this deliberately:
   * what you selected is what you end up looking at.
   */
  it("ends on the batch's newest own turn even when an older one is open", () => {
    expect(planReportBatch(viewer("95", 71), [borg(68), borg(69)]).finalTurn).toBe(69);
  });

  it("has no turn to end on when the batch holds none of the viewer's own reports", () => {
    expect(planReportBatch(viewer("95", 71), [ally(71)]).finalTurn).toBeNull();
  });

  it("merges another faction's report rather than switching to it", () => {
    const plan = planReportBatch(viewer("95"), [borg(71), ally(71)]);

    expect(plan.steps).toEqual([
      { kind: "import", index: 0, fileName: "f95-t71.rep", turnNumber: 71 },
      { kind: "merge", index: 1, fileName: "f73-t71.rep", turnNumber: 71 }
    ]);
  });

  /**
   * The ally's map is only worth anything once the turn it belongs to has been imported, so within
   * one turn the viewer's own report goes first however the files were chosen.
   */
  it("imports the viewer's own report before the allies of the same turn", () => {
    const plan = planReportBatch(viewer("95"), [ally(71), borg(71), ally(71, "f42-t71.rep")]);

    expect(plan.steps.map((step) => step.fileName)).toEqual([
      "f95-t71.rep",
      "f73-t71.rep",
      "f42-t71.rep"
    ]);
  });

  /**
   * An ally's account of a turn the viewer never played still fills in hexes the viewer has never
   * stood in, and the core refuses to overwrite a region seen on a later turn - so it can only add.
   */
  it("merges an ally's report for a turn the viewer has no report of", () => {
    const plan = planReportBatch(viewer("95"), [borg(70), borg(71), ally(69)]);

    expect(plan.steps).toEqual([
      { kind: "merge", index: 2, fileName: "f73-t69.rep", turnNumber: 69 },
      { kind: "import", index: 0, fileName: "f95-t70.rep", turnNumber: 70 },
      { kind: "import", index: 1, fileName: "f95-t71.rep", turnNumber: 71 }
    ]);
  });

  it("refuses an ally's report from a turn newer than the viewer's own newest", () => {
    const plan = planReportBatch(viewer("95"), [borg(71), ally(72)]);

    expect(plan.steps).toEqual([
      { kind: "import", index: 0, fileName: "f95-t71.rep", turnNumber: 71 }
    ]);
    expect(plan.skipped).toEqual([
      { index: 1, fileName: "f73-t72.rep", reason: "turn 72 is newer than your own turn 71" }
    ]);
  });

  /** With no own report in the batch, the turn on screen is what the ally may not overtake. */
  it("measures an ally against the turn on screen when the batch holds no own report", () => {
    const plan = planReportBatch(viewer("95", 71), [ally(71), ally(72)]);

    expect(plan.steps).toEqual([
      { kind: "merge", index: 0, fileName: "f73-t71.rep", turnNumber: 71 }
    ]);
    expect(plan.skipped).toEqual([
      { index: 1, fileName: "f73-t72.rep", reason: "turn 72 is newer than your own turn 71" }
    ]);
  });

  /**
   * The turn on screen is your own turn too, so an ally may speak for it whether or not the batch
   * happens to carry your report of it. Measuring only against the batch would throw away the
   * newest file in a selection whose point was to back-fill an old one.
   */
  it("lets an ally speak for the turn on screen while older turns are back-filled", () => {
    const plan = planReportBatch(viewer("95", 71), [borg(60), ally(71)]);

    expect(plan.steps).toEqual([
      { kind: "import", index: 0, fileName: "f95-t60.rep", turnNumber: 60 },
      { kind: "merge", index: 1, fileName: "f73-t71.rep", turnNumber: 71 }
    ]);
    expect(plan.skipped).toEqual([]);
    // Still the batch's own newest turn that ends up on screen, not the ally's.
    expect(plan.finalTurn).toBe(60);
  });

  it("skips a report that names no faction", () => {
    const plan = planReportBatch(viewer("95"), [borg(71), file("notes.txt", null, 71)]);

    expect(plan.steps).toHaveLength(1);
    expect(plan.skipped).toEqual([
      { index: 1, fileName: "notes.txt", reason: "the report does not name its faction" }
    ]);
  });

  it("skips a report whose turn cannot be read", () => {
    const plan = planReportBatch(viewer("95"), [borg(71), borg(null, "undated.rep")]);

    expect(plan.steps).toHaveLength(1);
    expect(plan.skipped).toEqual([
      { index: 1, fileName: "undated.rep", reason: "the report does not name its turn" }
    ]);
  });

  it("keeps skipped reports in the order they were chosen", () => {
    const plan = planReportBatch(viewer("95"), [
      file("b.rep", null, 71),
      borg(71),
      file("a.rep", null, 70)
    ]);

    expect(plan.skipped.map((skip) => skip.fileName)).toEqual(["b.rep", "a.rep"]);
  });

  /**
   * Committing overwrites, so the file chosen last is the one that survives. Both are still walked:
   * refusing the earlier one would mean deciding which of two files for one turn is the real report,
   * and there is nothing here that could tell.
   */
  it("keeps both reports of a repeated turn, in the order they were chosen", () => {
    const plan = planReportBatch(viewer("95"), [borg(71, "first.rep"), borg(71, "second.rep")]);

    expect(plan.steps.map((step) => step.fileName)).toEqual(["first.rep", "second.rep"]);
  });

  /**
   * Two folders dragged together can hand over two files of one name, and sorting by turn moves
   * them apart. Every step therefore says which of the chosen files it means, not just what it was
   * called - a name is not an identity, and pairing a step with the wrong report's text would
   * import one turn under another turn's number.
   */
  it("says which of two identically named files each step means", () => {
    const plan = planReportBatch(viewer("95"), [borg(71, "turn.rep"), borg(69, "turn.rep")]);

    expect(plan.steps).toEqual([
      { kind: "import", index: 1, fileName: "turn.rep", turnNumber: 69 },
      { kind: "import", index: 0, fileName: "turn.rep", turnNumber: 71 }
    ]);
  });

  it("can do nothing at all with a batch whose faction it cannot tell", () => {
    const plan = planReportBatch(viewer(null), [file("notes.txt", null, 71)]);

    expect(plan.steps).toEqual([]);
    expect(plan.finalTurn).toBeNull();
    expect(plan.skipped).toEqual([
      { index: 0, fileName: "notes.txt", reason: "the report does not name its faction" }
    ]);
  });
});
