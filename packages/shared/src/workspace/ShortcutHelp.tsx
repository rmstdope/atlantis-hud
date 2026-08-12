import { useEffect, useRef } from "react";
import { SHORTCUTS } from "../shortcuts";
import { useSettingsStore } from "../settingsStore";
import { useEscapeToDismiss } from "./dismissLayer";

/**
 * The keyboard cheat sheet: every shortcut the global layer answers, straight from the same
 * table the dispatch reads, so this can never describe a key the app does not have.
 *
 * It also shows itself at startup, which is the only reason a player who knows no shortcuts ever
 * sees it. The switch to stop that is here rather than only in settings, because here is where
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

  const groups = [...new Set(SHORTCUTS.map((entry) => entry.group))];

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
        aria-label="Keyboard shortcuts"
        className="w-[22rem] rounded border border-edge bg-panel-raised p-3 text-[11.5px] shadow-lg"
      >
        {/*
          A close button as well as Escape and the backdrop, because this is now the first thing a
          new player meets: the two ways out that existed are the two a new player has no reason to
          guess at.
        */}
        <div className="flex items-center justify-between">
          <h2 className="text-ink">Keyboard shortcuts</h2>
          <button
            type="button"
            data-testid="shortcut-help-close"
            aria-label="close keyboard shortcuts"
            // Focus starts inside the dialog rather than behind it, as the settings dialog does.
            autoFocus
            onClick={onDismiss}
            className="rounded border border-edge px-1.5 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            ×
          </button>
        </div>
        {groups.map((group) => (
          <div key={group} className="mt-2">
            <h3 className="text-[10px] uppercase tracking-[0.08em] text-ink-dim">{group}</h3>
            <dl className="mt-1 flex flex-col gap-1">
              {SHORTCUTS.filter((entry) => entry.group === group).map((entry) => (
                <div key={entry.id} className="flex items-baseline justify-between gap-2">
                  <dt className="text-ink-soft">{entry.description}</dt>
                  <dd className="m-0 font-mono text-ink">{isMac ? entry.mac : entry.other}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}

        {/*
          Phrased as what it does rather than as what it stops, so the box being ticked and the
          overlay being on screen say the same thing. Applies at once, like every other setting
          here; there is nothing to confirm.
        */}
        <label className="mt-3 flex items-center justify-between gap-2 border-t border-edge pt-2 text-ink-soft">
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
