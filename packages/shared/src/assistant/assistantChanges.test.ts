import { describe, expect, it } from "vitest";
import {
  aParsedReport,
  aReportRegion,
  aReportUnit,
  type OrderDiagnostic
} from "@atlantis/core-client";
import { orderProcessingFor } from "../orderProcessing";
import {
  alignOrderLines,
  assistantChangeProblems,
  assistantChangeViews,
  assistantChipLabel,
  countLabel,
  currentOrdersOf,
  problemMark,
  recordAssistantWrite,
  revertAllPrompt,
  revertAssistantChanges,
  settleAssistantChanges,
  NO_ASSISTANT_CHANGES,
  type AssistantChangesState
} from "./assistantChanges";

const orders = orderProcessingFor(null);

const DOCUMENT = [
  "#atlantis 3",
  ";*** plain (1,1) in Coast ***",
  "unit 100",
  "work",
  "unit 101",
  "tax",
  "unit 102",
  "#end",
  ""
].join("\n");

function written(unitId: string, replaced: string, wrote: string, state = NO_ASSISTANT_CHANGES) {
  return recordAssistantWrite(state, { unitId, replaced, wrote });
}

describe("recordAssistantWrite", () => {
  it("lists a unit the first time it is written, with the orders it replaced", () => {
    expect(written("100", "work", "move N").changes).toEqual([
      { unitId: "100", before: "work", after: "move N" }
    ]);
  });

  it("lists nothing for a write that changed nothing", () => {
    expect(written("100", "work", "work").changes).toEqual([]);
  });

  it("keeps several writes to one unit as one entry: first Before, latest After", () => {
    const once = written("100", "work", "move N");
    const twice = written("100", "move N", "move N E", once);

    expect(twice.changes).toEqual([{ unitId: "100", before: "work", after: "move N E" }]);
  });

  it("drops a unit written back to what it was", () => {
    const once = written("100", "work", "move N");

    expect(written("100", "move N", "work", once).changes).toEqual([]);
  });

  it("takes the player's edit as Before when the assistant writes over it", () => {
    const once = written("100", "work", "move N");
    // The player typed "tax" after that write, and this write replaced it.
    const over = written("100", "tax", "entertain", once);

    expect(over.changes).toEqual([{ unitId: "100", before: "tax", after: "entertain" }]);
  });

  it("opens the panel when the list goes from empty to something", () => {
    const closed: AssistantChangesState = { open: false, changes: [] };

    expect(written("100", "work", "move N", closed).open).toBe(true);
  });

  it("leaves a closed panel closed while further writes land", () => {
    const closed: AssistantChangesState = {
      open: false,
      changes: [{ unitId: "100", before: "work", after: "move N" }]
    };

    expect(written("101", "tax", "work", closed).open).toBe(false);
  });
});

describe("settleAssistantChanges", () => {
  const state: AssistantChangesState = {
    open: true,
    changes: [
      { unitId: "100", before: "work", after: "move N" },
      { unitId: "101", before: "tax", after: "work" }
    ]
  };

  it("drops a unit whose orders are back to Before", () => {
    const settled = settleAssistantChanges(state, new Map([["100", "work"], ["101", "something else"]]));

    expect(settled.changes.map((change) => change.unitId)).toEqual(["101"]);
  });

  it("returns the same state when nothing left the list", () => {
    expect(settleAssistantChanges(state, new Map([["100", "move N"], ["101", "work"]]))).toBe(state);
  });
});

describe("currentOrdersOf", () => {
  it("reads each named unit's block, and a unit with no block as no orders", () => {
    const current = currentOrdersOf(DOCUMENT, ["100", "102", "777"], orders);

    expect(current.get("100")).toBe("work");
    expect(current.get("102")).toBe("");
    expect(current.get("777")).toBe("");
  });
});

describe("revertAssistantChanges", () => {
  const document = DOCUMENT.replace("work", "move N");
  const state: AssistantChangesState = {
    open: true,
    changes: [
      { unitId: "100", before: "work", after: "move N" },
      { unitId: "101", before: "produce", after: "tax" }
    ]
  };

  it("puts Before back for the named unit, and takes it off the list", () => {
    const result = revertAssistantChanges(document, state, ["100"], orders);

    expect(orders.readUnitOrders(result.document, "100", undefined)).toBe("work");
    expect(result.state.changes.map((change) => change.unitId)).toEqual(["101"]);
    expect(result.reverted).toEqual(["100"]);
  });

  it("never overwrites a unit the player has edited since", () => {
    const edited = DOCUMENT.replace("work", "typed by hand");

    const result = revertAssistantChanges(edited, state, ["100"], orders);

    expect(result.document).toBe(edited);
    expect(result.state.changes).toHaveLength(2);
    expect(result.reverted).toEqual([]);
  });

  it("leaves a unit that had no orders empty", () => {
    const empty: AssistantChangesState = {
      open: true,
      changes: [{ unitId: "101", before: "", after: "tax" }]
    };

    const result = revertAssistantChanges(DOCUMENT, empty, ["101"], orders);

    expect(orders.readUnitOrders(result.document, "101", undefined)).toBe("");
  });
});

