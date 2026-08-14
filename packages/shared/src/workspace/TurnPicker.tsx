import { useEffect, useRef } from "react";
import { POPOVER_BODY_MAX_H } from "./primitives";

/** Enough of a stored turn to list it - no report content, just what identifies and labels it. */
export type TurnPickerEntry = {
  key: { factionId: string; turnNumber: number };
  season: string | null;
};

/**
 * The turns of this game, offered as one half of a pair.
 *
 * The working turn is always the other half: this list only ever says which turn to compare
 * against it, never which two turns to pick. That is ah-jg6.3's whole interaction, chosen with the
 * navigator over the free-pick alternative (mockup `docs/ui/turn-compare-picker.html`) because it
 * matches the question a player actually has - "what changed since then?" - with one click to ask
 * it and one to stop.
 */
export function TurnPicker({
  turns,
  workingTurn,
  comparedTurn,
  onSelect,
  onDismiss
}: {
  turns: TurnPickerEntry[];
  workingTurn: number;
  comparedTurn: number | null;
  onSelect: (turnNumber: number) => void;
  onDismiss: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const trigger = panelRef.current?.parentElement ?? panelRef.current;
      if (!trigger?.contains(event.target as Node)) {
        onDismiss();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onDismiss]);

  const ordered = [...turns].sort((a, b) => a.key.turnNumber - b.key.turnNumber);

  return (
    <div
      ref={panelRef}
      data-testid="turn-picker"
      role="dialog"
      aria-label="Turns of this game"
      onDragOver={(event) => event.stopPropagation()}
      className="absolute left-0 top-full z-20 mt-1 w-72 rounded border border-edge bg-panel-raised p-2 text-[11.5px] whitespace-normal shadow-lg"
    >
      <div className="px-1 pb-1.5 text-[10px] tracking-[0.12em] text-brass uppercase">
        Turns of this game
      </div>
      <ul className={`${POPOVER_BODY_MAX_H} overflow-y-auto`}>
        {ordered.map((turn) => {
          const isWorking = turn.key.turnNumber === workingTurn;
          const isCompared = turn.key.turnNumber === comparedTurn;
          return (
            <li key={turn.key.turnNumber}>
              <button
                type="button"
                data-testid={`turn-row-${turn.key.turnNumber}`}
                onClick={() => onSelect(turn.key.turnNumber)}
                className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left ${
                  isCompared ? "bg-panel-selected" : ""
                } ${isWorking ? "text-brass" : "text-ink-soft"}`}
              >
                <span className="w-3 text-center">{isWorking ? "●" : isCompared ? "⇄" : ""}</span>
                <span className="tabular-nums text-ink">{turn.key.turnNumber}</span>
                {turn.season ? <span className="text-ink-dim">{turn.season}</span> : null}
                <span className="ml-auto text-[9.5px] text-ink-dim">
                  {isWorking ? "playing" : isCompared ? "compare" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-edge px-1 pt-1.5 text-ink-dim">
        {`click a turn to compare it with ${workingTurn} · click again to stop`}
      </p>
    </div>
  );
}
