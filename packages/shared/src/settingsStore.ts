/**
 * Global settings: preferences that apply to every game.
 *
 * The theme is the first of them. It lives in its own store rather than in the workspace store
 * because the two persist different things for different reasons: the workspace remembers layout
 * choices about a session, while this remembers who the user is regardless of what is open. The
 * store owns the side effect of stamping `data-theme` on the document root, so the theme works
 * before React mounts and a test can observe it without rendering anything.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { normalizeSnippets, type OrderSnippet } from "./orderSnippets";
import { DEFAULT_MAP_THEME_ID, isMapThemeId } from "./workspace/mapThemes";

export type ThemeName = "dark" | "light";

/** How see-through the floating panes start out: enough map underneath to navigate by. */
export const DEFAULT_PANE_TRANSPARENCY = 90;

/** How many rows the units-in-hex table starts out showing: a readable screenful. */
export const DEFAULT_UNIT_LIST_LIMIT = 12;

/**
 * The ends of what the units-in-hex row count may be set to, by the pane's own + and - as much as
 * by the settings slider. Both controls and the clamp read these, so the three cannot drift apart
 * and leave a button that offers a value the store then refuses.
 *
 * One row rather than three: shrunk to a single row the pane is nearly out of the way of the map
 * while still being a list you can scroll, which is a reasonable thing to want. Sixteen is the
 * ceiling because the pane is already bounded to a fraction of the window height, so rows past it
 * would mostly change nothing a player can see.
 */
export const UNIT_LIST_LIMIT_MIN = 1;
export const UNIT_LIST_LIMIT_MAX = 16;

export type SettingsState = {
  theme: ThemeName;
  /**
   * Which of the map's hex renderings the world map draws with, by registry id.
   *
   * Global rather than per game: it says how this player likes to read a map, not anything about
   * one campaign. Stored as a plain string because the set of themes is the registry's business,
   * not this store's.
   */
  mapTheme: string;
  biomeTextures: boolean;
  /**
   * How see-through the panes floating over the map are, in percent.
   *
   * 0 is opaque and 95 is the most transparent the slider offers - never 100, because a pane that
   * cannot be seen at all can also not be found to make visible again.
   */
  paneTransparency: number;
  /**
   * How many rows tall the "Units in hex" pane stands, between UNIT_LIST_LIMIT_MIN and
   * UNIT_LIST_LIMIT_MAX.
   *
   * A ceiling on the pane, never a cut in the list: every unit stays reachable by scrolling and
   * by the arrow keys, this many of them on screen at a time.
   */
  unitListLimit: number;
  /**
   * Whether the "Units in hex" pane's row count is a fixed size rather than a ceiling.
   *
   * Off by default, matching today's behaviour: the pane hugs whatever the hex holds, up to
   * `unitListLimit`. On, it always reserves that many rows - including on an empty, stale,
   * unselected or filtered-to-nothing hex - so moving between hexes never resizes the pane.
   */
  unitListFixedSize: boolean;
  /**
   * Whether order validation warns about a hex holding your units and no guard at all.
   *
   * Off by default. Most hexes are deliberately unguarded, so this speaks about hex after hex -
   * against the committed turn 71 it is one warning per hex the faction stands in - and a panel
   * that always has something to say is a panel nobody reads. Dropping a guard you *had* is
   * reported whatever this says, because that is a change you may not have meant.
   */
  warnOnUnguardedHex: boolean;
  /**
   * Whether the Movement pane shows at all. A feature flag rather than a preference: the planner
   * is the one piece of the workspace still finding its shape, so it starts off and stays off
   * until asked for.
   */
  movementPlanner: boolean;
  /**
   * Whether the keyboard shortcuts overlay shows itself when the application starts.
   *
   * On by default, and the only piece of the interface that appears uninvited. It earns that: the
   * overlay is opened by a key, so the player who most needs it is exactly the one who cannot find
   * it. Turning it off is offered inside the overlay itself, next to the reason for wanting to.
   */
  showShortcutsAtStartup: boolean;
  /**
   * The player's order snippets, insertable by name from the editor's completion popup.
   * Global on purpose: a patrol block is the same routine whichever game it is typed into.
   */
  snippets: OrderSnippet[];
  /** Applies instantly: the settings dialog has no OK button to wait for. */
  setTheme: (theme: ThemeName) => void;
  setMapTheme: (id: string) => void;
  setBiomeTextures: (enabled: boolean) => void;
  setPaneTransparency: (percent: number) => void;
  setUnitListLimit: (count: number) => void;
  setUnitListFixedSize: (enabled: boolean) => void;
  setWarnOnUnguardedHex: (enabled: boolean) => void;
  setMovementPlanner: (enabled: boolean) => void;
  setShowShortcutsAtStartup: (enabled: boolean) => void;
  addSnippet: (snippet: OrderSnippet) => void;
  updateSnippet: (id: string, changes: Pick<OrderSnippet, "name" | "body">) => void;
  removeSnippet: (id: string) => void;
};

