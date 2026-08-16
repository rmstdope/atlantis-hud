import { useMemo } from "react";
import { splitTurnMessages, type TurnMessage } from "../turnMessages";
import { POPOVER_BODY_MAX_H } from "./primitives";
import { PopoverFrame } from "./popover";

/** Which of the report's two lists is being read. */
export type TurnMessagesTab = "errors" | "events";

/**
 * What the engine said about the turn, in full.
 *
 * The header has always counted these and never shown them, so a player was told that three orders
 * failed and left to guess which. This is the other half: the lines themselves, each split into the
 * unit that caused it, the order that failed and the message, with the unit a way back to the map.
 *
 * A panel anchored under the chip rather than a centred modal, for the reason the game picker gives:
 * reading a list is not worth darkening the whole workspace for. It closes on Escape and on a click
 * elsewhere, which is what anything opened from a header control should do.
 *
 * Anchored to the right of its trigger, unlike the picker. This is wide enough to hold a sentence
 * and the chip sits in the middle of the bar, so hanging it leftwards would put its far edge off a
 * narrow window.
 */
export function TurnMessagesPanel({
  turnLabel,
  errors,
  events,
  tab,
  onTab,
  knownUnitIds,
  onSelectUnit,
  onDismiss
}: {
  turnLabel: string | null;
  errors: string[];
  events: string[];
  tab: TurnMessagesTab;
  onTab: (tab: TurnMessagesTab) => void;
  /** The units the loaded turn describes. Anything outside it is shown but cannot be gone to. */
  knownUnitIds: ReadonlySet<string>;
  onSelectUnit: (unitId: string) => void;
  onDismiss: () => void;
}) {
  const parsedErrors = useMemo(() => splitTurnMessages(errors), [errors]);
  const parsedEvents = useMemo(() => splitTurnMessages(events), [events]);
  const shown = tab === "errors" ? parsedErrors : parsedEvents;

  return (
    <PopoverFrame testId="turn-messages" label="Turn messages" align="right" width="w-[28rem]">
      <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
        <span className="text-ink-soft">
          {turnLabel ? `Turn ${turnLabel}` : "This turn"}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="close turn messages"
          onClick={onDismiss}
          className="rounded px-1.5 text-ink-dim hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div role="tablist" aria-label="Turn messages" className="flex gap-1 px-2 pt-1.5">
        <Tab name="errors" count={errors.length} active={tab} onTab={onTab} />
        <Tab name="events" count={events.length} active={tab} onTab={onTab} />
      </div>

      <ul className={`${POPOVER_BODY_MAX_H} overflow-y-auto p-2`}>
        {shown.map((message, index) => (
          <li
            key={`${tab}-${index}`}
            data-testid={`turn-messages-row-${index}`}
            className="border-t border-edge-soft py-1 first:border-t-0"
          >
            {/*
              Omitted entirely when the line named neither, rather than shown as a pair of dashes.
              Most events name no order at all, and three hundred rows of placeholder say nothing
              three hundred times.
            */}
            {message.unitId || message.verb ? (
              <div className="flex items-baseline gap-2">
                <Unit message={message} known={knownUnitIds} onSelectUnit={onSelectUnit} />
                {message.verb ? <span className="text-ink-dim">{message.verb}</span> : null}
              </div>
            ) : null}
            <p className="pl-2 text-ink">{message.text}</p>
          </li>
        ))}
      </ul>
    </PopoverFrame>
  );
}

function Tab({
  name,
  count,
  active,
  onTab
}: {
  name: TurnMessagesTab;
  count: number;
  active: TurnMessagesTab;
  onTab: (tab: TurnMessagesTab) => void;
}) {
  const selected = name === active;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-testid={`turn-messages-tab-${name}`}
      // A list with nothing in it is not worth switching to, and saying so with a disabled tab is
      // clearer than a tab that opens onto nothing.
      disabled={count === 0}
      onClick={() => onTab(name)}
      className={`rounded border px-2 py-0.5 capitalize disabled:opacity-40 ${
        selected ? "border-brass text-brass" : "border-edge text-ink-soft hover:text-ink"
      }`}
    >
      {name} {count}
    </button>
  );
}

/**
 * The unit a message names, as a way to go and look at it.
 *
 * Only when the loaded turn actually describes it. An id from an order for a unit that has since
 * died would be a button that does nothing, which is worse than plain text saying the same thing.
 */
function Unit({
  message,
  known,
  onSelectUnit
}: {
  message: TurnMessage;
  known: ReadonlySet<string>;
  onSelectUnit: (unitId: string) => void;
}) {
  const unitId = message.unitId;
  if (!unitId) {
    return null;
  }

  const label = `${message.unitName} (${unitId})`;
  if (!known.has(unitId)) {
    return <span className="text-ink-dim">{label}</span>;
  }

  return (
    <button
      type="button"
      data-testid={`turn-messages-unit-${unitId}`}
      onClick={() => onSelectUnit(unitId)}
      className="rounded text-left text-brass hover:underline"
    >
      {label}
    </button>
  );
}
