import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterPalette,
  noteSnippet,
  paletteKeyReduce,
  PALETTE_PAGE_ROWS,
  type PaletteEntry
} from "../commandPalette";
import { useEscapeToDismiss } from "./dismissLayer";
import { factionRow } from "./paletteFactionRow";

/**
 * The kind as the row prints it: `order` for order help, `hex note` and `mage note` for the two
 * kinds of note (ah-mlls.5), the kind's own name otherwise.
 */
export function kindLabel(entry: PaletteEntry): string {
  switch (entry.kind) {
    case "order-help":
      return "order";
    case "hex-note":
      return "hex note";
    case "mage-note":
      return "mage note";
    default:
      return entry.kind;
  }
}

/**
 * A note row's text (ah-mlls.5), on two lines where every other row has one: the line of the note
 * holding what was typed, the match in bold, and beneath it, dimmed, where the note was written.
 * Each line is cut at its end with `…` on its own, so on a narrow window a hex note's turn is the
 * first thing lost and its hex the next.
 */
export function PaletteNoteText({
  text,
  place,
  query
}: {
  text: string;
  place: string;
  query: string;
}) {
  const snippet = noteSnippet(text, query);
  return (
    <span className="mr-auto flex min-w-0 flex-col">
      <span data-testid="palette-note-line" className="truncate">
        {snippet.lead ? "…" : ""}
        {snippet.before}
        <b className="font-semibold text-ink">{snippet.match}</b>
        {snippet.after}
      </span>
      <span data-testid="palette-note-place" className="truncate text-pane-sm text-ink-dim">
        {place}
      </span>
    </span>
  );
}

/**
 * Everything the row says, for its hover text: a long label or faction is cut short with "…"
 * on a narrow row, and this is where the whole of it can still be read (ah-mlls.1).
 */
