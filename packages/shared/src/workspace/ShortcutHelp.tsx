import { SHORTCUTS } from "../shortcuts";
import { useEscapeToDismiss } from "./dismissLayer";

/**
 * The keyboard cheat sheet: every shortcut the global layer answers, straight from the same
 * table the dispatch reads, so this can never describe a key the app does not have.
 */
export function ShortcutHelp({ isMac, onDismiss }: { isMac: boolean; onDismiss: () => void }) {
  useEscapeToDismiss(onDismiss);

  const groups = [...new Set(SHORTCUTS.map((entry) => entry.group))];

  return (
    <div
      data-testid="shortcut-help"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-[22rem] rounded border border-edge bg-panel-raised p-3 text-[11.5px] shadow-lg"
      >
        <h2 className="text-ink">Keyboard shortcuts</h2>
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
      </div>
    </div>
  );
}
