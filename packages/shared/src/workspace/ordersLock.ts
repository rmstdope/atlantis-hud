import type { ReportUnit } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";

export type Lock =
  | { kind: "no-unit" }
  | { kind: "foreign"; factionName: string; factionId: string | null }
  | { kind: "not-in-turn"; lastSeenTurn: number | null };

export function lockFor(unit: ReportUnit | null, hex: HexNode | null): Lock | null {
  if (!unit) return { kind: "no-unit" };
  if (!unit.own) {
    return { kind: "foreign", factionName: unit.factionName ?? "another faction", factionId: unit.factionId };
  }
  if (hex?.knowledge === "stale") return { kind: "not-in-turn", lastSeenTurn: hex.lastSeenTurn };
  return null;
}

export function describeLock(lock: Lock, ownFaction: string): { badge: string; lines: string[] } {
  switch (lock.kind) {
    case "no-unit": return { badge: "No unit", lines: ["Select a unit to write its orders."] };
    case "foreign": return {
      badge: "Read only",
      lines: [
        `This unit belongs to ${lock.factionName}${lock.factionId ? ` (${lock.factionId})` : ""}.`,
        `You can only write orders for units in ${ownFaction}.`
      ]
    };
    case "not-in-turn": return {
      badge: "Not in this turn",
      lines: [
        lock.lastSeenTurn === null
          ? "This unit is not in the current report."
          : `This unit was last seen on turn ${lock.lastSeenTurn} and is not in the current report.`,
        "Orders can only be written for units present in the current turn."
      ]
    };
  }
}
