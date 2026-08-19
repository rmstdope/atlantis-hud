import { useState } from "react";
import type { AdvisoryCheckCode } from "@atlantis/core-client";
import { useEscapeToDismiss } from "./dismissLayer";
import { APP_VERSION } from "../appVersion";
import { snippetBodyProblem, snippetNameProblem } from "../orderSnippets";
import { useSettingsStore } from "../settingsStore";
import { useWorkspaceStore } from "../workspaceStore";
import type { ThemeName } from "../settingsStore";
import { mapThemeOptions } from "./mapThemes";
import { SettingToggle } from "./SettingToggle";
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

  // Escape closes this dialog - unless something newer stands over it, which is the command
  // palette's whole opening move.
  useEscapeToDismiss(onDismiss);

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
        className="w-[26rem] rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
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
          {tab === "warnings" ? <WarningSettings /> : null}
          {tab === "snippets" ? <SnippetSettings /> : null}
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
/** Exported for `SettingsDialog.test.tsx`, which renders this panel in isolation. */
export function GlobalSettings() {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const mapTheme = useSettingsStore((state) => state.mapTheme);
  const setMapTheme = useSettingsStore((state) => state.setMapTheme);
  const biomeTextures = useSettingsStore((state) => state.biomeTextures);
  const setBiomeTextures = useSettingsStore((state) => state.setBiomeTextures);
  // Per theme (ah-j1xd): the slider always shows and writes the theme the player is looking at.
  const paneTransparency = useSettingsStore((state) => state.paneTransparency);
  const setPaneTransparency = useSettingsStore((state) => state.setPaneTransparency);
  const interfaceSize = useSettingsStore((state) => state.interfaceSize);
  const setInterfaceSize = useSettingsStore((state) => state.setInterfaceSize);
  const showShortcutsAtStartup = useSettingsStore((state) => state.showShortcutsAtStartup);
  const setShowShortcutsAtStartup = useSettingsStore((state) => state.setShowShortcutsAtStartup);
  const movementPlanner = useSettingsStore((state) => state.movementPlanner);
  const setMovementPlanner = useSettingsStore((state) => state.setMovementPlanner);
  const orderOcd = useSettingsStore((state) => state.orderOcd);
  const setOrderOcd = useSettingsStore((state) => state.setOrderOcd);
  // A workspace preference rather than a setting, but this is where a player looks for "put it
  // back how it was" - and a table whose columns have been dragged into a bad shape needs a way
  // out that is not on the table itself (ah-1owr.2).
  const resetUnitColumnShares = useWorkspaceStore((state) => state.resetUnitColumnShares);
  const resetUnitColumnOrder = useWorkspaceStore((state) => state.resetUnitColumnOrder);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-soft">App theme</span>
        <div className="flex gap-1">
          <ThemeChoice name="dark" label="Dark" current={theme} onPick={setTheme} />
          <ThemeChoice name="light" label="Light" current={theme} onPick={setTheme} />
        </div>
      </div>

      {/*
        The options come from the theme registry, never from a list kept here: a new map theme is
        one module and one registry entry, and it must appear in this picker without touching it.
      */}
      <label className="flex items-center justify-between gap-2 text-ink-soft">
        <span>
          <span className="block">Map theme</span>
          <span className="block text-pane-sm text-ink-dim">How the world map draws each hex.</span>
        </span>
        <select
          data-testid="settings-map-theme"
          aria-label="Map theme"
          value={mapTheme}
          onChange={(event) => setMapTheme(event.target.value)}
          className="rounded border border-edge bg-panel-raised px-1.5 py-0.5 text-ink"
        >
          {mapThemeOptions().map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <SettingToggle
        title="Biome textures"
        description="Uses image tiles for known biomes."
        testId="settings-biome-textures"
        checked={biomeTextures}
        onChange={setBiomeTextures}
      />

      {/*
        The same switch the overlay itself carries. Here as well because the overlay is the one
        screen a player can turn off from inside and then be unable to find again: the key that
        opens it is written on the thing they just dismissed.
      */}
      <SettingToggle
        title="Show the getting-around guide at startup"
        description="The mouse and keyboard guide greets you when the application opens."
        testId="settings-shortcuts-at-startup"
        checked={showShortcutsAtStartup}
        onChange={setShowShortcutsAtStartup}
      />

      <label className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-ink-soft">Pane transparency</span>
          <span className="text-ink">{paneTransparency[theme]}%</span>
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
          value={paneTransparency[theme]}
          onChange={(event) => setPaneTransparency(Number(event.target.value))}
          className="accent-brass"
        />
        <span className="block text-pane-sm text-ink-dim">
          Makes the panes see-through so the map shows behind them. Remembered separately for the
          dark and light themes.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-ink-soft">Interface size</span>
          <span className="text-ink">{interfaceSize}%</span>
        </span>
        <input
          type="range"
          data-testid="settings-interface-size"
          aria-label="interface size"
          min={100}
          max={200}
          step={25}
          value={interfaceSize}
          onChange={(event) => setInterfaceSize(Number(event.target.value))}
          className="accent-brass"
        />
        <span className="text-pane-sm text-ink-dim">
          Makes the panes, the header and the dialogs bigger. The map is not affected.
        </span>
      </label>

      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-soft">
          <span className="block">Units table columns</span>
          <span className="block text-pane-sm text-ink-dim">
            Puts the dragged column widths, or the order they were dragged into, back to how they
            ship.
          </span>
        </span>
        {/*
          Two buttons rather than one "Reset columns": order and widths are separate preferences
          stored separately, so a player can undo the mess they made of one without losing the
          other (ah-1owr.3). The pair follows `BadgeMenu`'s All/None shape.
        */}
        <span className="flex gap-1">
          <button
            type="button"
            data-testid="settings-reset-column-widths"
            onClick={resetUnitColumnShares}
            className="rounded border border-edge px-1.5 text-ink-soft hover:text-ink"
          >
            Reset widths
          </button>
          <button
            type="button"
            data-testid="settings-reset-column-order"
            onClick={resetUnitColumnOrder}
            className="rounded border border-edge px-1.5 text-ink-soft hover:text-ink"
          >
            Reset order
          </button>
        </span>
      </div>

      <SettingToggle
        title="Movement planner"
        description="Shows the experimental Movement pane for planning MOVE routes on the map."
        testId="settings-movement-planner"
        checked={movementPlanner}
        onChange={setMovementPlanner}
      />

      <SettingToggle
        title="Order OCD"
        description="Uppercase the command keywords as you write, so MOVE, STUDY and ALL stand out from names. Text inside quotes is left alone."
        testId="settings-order-ocd"
        checked={orderOcd}
        onChange={setOrderOcd}
      />
    </div>
  );
}

