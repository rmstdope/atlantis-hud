import { useMemo } from "react";
import { groupTurnMessages, splitTurnMessages } from "../turnMessages";

/**
 * One of the report's two lists: what the engine said went wrong, or what happened.
 *
 * The header has always counted these and never shown them, so a player was told that three orders
 * failed and left to guess which. This is the other half: the lines themselves, each split into the
 * unit that caused it, the order that failed and the message, with the unit a way back to the map.
 *
 * Two of the turn-report panel's four tab bodies (ah-30hg.2). `errors` is flat; `events` groups by
 * the unit that caused them, because following one unit through a turn otherwise means reading the
 * whole list and remembering. The frame, the header line, the tab row and the scroller are the
 * panel's.
 */
export function TurnMessagesList({
  kind,
  lines,
  knownUnitIds,
  onSelectUnit
}: {
  kind: "errors" | "events";
  lines: readonly string[];
  /** The units the loaded turn describes. Anything outside it is shown but cannot be gone to. */
  knownUnitIds: ReadonlySet<string>;
  onSelectUnit: (unitId: string) => void;
}) {
  const parsed = useMemo(() => splitTurnMessages(lines), [lines]);
  const groups = useMemo(
    () => (kind === "events" ? groupTurnMessages(parsed) : []),
    [kind, parsed]
  );

  return (
    <ul data-testid={kind === "errors" ? "turn-report-errors" : "turn-report-events"}>
      {kind === "events"
        ? groups.map((group) => (
            <li
              key={group.unitId ?? "general"}
              data-testid={`turn-messages-group-${group.unitId ?? "general"}`}
              className="border-t border-edge-soft py-1 first:border-t-0"
            >
              <div className="flex items-baseline gap-2">
                {group.unitId ? (
                  <Unit
                    unitId={group.unitId}
                    unitName={group.unitName}
                    known={knownUnitIds}
                    onSelectUnit={onSelectUnit}
                  />
                ) : (
                  <span className="text-ink-soft">General</span>
                )}
                <span className="flex-1" />
                <span className="text-ink-dim">{group.messages.length}</span>
              </div>
              {/*
                Every group is open: grouping alone does the work, and a one-line group hidden
                behind a control costs a click to read nothing (navigator, 2026-08-17).
              */}
              <ul className="pl-2">
                {group.messages.map((message, index) => (
                  <li key={index} className="py-0.5">
                    {message.verb ? (
                      <span className="pr-2 text-ink-dim">{message.verb}</span>
                    ) : null}
                    <span className="text-ink">{message.text}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))
        : parsed.map((message, index) => (
            <li
              key={`${kind}-${index}`}
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
                  <Unit
                    unitId={message.unitId}
                    unitName={message.unitName}
                    known={knownUnitIds}
                    onSelectUnit={onSelectUnit}
                  />
                  {message.verb ? <span className="text-ink-dim">{message.verb}</span> : null}
                </div>
              ) : null}
              <p className="pl-2 text-ink">{message.text}</p>
            </li>
          ))}
    </ul>
  );
}

/**
 * The unit a message names, as a way to go and look at it.
 *
 * Only when the loaded turn actually describes it. An id from an order for a unit that has since
 * died would be a button that does nothing, which is worse than plain text saying the same thing.
 */
function Unit({
  unitId,
  unitName,
  known,
  onSelectUnit
}: {
  unitId: string | null;
  unitName: string | null;
  known: ReadonlySet<string>;
  onSelectUnit: (unitId: string) => void;
}) {
  if (!unitId) {
    return null;
  }

  const label = `${unitName} (${unitId})`;
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
