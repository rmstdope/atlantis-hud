import { useEffect, useState } from "react";
import { APP_VERSION } from "../appVersion";
import { useSettingsStore } from "../settingsStore";
import type { ThemeName } from "../settingsStore";
import type { WorkspaceGame } from "../workspaceStore";
import type { AppUpdateControl } from "./appUpdate";
import { updatePresentationFor } from "./appUpdate";
import type { SettingsTabId } from "./settingsTabs";
import { SETTINGS_TABS, gameSettingsPresentation, nextTab, rulesetOptions } from "./settingsTabs";

/**
 * The settings dialog: global preferences, the open game's, and what this build is.
 *
 * A centered modal rather than a header popover like its predecessor, because settings now hold
 * controls rather than a version line, and three tabs of controls hanging off a header button is a
 * menu pretending not to be a dialog. Every change applies the moment it is made — there is no OK
 * to press, so closing is the only exit and nothing is ever half-committed.
 *
 * Two dismissal semantics change with the promotion to a modal, both deliberately: the cogwheel no
 * longer toggles the dialog closed (it sits under the backdrop, and a dimmed control that still
 * worked would undermine what the dimming says), and report drops on the header are blocked while
 * the dialog is open (the backdrop covers the drop target, as a modal means it to).
 *
 * It is reachable before a game exists, which is why `GameGate` renders it too; the per-game tab
 * shows an empty state then. The element is `position: fixed`, so mounting inside the header's
 * anchor span places it correctly anyway.
 */
