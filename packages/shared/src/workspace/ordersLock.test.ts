import { aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { hexNodeOf } from "../hexMapModel";
import type { HexNode } from "../hexMapModel";
import { describeLock, formedSelectionFor, lockFor } from "./ordersLock";

function hexAt(knowledge: "current" | "stale", lastSeenTurn: number | null): HexNode {
  return hexNodeOf(
    {
      coordinate: { x: 43, y: 81, z: 1 },
      terrain: "mountain",
      province: "Derngill",
      knowledge,
      lastSeenTurn,
      region: null,
      settlement: null
    },
    71
  );
}

describe("lockFor", () => {
  it("an own unit in the current turn is editable even with no block in the document", () => {
    expect(lockFor(aReportUnit({ unitId: "1656", own: true }), hexAt("current", 71), null)).toBeNull();
  });

  it("refuses when no unit is selected", () => {
    expect(lockFor(null, hexAt("current", 71), null)).toEqual({ kind: "no-unit" });
  });

  it("refuses a unit of another faction", () => {
    expect(
      lockFor(
        aReportUnit({ unitId: "42", own: false, factionName: "Borg", factionId: "95" }),
        hexAt("current", 71),
        null
      )
    ).toEqual({ kind: "foreign", factionName: "Borg", factionId: "95" });
  });

  it("refuses an own unit whose hex is only remembered", () => {
    expect(lockFor(aReportUnit({ unitId: "1656", own: true }), hexAt("stale", 68), null)).toEqual({
      kind: "not-in-turn",
      lastSeenTurn: 68
    });
  });
});

describe("describeLock", () => {
  it("keeps the wording of the refusals that remain", () => {
    expect(describeLock({ kind: "foreign", factionName: "Borg", factionId: "95" }, "Vanguard")).toEqual({
      badge: "Read only",
      lines: [
        "This unit belongs to Borg (95).",
        "You can only write orders for units in Vanguard."
      ]
    });

    expect(describeLock({ kind: "not-in-turn", lastSeenTurn: 68 }, "Vanguard")).toEqual({
      badge: "Not in this turn",
      lines: [
        "This unit was last seen on turn 68 and is not in the current report.",
        "Orders can only be written for units present in the current turn."
      ]
    });

    expect(describeLock({ kind: "no-unit" }, "Vanguard")).toEqual({
      badge: "No unit",
      lines: ["Select a unit to write its orders."]
    });
  });
});

describe("a unit formed this month", () => {
  const REGION = new Set(["1922"]);
  const document = ["unit 1922", "@claim 200", "form 1", "buy 1 hdwa", "end"].join("\n");

  it("a formed unit whose FORM the document has lost is refused, and says which order to write", () => {
    const lock = lockFor(null, hexAt("current", 71), { alias: "1", formedBy: null });
    expect(lock).toEqual({ kind: "no-form-block", alias: "1" });
    expect(describeLock(lock!, "Bandits (95)")).toEqual({
      badge: "No FORM order",
      lines: [
        "The orders no longer carry a FORM 1 that creates this unit in this hex.",
        "Select the unit that should create it and write a FORM 1 order in its orders."
      ]
    });
  });

  it("a formed unit with a FORM block is not locked, even with no row in the forecast", () => {
    expect(lockFor(null, hexAt("current", 71), { alias: "1", formedBy: "1922" })).toBeNull();
  });

  it("a new-1 selection resolves to the FORM block that creates it in this hex", () => {
    expect(formedSelectionFor(document, "new-1", REGION)).toEqual({ alias: "1", formedBy: "1922" });
    expect(formedSelectionFor("unit 1922\n@tax", "new-1", REGION)).toEqual({
      alias: "1",
      formedBy: null
    });
    expect(formedSelectionFor(document, "1922", REGION)).toBeNull();
    expect(formedSelectionFor(document, null, REGION)).toBeNull();
  });
});
