import type { ReactNode } from "react";
import type { UpdateMark } from "./appUpdate";
import { NO_UPDATE_MARK } from "./appUpdate";

/**
 * The header's gear, with the settings dialog hanging off it.
 *
 * One component for both headers - the workspace's and the no-game screen's - so the mark a newer
 * version leaves on it (ah-sw92) cannot appear on one and be forgotten on the other. The dot is
 * decoration: it is `aria-hidden` and not focusable, and the button's accessible name and tooltip
 * carry the same news in words.
 */
export function SettingsButton({
  settingsOpen,
  onToggleSettings,
  mark = NO_UPDATE_MARK,
  settings
}: {
  settingsOpen: boolean;
  onToggleSettings: () => void;
  mark?: UpdateMark;
  settings: ReactNode;
}) {
  return (
    // Relative for the same reason the game indicator is: the panel hangs off this button.
    <span className="relative">
      <button
        type="button"
        data-testid="settings-indicator"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        aria-label={mark.settingsLabel}
        title={mark.marked ? mark.settingsLabel : undefined}
        onClick={onToggleSettings}
        className="relative rounded border border-edge bg-panel-raised px-2 py-1 text-ink-soft hover:border-brass hover:text-ink"
      >
        <span aria-hidden>⚙</span>
        {mark.marked ? (
          <span
            aria-hidden="true"
            data-testid="settings-update-dot"
            className="pointer-events-none absolute -right-1 -top-1 h-[9px] w-[9px] rounded-full bg-brass ring-2 ring-panel"
          />
        ) : null}
      </button>
      {settingsOpen ? settings : null}
    </span>
  );
}