export function SettingsDialog({
  platformLabel,
  appUpdate,
  game,
  busy,
  error,
  onChangeRuleset,
  onDismiss
}: {
  platformLabel: string;
  appUpdate: AppUpdateControl;
  game: WorkspaceGame | null;
  busy: boolean;
  error: string | null;
  onChangeRuleset: (rulesetId: string) => void;
  onDismiss: () => void;
}) {
  // Local rather than lifted: the dialog unmounts when closed, so every open lands on Global,
  // which is the wanted default.
  const [tab, setTab] = useState<SettingsTabId>("global");

  useEffect(() => {
    // Captured, and stopped, because Escape must mean only "close this dialog". Other surfaces
    // listen for Escape on the document too — the foreign-report prompt cancels a pending decision
    // on it — and a bubble-phase listener here would let one keypress answer both.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onDismiss]);

  return (
    <div
      data-testid="settings-backdrop"
      // A press that starts on the dim area dismisses; one that starts on the panel does not, even
      // if the pointer is released outside it. `pointerdown` matches the header popovers' feel.
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      // The dialog is mounted inside the header, which is the report drop target, so drags that
      // land on the backdrop would bubble into it — turning the whole dimmed screen into a drop
      // zone while a modal claims exclusivity. Swallowed instead: a modal means what it dims.
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
    >
      <div
        data-testid="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        // `whitespace-normal` undoes the header's `whitespace-nowrap`, which would otherwise
        // inherit through the anchor span this dialog is mounted in.
        className="w-[26rem] rounded border border-edge bg-panel-raised p-3 text-[11.5px] whitespace-normal shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-ink">Settings</h2>
          <button
            type="button"
            data-testid="settings-close"
            aria-label="close settings"
            // Focus starts inside the dialog, not on the cog behind the backdrop, so the keyboard
            // is where `aria-modal` says it is. A full focus trap can follow when the dialog
            // grows controls that need one.
            autoFocus
            onClick={onDismiss}
            className="rounded border border-edge px-1.5 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            ×
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Settings sections"
          // One tab stop, not three: only the selected tab is tabbable and the arrows move within
          // the list, selection following focus, as the ARIA tabs pattern asks.
          onKeyDown={(event) => {
            const target = nextTab(tab, event.key);
            if (target) {
              event.preventDefault();
              setTab(target);
              event.currentTarget
                .querySelector<HTMLButtonElement>(`[data-testid="settings-tab-${target}"]`)
                ?.focus();
            }
          }}
          className="mt-2 flex gap-1"
        >
          {SETTINGS_TABS.map((entry) => (
            <Tab key={entry.id} id={entry.id} label={entry.label} active={tab} onTab={setTab} />
          ))}
        </div>

        <div className="mt-3 min-h-32">
          {tab === "global" ? <GlobalSettings /> : null}
          {tab === "game" ? (
            <GameSettings
              game={game}
              busy={busy}
              error={error}
              onChangeRuleset={onChangeRuleset}
            />
          ) : null}
          {tab === "about" ? <About platformLabel={platformLabel} appUpdate={appUpdate} /> : null}
        </div>
      </div>
    </div>
  );
}

function Tab({
  id,
  label,
  active,
  onTab
}: {
  id: SettingsTabId;
  label: string;
  active: SettingsTabId;
  onTab: (tab: SettingsTabId) => void;
}) {
  const selected = id === active;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-testid={`settings-tab-${id}`}
      onClick={() => onTab(id)}
      className={`rounded border px-2 py-0.5 ${
        selected ? "border-brass text-brass" : "border-edge text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Settings that hold for every game: the theme, the map's textures, how see-through panes are,
 * and how many units the hex list shows.
 */
function GlobalSettings() {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const biomeTextures = useSettingsStore((state) => state.biomeTextures);
  const setBiomeTextures = useSettingsStore((state) => state.setBiomeTextures);
  const paneTransparency = useSettingsStore((state) => state.paneTransparency);
  const setPaneTransparency = useSettingsStore((state) => state.setPaneTransparency);
  const unitListLimit = useSettingsStore((state) => state.unitListLimit);
  const setUnitListLimit = useSettingsStore((state) => state.setUnitListLimit);
  const warnOnUnguardedHex = useSettingsStore((state) => state.warnOnUnguardedHex);
  const setWarnOnUnguardedHex = useSettingsStore((state) => state.setWarnOnUnguardedHex);
  const movementPlanner = useSettingsStore((state) => state.movementPlanner);
  const setMovementPlanner = useSettingsStore((state) => state.setMovementPlanner);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-soft">Theme</span>
        <div className="flex gap-1">
          <ThemeChoice name="dark" label="Dark" current={theme} onPick={setTheme} />
          <ThemeChoice name="light" label="Light" current={theme} onPick={setTheme} />
        </div>
      </div>
      <label className="flex items-center justify-between gap-2 text-ink-soft">
        <span>
          <span className="block">Biome textures</span>
          <span className="block text-[10px] text-ink-dim">Uses image tiles for known biomes.</span>
        </span>
        <input
          type="checkbox"
          data-testid="settings-biome-textures"
          aria-label="Biome textures"
          checked={biomeTextures}
          onChange={(event) => setBiomeTextures(event.target.checked)}
          className="accent-brass"
        />
      </label>

      {/*
        Off by default, and deliberately. Most hexes are left unguarded on purpose - against the
        committed turn 71 this warns about every hex the faction stands in - and a panel that
        always has something to say is one nobody reads. Losing a guard you had is reported
        whatever this says, because that is a change the player may not have meant.
      */}
      <label className="flex items-center justify-between gap-2 text-ink-soft">
        <span>
          <span className="block">Warn about unguarded hexes</span>
          <span className="block text-[10px] text-ink-dim">
            Every hex holding your units with nobody guarding it. Losing a guard is always warned
            about.
          </span>
        </span>
        <input
          type="checkbox"
          data-testid="settings-warn-unguarded"
          aria-label="Warn about unguarded hexes"
          checked={warnOnUnguardedHex}
          onChange={(event) => setWarnOnUnguardedHex(event.target.checked)}
          className="accent-brass"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-ink-soft">Pane transparency</span>
          <span className="text-ink">{paneTransparency}%</span>
        </span>
        {/*
          Capped at 95 rather than 100, because a fully transparent pane can neither be read nor
          found again to turn back. Applies as it is dragged: the panes are on screen behind the
          dialog, so the slider is its own preview.
        */}
        <input
          type="range"
          data-testid="pane-transparency"
          aria-label="pane transparency"
          min={0}
          max={95}
          step={5}
          value={paneTransparency}
          onChange={(event) => setPaneTransparency(Number(event.target.value))}
          className="accent-brass"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-ink-soft">Units in hex list</span>
          <span className="text-ink">{unitListLimit}</span>
        </span>
        {/*
          Bounded at both ends: fewer than three rows stops being a list, and past sixteen the
          table is scrolling anyway - the filter is the tool for finding one unit among hundreds.
          Applies as it is dragged, the table behind the dialog being its own preview.
        */}
        <input
          type="range"
          data-testid="unit-list-limit"
          aria-label="units in hex list"
          min={3}
          max={16}
          step={1}
          value={unitListLimit}
          onChange={(event) => setUnitListLimit(Number(event.target.value))}
          className="accent-brass"
        />
      </label>

      <label className="flex items-center justify-between gap-2 text-ink-soft">
        <span>
          <span className="block">Movement planner</span>
          <span className="block text-[10px] text-ink-dim">
            Shows the experimental Movement pane for planning MOVE routes on the map.
          </span>
        </span>
        <input
          type="checkbox"
          data-testid="settings-movement-planner"
          aria-label="Movement planner"
          checked={movementPlanner}
          onChange={(event) => setMovementPlanner(event.target.checked)}
          className="accent-brass"
        />
      </label>
    </div>
  );
}

function ThemeChoice({
  name,
  label,
  current,
  onPick
}: {
  name: ThemeName;
  label: string;
  current: ThemeName;
  onPick: (theme: ThemeName) => void;
}) {
  const selected = name === current;

  return (
    <button
      type="button"
      data-testid={`theme-${name}`}
      aria-pressed={selected}
      onClick={() => onPick(name)}
      className={`rounded border px-2 py-0.5 ${
        selected ? "border-brass text-brass" : "border-edge text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

/** Settings that hold for the open game only: its ruleset, until more arrive. */
function GameSettings({
  game,
  busy,
  error,
  onChangeRuleset
}: {
  game: WorkspaceGame | null;
  busy: boolean;
  error: string | null;
  onChangeRuleset: (rulesetId: string) => void;
}) {
  const presentation = gameSettingsPresentation(game);

  if (presentation.kind === "empty") {
    return (
      <p data-testid="settings-no-game" className="text-ink-soft">
        Per-game settings appear once a game is open.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink-soft">{presentation.gameName}</p>
      <label className="flex flex-col gap-1">
        <span className="text-ink-soft">Ruleset</span>
        <select
          data-testid="settings-game-ruleset"
          aria-label="ruleset"
          value={presentation.rulesetId}
          disabled={busy}
          onChange={(event) => onChangeRuleset(event.target.value)}
          className="rounded border border-edge bg-panel px-2 py-1 text-ink disabled:opacity-50"
        >
          {rulesetOptions(presentation.rulesetId).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <span data-testid="settings-game-error" role="alert" className="text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** What this build is, and whether there is a newer one — the old settings panel, now a tab. */
function About({
  platformLabel,
  appUpdate
}: {
  platformLabel: string;
  appUpdate: AppUpdateControl;
}) {
  const { message, action } = updatePresentationFor(appUpdate.state);

  return (
    <div>
      <dl className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-soft">Version</dt>
          <dd data-testid="app-version" className="text-ink">
            {APP_VERSION}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-soft">Build</dt>
          <dd className="text-ink">{platformLabel}</dd>
        </div>
      </dl>

      <div className="mt-2 border-t border-edge pt-2">
        {action ? (
          <button
            type="button"
            data-testid="check-for-updates"
            onClick={() => (action.kind === "apply" ? appUpdate.apply?.() : appUpdate.check())}
            className="w-full rounded border border-edge bg-panel px-2 py-1 text-brass hover:border-brass"
          >
            {action.label}
          </button>
        ) : null}
        {message ? (
          <p data-testid="update-status" className="mt-1.5 text-ink-soft">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
