import type { ReportUnit } from "@atlantis/core-client";
import { useEffect, useState } from "react";
import type { HexNode } from "../hexMapModel";
import { readUnitOrders } from "../ordersDocument";
import { CollapsiblePanel } from "./CollapsiblePanel";

/** Why the editor is refusing an edit. Each reason needs its own wording to be any use. */
type Lock =
  | { kind: "no-unit" }
  | { kind: "foreign"; factionName: string; factionId: string | null }
  | { kind: "not-in-turn"; lastSeenTurn: number | null }
  | { kind: "no-block" };

/**
 * Where the document stands with storage.
 *
 * Four states rather than a timestamp, because the panel used to show one that was made out of
 * `new Date()` and meant nothing. "failed" carries its reason: orders are the player's own typed
 * work, and a write that fails silently is the one failure that loses it.
 */
export type SaveState =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed"; reason: string };

type OrdersPanelProps = {
  unit: ReportUnit | null;
  hex: HexNode | null;
  /** The whole faction document, of which this panel edits one unit's slice. */
  document: string;
  ownFactionName: string;
  onChange: (unitId: string, orders: string) => void;
  errorCount: number;
  warningCount: number;
  save: SaveState;
};

function lockFor(unit: ReportUnit | null, hex: HexNode | null, block: string | null): Lock | null {
  if (!unit) {
    return { kind: "no-unit" };
  }
  if (!unit.own) {
    return {
      kind: "foreign",
      factionName: unit.factionName ?? "another faction",
      factionId: unit.factionId
    };
  }
  // A unit carried over from an earlier turn cannot be ordered: you cannot command what you cannot
  // presently see, and the server would reject orders for it.
  if (hex?.knowledge === "stale") {
    return { kind: "not-in-turn", lastSeenTurn: hex.lastSeenTurn };
  }
  if (block === null) {
    return { kind: "no-block" };
  }
  return null;
}

export function OrdersPanel({
  unit,
  hex,
  document,
  ownFactionName,
  onChange,
  errorCount,
  warningCount,
  save
}: OrdersPanelProps) {
  const unitId = unit?.unitId ?? null;
  const block = unitId === null ? null : readUnitOrders(document, unitId);
  const lock = lockFor(unit, hex, block);
  const [draft, setDraft] = useState(block ?? "");

  // Reload when the selection or the document changes, not on every render: re-reading constantly
  // would fight the user's typing, while never reloading would show one unit's orders under
  // another's name.
  useEffect(() => {
    setDraft(unitId === null ? "" : readUnitOrders(document, unitId) ?? "");
  }, [unitId, document]);

  return (
    <CollapsiblePanel
      panel="orders"
      title="Orders"
      hint={unit ? `— unit ${unit.unitId}` : undefined}
      className="min-h-0"
    >
      {lock ? (
        <LockNotice lock={lock} ownFaction={ownFactionName} />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <textarea
            data-testid="orders-input"
            aria-label={`Orders for unit ${unit?.unitId ?? ""}`}
            value={draft}
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value);
              if (unit) {
                onChange(unit.unitId, event.target.value);
              }
            }}
            className="min-h-0 w-full flex-1 resize-none rounded border border-edge bg-ground p-2 font-mono text-[11.5px] text-ink outline-none focus:border-select"
          />
          <p
            data-testid="orders-status"
            className="m-0 flex items-center gap-3 border-t border-edge pt-1.5 text-[10px] text-ink-soft"
          >
            <span className={errorCount > 0 ? "text-danger" : "text-ok"}>
              {errorCount} error{errorCount === 1 ? "" : "s"}
            </span>
            <span className={warningCount > 0 ? "text-warn" : "text-ok"}>
              {warningCount} warning{warningCount === 1 ? "" : "s"}
            </span>
            <span className="flex-1" />
            <SaveNotice save={save} />
          </p>
        </div>
      )}
    </CollapsiblePanel>
  );
}

/**
 * What the document's last dealings with storage were.
 *
 * A failure is coloured and left standing rather than fading back to "unsaved changes": the player
 * needs to know their evening is not on disk, and needs to know why.
 */
function SaveNotice({ save }: { save: SaveState }) {
  switch (save.kind) {
    case "clean":
      return <span>not saved yet</span>;
    case "dirty":
      return <span className="text-warn">unsaved changes</span>;
    case "saving":
      return <span>saving…</span>;
    case "saved":
      return <span>saved {save.at}</span>;
    case "failed":
      return <span className="text-danger">could not save: {save.reason}</span>;
  }
}

function LockNotice({ lock, ownFaction }: { lock: Lock; ownFaction: string }) {
  const { badge, lines } = describe(lock, ownFaction);

  return (
    <div
      data-testid="orders-locked"
      data-lock={lock.kind}
      className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-ink-dim"
    >
      <span className="rounded border border-edge px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-ink-soft">
        {badge}
      </span>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
}

function describe(lock: Lock, ownFaction: string): { badge: string; lines: string[] } {
  switch (lock.kind) {
    case "no-unit":
      return { badge: "No unit", lines: ["Select a unit to write its orders."] };
    case "foreign":
      return {
        badge: "Read only",
        lines: [
          `This unit belongs to ${lock.factionName}${lock.factionId ? ` (${lock.factionId})` : ""}.`,
          `You can only write orders for units in ${ownFaction}.`
        ]
      };
    case "not-in-turn":
      return {
        badge: "Not in this turn",
        lines: [
          lock.lastSeenTurn === null
            ? "This unit is not in the current report."
            : `This unit was last seen on turn ${lock.lastSeenTurn} and is not in the current report.`,
          "Orders can only be written for units present in the current turn."
        ]
      };
    case "no-block":
      return {
        badge: "No orders block",
        lines: [
          "The report's orders template has no block for this unit.",
          "Adding one would produce a file the server rejects."
        ]
      };
  }
}