/**
 * Which advisory order-check codes should not run at all: the Warnings tab's on/off toggles,
 * grouped Studying/Teaching / Resources / Markets / Guarding / Orders / Building / Sailing. Off means the core never
 * produces the finding - counts, chip, panels and editor underlines all agree, nothing anywhere
 * says "hidden".
 */
const WARNING_GROUPS: readonly {
  heading: string;
  entries: readonly { code: AdvisoryCheckCode; title: string; description: string }[];
}[] = [
  {
    heading: "Studying/Teaching",
    entries: [
      {
        code: "teacher-has-free-slots",
        title: "Teachers with free slots",
        description: "A unit that could teach somebody this month and is not."
      },
      {
        code: "teaching-oversubscribed",
        title: "Oversubscribed teachers",
        description: "More students than the teacher can take."
      },
      {
        code: "teacher-cannot-teach",
        title: "Teachers lacking the skill",
        description: "The teacher cannot teach what the student is studying."
      },
      {
        code: "taught-not-studying",
        title: "Students not studying",
        description: "A unit named as a student that is not studying anything."
      },
      {
        code: "taught-not-here",
        title: "Students elsewhere",
        description: "Teacher and student are not in the same hex."
      },
      {
        code: "too-many-quartermasters",
        title: "More quartermasters than allowed",
        description:
          "A unit ordered to study quartermaster when the faction already has all it may have."
      },
      {
        code: "study-at-maximum",
        title: "Study with nothing to learn",
        description: "A unit ordered to study a skill it has already taken to the ruleset's maximum."
      },
      {
        code: "magic-study-outside-building",
        title: "Magic study outside a building",
        description:
          "A mage above level 2 studying magic where no building houses them, which halves the month's study."
      }
    ]
  },
  {
    heading: "Resources",
    entries: [
      {
        code: "not-enough-silver",
        title: "Overspent silver",
        description: "Orders spend more silver than the unit or the hex holds."
      },
      {
        code: "not-enough-items",
        title: "Overdrawn items",
        description: "Orders spend more of an item than the unit or the hex holds."
      }
    ]
  },
  {
    heading: "Markets",
    entries: [
      {
        code: "not-traded-here",
        title: "Buying what is not sold",
        description: "A BUY or SELL order for something this hex's market does not trade."
      }
    ]
  },
  {
    heading: "Guarding",
    entries: [
      {
        code: "guard-dropped",
        title: "Dropped guards",
        description: "A hex you were guarding no longer is."
      },
      {
        code: "hex-unguarded",
        title: "Unguarded hexes",
        description: "Every hex holding your units with nobody guarding it."
      }
    ]
  },
  {
    heading: "Orders",
    entries: [
      {
        code: "form-alias-reused",
        title: "Reused FORM numbers",
        description: "Two units formed in the same hex this month with the same NEW number."
      },
      {
        code: "give-target-not-here",
        title: "Gifts to units that are not here",
        description: "A GIVE or TAKE naming a unit the report does not show in that hex."
      },
      {
        code: "too-many-trade-regions",
        title: "Producing in too many regions",
        description: "PRODUCE orders in more regions than the faction's allowance permits."
      },
      {
        code: "unit-overloaded",
        title: "Overloaded units",
        description: "A unit ordered to move carrying more than it can move with."
      },
      {
        code: "unit-does-nothing",
        title: "Units that do nothing",
        description: "A unit with no order that spends its month."
      }
    ]
  },
  {
    heading: "Building",
    entries: [
      {
        code: "already-built",
        title: "Building what is built",
        description: "A BUILD order on a structure the report already shows as finished."
      },
      {
        code: "build-outside-structure",
        title: "Building outside a structure",
        description: "A bare BUILD or BUILD COMPLETE by a unit that is in no structure."
      },
      {
        code: "build-help-not-building",
        title: "Helping a unit that is not building",
        description: "A BUILD HELP naming a unit with no BUILD order of its own."
      }
    ]
  },
  {
    heading: "Sailing",
    entries: [
      {
        code: "fleet-overloaded",
        title: "Overloaded fleets",
        description: "A fleet ordered to sail with more weight aboard than it can carry."
      },
      {
        code: "fleet-undercrewed",
        title: "Undercrewed fleets",
        description: "A fleet ordered to sail without enough sailing skill aboard."
      }
    ]
  }
];

