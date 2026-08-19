import type { OrderDiagnosticSeverity } from "@atlantis/core-client";
import { Fragment, type ReactNode } from "react";

/**
 * The ceiling for a header popover's scrollable body.
 *
 * A fixed-percentage cap (40vh, 50vh, 60vh) scrolls a popover even when the window below it is
 * mostly empty. `6rem` covers up to two 36px header rows, the `mt-1` anchor gap, and a little
 * breathing room at the window's bottom edge - a pure-CSS clamp, no JS measurement. Tailwind scans
 * source text for class literals: interpolating this whole constant into a larger `className`
 * string (as every call site does) is fine, but the `max-h-[calc(...)]` token itself must never be
 * assembled from pieces - that is what would go unscanned.
 */
export const POPOVER_BODY_MAX_H = "max-h-[calc(100vh-6rem)]";

/**
 * The box a hex's problems sit in.
 *
 * Whole literal, never assembled from pieces: Tailwind scans source text for class names, and a
 * class built by concatenation is never emitted - the border would silently not appear.
 */
export const PROBLEM_CARD = "overflow-hidden rounded border border-edge bg-panel";

/**
 * How a diagnostic's severity reads: a glyph and a colour, never colour alone.
 *
 * The glyph is decorative and hidden; the word beside it is what a screen reader announces.
 * `sr-only` is `position:absolute`, so the second span costs no layout inside the flex row.
 */
export function SeverityMark({ severity }: { severity: OrderDiagnosticSeverity }) {
  return (
    <>
      <span
        aria-hidden
        className={`w-3 shrink-0 text-center ${severity === "error" ? "text-danger" : "text-warn"}`}
      >
        {severity === "error" ? "✕" : "⚠"}
      </span>
      <span className="sr-only">{severity === "error" ? "error" : "warning"}</span>
    </>
  );
}

/** The shared look of a unit id you can go and look at, so one gesture reads the same everywhere. */
/** The shared look of a name that opens the game-data dictionary. */
const GAME_DATA_LINK_CLASS =
  "border-b border-dotted border-ink-dim text-left hover:text-select hover:border-select focus-visible:outline focus-visible:outline-1 focus-visible:outline-select";

const UNIT_LINK_CLASS =
  "shrink-0 rounded text-left tabular-nums text-brass hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass";

/**
 * Whose problem it is: a unit id, or `hex` for a diagnostic that belongs to the hex and to no unit.
 *
 * The id is a way to go and look at the unit, on the same terms `TurnMessagesPanel`'s `Unit` sets
 * (ah-87he): a button only when the loaded turn actually describes that unit, and plain text
 * otherwise, because a button that does nothing is worse than plain text saying the same thing.
 * Without `onSelectUnit` it stays the plain span it has always been, so a caller that has no
 * selection to offer loses nothing.
 */
export function ProblemWho({
  unitId,
  known,
  onSelectUnit
}: {
  unitId: string | null;
  known?: ReadonlySet<string>;
  onSelectUnit?: (unitId: string) => void;
}) {
  if (unitId === null) {
    return (
      <>
        <span aria-hidden className="shrink-0 text-pane-sm italic tracking-wide text-ink-dim">
          hex
        </span>
        <span className="sr-only">the whole hex</span>
      </>
    );
  }

  if (onSelectUnit && known?.has(unitId)) {
    return (
      <button
        type="button"
        data-testid={`problem-unit-${unitId}`}
        onClick={() => onSelectUnit(unitId)}
        className={UNIT_LINK_CLASS}
      >
        <span className="sr-only">unit </span>
        {unitId}
      </button>
    );
  }

  return (
    <span className="shrink-0 tabular-nums text-ink-dim">
      <span className="sr-only">unit </span>
      {unitId}
    </span>
  );
}

/**
 * A diagnostic's message, with every unit it names turned into a way to go and look at it.
 *
 * The messages are prose built in Rust, so the ids have to be read back out of them - which means
 * this is coupled to their wording, and a message reworded to say "by 4021" rather than "unit 4021"
 * silently stops linking. That is the accepted cost of ah-87he's "every unit number": the failure
 * is a link that is not offered, never a wrong one, because every id found is checked against
 * `known` before it becomes a button.
 */
