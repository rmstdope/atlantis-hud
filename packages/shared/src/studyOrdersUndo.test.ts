import { describe, expect, it } from "vitest";
import { recordStudyWrite, studyWriteStanding, takeBackStudyWrite, type StudyWrite } from "./studyOrdersUndo";
import type { StudyWritePlan, WriteRow } from "./studyOrdersWrite";

const BANNER = ";*** plain (7,53) in Foo ***";

type Block = readonly [id: string, ...lines: string[]];

const aDocument = (...blocks: Block[]): string =>
  [
    "#atlantis 95",
    "",
    BANNER,
    ...blocks.flatMap(([id, ...lines]) => ["", `unit ${id}`, ...lines]),
    "",
    "#end"
  ].join("\n");

const row = (unitId: string, name: string, over: Partial<WriteRow> = {}): WriteRow => ({
  unitId,
  who: `${name} (${unitId})`,
  detail: "",
  writes: true,
  cast: null,
  ...over
});

const planOf = (next: string, rows: WriteRow[]): StudyWritePlan => ({
  rows,
  next,
  changed: rows.length,
  replaced: 0,
  casts: 0,
  warning: null,
  lead: "",
  resultText: ""
});

const NAMES: Record<string, string> = { "1234": "Ereb", "412": "Kira", "87": "Tolm", "905": "Sael" };
const ALL = ["1234", "412", "87", "905"];

/** Four mages studying from WORK, and Orrin (331), who is none of them. */
const before = aDocument(["1234", "WORK"], ["412", "WORK"], ["87", "WORK"], ["905", "WORK"], ["331", "WORK"]);
const after = aDocument(
  ["1234", "STUDY FORC"],
  ["412", "STUDY PATT"],
  ["87", "TEACH 412"],
  ["905", "STUDY SPIR"],
  ["331", "WORK"]
);

const fourMages = (over: { rows?: WriteRow[]; was?: string; now?: string } = {}): StudyWrite =>
  recordStudyWrite({
    before: over.was ?? before,
    plan: planOf(over.now ?? after, over.rows ?? ALL.map((id) => row(id, NAMES[id] ?? id))),
    syntax: "origins"
  });

/** `after`, with these mages' orders changed afterwards. */
const changing = (...ids: string[]): string =>
  ids.reduce((document, id) => document.replace(`unit ${id}\n`, `unit ${id}\nCLAIM 1\n`), after);

const single = (id = "1234"): StudyWrite =>
  fourMages({ rows: [row(id, NAMES[id] ?? id)] });

describe("which mages a study write is answerable for", () => {
  it("counts exactly the rows the write changed, casts-only included", () => {
    const write = fourMages({
      rows: [
        row("1234", "Ereb"),
        row("412", "Kira", { writes: false, cast: { detail: "", writes: true } }),
        row("87", "Tolm", { writes: false }),
        row("905", "Sael", { writes: false, cast: { detail: "", writes: false } })
      ]
    });
    expect(write.mages.map((mage) => mage.unitId)).toEqual(["1234", "412"]);
  });

  it("records no earlier orders for a mage the write gave a new block", () => {
    const was = aDocument(["331", "WORK"]);
    const now = aDocument(["331", "WORK"], ["1234", "STUDY FORC"]);
    const write = fourMages({ was, now, rows: [row("1234", "Ereb")] });
    expect(write.mages[0]).toMatchObject({ had: null, wrote: "STUDY FORC" });
  });

  it("names the banners the write itself added", () => {
    const was = "#atlantis 95\n\n#end";
    const now = `#atlantis 95\n\n${BANNER}\n\nunit 1234\nSTUDY FORC\n\n#end`;
    expect(fourMages({ was, now, rows: [row("1234", "Ereb")] }).banners).toEqual([BANNER]);
    expect(fourMages().banners).toEqual([]);
  });
});

describe("the line before Undo is pressed", () => {
  it("adds nothing while the orders are exactly what the write left", () => {
    expect(studyWriteStanding(fourMages(), after, "origins")).toEqual({ undoable: true, detail: null });
  });

  it("says Undo is partial when only something else changed", () => {
    const current = after.replace("unit 331\nWORK", "unit 331\nTAX");
    expect(studyWriteStanding(fourMages(), current, "origins")).toEqual({
      undoable: true,
      detail: "Your orders have changed since. Undo takes back only these mages."
    });
  });

  it("names one changed mage", () => {
    expect(studyWriteStanding(fourMages(), changing("1234"), "origins")).toEqual({
      undoable: true,
      detail: "Ereb (1234) has changed since, so Undo will leave him as he is."
    });
  });

  it("names two changed mages", () => {
    expect(studyWriteStanding(fourMages(), changing("1234", "412"), "origins").detail).toBe(
      "Ereb (1234) and Kira (412) have changed since, so Undo will leave them as they are."
    );
  });

  it("names three changed mages, and a change elsewhere does not displace the naming", () => {
    const current = changing("1234", "412", "87").replace("unit 331\nWORK", "unit 331\nTAX");
    expect(studyWriteStanding(fourMages(), current, "origins").detail).toBe(
      "Ereb (1234), Kira (412) and Tolm (87) have changed since, so Undo will leave them as they are."
    );
  });

  it("withdraws Undo when every written mage has changed", () => {
    expect(studyWriteStanding(fourMages(), changing("1234", "412", "87", "905"), "origins")).toEqual({
      undoable: false,
      detail: "All 4 mages have changed since, so there is nothing left to undo."
    });
  });

  it("says 1 mage when the only one written has changed", () => {
    expect(studyWriteStanding(single(), changing("1234"), "origins")).toEqual({
      undoable: false,
      detail: "1 mage has changed since, so there is nothing left to undo."
    });
  });

  it("counts a change to a mage's casts or later turns as a change to him", () => {
    const write = single();
    const cast = after.replace("STUDY FORC", "STUDY FORC\nCAST FARS");
    const turn = after.replace("STUDY FORC", "STUDY FORC\nTURN\n  WORK\nENDTURN");
    expect(studyWriteStanding(write, cast, "origins").undoable).toBe(false);
    expect(studyWriteStanding(write, turn, "origins").undoable).toBe(false);
  });

  it("counts a mage whose block has gone as changed", () => {
    const current = after.replace("\nunit 1234\nSTUDY FORC\n", "\n");
    expect(studyWriteStanding(fourMages(), current, "origins").detail).toBe(
      "Ereb (1234) has changed since, so Undo will leave him as he is."
    );
  });

  it("reports a mage who merely moved in the file as unchanged", () => {
    const moved = aDocument(
      ["331", "WORK"],
      ["1234", "STUDY FORC"],
      ["412", "STUDY PATT"],
      ["87", "TEACH 412"],
      ["905", "STUDY SPIR"]
    );
    expect(studyWriteStanding(fourMages(), moved, "origins").detail).toBe(
      "Your orders have changed since. Undo takes back only these mages."
    );
  });
});

