import type { MapSizes } from "@atlantis/core-client";
import { mapSizesOfGame } from "../mapShape";
import { MapSizesSettings } from "./MapSizesSettings";
import { useState } from "react";
import type { AdvisoryCheckCode } from "@atlantis/core-client";
import { useEscapeToDismiss } from "./dismissLayer";
import { APP_VERSION } from "../appVersion";
import { RULESETS } from "../rulesets";
import { snippetBodyProblem, snippetNameProblem } from "../orderSnippets";
import { BOOLEAN_SETTINGS, useSettingsStore } from "../settingsStore";
import {
  MOVEMENT_ANIMATION_SPEED_MAX,
  MOVEMENT_ANIMATION_SPEED_MIN,
  MOVEMENT_ANIMATION_SPEED_STEP
} from "./routeCometPath";
import { useWorkspaceStore } from "../workspaceStore";
import type { ThemeName } from "../settingsStore";
import { mapThemeOptions } from "./mapThemes";
import { SettingFlag } from "./SettingFlag";
import { TEXTURE_SETS } from "./textureSets";
import { SettingToggle } from "./SettingToggle";
import {
  COLUMN_LABELS,
  HIDEABLE_COLUMNS,
  type HideableColumn
} from "../unitTable";
import type { WorkspaceGame } from "../workspaceStore";
import type { AppUpdateControl, UpdateButton } from "./appUpdate";
import { updateMarkFor, updatePresentationFor } from "./appUpdate";
import type { OpenExternal } from "./openExternal";
import type { SettingsTabId } from "./settingsTabs";
import { SETTINGS_TABS, gameSettingsPresentation, nextTab } from "./settingsTabs";

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
  openExternal,
  game,
  busy,
  error,
  onChangeMapSizes,
  onDismiss
}: {
  platformLabel: string;
  appUpdate: AppUpdateControl;
  openExternal: OpenExternal;
  game: WorkspaceGame | null;
  busy: boolean;
  error: string | null;
  onChangeMapSizes: (mapSizes: MapSizes) => Promise<boolean>;
  onDismiss: () => void;
}) {
  // Local rather than lifted: the dialog unmounts when closed, so every open lands on Global,
  // which is the wanted default.
  const [tab, setTab] = useState<SettingsTabId>("global");

  // Escape closes this dialog - unless something newer stands over it, which is the command
  // palette's whole opening move.
  useEscapeToDismiss(onDismiss);

  // ah-sw92: the About tab carries the same mark as the gear while a newer version exists. Opening
  // the tab does not clear it - it stays until the player is running the new version.
  const aboutMarked = updateMarkFor(appUpdate).marked;

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
        className="w-[40rem] max-w-[94vw] rounded border border-brass/60 bg-panel-raised p-3 text-pane whitespace-normal shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-brass/60 pb-2">
          <h2 className="m-0 text-brass">Settings</h2>
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
          // Wraps rather than overflowing: a sixth tab (ah-20di) is already wider than the panel
          // at some sizes, and a tab strip scrolled off the side is one nobody can find. The
          // chosen mockup shows the wrapped strip.
          className="mt-2 flex flex-wrap gap-1 rounded border border-edge bg-panel p-1"
        >
          {SETTINGS_TABS.map((entry) => (
            <Tab
              key={entry.id}
              id={entry.id}
              label={entry.label}
              active={tab}
              onTab={setTab}
              marked={entry.id === "about" && aboutMarked}
            />
          ))}
        </div>

        <div className="mt-3 min-h-32 rounded border border-edge bg-panel-raised p-3">
          {tab === "global" ? <GlobalSettings /> : null}
          {tab === "game" ? (
            <GameSettings
              game={game}
              busy={busy}
              error={error}
              onChangeMapSizes={onChangeMapSizes}
            />
          ) : null}
          {tab === "columns" ? <ColumnSettings /> : null}
          {tab === "warnings" ? <WarningSettings /> : null}
          {tab === "snippets" ? <SnippetSettings /> : null}
          {tab === "about" ? (
            <About
              platformLabel={platformLabel}
              appUpdate={appUpdate}
              openExternal={openExternal}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Tab({
  id,
  label,
  active,
  onTab,
  marked = false
}: {
  id: SettingsTabId;
  label: string;
  active: SettingsTabId;
  onTab: (tab: SettingsTabId) => void;
  marked?: boolean;
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
      className={`relative rounded border px-2 py-0.5 ${
        selected
          ? "border-brass bg-brass/10 text-brass"
          : "border-edge bg-panel text-ink-soft hover:bg-panel-raised hover:text-ink"
      }`}
    >
      {label}
      {marked ? (
        <span
          aria-hidden="true"
          data-testid={`settings-tab-${id}-dot`}
          className="pointer-events-none absolute -right-[3px] -top-[3px] h-[7px] w-[7px] rounded-full bg-brass ring-2 ring-panel"
        />
      ) : null}
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
  const showTextures = useSettingsStore((state) => state.biomeTextures);
  const textureSet = useSettingsStore((state) => state.textureSet);
  const setTextureSet = useSettingsStore((state) => state.setTextureSet);
  // Per theme (ah-j1xd): the slider always shows and writes the theme the player is looking at.
  const paneTransparency = useSettingsStore((state) => state.paneTransparency);
  const setPaneTransparency = useSettingsStore((state) => state.setPaneTransparency);
  const interfaceSize = useSettingsStore((state) => state.interfaceSize);
  const animateMovement = useSettingsStore((state) => state.animateMovement);
  const movementAnimationSpeed = useSettingsStore((state) => state.movementAnimationSpeed);
  const setMovementAnimationSpeed = useSettingsStore((state) => state.setMovementAnimationSpeed);
  const setFlag = useSettingsStore((state) => state.setFlag);
  const setInterfaceSize = useSettingsStore((state) => state.setInterfaceSize);
  const layers = useWorkspaceStore((state) => state.layers);
  const toggleLayer = useWorkspaceStore((state) => state.toggleLayer);

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

      <SettingFlag name="biomeTextures" />

      <div className="ml-4 space-y-2 border-l-2 border-brass/40 pl-2">
        {/*
          Which pictures the textures are (ah-d9jb.1). Inside the group because it only means
          anything with textures on; disabled with them off like the two toggles below, and it keeps
          its value meanwhile. The options come from the registry, so a new set needs no work here.
        */}
        <label
          className={`flex flex-wrap items-center justify-between gap-2 text-ink-soft ${
            showTextures ? "" : "opacity-50"
          }`}
        >
          <span>
            <span className="block">Texture set</span>
            <span className="block text-pane-sm text-ink-dim">
              Which pictures the map uses for each biome.
            </span>
          </span>
          <select
            data-testid="settings-texture-set"
            aria-label="Texture set"
            value={textureSet}
            disabled={!showTextures}
            onChange={(event) => setTextureSet(event.target.value)}
            className="rounded border border-edge bg-panel-raised px-1.5 py-0.5 text-ink"
          >
            {TEXTURE_SETS.map((set) => (
              <option key={set.id} value={set.id}>
                {set.label}
              </option>
            ))}
          </select>
        </label>
        <SettingFlag name="biomeTextureRotation" />
        <SettingFlag name="animateWaterTextures" />
      </div>

      {/*
        The two map layers that used to be chips over the map (ah-l9mp). Both are set once and then
        forgotten, so they sit here with the other "how the map draws" preferences; the badge menu
        stayed on the map because it is flicked while reading a hex. The state is the workspace
        store's, unchanged - these are the same switches driven from a different place.
      */}
      <SettingToggle
        title="Staleness"
        description="Shade hexes by how long ago you last saw them."
        testId="settings-layer-staleness"
        checked={layers.staleness}
        onChange={() => toggleLayer("staleness")}
      />

      {/*
        Never-visited hexes have no age, so Staleness leaves them alone; this is the switch that
        governs them (ah-7czr). Off, they are drawn like any other hex.
      */}
      <SettingToggle
        title="Unvisited hexes"
        description="Dim and outline hexes you have never visited, known only from a neighbouring hex's exits."
        testId="settings-layer-unvisited"
        checked={layers.unvisited}
        onChange={() => toggleLayer("unvisited")}
      />

      <SettingToggle
        title="Movement"
        description="Draw the routes units are ordered to travel."
        testId="settings-layer-movement"
        checked={layers.movement}
        onChange={() => toggleLayer("movement")}
      />

      {/*
        The spark along the route, and how fast it runs. Under Movement because it animates that
        line and means nothing without it; disabled by hand since Movement is the workspace store's
        layer, not one of BOOLEAN_SETTINGS that `requires` could name.
      */}
      <div className="ml-4 space-y-2 border-l-2 border-brass/40 pl-2">
        <SettingToggle
          title={BOOLEAN_SETTINGS.animateMovement.title}
          description={BOOLEAN_SETTINGS.animateMovement.description}
          testId={BOOLEAN_SETTINGS.animateMovement.testId}
          checked={animateMovement}
          onChange={(value) => setFlag("animateMovement", value)}
          disabled={!layers.movement}
        />
        <label
          className={`flex flex-col gap-1 ${layers.movement && animateMovement ? "" : "opacity-50"}`}
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-ink-soft">Animation speed</span>
            <span className="text-ink">{movementAnimationSpeed} hexes/s</span>
          </span>
          <input
            type="range"
            data-testid="settings-movement-animation-speed"
            aria-label="movement animation speed"
            min={MOVEMENT_ANIMATION_SPEED_MIN}
            max={MOVEMENT_ANIMATION_SPEED_MAX}
            step={MOVEMENT_ANIMATION_SPEED_STEP}
            value={movementAnimationSpeed}
            disabled={!layers.movement || !animateMovement}
            onChange={(event) => setMovementAnimationSpeed(Number(event.target.value))}
            className="accent-brass"
          />
        </label>
      </div>

      {/*
        The same switch the overlay itself carries. Here as well because the overlay is the one
        screen a player can turn off from inside and then be unable to find again: the key that
        opens it is written on the thing they just dismissed.
      */}
      <SettingFlag name="showShortcutsAtStartup" />

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
          min={50}
          max={200}
          step={25}
          value={interfaceSize}
          onChange={(event) => setInterfaceSize(Number(event.target.value))}
          className="accent-brass"
        />
        <span className="text-pane-sm text-ink-dim">
          Makes the panes, the header and the dialogs smaller or bigger. The map is not affected.
        </span>
      </label>

      <SettingFlag name="movementPlanner" />

      <SettingFlag name="orderOcd" />

      <SettingFlag name="countUpkeep" />
    </div>
  );
}

/**
 * Which advisory order-check codes should not run at all: the Warnings tab's on/off toggles,
 * grouped Studying/Teaching / Resources / Markets / Guarding / Orders / Building / Sailing. Off means the core never
 * produces the finding - counts, chip, panels and editor underlines all agree, nothing anywhere
 * says "hidden".
 */
export const WARNING_GROUPS: readonly {
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
        title: "Teachers unable to teach",
        description: "A teacher is not all leaders or cannot teach what a student is studying."
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
        description:
          "A unit ordered to study a skill that at least one of its races cannot learn any further."
      },
      {
        code: "study-unlearnable",
        title: "Study of an unlearnable skill",
        description:
          "A unit ordered to study a magic skill that is granted by an item rather than learned normally."
      },
      {
        code: "magic-study-capped-by-prerequisites",
        title: "Magic study capped by prerequisites",
        description:
          "A mage ordered to study a magic skill whose next level is blocked by prerequisite skills."
      },
      {
        code: "magic-study-outside-building",
        title: "Magic study outside a building",
        description:
          "A mage above level 2 studying magic where no building houses them, which halves the month's study."
      },
      {
        code: "magic-study-needs-a-lone-leader",
        title: "Magic study by a unit that cannot become a mage",
        description:
          "A unit that is not one leader on its own ordered to begin force, pattern, spirit or manipulation."
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
      },
      {
        code: "part-of-hex-shortfall",
        title: "Orders in a hex that is short between its units",
        description:
          "Marks each order line contributing to a shortfall that is reported against the whole hex rather than one unit."
      },
      {
        code: "claims-exceed-unclaimed",
        title: "Claiming more than the faction has",
        description:
          "CLAIM and WITHDRAW orders across all your units asking for more unclaimed silver than the faction holds."
      },
      {
        code: "upkeep-exceeds-unclaimed",
        title: "Upkeep the faction cannot pay",
        description: "Units that cannot pay their maintenance, when the faction's unclaimed silver will not cover the shortfall either."
      },
      {
        code: "region-pool-oversubscribed",
        title: "Promised more than the region has",
        description:
          "Your units in one hex ordered to tax, work, entertain or trade for more than the region or its market can supply between them."
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
      },
      {
        code: "nothing-left-to-sell",
        title: "Sale with nothing left to sell",
        description: "A SELL ALL of goods this month's earlier orders have already moved away."
      },
      {
        code: "nothing-left-to-buy",
        title: "Purchase with nothing left to buy",
        description: "A BUY of goods this unit's own earlier orders have already bought from this market."
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
        code: "guard-without-tax-ability",
        title: "Guards that cannot take watch",
        description: "A GUARD 1 order given to a unit that cannot tax and therefore cannot guard."
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
        description:
          "A GIVE or TAKE naming a unit the report does not show in that hex, or a NEW number no FORM order there creates."
      },
      {
        code: "take-from-another-faction",
        title: "Taking from another faction",
        description:
          "A TAKE naming a visible unit from another faction, which the game will refuse."
      },
      {
        code: "transfer-to-itself",
        title: "Transfers a unit writes to itself",
        description:
          "A GIVE or TAKE naming the unit that wrote it, which the game will refuse."
      },
      {
        code: "arrivals-lower-a-skill",
        title: "Arrivals that lower a skill",
        description:
          "Men joining a unit, given, taken or bought, that leave it at a lower skill level than the report gave it."
      },
      {
        code: "items-cannot-be-given",
        title: "Gifts the game will refuse",
        description:
          "A GIVE or TAKE naming items that cannot change hands, or men given to another faction."
      },
      {
        code: "men-sent-into-a-mage",
        title: "Men sent into a mage",
        description:
          "A GIVE, TAKE or BUY that would add people to a unit that has already begun magic."
      },
      {
        code: "too-many-trade-regions",
        title: "Taxing and trading in too many regions",
        description: "PRODUCE, TAX and PILLAGE orders in more regions than the faction's allowance permits."
      },
      {
        code: "withdraw-in-nexus",
        title: "Withdrawing in the Nexus",
        description: "WITHDRAW orders in the Nexus, where the order cannot be used."
      },
      {
        code: "withdraw-not-a-basic-item",
        title: "Withdrawing something that is not a basic item",
        description: "WITHDRAW orders naming an item the game will not hand over, such as silver."
      },
      {
        code: "cast-cannot-make-this",
        title: "Casts that name a material the spell cannot make",
        description:
          "A transmuting CAST whose material is a real item the spell does not create, or no material at all. A word the catalogue does not know is flagged in the order pane instead."
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
      },
      {
        code: "two-month-long-orders",
        title: "Two orders for one month",
        description:
          "A unit given more than one order that spends its month, such as MOVE and STUDY together, where only one of them will run."
      },
      {
        code: "taxed-a-pillaged-hex",
        title: "Taxing a hex you are pillaging",
        description:
          "TAX orders in a hex where one of your own units is ordered to PILLAGE, which collects the region's money first."
      },
      {
        code: "taxed-a-guarded-hex",
        title: "Taxing or pillaging a hex someone else guards",
        description:
          "TAX and PILLAGE orders in a hex where another faction has a unit on guard. TAX may be blocked; PILLAGE is always blocked."
      },
      {
        code: "tax-without-combat-ready-men",
        title: "Taxing without combat-ready men",
        description: "A TAX order or taxing flag on a unit with no combat-ready men."
      },
      {
        code: "pillage-without-men",
        title: "Pillaging without the men",
        description:
          "A PILLAGE order where the units ordering it have too few combat ready men between them to take the money."
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
      },
      {
        code: "build-without-skill",
        title: "Building without the skill",
        description:
          "A BUILD order for a structure the unit has not the skill or level to build."
      },
      {
        code: "build-site-refused",
        title: "Construction sites the game will refuse",
        description: "A BUILD order that cannot start a new building in this region."
      },
      {
        code: "build-without-material",
        title: "Building without the material",
        description:
          "A BUILD order by a unit that has none of the wood or stone the structure is built from."
      }
    ]
  },
  {
    heading: "Producing",
    entries: [
      {
        code: "produce-without-skill",
        title: "Producing without the skill",
        description:
          "A PRODUCE order for an item the unit has not the skill or level to make."
      },
      {
        code: "produce-not-here",
        title: "Producing what the region has not",
        description:
          "A PRODUCE order for a resource this region's Products line does not name."
      }
    ]
  },
  {
    heading: "Movement",
    entries: [
      {
        code: "passage-with-no-known-exit",
        title: "Passages with no known exit",
        description:
          "A route goes through a passage inside a structure, and no report says where it leads."
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
      },
      {
        code: "sail-not-by-owner",
        title: "Courses set by the wrong unit",
        description: "A fleet given a course by a unit that does not own it."
      },
      {
        code: "sail-between-land-hexes",
        title: "Sailing from land to land",
        description:
          "A SAIL step from a land region into another land region, which the game never allows."
      },
      {
        code: "sail-through-neck-of-land",
        title: "Sailing through a neck of land",
        description:
          "A SAIL that crosses a land region in one month. A fleet may only leave by the side it entered or one beside it, unless there is a canal."
      }
    ]
  },
  {
    heading: "Transport",
    entries: [
      {
        code: "transport-out-of-reach",
        title: "Shipments the game will not carry",
        description: "A TRANSPORT order whose target is too far away, or too far to measure."
      }
    ]
  }
];