export function ProblemMessage({
  message,
  known,
  onSelectUnit
}: {
  message: string;
  known?: ReadonlySet<string>;
  onSelectUnit?: (unitId: string) => void;
}) {
  if (!onSelectUnit || !known) {
    return <>{message}</>;
  }

  // Built per call: a module-level /g regex keeps `lastIndex` between calls, which would link the
  // ids in every other message and miss the rest.
  const unitInMessage = /\bunit (\d+)\b/g;
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (let match = unitInMessage.exec(message); match; match = unitInMessage.exec(message)) {
    const [matched, unitId] = match;

    if (match.index > cursor) {
      parts.push(message.slice(cursor, match.index));
    }

    const word = matched.slice(0, matched.length - unitId.length);

    if (known.has(unitId)) {
      // The visible `unit ` is hidden from assistive technology and repeated inside the button
      // instead, so the button's accessible name is "unit 4021" rather than a bare "4021" - a
      // screen reader's list of buttons is unreadable otherwise - while linear reading still
      // hears it once.
      parts.push(
        <span key={`word-${match.index}`} aria-hidden>
          {word}
        </span>
      );
      parts.push(
        <button
          key={`unit-${match.index}`}
          type="button"
          data-testid={`problem-unit-${unitId}`}
          onClick={() => onSelectUnit(unitId)}
          className={UNIT_LINK_CLASS}
        >
          <span className="sr-only">unit </span>
          {unitId}
        </button>
      );
    } else {
      parts.push(word);
      parts.push(unitId);
    }
    cursor = match.index + matched.length;
  }

  if (cursor === 0) {
    return <>{message}</>;
  }

  if (cursor < message.length) {
    parts.push(message.slice(cursor));
  }

  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? <Fragment key={`text-${index}`}>{part}</Fragment> : part
      )}
    </>
  );
}

/** A labelled group inside a panel, with an optional total for a list longer than the view. */
export function Section({
  title,
  count,
  asOf,
  children
}: {
  title: string;
  count?: number;
  asOf?: string | null;
  children: ReactNode;
}) {
  return (
    <>
      <p className="mt-2.5 mb-1 text-pane-sm uppercase tracking-[0.1em] text-brass">
        {title}
        {count === undefined ? null : (
          <span className="ml-1.5 normal-case tracking-normal text-ink-dim">{count}</span>
        )}
        {asOf ? (
          <span className="ml-1.5 normal-case tracking-normal text-warn">{asOf}</span>
        ) : null}
      </p>
      {children}
    </>
  );
}

/**
 * A name that opens its game-data entry.
 *
 * Dotted underline at rest, blue under the pointer: the panes still read as prose until you look
 * for the link (ah-5jkt.2). A `<button>` rather than a clickable `<span>`, because the affordance
 * is hover-led and that is exactly what a keyboard and a screen reader cannot hover for - hence
 * the focus ring, which is not decoration here but the whole of the keyboard's affordance.
 */
export function GameDataLink({
  entryId,
  onOpen,
  children
}: {
  entryId: string;
  onOpen: (entryId: string) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-game-data-entry={entryId}
      onClick={() => onOpen(entryId)}
      className={GAME_DATA_LINK_CLASS}
    >
      {children}
    </button>
  );
}

/** A label and value on one line, with the value aligned right. */
export function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="tabular-nums text-ink-soft">{value}</span>
    </div>
  );
}

/** A key and value in a two-column grid, for the fixed fields at the top of a panel. */
export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-ink-soft">{label}</dt>
      <dd className="m-0 tabular-nums">{value}</dd>
    </>
  );
}

/** States an absence explicitly, rather than leaving a blank the user has to interpret. */
export function Absent({ children }: { children: ReactNode }) {
  return <p className="m-0 italic text-ink-dim">{children}</p>;
}

/** Warns that what follows was true at some earlier turn and may since have changed. */
export function StaleBanner({ lastSeenTurn, ageInTurns }: { lastSeenTurn: number; ageInTurns: number }) {
  return (
    <p className="mb-2 flex gap-2 rounded border border-l-[3px] border-brass/60 bg-brass/10 px-2 py-1.5 text-brass">
      <span aria-hidden>&#9719;</span>
      <span>
        <strong className="font-medium text-brass-bright">Last seen turn {lastSeenTurn}</strong>
        {ageInTurns > 0 ? `, ${ageInTurns} turn${ageInTurns === 1 ? "" : "s"} ago` : ""}. Not in the
        current report, so these figures may be out of date.
      </span>
    </p>
  );
}