type Persisted = Pick<
  SettingsState,
  | "theme"
  | "mapTheme"
  | "biomeTextures"
  | "paneTransparency"
  | "unitListLimit"
  | "unitListFixedSize"
  | "warnOnUnguardedHex"
  | "movementPlanner"
  | "showShortcutsAtStartup"
  | "snippets"
>;

/**
 * Stamps the theme where the stylesheet can see it. The dark tokens are the `:root` defaults, and
 * `:root[data-theme="light"]` overrides them, so the attribute is the entire switching mechanism.
 * Guarded because the store is also constructed under Node, where there is no document.
 */
function applyTheme(theme: ThemeName) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = theme;
}

/**
 * What the slider offers is also what the store accepts: storage is hand-editable, and a value
 * from outside the range must not paint the panes invisible or leave a long decimal in the CSS.
 * Anything unreadable falls back to the default rather than to an extreme.
 */
/**
 * The theme id to keep.
 *
 * Storage is hand-editable and a build can be downgraded past a theme it once shipped; a map drawn
 * in the wrong style is a nuisance, one drawn in no style at all is a broken app.
 */
function knownMapTheme(id: string): string {
  return isMapThemeId(id) ? id : DEFAULT_MAP_THEME_ID;
}

function clampTransparency(percent: number): number {
  // Coerced before the finite check: storage is hand-editable and other writers exist, so the
  // "number" rehydrated into state can arrive as its string form.
  const numeric = Number(percent);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_PANE_TRANSPARENCY;
  }
  return Math.min(95, Math.max(0, Math.round(numeric)));
}

/**
 * What the controls offer is also what the store accepts: whole rows between the two bounds above,
 * garbage falling back to the default rather than to either extreme. Same reasoning as the
 * transparency clamp: storage is hand-editable and other writers exist.
 */
function clampUnitListLimit(count: number): number {
  const numeric = Number(count);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_UNIT_LIST_LIMIT;
  }
  // The earlier build persisted 0 as "show all", and as its default - so it is what every
  // untouched settings blob from that build holds. It means "no preference", not "as few as
  // possible", and clamping it to the floor would greet everyone upgrading with the tightest cap.
  if (numeric === 0) {
    return DEFAULT_UNIT_LIST_LIMIT;
  }
  return Math.min(UNIT_LIST_LIMIT_MAX, Math.max(UNIT_LIST_LIMIT_MIN, Math.round(numeric)));
}

/**
 * Stamps the transparency where the stylesheet can see it. `.bg-pane` derives its alpha from this
 * one custom property, so a slider move re-paints every pane at once - the same mechanism, and the
 * same reason, as the theme attribute above.
 */
function applyPaneTransparency(percent: number) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.style.setProperty("--pane-transparency", String(percent));
}

/**
 * Storage that degrades to nothing when there is none.
 *
 * The store is also constructed under Node, where `localStorage` does not exist, and a store that
 * throws on import would take the whole app with it.
 */
function optionalStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // A browser can refuse access outright, for instance with site data blocked.
    return null;
  }
}

const MEMORY = new Map<string, string>();

const STORAGE = createJSONStorage<Persisted>(() => {
  const storage = optionalStorage();
  if (storage) {
    return storage;
  }
  return {
    getItem: (key) => MEMORY.get(key) ?? null,
    setItem: (key, value) => void MEMORY.set(key, value),
    removeItem: (key) => void MEMORY.delete(key)
  };
});

/**
 * What every setting is before anybody chooses otherwise.
 *
 * One object rather than a list repeated in the store and again in the reset below. The two had
 * drifted apart in the only way that matters: the tests reset before each case, so they read the
 * reset's idea of a default and could not see the store's - a wrong default would have shipped
 * with a green suite.
 */