/**
 * Which columns the units table draws, and the three buttons that put its column preferences back
 * (ah-20di). A tab of its own rather than more rows on an already-scrolling Global tab, and it is
 * where the two reset buttons moved to: everything about the table's columns in one place.
 *
 * A workspace preference rather than a setting, but this is where a player looks for "put it back
 * how it was" - and a table whose columns have been dragged into a bad shape, or hidden, needs a
 * way out that is not on the table itself (ah-1owr.2).
 */
/** Exported for `SettingsDialog.test.tsx`, which renders this panel in isolation. */
export function ColumnSettings() {
  const columnsShown = useWorkspaceStore((state) => state.unitColumnsShown);
  const setUnitColumnShown = useWorkspaceStore((state) => state.setUnitColumnShown);
  const showAllUnitColumns = useWorkspaceStore((state) => state.showAllUnitColumns);
  const resetUnitColumnShares = useWorkspaceStore((state) => state.resetUnitColumnShares);
  const resetUnitColumnOrder = useWorkspaceStore((state) => state.resetUnitColumnOrder);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-pane-sm text-ink-dim">
        Which columns the units table draws. Unchecking one takes it off the table and gives its
        width to the columns still shown.
      </p>

      {/*
        `HIDEABLE_COLUMNS` order - the shipped left-to-right order - rather than the player's own
        dragged order: a settings list that rearranges itself under them is one nobody can learn.
        The titles come from `COLUMN_LABELS` and are never retyped here; two lists of labels for
        one set of columns is exactly the drift `UNIT_COLUMNS` exists to prevent.
      */}
      {HIDEABLE_COLUMNS.map((column) => (
        <SettingToggle
          key={column}
          title={COLUMN_LABELS[column] ?? column}
          description={COLUMN_DESCRIPTIONS[column]}
          testId={`settings-column-${column}`}
          checked={columnsShown[column]}
          onChange={(checked) => setUnitColumnShown(column, checked)}
        />
      ))}

      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-soft">
          <span className="block">Units table columns</span>
          <span className="block text-pane-sm text-ink-dim">
            Puts the dragged column widths, or the order they were dragged into, back to how they
            ship.
          </span>
        </span>
        {/*
          Three buttons rather than one "Reset columns": visibility, order and widths are separate
          preferences stored separately, so a player can undo the mess they made of one without
          losing the others (ah-1owr.3, ah-20di). The set follows `BadgeMenu`'s All/None shape.
        */}
        <span className="flex gap-1">
          <button
            type="button"
            data-testid="settings-show-all-columns"
            onClick={showAllUnitColumns}
            className="rounded border border-edge px-1.5 text-ink-soft hover:text-ink"
          >
            Show all
          </button>
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
    </div>
  );
}