function rowTitle(entry: PaletteEntry): string {
  const standing = entry.kind === "faction" ? factionRow(entry) : null;
  return [
    `${entry.label}${standing?.mark ?? ""}`,
    entry.note?.place,
    entry.faction?.label,
    entry.count?.text,
    entry.lastSeenTurn !== undefined ? `last seen turn ${entry.lastSeenTurn}` : undefined,
    standing?.attitude.word,
    kindLabel(entry)
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

/**
 * The command palette: one input over everything reachable by name.
 *
 * A modal like the settings dialog and dismissed the same ways - Escape captured and stopped, so
 * one press closes only this; a press on the backdrop; running an entry. Focus goes back where
 * it came from on close unless the entry that ran claimed it for somewhere else, which a
 * navigation entry does the moment it selects a unit.
 */
export function CommandPalette({
  entries,
  onDismiss
}: {
  entries: PaletteEntry[];
  onDismiss: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const shown = useMemo(() => filterPalette(entries, query), [entries, query]);
  // Clamped rather than stored: a narrowing query must not leave the highlight past the end.
  const active = Math.min(index, Math.max(0, shown.length - 1));

  useEscapeToDismiss(onDismiss);

  // The highlighted row is scrolled into view for the keyboard only. Doing it on hover would move
  // the row out from under the pointer, firing another `pointerenter` - a list that will not stand
  // still. `block: "nearest"` scrolls only when the row is actually off screen, so arrowing within
  // the visible rows does not jog it.
  const list = useRef<HTMLUListElement | null>(null);
  const byKeyboard = useRef(false);
  useEffect(() => {
    if (!byKeyboard.current) {
      return;
    }
    byKeyboard.current = false;
    const rows = list.current?.querySelectorAll('[data-testid="palette-item"]');
    rows?.[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Focus returns to where the palette was summoned from - unless the entry that ran took it
  // somewhere on purpose, which is what the activeElement check respects. Captured during the
  // first render, deliberately: by the time any effect runs, the input's autoFocus has already
  // moved focus here, and an effect would only ever record the palette's own input.
  const summonedFrom = useRef<Element | null>(null);
  if (summonedFrom.current === null) {
    summonedFrom.current = typeof document === "undefined" ? null : document.activeElement;
  }
  useEffect(() => {
    return () => {
      const current = document.activeElement;
      if (
        (current === null || current === document.body) &&
        summonedFrom.current instanceof HTMLElement
      ) {
        summonedFrom.current.focus();
      }
    };
  }, []);

  const run = (entry: PaletteEntry | undefined) => {
    if (!entry) {
      return;
    }
    onDismiss();
    entry.run();
  };

  return (
    <div
      data-testid="command-palette"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[15vh]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-[28rem] rounded border border-edge bg-panel-raised p-2 text-pane shadow-lg"
      >
        <input
          type="text"
          data-testid="palette-input"
          aria-label="search commands"
          placeholder="unit, place, action, order…"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              run(shown[active]);
              return;
            }
            const step = (from: number) =>
              paletteKeyReduce(
                {
                  // The same clamp `active` applies, so a narrowed list still steps from a real row.
                  index: Math.min(from, Math.max(0, shown.length - 1)),
                  count: shown.length,
                  pageSize: PALETTE_PAGE_ROWS
                },
                event.key
              );
            // Recognising the key does not depend on where the highlight is, so this call answers
            // "is this ours?"; the move itself is applied to the *pending* index rather than to
            // the rendered one. Holding Down outruns React's renders otherwise, and every press
            // within one commit computes the same next row - the highlight then crawls.
            if (step(active) !== null) {
              event.preventDefault();
              byKeyboard.current = true;
              setIndex((current) => step(current) ?? current);
            }
          }}
          className="w-full rounded border border-edge bg-ground px-2 py-1 text-ink outline-none focus:border-select"
        />
        {/* 70vh against the dialog's own pt-[15vh]: the list uses a tall window and simply
            scrolls on a short one, and the dialog can never run past the bottom edge. */}
        <ul
          ref={list}
          role="listbox"
          aria-label="matches"
          className="m-0 mt-1 max-h-[70vh] list-none overflow-y-auto p-0"
        >
          {shown.map((entry, at) => {
            // A faction row's attitude, house mark and colour (ah-mlls.3); null on every other row.
            const standing = entry.kind === "faction" ? factionRow(entry) : null;
            return (
              <li key={entry.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={at === active}
                  data-testid="palette-item"
                  // Selection follows the pointer the way it follows the arrows - but on real
                  // movement only. `pointerenter` also fires when a row scrolls *under* a
                  // stationary mouse, so on an uncapped list (ah-yk6b) arrowing down would scroll
                  // a row beneath the pointer and hand the highlight straight back to it.
                  onPointerMove={() => {
                    byKeyboard.current = false;
                    setIndex(at);
                  }}
                  onClick={() => run(entry)}
                  title={rowTitle(entry)}
                  className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left ${
                    at === active ? "bg-edge/40 text-ink" : "text-ink-soft"
                  }`}
                >
                  {/* One flat row so each piece shrinks on its own terms (ah-mlls.1): the auto margin
                      takes any spare room; when room runs short the faction gives way first - its
                      shrink factor dwarfs the label's - down to about a word, and only then does the
                      unit's name shorten. The kind and the history marker never shrink. */}
                  {entry.note !== undefined ? (
                    <PaletteNoteText text={entry.label} place={entry.note.place} query={query} />
                  ) : (
                    <span className={`mr-auto min-w-0 truncate ${standing?.labelClassName ?? ""}`}>
                      {entry.label}
                      {standing?.mark}
                    </span>
                  )}
                  {entry.faction ? (
                    <span
                      data-testid="palette-faction"
                      className={`min-w-[6ch] shrink-[1000] truncate text-pane-sm ${
                        entry.faction.concealed ? "italic text-ink-dim" : "text-ink-soft"
                      }`}
                    >
                      {entry.faction.label}
                    </span>
                  ) : null}
                  {entry.count ? (
                    <span
                      className={`shrink-0 whitespace-nowrap text-pane-sm ${
                        entry.count.quiet ? "italic text-ink-dim" : "text-ink-soft"
                      }`}
                    >
                      {entry.count.text}
                    </span>
                  ) : null}
                  {entry.lastSeenTurn !== undefined ? (
                    <span className="shrink-0 whitespace-nowrap text-pane-sm text-brass-bright">
                      last seen turn {entry.lastSeenTurn}
                    </span>
                  ) : null}
                  {/* The friend-or-foe word never shortens: the faction's name gives way instead. */}
                  {standing ? (
                    <span
                      className={`shrink-0 whitespace-nowrap text-pane-sm ${standing.attitude.className}`}
                    >
                      {standing.attitude.word}
                    </span>
                  ) : null}
                  <span className="shrink-0 whitespace-nowrap text-pane-sm uppercase tracking-[0.08em] text-ink-dim">
                    {kindLabel(entry)}
                  </span>
                  {entry.binding ? (
                    <span className="shrink-0 font-mono text-pane-sm text-ink-dim">{entry.binding}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {shown.length === 0 ? (
            <li className="px-2 py-1 text-ink-dim">nothing matches</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