describe("alignOrderLines", () => {
  it("keeps lines common to both sides level", () => {
    expect(alignOrderLines("guard 1\ntax", "guard 1\nbehind 1\ntax")).toEqual([
      { before: "guard 1", after: "guard 1", changed: false },
      { before: null, after: "behind 1", changed: true },
      { before: "tax", after: "tax", changed: false }
    ]);
  });

  it("lets a removed and an added line share a row", () => {
    expect(alignOrderLines("avoid 1\nwork", "avoid 1\nmove N N")).toEqual([
      { before: "avoid 1", after: "avoid 1", changed: false },
      { before: "work", after: "move N N", changed: true }
    ]);
  });

  it("has no lines for an empty side", () => {
    expect(alignOrderLines("", "buy 10 silk")).toEqual([
      { before: null, after: "buy 10 silk", changed: true }
    ]);
  });
});

describe("assistantChangeViews", () => {
  function hex(x: number, y: number, z: number, terrain: string, unitId: string) {
    return aReportRegion({
      regionId: `${z}:${x},${y}`,
      coordinate: { x, y, z },
      terrain,
      units: [aReportUnit({ unitId, name: `Unit ${unitId}`, own: true })]
    });
  }

  const parsed = aParsedReport({
    regions: [
      hex(15, 5, 1, "hill", "400"),
      hex(14, 4, 1, "city", "300"),
      hex(13, 5, 1, "forest", "200"),
      hex(12, 4, 1, "plain", "100"),
      hex(3, 5, 2, "cave", "500"),
      hex(1, 1, 0, "nexus", "600")
    ]
  });

  const listed = (...ids: string[]): AssistantChangesState => ({
    open: true,
    changes: ids.map((unitId) => ({ unitId, before: "work", after: "tax" }))
  });

  const document = (units: Record<string, string>) =>
    [
      "#atlantis 3",
      ...Object.entries(units).flatMap(([id, text]) => [`unit ${id}`, text]),
      "#end",
      ""
    ].join("\n");

  function views(state: AssistantChangesState, text: string, diagnostics: OrderDiagnostic[] = []) {
    return assistantChangeViews({
      state,
      document: text,
      parsed,
      problems: assistantChangeProblems({ state, parsed, validated: { text, diagnostics }, orders }),
      orders
    });
  }

  it("sorts by hex in reading order, the surface before the levels below it", () => {
    const text = document({ 100: "tax", 200: "tax", 300: "tax", 400: "tax", 500: "tax", 600: "tax" });

    expect(views(listed("600", "500", "400", "300", "200", "100"), text).map((view) => view.unitId)).toEqual([
      "100",
      "300",
      "200",
      "400",
      "500",
      "600"
    ]);
  });

  it("says who the unit is and where, with the level only off the surface", () => {
    const text = document({ 100: "tax", 500: "tax" });
    const [surface, deep] = views(listed("100", "500"), text);

    expect(surface).toMatchObject({ name: "Unit 100", regionId: "1:12,4", where: "Plain (12,4)" });
    expect(deep).toMatchObject({ where: "Cave (3,5,2)" });
  });

  it("marks a unit whose orders are no longer what the assistant wrote", () => {
    const [view] = views(listed("100"), document({ 100: "typed by hand" }));

    expect(view?.edited).toBe(true);
  });

  it("clears the mark when the orders match After again", () => {
    const [view] = views(listed("100"), document({ 100: "tax" }));

    expect(view?.edited).toBe(false);
  });

  it("does not list a unit whose orders are back to Before", () => {
    expect(views(listed("100"), document({ 100: "work" }))).toEqual([]);
  });

  it("gives each problem's own sentence, and none for a unit edited by hand", () => {
    const diagnostic = (lineStart: number): OrderDiagnostic => ({
      severity: "error",
      code: "x",
      message: "this hex does not sell silk",
      lineStart,
      lineEnd: lineStart,
      columnStart: null,
      columnEnd: null,
      unitId: "100"
    } as OrderDiagnostic);
    const clean = document({ 100: "tax" });
    const handEdited = document({ 100: "typed" });

    expect(views(listed("100"), clean, [diagnostic(3)])[0]?.problems).toEqual(["this hex does not sell silk"]);
    expect(views(listed("100"), handEdited, [diagnostic(3)])[0]?.problems).toEqual([]);
  });

  it("flags which side reads as no orders", () => {
    const state: AssistantChangesState = {
      open: true,
      changes: [{ unitId: "100", before: "", after: "tax" }]
    };
    const [view] = views(state, document({ 100: "tax" }));

    expect(view?.beforeEmpty).toBe(true);
    expect(view?.afterEmpty).toBe(false);
  });
});

describe("the words", () => {
  it("counts units", () => {
    expect(countLabel(1)).toBe("1 unit");
    expect(countLabel(3)).toBe("3 units");
  });

  it("marks problems", () => {
    expect(problemMark(1)).toBe("⚠ 1 problem");
    expect(problemMark(2)).toBe("⚠ 2 problems");
  });

  it("names the chip with the listed units, and the units with problems among those not edited", () => {
    const view = (edited: boolean, problems: string[]) => ({ edited, problems });

    expect(assistantChipLabel([view(false, []), view(false, []), view(false, [])])).toBe("Assistant: 3");
    expect(assistantChipLabel([view(false, ["a", "b"]), view(true, ["c"]), view(false, [])])).toBe(
      "Assistant: 3 · ⚠ 1"
    );
  });

  it("asks the Revert all question", () => {
    expect(revertAllPrompt(3)).toEqual({
      question: "Revert 3 units? The assistant's orders for them will be gone.",
      confirm: "Revert 3 units"
    });
    expect(revertAllPrompt(1)).toEqual({
      question: "Revert 1 unit? The assistant's orders for it will be gone.",
      confirm: "Revert 1 unit"
    });
  });
});
