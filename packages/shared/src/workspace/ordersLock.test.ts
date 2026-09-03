import { aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { hexNodeOf } from "../hexMapModel";
import type { HexNode } from "../hexMapModel";
import { describeLock, lockFor } from "./ordersLock";

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
    expect(lockFor(aReportUnit({ unitId: "1656", own: true }), hexAt("current", 71))).toBeNull();
  });

  it("refuses when no unit is selected", () => {
    expect(lockFor(null, hexAt("current", 71))).toEqual({ kind: "no-unit" });
  });

  it("refuses a unit of another faction", () => {
    expect(
      lockFor(
        aReportUnit({ unitId: "42", own: false, factionName: "Borg", factionId: "95" }),
        hexAt("current", 71)
      )
    ).toEqual({ kind: "foreign", factionName: "Borg", factionId: "95" });
  });

  it("refuses an own unit whose hex is only remembered", () => {
    expect(lockFor(aReportUnit({ unitId: "1656", own: true }), hexAt("stale", 68))).toEqual({
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
