import { useEffect, useRef, useState } from "react";
import { filterGuide, guideRows, highlightSegments, type GuideSection } from "../navigationGuide";
import { useSettingsStore } from "../settingsStore";
import { DialogFrame } from "./DialogFrame";

/**
 * How to get around: every move worth knowing, with the mouse in one column and the keyboard in
 * the other, straight from `navigationGuide` - which takes its chords from the same table the
 * dispatch reads, so this can never describe a key the application does not have.
 *
 * Both columns rather than only the chords, because this greets a player at startup and a player
 * meeting a hex map for the first time reaches for the mouse. A cheat sheet that answered only
 * "which key" left the more likely question unanswered.
 *
 * The switch to stop the greeting is here rather than only in settings, because here is where
 * somebody who has seen it enough times is standing when they decide.
 *
 * A filter sits above the table (ah-ppit): the guide holds more than fifty moves, and "how do I…"
 * is usually one word away. It starts empty on every opening, so the greeting always shows the
 * whole guide, and Escape clears it before it closes anything.
 */
export function ShortcutHelp({ isMac, onDismiss }: { isMac: boolean; onDismiss: () => void }) {
  const showAtStartup = useSettingsStore((state) => state.showShortcutsAtStartup);
  const setFlag = useSettingsStore((state) => state.setFlag);

  // Focus returns where it was summoned from, the same way the command palette's does and for the
  // same reason: this overlay can be opened from inside the orders editor, and its filter takes
  // focus on mount. Without the return trip, dismissing it would leave the caret nowhere and
  // the next keystrokes would land nowhere. Captured during the first render, because by the time
  // an effect runs the filter's autoFocus has already moved focus here.
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

  // Never stored: an opening that remembered the last filter could greet a player with a guide
  // that looks nearly empty.
  const [query, setQuery] = useState("");
  const filtered = filterGuide(guideRows(isMac), query);
  const filtering = query.trim() !== "";

  return (
    <DialogFrame
      label="Getting around"
      onDismiss={onDismiss}
      // A search box's Escape: clear what was typed first, close only once there is nothing to clear.
      onEscape={() => (query === "" ? onDismiss() : setQuery(""))}
      // Drags are swallowed rather than allowed to bubble, exactly as the settings dialog swallows
      // them. This overlay now greets a first-time player, and a first-time player's first instinct
      // is to drag their turn report onto the window: without these, the drop lands on the backdrop,
      // nothing calls preventDefault, and the browser navigates away from the application to show
      // the file.
      swallowFileDrops
      layer="z-40"
      backdropTestId="shortcut-help"
      // A column with a capped height, so the header and the startup switch stay put and only
      // the middle scrolls. Capped against the viewport rather than at a fixed height: the two
      // columns are wide, and on a short window the guide is a good deal taller than the screen.
      boxClassName="flex max-h-[85vh] w-[34rem] max-w-[calc(100vw-2rem)] flex-col rounded border border-edge bg-panel-raised p-3 text-pane shadow-lg"
      barClassName="flex-none items-center justify-between"
      // A close button as well as Escape and the backdrop, because this is now the first thing a
      // new player meets: the two ways out that existed are the two a new player has no reason to
      // guess at. Focus starts in the filter instead, so a player can type straight away (ah-ppit).
      close={{
        testId: "shortcut-help-close",
        label: "close getting around",
        look: "framed"
      }}
      bar={<h2 className="text-ink">Getting around</h2>}
    >
      <label className="mt-2 flex flex-none items-center gap-1.5 rounded border border-edge bg-panel px-2 py-1 focus-within:border-brass">
        <span aria-hidden="true" className="text-ink-dim">
          ⌕
        </span>
        <input
          type="text"
          data-testid="shortcut-help-filter"
          aria-label="Filter the guide"
          placeholder="Filter - type a move, a key or a word like “army”"
          // Opened to be typed into, the startup greeting included.
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-dim"
        />
        <span
          data-testid={filtering ? "shortcut-help-count" : undefined}
          aria-live="polite"
          className="flex-none text-pane-sm text-ink-dim"
        >
          {filtering ? `${filtered.shown} of ${filtered.total}` : ""}
        </span>
      </label>

      {/*
        A table rather than the description lists this used to be: with two ways of doing the
        same thing, the columns have to line up down the whole overlay for the eye to read either
        one on its own. Scrolls in its own right, so the switch below it never leaves the screen.
      */}
      <div
        data-testid="shortcut-help-body"
        // A tab stop of its own, because a scrolling region that cannot be focused is a region a
        // keyboard-only reader cannot scroll: the only other focusable things here are the close
        // button and the switch, and reaching either says nothing about where the list is.
        //
        // Named, because a focus stop that announces nothing is a focus stop a screen reader user
        // arrives at blind - and this one is the whole content of the dialog.
        tabIndex={0}
        role="region"
        aria-label="Ways to get around"
        className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1"
      >
        <GuideTable sections={filtered.sections} query={query} />
      </div>

      {/*
        Phrased as what it does rather than as what it stops, so the box being ticked and the
        overlay being on screen say the same thing. Applies at once, like every other setting
        here; there is nothing to confirm.
      */}
      <label className="mt-3 flex flex-none items-center justify-between gap-2 border-t border-edge pt-2 text-ink-soft">
        <span>Show this when Atlantis HUD starts</span>
        <input
          type="checkbox"
          data-testid="shortcut-help-at-startup"
          aria-label="Show this when Atlantis HUD starts"
          checked={showAtStartup}
          onChange={(event) => setFlag("showShortcutsAtStartup", event.target.checked)}
          className="accent-brass"
        />
      </label>
    </DialogFrame>
  );
}