describe("taking the write back", () => {
  it("restores the document byte for byte when nothing else changed", () => {
    expect(takeBackStudyWrite(fourMages(), after, "origins")).toEqual({
      next: before,
      text: "Put your orders back as they were."
    });
  });

  it("keeps a later change to another unit", () => {
    const current = after.replace("unit 331\nWORK", "unit 331\nTAX");
    expect(takeBackStudyWrite(fourMages(), current, "origins")).toEqual({
      next: before.replace("unit 331\nWORK", "unit 331\nTAX"),
      text: "Took back the study orders for 4 mages. Your later changes are still there."
    });
  });

  it("says 1 mage when one was written and something else changed", () => {
    const current = after.replace("unit 331\nWORK", "unit 331\nTAX");
    expect(takeBackStudyWrite(single(), current, "origins")?.text).toBe(
      "Took back the study orders for 1 mage. Your later changes are still there."
    );
  });

  it("leaves one changed mage as he is and names him", () => {
    const current = changing("1234");
    const taken = takeBackStudyWrite(fourMages(), current, "origins");
    expect(taken?.text).toBe(
      "Took back the study orders for 3 mages. Left Ereb (1234) as he is: his orders changed after the write."
    );
    expect(taken?.next).toContain("unit 1234\nCLAIM 1\nSTUDY FORC");
    expect(taken?.next).toContain("unit 412\nWORK");
    expect(taken?.next).toContain("unit 905\nWORK");
  });

  it("names every mage left alone, however many", () => {
    const current = changing("1234", "412", "87");
    expect(takeBackStudyWrite(fourMages(), current, "origins")?.text).toBe(
      "Took back the study orders for 1 mage. Left Ereb (1234), Kira (412) and Tolm (87) as they are: their orders changed after the write."
    );
  });

  it("takes back two and names two", () => {
    expect(takeBackStudyWrite(fourMages(), changing("1234", "412"), "origins")?.text).toBe(
      "Took back the study orders for 2 mages. Left Ereb (1234) and Kira (412) as they are: their orders changed after the write."
    );
  });

  it("removes a block the write created, when something else also changed", () => {
    const was = aDocument(["331", "WORK"]);
    const now = aDocument(["331", "WORK"], ["1234", "STUDY FORC"]);
    const write = fourMages({ was, now, rows: [row("1234", "Ereb")] });
    const taken = takeBackStudyWrite(write, now.replace("unit 331\nWORK", "unit 331\nTAX"), "origins");
    expect(taken?.next).toBe(aDocument(["331", "TAX"]));
  });

  it("removes a banner the write added once its block is gone", () => {
    const was = "#atlantis 95\n\nunit 331\nWORK\n\n#end";
    const now = `#atlantis 95\n\nunit 331\nWORK\n\n${BANNER}\n\nunit 1234\nSTUDY FORC\n\n#end`;
    const write = fourMages({ was, now, rows: [row("1234", "Ereb")] });
    const taken = takeBackStudyWrite(write, now.replace("unit 331\nWORK", "unit 331\nTAX"), "origins");
    expect(taken?.next).not.toContain(BANNER);
    expect(taken?.next).toContain("unit 331\nTAX");
  });

  it("restores a block that was empty before the write", () => {
    const was = aDocument(["1234"], ["331", "WORK"]);
    const now = aDocument(["1234", "STUDY FORC"], ["331", "WORK"]);
    const write = fourMages({ was, now, rows: [row("1234", "Ereb")] });
    const taken = takeBackStudyWrite(write, now.replace("unit 331\nWORK", "unit 331\nTAX"), "origins");
    expect(taken?.next).toBe(aDocument(["1234"], ["331", "TAX"]));
  });

  it("does nothing when every mage turns out to have changed", () => {
    expect(takeBackStudyWrite(fourMages(), changing("1234", "412", "87", "905"), "origins")).toBeNull();
  });
});