/** What each hideable column shows, one line each, for the Columns tab's checkboxes. */
const COLUMN_DESCRIPTIONS: Record<HideableColumn, string> = {
  faction: "Who the unit belongs to.",
  men: "How many men the unit holds.",
  movement: "How the unit can travel, and how heavily it is loaded.",
  flags: "The unit's behaviour flags, one letter each.",
  skills: "The skills the unit knows, and at what level.",
  items: "What the unit carries, after this month's orders.",
  structure: "The building or ship the unit is in.",
  longOrder: "The unit's month-long order.",
  silver: "The silver the unit is left holding at the end of the month."
};

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
          <div className="mt-2 border-b border-brass/60 pb-0.5 text-pane-sm uppercase tracking-wider text-brass">
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
        selected
          ? "border-brass bg-brass/10 text-brass"
          : "border-edge bg-panel text-ink-soft hover:bg-panel-raised hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

/** Settings that hold for the open game only: its ruleset, until more arrive. */
export function GameSettings({
  game,
  busy,
  error,
  onChangeMapSizes
}: {
  game: WorkspaceGame | null;
  busy: boolean;
  error: string | null;
  onChangeMapSizes: (mapSizes: MapSizes) => Promise<boolean>;
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
      <div className="flex flex-col gap-1">
        <span className="text-ink-soft">Ruleset</span>
        <span
          data-testid="settings-game-ruleset"
          aria-label="ruleset"
          className="rounded border border-edge bg-panel px-2 py-1 text-ink"
        >
          {presentation.rulesetLabel}
        </span>
        <span className="text-sm text-ink-soft">
          The ruleset is chosen when this game is created.
        </span>
      </div>
      <MapSizesSettings
        mapSizes={mapSizesOfGame(game?.mapSizes, presentation.map)}
        assumed={game?.mapSizes === undefined && !presentation.mapStated && presentation.map !== null}
        busy={busy}
        onChange={onChangeMapSizes}
      />
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

/**
 * Where a player reports a bug or asks for a feature.
 *
 * `/issues/new` rather than `/issues`: the call to action is "describe it", so the form is the
 * right target rather than a list to hunt through. The desktop capability scopes
 * `opener:allow-open-url` to `https://github.com/rmstdope/atlantis-hud/*`, so this address is
 * already inside the allowance and no capability change is needed - one that drifts outside it
 * would be refused at runtime rather than opened.
 */
const ISSUES_URL = "https://github.com/rmstdope/atlantis-hud/issues/new";

/**
 * Whether there is a newer version, then what this build is - the old settings panel, now a tab.
 *
 * Exported for `SettingsDialog.test.tsx`, which renders this panel in isolation.
 *
 * The variants row is read from `RULESETS` rather than written into the prose, so the day a second
 * ruleset ships it appears here without anyone editing a sentence - and there is one spelling of
 * the name across the whole app, this tab and the game-settings picker alike.
 */
export function About({
  platformLabel,
  appUpdate,
  openExternal
}: {
  platformLabel: string;
  appUpdate: AppUpdateControl;
  openExternal: OpenExternal;
}) {
  const { notice, buttons, status } = updatePresentationFor(appUpdate, APP_VERSION);
  const run = (kind: UpdateButton["kind"]) => {
    if (kind === "apply") appUpdate.apply?.();
    else if (kind === "download") appUpdate.download?.();
    else appUpdate.check();
  };

  const controls = (
    <>
      {buttons.length > 0 ? (
        <div className="flex gap-1.5">
          {buttons.map((button) => (
            <button
              key={button.kind}
              type="button"
              data-testid={button.kind === "download" ? "update-download" : "check-for-updates"}
              disabled={button.disabled}
              onClick={() => run(button.kind)}
              className="min-w-0 flex-1 rounded border border-edge bg-panel px-2 py-1 text-brass hover:border-brass disabled:cursor-default disabled:text-ink-soft disabled:opacity-55 disabled:hover:border-edge"
            >
              {button.label}
            </button>
          ))}
        </div>
      ) : null}
      {status ? (
        <p
          data-testid="update-status"
          className={`mt-1.5 ${status.tone === "error" ? "text-danger" : "text-ink-soft"}`}
        >
          {status.text}
        </p>
      ) : null}
    </>
  );

  return (
    <div>
      {/*
        ah-sw92: the update section leads the tab in every state, so the buttons never move when a
        newer version appears - the section itself becomes the amber notice around them.
      */}
      <div data-testid="update-section" className="mb-2">
        {notice ? (
          <div
            data-testid="update-notice"
            className="rounded border border-brass bg-brass/10 px-2 py-1.5 text-ink"
          >
            <p className="mb-1.5">
              <strong className="text-brass">{notice.emphasis}</strong> {notice.rest}
            </p>
            {controls}
          </div>
        ) : (
          controls
        )}
      </div>

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
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-soft">Variants</dt>
          <dd data-testid="app-variants" className="text-ink">
            {RULESETS.map((ruleset) => ruleset.label).join(", ")}
          </dd>
        </div>
      </dl>

      <div className="mt-2 flex flex-col gap-2 border-t border-edge pt-2 text-ink-soft">
        <p>
          Atlantis HUD is a client for Atlantis, the play-by-email game. It runs in a browser and as
          a desktop app.
        </p>
        <p>
          To work properly it needs the rules and game data for the particular Atlantis variant you
          are playing.
        </p>
        <p>
          If you run into a bug or would like a feature added, please describe it on the{" "}
          <button
            type="button"
            data-testid="about-issues-link"
            onClick={() => openExternal(ISSUES_URL)}
            className="text-select underline underline-offset-2 hover:text-brass"
          >
            project&apos;s issue page on GitHub
          </button>
          .
        </p>
      </div>
    </div>
  );
}