/**
 * The table, or the line saying nothing matched (ah-ppit). Hook-free, so a test can draw it with a
 * filter typed; `sections` arrives already narrowed and spelled for the platform.
 */
export function GuideTable({
  sections,
  query
}: {
  sections: readonly GuideSection[];
  query: string;
}) {
  if (sections.length === 0) {
    // In place of the table, header and all: with no rows, column names describe nothing.
    return (
      <p data-testid="shortcut-help-empty" className="px-2 py-7 text-center text-ink-dim">
        No move matches “{query.trim()}”.
        <br />
        Try a shorter word, or clear the filter.
      </p>
    );
  }
  // Separated borders and cell-level stickiness, as the units table does and for the same
  // reasons: a collapsed border belongs to the table rather than the cell, so it does not
  // travel with a sticky header, and a background on the row rather than the cells lets the
  // rows show through as they slide under it.
  return (
    <table className="w-full border-separate border-spacing-0 text-left">
      <thead>
        {/*
          Sticky, because a reader who has scrolled to the panels at the bottom is still
          reading two columns and still needs to know which is which.
        */}
        <tr className="text-pane-sm uppercase tracking-[0.08em] text-ink-dim">
          <th className="sticky -top-px z-10 w-[45%] border-b border-edge bg-panel-raised py-1 font-normal">
            Move
          </th>
          <th className="sticky -top-px z-10 w-[35%] border-b border-edge bg-panel-raised py-1 font-normal">
            Mouse
          </th>
          <th className="sticky -top-px z-10 border-b border-edge bg-panel-raised py-1 font-normal">
            Keyboard
          </th>
        </tr>
      </thead>
      {sections.map((section) => (
        <tbody key={section.group}>
          <tr>
            <th
              colSpan={3}
              className="pt-2.5 pb-0.5 text-pane-sm font-normal uppercase tracking-[0.08em] text-brass"
            >
              {section.group}
            </th>
          </tr>
          {section.rows.map((move) => (
            <tr key={move.id} className="align-baseline">
              <td className="py-0.5 pr-2 text-ink-soft">
                <Marked text={move.description} query={query} />
              </td>
              {/*
                A dash where there is no such way of doing it: an empty cell reads as an
                oversight, where "—" says the move genuinely needs the other hand.
              */}
              <td className="py-0.5 pr-2 text-ink">
                {move.mouse === null ? <Absent /> : <Marked text={move.mouse} query={query} />}
              </td>
              <td className="py-0.5 font-mono text-ink">
                {move.keys === null ? <Absent /> : <Marked text={move.keys} query={query} />}
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

/** A cell with what the filter matched marked, so the eye finds why the row stayed. */
function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded-sm bg-brass/25 text-inherit">
            {segment.text}
          </mark>
        ) : (
          segment.text
        )
      )}
    </>
  );
}

/** Says "there is no such way of doing this", where an empty cell would say nothing at all. */
function Absent() {
  return <span className="text-ink-dim">—</span>;
}