const DEFAULTS: Persisted = {
  theme: "dark",
  mapTheme: DEFAULT_MAP_THEME_ID,
  biomeTextures: true,
  paneTransparency: DEFAULT_PANE_TRANSPARENCY,
  unitListLimit: DEFAULT_UNIT_LIST_LIMIT,
  unitListFixedSize: false,
  warnOnUnguardedHex: false,
  movementPlanner: false,
  showShortcutsAtStartup: true,
  snippets: []
};

export const useSettingsStore = create<SettingsState>()(
  persist<SettingsState, [], [], Persisted>(
    (set) => ({
      ...DEFAULTS,

      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },

      setMapTheme: (id) => {
        set({ mapTheme: knownMapTheme(id) });
      },

      setBiomeTextures: (biomeTextures) => {
        set({ biomeTextures });
      },

      setPaneTransparency: (percent) => {
        const clamped = clampTransparency(percent);
        applyPaneTransparency(clamped);
        set({ paneTransparency: clamped });
      },

      setUnitListLimit: (count) => {
        set({ unitListLimit: clampUnitListLimit(count) });
      },

      setUnitListFixedSize: (unitListFixedSize) => {
        set({ unitListFixedSize });
      },

      setWarnOnUnguardedHex: (warnOnUnguardedHex) => {
        set({ warnOnUnguardedHex });
      },

      setMovementPlanner: (movementPlanner) => {
        set({ movementPlanner });
      },

      setShowShortcutsAtStartup: (showShortcutsAtStartup) => {
        set({ showShortcutsAtStartup });
      },

      addSnippet: (snippet) => {
        set((state) => ({ snippets: [...state.snippets, snippet] }));
      },

      updateSnippet: (id, changes) => {
        set((state) => ({
          snippets: state.snippets.map((snippet) =>
            snippet.id === id ? { ...snippet, ...changes } : snippet
          )
        }));
      },

      removeSnippet: (id) => {
        set((state) => ({
          snippets: state.snippets.filter((snippet) => snippet.id !== id)
        }));
      }
    }),
    {
      name: "atlantis-hud-settings",
      storage: STORAGE,
      partialize: (state) => ({
        theme: state.theme,
        mapTheme: state.mapTheme,
        biomeTextures: state.biomeTextures,
        paneTransparency: state.paneTransparency,
        unitListLimit: state.unitListLimit,
        unitListFixedSize: state.unitListFixedSize,
        warnOnUnguardedHex: state.warnOnUnguardedHex,
        movementPlanner: state.movementPlanner,
        showShortcutsAtStartup: state.showShortcutsAtStartup,
        snippets: state.snippets
      })
    }
  )
);

/**
 * Applies whatever theme was persisted. Called once at startup, before React mounts, so a
 * light-theme user never sees a dark flash. Rehydration from localStorage is synchronous, so by
 * the time any module can call this the persisted value is already in the store.
 */
export function applyPersistedSettings() {
  applyTheme(useSettingsStore.getState().theme);
  // Rehydration merges storage straight into state without the setter, so an out-of-range or
  // string value must be reconciled in BOTH places here: stamped clamped into the CSS, and
  // written back into the store so the slider does not claim a value the panes are not painting.
  const transparency = clampTransparency(useSettingsStore.getState().paneTransparency);
  useSettingsStore.setState({ paneTransparency: transparency });
  applyPaneTransparency(transparency);
  // The limit reaches no stylesheet, but the same reconciliation applies: rehydration bypasses
  // the setter, and a hand-edited value must not leave the table cutting by a figure the dialog
  // would refuse.
  useSettingsStore.setState({
    unitListLimit: clampUnitListLimit(useSettingsStore.getState().unitListLimit)
  });
  // Same door again: a blob naming a theme this build never had would otherwise leave the map
  // with nothing to draw with.
  useSettingsStore.setState({
    mapTheme: knownMapTheme(useSettingsStore.getState().mapTheme)
  });
  // Same reconciliation for the snippets: rehydration bypasses the setters, storage is
  // hand-editable, and an older blob has no snippets key at all.
  useSettingsStore.setState({
    snippets: normalizeSnippets(useSettingsStore.getState().snippets)
  });
}

/** Resets the store, remembered preferences included. Tests would otherwise leak state. */
export function resetSettingsStore() {
  MEMORY.clear();
  optionalStorage()?.removeItem("atlantis-hud-settings");
  useSettingsStore.setState({ ...DEFAULTS });
  applyTheme(DEFAULTS.theme);
  applyPaneTransparency(DEFAULTS.paneTransparency);
}
