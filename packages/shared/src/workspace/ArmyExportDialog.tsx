import { useState } from "react";
import type { ArmyRecord } from "@atlantis/core-client";

import { exportReadiness } from "../armyExport";
import type { DerivedSkills } from "../battleSkills";
import { useEscapeToDismiss } from "./dismissLayer";

/**
 * Which Armies fight, and which side each is on.
 *
 * Two pickers and a swap, because that is the whole of the question: the simulator's file has an
 * attacking side and a defending one, and either may be empty. The Army whose strip opened the
 * dialog starts as the attackers, which is the common case - you are looking at the force you are
 * about to send in.
 *
 * Below them, the count and the caveats. The caveats are a stacked list rather than a paragraph
 * (ah-1mpx.3 D1): three of them can be true at once, and one that appears and disappears on its
 * own is one a player can look at on its own.
 *
 * Every decision the lines below make lives in `../armyExport`, which is where they are tested;
 * this file is only how they look. `packages/shared` has no jsdom (ah-nass), so the `<select>`s,
 * the swap and the download are covered by `tests/smoke/armies.spec.ts` instead.
 */
export function ArmyExportDialog({
  armies,
  initialAttackerId,
  currentTurn,
  derived,
  scanning,
  unreadTurns,
  busy,
  error,
  onExport,
  onDismiss
}: {
  armies: readonly ArmyRecord[];
  /** The Army whose strip opened the dialog. It starts as the attackers. */
  initialAttackerId: string;
  currentTurn: number;
  /** The combat skills recovered from battle rosters (`useBattleSkillsStore`). */
  derived: DerivedSkills;
  /** The recovery scan is still running, so a foreign unit's skills are not counted yet. */
  scanning: boolean;
  /** Stored turns the scan could not read; the dialog says how many. */
  unreadTurns: number;
  busy: boolean;
  error: string | null;
  onExport: (attackers: ArmyRecord | null, defenders: ArmyRecord | null) => void;
  onDismiss: () => void;
}) {
  // The dialog owns the two choices; the shell owns only whether it is open. Reopening therefore
  // starts from the strip's Army again, which is deliberate (ah-1mpx.3, Where state lives).
  const [attackerId, setAttackerId] = useState<string>(initialAttackerId);
  const [defenderId, setDefenderId] = useState<string>("");

  useEscapeToDismiss(onDismiss);

  const armyOf = (id: string): ArmyRecord | null =>
    armies.find((army) => army.id === id) ?? null;
  const attackers = armyOf(attackerId);
  const defenders = armyOf(defenderId);

  const readiness = exportReadiness({
    armies,
    attackers,
    defenders,
    currentTurn,
    derived,
    scanning,
    unreadTurns
  });

  // Not re-sorted: `armies` arrives in the store's order, which is `sortArmies`'.
  const picker = (
    side: "attackers" | "defenders",
    label: string,
    value: string,
    onChange: (id: string) => void
  ) => (
    <label className="flex items-center justify-between gap-2 text-ink-soft">
      <span>{label}</span>
      <select
        data-testid={`army-export-${side}`}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded border border-edge bg-panel-raised px-1.5 py-0.5 text-ink"
      >
        <option value="">— none —</option>
        {armies.map((army) => (
          <option key={army.id} value={army.id}>
            {`${army.name} — ${army.members.length} units`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div
      data-testid="army-export-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
    >
      <div
        data-testid="army-export-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Export to battle simulator"
        className="flex w-[30rem] flex-col gap-2 rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-ink">Export to battle simulator</h2>
          <button
            type="button"
            data-testid="army-export-close"
            aria-label="close export"
            autoFocus
            onClick={onDismiss}
            className="rounded border border-edge px-1.5 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-edge pt-2">
          {picker("attackers", "Attackers", attackerId, setAttackerId)}
          <div className="flex justify-end">
            <button
              type="button"
              data-testid="army-export-swap"
              disabled={attackers === null && defenders === null}
              onClick={() => {
                setAttackerId(defenderId);
                setDefenderId(attackerId);
              }}
              className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass disabled:border-edge disabled:text-ink-dim"
            >
              ⇅ Swap sides
            </button>
          </div>
          {picker("defenders", "Defenders", defenderId, setDefenderId)}
        </div>

        <p data-testid="army-export-summary" className="border-t border-edge pt-2 text-ink">
          {readiness.refusal ?? readiness.countText}
        </p>
        {readiness.notices.map((notice) => (
          <div key={notice.kind} className="flex gap-2" data-testid="army-export-notice">
            {/*
              The marker carries no meaning a reader needs - the colour is the whole of what it
              says, and the text says it in words as well. Two columns so a wrapped second line
              hangs under the first rather than under the marker.
            */}
            <span
              aria-hidden="true"
              className={
                // Grey for the transient waiting line as well as the empty side (L1): neither is a
                // caveat about the file, and the waiting one is a state about to end.
                notice.kind === "empty-side" || notice.kind === "scanning"
                  ? "text-ink-dim"
                  : "text-warn"
              }
            >
              ●
            </span>
            <span className="text-ink-dim">{notice.text}</span>
          </div>
        ))}
        {error ? (
          <p data-testid="army-export-error" className="text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="army-export-confirm"
            disabled={busy || readiness.refusal !== null || readiness.waiting}
            onClick={() => onExport(attackers, defenders)}
            className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim"
          >
            {busy ? "Exporting…" : "Export…"}
          </button>
        </div>
      </div>
    </div>
  );
}
