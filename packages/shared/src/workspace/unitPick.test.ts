import { describe, expect, it } from "vitest";
import { aReportUnit } from "@atlantis/core-client";
import { NO_PICK, afterGesture, narrowedTo, onPress, pickedIn, type UnitPick } from "./unitPick";
import { unitRowKey } from "../unitTable";

const ROWS = ["1", "2", "3", "4", "5"];

const pick = (ids: string[], anchor: string | null): UnitPick => ({
  ids: new Set(ids),
  anchor
});

const idsOf = (one: UnitPick) => [...one.ids].sort();

describe("afterGesture", () => {
  it("a plain gesture picks that row alone and anchors on it", () => {
    const next = afterGesture(pick(["1", "2"], "1"), { kind: "plain", rowKey: "4" }, ROWS);

    expect(idsOf(next)).toEqual(["4"]);
    expect(next.anchor).toBe("4");
  });

  it("extend takes the run between the anchor and the target, in the order the table draws them", () => {
    const next = afterGesture(pick(["2"], "2"), { kind: "extend", rowKey: "4" }, ROWS);

    expect(idsOf(next)).toEqual(["2", "3", "4"]);
    // The anchor does not move, so a second Shift+click re-extends from where it started.
    expect(next.anchor).toBe("2");
  });

  it("extend runs backwards from the anchor just as far", () => {
    const next = afterGesture(pick(["4"], "4"), { kind: "extend", rowKey: "2" }, ROWS);

    expect(idsOf(next)).toEqual(["2", "3", "4"]);
    expect(next.anchor).toBe("4");
  });

  it("extend replaces the pick rather than adding to it", () => {
    const next = afterGesture(pick(["1", "5"], "5"), { kind: "extend", rowKey: "4" }, ROWS);

    expect(idsOf(next)).toEqual(["4", "5"]);
  });

  it("extend without an anchor behaves as a plain pick", () => {
    const next = afterGesture(NO_PICK, { kind: "extend", rowKey: "3" }, ROWS);

    expect(idsOf(next)).toEqual(["3"]);
    expect(next.anchor).toBe("3");
  });

  it("extend from an anchor the table no longer draws behaves as a plain pick", () => {
    const next = afterGesture(pick(["9"], "9"), { kind: "extend", rowKey: "3" }, ROWS);

    expect(idsOf(next)).toEqual(["3"]);
    expect(next.anchor).toBe("3");
  });

  it("toggle adds a row that was not picked", () => {
    const next = afterGesture(pick(["1"], "1"), { kind: "toggle", rowKey: "3" }, ROWS);

    expect(idsOf(next)).toEqual(["1", "3"]);
    expect(next.anchor).toBe("3");
  });

  it("toggle removes a picked row and still anchors on it", () => {
    const next = afterGesture(pick(["1", "3"], "1"), { kind: "toggle", rowKey: "3" }, ROWS);

    expect(idsOf(next)).toEqual(["1"]);
    // Anchored even though the row left the pick, so a Shift+click straight afterwards extends
    // from where the pointer last was.
    expect(next.anchor).toBe("3");
  });

  it("toggle that empties the pick still anchors on the row toggled", () => {
    const next = afterGesture(pick(["3"], "3"), { kind: "toggle", rowKey: "3" }, ROWS);

    expect(idsOf(next)).toEqual([]);
    expect(next.anchor).toBe("3");
  });

  it("all picks every row it is given and keeps an anchor it still holds", () => {
    const next = afterGesture(pick(["2"], "2"), { kind: "all" }, ROWS);

    expect(idsOf(next)).toEqual(["1", "2", "3", "4", "5"]);
    expect(next.anchor).toBe("2");
  });

  it("all takes the first row as its anchor when the old one is gone", () => {
    const next = afterGesture(pick(["9"], "9"), { kind: "all" }, ROWS);

    expect(idsOf(next)).toEqual(["1", "2", "3", "4", "5"]);
    expect(next.anchor).toBe("1");
  });

  it("all over nothing picks nothing and anchors on nothing", () => {
    const next = afterGesture(pick(["9"], "9"), { kind: "all" }, []);

    expect(idsOf(next)).toEqual([]);
    expect(next.anchor).toBeNull();
  });
});

