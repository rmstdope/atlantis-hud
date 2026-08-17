import { POPOVER_BODY_MAX_H } from "./primitives";
import { PopoverFrame } from "./popover";

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
  onSelect
}: {
  turns: TurnPickerEntry[];
  workingTurn: number;
  comparedTurn: number | null;
  onSelect: (turnNumber: number) => void;
}) {
  const ordered = [...turns].sort((a, b) => a.key.turnNumber - b.key.turnNumber);

  return (
    <PopoverFrame testId="turn-picker" label="Turns of this game" align="left" width="w-72" padding="p-2">
      <div className="px-1 pb-1.5 text-pane-sm tracking-[0.12em] text-brass uppercase">
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
                <span className="ml-auto text-pane-sm text-ink-dim">
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
    </PopoverFrame>
  );
}
