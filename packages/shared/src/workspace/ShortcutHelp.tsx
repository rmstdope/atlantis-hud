import { useEffect, useRef } from "react";
import { navigationGroups } from "../navigationGuide";
import { useSettingsStore } from "../settingsStore";
import { useEscapeToDismiss } from "./dismissLayer";

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
 */
export function ShortcutHelp({ isMac, onDismiss }: { isMac: boolean; onDismiss: () => void }) {
  useEscapeToDismiss(onDismiss);

  const showAtStartup = useSettingsStore((state) => state.showShortcutsAtStartup);
  const setShowAtStartup = useSettingsStore((state) => state.setShowShortcutsAtStartup);

  // Focus returns where it was summoned from, the same way the command palette's does and for the
  // same reason: this overlay can be opened from inside the orders editor, and its close button
  // takes focus on mount. Without the return trip, dismissing it would leave the caret nowhere and
  // the next keystrokes would land nowhere. Captured during the first render, because by the time
  // an effect runs the button's autoFocus has already moved focus here.
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

  const sections = navigationGroups();

  return (
    <div
      data-testid="shortcut-help"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      // Drags are swallowed rather than allowed to bubble, exactly as the settings dialog swallows
      // them. This overlay now greets a first-time player, and a first-time player's first instinct
      // is to drag their turn report onto the window: without these, the drop lands on the backdrop,
      // nothing calls preventDefault, and the browser navigates away from the application to show
      // the file.
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Getting around"
        // A column with a capped height, so the header and the startup switch stay put and only
        // the middle scrolls. Capped against the viewport rather than at a fixed height: the two
        // columns are wide, and on a short window the guide is a good deal taller than the screen.
        className="flex max-h-[85vh] w-[34rem] max-w-[calc(100vw-2rem)] flex-col rounded border border-edge bg-panel-raised p-3 text-[11.5px] shadow-lg"
      >
        {/*
          A close button as well as Escape and the backdrop, because this is now the first thing a
          new player meets: the two ways out that existed are the two a new player has no reason to
          guess at.
        */}
        <div className="flex flex-none items-center justify-between">
          <h2 className="text-ink">Getting around</h2>
          <button
            type="button"
            data-testid="shortcut-help-close"
            aria-label="close getting around"
            // Focus starts inside the dialog rather than behind it, as the settings dialog does.
            autoFocus
            onClick={onDismiss}
            className="rounded border border-edge px-1.5 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            ×
          </button>
        </div>
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
          {/*
            Separated borders and cell-level stickiness, as the units table does and for the same
            reasons: a collapsed border belongs to the table rather than the cell, so it does not
            travel with a sticky header, and a background on the row rather than the cells lets the
            rows show through as they slide under it.
          */}
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead>
              {/*
                Sticky, because a reader who has scrolled to the panels at the bottom is still
                reading two columns and still needs to know which is which.
              */}
              <tr className="text-[10px] uppercase tracking-[0.08em] text-ink-dim">
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
                    className="pt-2.5 pb-0.5 text-[10px] font-normal uppercase tracking-[0.08em] text-brass"
                  >
                    {section.group}
                  </th>
                </tr>
                {section.moves.map((move) => (
                  <tr key={move.id} className="align-baseline">
                    <td className="py-0.5 pr-2 text-ink-soft">{move.description}</td>
                    {/*
                      A dash where there is no such way of doing it: an empty cell reads as an
                      oversight, where "—" says the move genuinely needs the other hand.
                    */}
                    <td className="py-0.5 pr-2 text-ink">{move.mouse ?? <Absent />}</td>
                    <td className="py-0.5 font-mono text-ink">
                      {move.keys ? (isMac ? move.keys.mac : move.keys.other) : <Absent />}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
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
            onChange={(event) => setShowAtStartup(event.target.checked)}
            className="accent-brass"
          />
        </label>
      </div>
    </div>
  );
}

/** Says "there is no such way of doing this", where an empty cell would say nothing at all. */
function Absent() {
  return <span className="text-ink-dim">—</span>;
}
