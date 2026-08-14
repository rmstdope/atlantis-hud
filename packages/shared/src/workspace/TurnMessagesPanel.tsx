import { useEffect, useMemo, useRef } from "react";
import { splitTurnMessages, type TurnMessage } from "../turnMessages";
import { POPOVER_BODY_MAX_H } from "./primitives";

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
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    // Pointer rather than click, and the wrapper rather than the panel: a drag that began inside is
    // not a dismissal, and the chip that opened this sits beside it in that wrapper - testing the
    // panel alone would dismiss on the chip's own press and let its toggle reopen immediately.
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

  const parsedErrors = useMemo(() => splitTurnMessages(errors), [errors]);
  const parsedEvents = useMemo(() => splitTurnMessages(events), [events]);
  const shown = tab === "errors" ? parsedErrors : parsedEvents;

  return (
    <div
      ref={panelRef}
      data-testid="turn-messages"
      role="dialog"
      aria-label="Turn messages"
      /*
       * Not a drop target, deliberately.
       *
       * This panel is a child of the header in the DOM but floats over the map, and the header is
       * what accepts a dropped report - it is the only element that calls `preventDefault` on a
       * dragover, which is what makes a drop legal at all. Left alone, this rectangle would inherit
       * that and become the one place outside the 36px header bar where a file could be dropped:
       * an invisible target sitting over the map, present only while a list of errors happens to be
       * open. Stopping the event here keeps the answer to "where do reports go" the same whether
       * this is open or shut, at the cost of a drop onto the panel itself doing nothing.
       *
       * The game picker does the same, for the same reason.
       */
      onDragOver={(event) => event.stopPropagation()}
      // `whitespace-normal` undoes the header's `whitespace-nowrap`, which keeps the turn and
      // faction labels on one line up there and inherits into anything rendered inside it. These
      // messages are prose and have to wrap.
      className="absolute right-0 top-full z-20 mt-1 w-[28rem] rounded border border-edge bg-panel-raised text-[11.5px] whitespace-normal shadow-lg"
    >
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
    </div>
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