/**
 * Every advisory check's on/off toggle, grouped as `WARNING_GROUPS` lays out. Global in scope -
 * "per game" is not a settings scope today - and off by default only for `hex-unguarded`, matching
 * the behaviour this tab absorbed from the Global tab's own checkbox.
 */
/** Exported for `SettingsDialog.test.tsx`, which renders this panel in isolation. */
export function WarningSettings() {
  const advisoryChecks = useSettingsStore((state) => state.advisoryChecks);
  const setAdvisoryCheck = useSettingsStore((state) => state.setAdvisoryCheck);

  return (
    <div className="flex flex-col gap-3">
      {WARNING_GROUPS.map((group) => (
        <div key={group.heading} className="flex flex-col gap-2">
          <div className="mt-2 text-pane-sm uppercase tracking-wider text-ink-dim border-b border-edge/60 pb-0.5">
            {group.heading}
          </div>
          {group.entries.map((entry) => (
            <SettingToggle
              key={entry.code}
              title={entry.title}
              description={entry.description}
              testId={`settings-warning-${entry.code}`}
              checked={advisoryChecks[entry.code]}
              onChange={(checked) => setAdvisoryCheck(entry.code, checked)}
            />
          ))}
        </div>
      ))}
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

/**
 * The player's snippet library: reusable order blocks, insertable by name from the editor's
 * completion popup. A body may carry ${field} markers, which expand as tab-through placeholders.
 *
 * Add and delete, no in-place editing: a snippet is small enough that delete-and-retype is the
 * simpler story, and the store's `updateSnippet` waits for the day that stops being true.
 */
function SnippetSettings() {
  const snippets = useSettingsStore((state) => state.snippets);
  const addSnippet = useSettingsStore((state) => state.addSnippet);
  const removeSnippet = useSettingsStore((state) => state.removeSnippet);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const add = () => {
    const found = snippetNameProblem(name, snippets) ?? snippetBodyProblem(body);
    if (found) {
      setProblem(found);
      return;
    }
    addSnippet({ id: crypto.randomUUID(), name: name.trim(), body });
    setName("");
    setBody("");
    setProblem(null);
  };

  return (
    <div className="flex flex-col gap-2">
      {snippets.length === 0 ? (
        <p className="text-ink-soft">
          No snippets yet. A snippet is a block of orders you insert by typing its name in the
          orders editor.
        </p>
      ) : (
        <ul className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0">
          {snippets.map((snippet) => (
            <li
              key={snippet.id}
              data-testid="snippet-row"
              className="flex items-start justify-between gap-2 rounded border border-edge px-2 py-1"
            >
              <span className="min-w-0">
                <span className="block text-ink">{snippet.name}</span>
                <span className="block truncate font-mono text-pane-sm text-ink-dim">
                  {snippet.body.split("\n")[0]}
                  {snippet.body.includes("\n") ? " …" : ""}
                </span>
              </span>
              <button
                type="button"
                data-testid="snippet-delete"
                aria-label={`delete snippet ${snippet.name}`}
                onClick={() => {
                  removeSnippet(snippet.id);
                  // The error usually names this row as the conflict; deleting it resolves that.
                  setProblem(null);
                }}
                className="rounded border border-edge px-1.5 py-0.5 text-ink-soft hover:border-danger hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-ink-soft">Name</span>
        <input
          type="text"
          data-testid="snippet-name"
          aria-label="snippet name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
          className="rounded border border-edge bg-panel px-2 py-1 text-ink"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-ink-soft">Orders</span>
        <textarea
          data-testid="snippet-body"
          aria-label="snippet orders"
          value={body}
          spellCheck={false}
          rows={3}
          onChange={(event) => {
            setBody(event.target.value);
            setProblem(null);
          }}
          className="resize-none rounded border border-edge bg-panel px-2 py-1 font-mono text-ink"
        />
      </label>
      {problem ? (
        <span data-testid="snippet-error" role="alert" className="text-danger">
          {problem}
        </span>
      ) : null}
      <button
        type="button"
        data-testid="snippet-add"
        onClick={add}
        className="rounded border border-edge bg-panel px-2 py-1 text-brass hover:border-brass"
      >
        Add snippet
      </button>
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
