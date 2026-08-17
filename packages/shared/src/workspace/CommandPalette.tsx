import { useEffect, useMemo, useRef, useState } from "react";
import { filterPalette, paletteKeyReduce, type PaletteEntry } from "../commandPalette";
import { useEscapeToDismiss } from "./dismissLayer";

/** More results than fit a keyboard's patience; typing narrows faster than scrolling finds. */
const SHOWN_LIMIT = 12;

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
  const shown = useMemo(() => filterPalette(entries, query, SHOWN_LIMIT), [entries, query]);
  // Clamped rather than stored: a narrowing query must not leave the highlight past the end.
  const active = Math.min(index, Math.max(0, shown.length - 1));

  useEscapeToDismiss(onDismiss);

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
            const moved = paletteKeyReduce({ index: active, count: shown.length }, event.key);
            if (moved !== null) {
              event.preventDefault();
              setIndex(moved);
            }
          }}
          className="w-full rounded border border-edge bg-ground px-2 py-1 text-ink outline-none focus:border-select"
        />
        <ul role="listbox" aria-label="matches" className="m-0 mt-1 list-none p-0">
          {shown.map((entry, at) => (
            <li key={entry.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={at === active}
                data-testid="palette-item"
                // Selection follows the pointer the way it follows the arrows.
                onPointerEnter={() => setIndex(at)}
                onClick={() => run(entry)}
                className={`flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left ${
                  at === active ? "bg-edge/40 text-ink" : "text-ink-soft"
                }`}
              >
                <span className="min-w-0 truncate">{entry.label}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-pane-sm uppercase tracking-[0.08em] text-ink-dim">
                    {entry.kind === "order-help" ? "order" : entry.kind}
                  </span>
                  {entry.binding ? (
                    <span className="font-mono text-pane-sm text-ink-dim">{entry.binding}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
          {shown.length === 0 ? (
            <li className="px-2 py-1 text-ink-dim">nothing matches</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