describe("narrowedTo", () => {
  it("drops the rows the table is no longer drawing", () => {
    const next = narrowedTo(pick(["1", "3", "9"], "1"), ROWS);

    expect(idsOf(next)).toEqual(["1", "3"]);
    expect(next.anchor).toBe("1");
  });

  it("clears the anchor when the anchor row went too", () => {
    const next = narrowedTo(pick(["1", "9"], "9"), ROWS);

    expect(idsOf(next)).toEqual(["1"]);
    expect(next.anchor).toBeNull();
  });

  it("answers with the same object when nothing was dropped", () => {
    const before = pick(["1", "3"], "1");

    expect(narrowedTo(before, ROWS)).toBe(before);
  });
});

describe("pickedIn", () => {
  it("answers with the picked rows in the order the table is drawing them", () => {
    const rows = [
      aReportUnit({ unitId: "3", name: "Third" }),
      aReportUnit({ unitId: "1", name: "First" }),
      aReportUnit({ unitId: "2", name: "Second" })
    ];

    expect(
      pickedIn(
        pick([unitRowKey("1:7,53", "1"), unitRowKey("1:7,53", "2")], unitRowKey("1:7,53", "1")),
        rows
      ).map((unit) => unit.unitId)
    ).toEqual(["1", "2"]);
  });

  it("returns only the picked hex's unit when two hexes hold the same number", () => {
    const here = aReportUnit({ unitId: "new-1", regionId: "1:6,52" });
    const there = aReportUnit({ unitId: "new-1", regionId: "1:9,55" });

    const picked = pickedIn(
      { ids: new Set([unitRowKey("1:9,55", "new-1")]), anchor: null },
      [here, there]
    );

    expect(picked).toEqual([there]);
  });
});

describe("onPress", () => {
  const NEITHER = { shift: false, mod: false };

  it("a shift press extends at once and arms no drag", () => {
    const outcome = onPress(pick(["2"], "2"), "4", { shift: true, mod: false }, ROWS);

    expect(idsOf(outcome.now!)).toEqual(["2", "3", "4"]);
    expect(outcome.onRelease).toBeNull();
    expect(outcome.draggable).toBe(false);
  });

  it("a mod press toggles at once and arms no drag", () => {
    const outcome = onPress(pick(["1"], "1"), "3", { shift: false, mod: true }, ROWS);

    expect(idsOf(outcome.now!)).toEqual(["1", "3"]);
    expect(outcome.onRelease).toBeNull();
    expect(outcome.draggable).toBe(false);
  });

  it("a plain press on a row already in a pick of two or more decides nothing until it is released", () => {
    const outcome = onPress(pick(["1", "2", "3"], "1"), "2", NEITHER, ROWS);

    // Nothing now: collapsing on pointerdown would make the pick impossible to drag.
    expect(outcome.now).toBeNull();
    expect(idsOf(outcome.onRelease!)).toEqual(["2"]);
    expect(outcome.onRelease!.anchor).toBe("2");
    expect(outcome.draggable).toBe(true);
  });

  it("a plain press on a row outside the pick picks it alone at once", () => {
    const outcome = onPress(pick(["1", "2"], "1"), "4", NEITHER, ROWS);

    expect(idsOf(outcome.now!)).toEqual(["4"]);
    expect(outcome.onRelease).toBeNull();
    expect(outcome.draggable).toBe(true);
  });

  it("a plain press on the only picked row settles at once", () => {
    const outcome = onPress(pick(["2"], "2"), "2", NEITHER, ROWS);

    expect(idsOf(outcome.now!)).toEqual(["2"]);
    expect(outcome.onRelease).toBeNull();
    expect(outcome.draggable).toBe(true);
  });
});
