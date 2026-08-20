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
import { ADVISORY_CHECK_CODES, type AdvisoryCheckCode } from "@atlantis/core-client";
import { normalizeSnippets, type OrderSnippet } from "./orderSnippets";
import { DEFAULT_MAP_THEME_ID, isMapThemeId } from "./workspace/mapThemes";

export type ThemeName = "dark" | "light";

/**
 * How see-through the floating panes start out.
 *
 * 20, not 90 (ah-v09e): at 90 the panes are painted at 10% opacity, so the real background of
 * nearly all the app's text is the live terrain, and body text fell to 3.90:1 over tundra while
 * dimmed text reached 1.70:1 over desert - a background that changes contrast between 1.7:1 and
 * 13:1 as the player pans. 20 is the line at which every ink token clears AA over the worst
 * terrain in the game. The slider's range is unchanged; only the default moved, and anyone who
 * has ever touched the slider keeps their stored value.
 *
 * `--pane-transparency` in theme.css must agree: it paints the first frame.
 */
export const DEFAULT_PANE_TRANSPARENCY: Record<ThemeName, number> = { dark: 20, light: 0 };

/** The Interface size setting's default, as a percentage. 100 means the panes are as designed. */
export const DEFAULT_INTERFACE_SIZE = 100;

/** Whether each advisory order-check code is allowed to run at all, by code. */
export type AdvisoryChecks = Record<AdvisoryCheckCode, boolean>;

/**
 * Every advisory check on, except `hex-unguarded` - the one precedent this whole tab generalizes.
 * Most hexes are deliberately unguarded, so it would speak about hex after hex; every other check
 * is narrow enough to start out useful.
 */
export const DEFAULT_ADVISORY_CHECKS: AdvisoryChecks = Object.fromEntries(
  ADVISORY_CHECK_CODES.map((code) => [code, code !== "hex-unguarded"])
) as AdvisoryChecks;

/**
 * Starts from the defaults and copies over only what a stored blob actually is: a boolean, under a
 * code this build still knows. Storage is hand-editable and a build can be downgraded past a code
 * it once shipped, so anything else is left at the default rather than trusted.
 */
export function reconcileAdvisoryChecks(stored: unknown): AdvisoryChecks {
  const checks = { ...DEFAULT_ADVISORY_CHECKS };
  if (stored && typeof stored === "object") {
    for (const code of ADVISORY_CHECK_CODES) {
      const value = (stored as Record<string, unknown>)[code];
      if (typeof value === "boolean") {
        checks[code] = value;
      }
    }
  }
  return checks;
}

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
  paneTransparency: Record<ThemeName, number>;
  /**
   * How much bigger the panes' type is than designed, as a percentage. The map is not on this
   * scale and never moves with it.
   */
  interfaceSize: number;
  /**
   * Whether each advisory order-check code is allowed to run at all - the Warnings settings tab.
   *
   * Off means the core does not produce that finding, at all: counts, chip, panels and editor
   * underlines all agree, and nothing anywhere says "hidden". `hex-unguarded` starts off, for the
   * reason `DEFAULT_ADVISORY_CHECKS` documents; every other code starts on.
   */
  advisoryChecks: AdvisoryChecks;
  /**
   * Whether the Movement pane shows at all. A feature flag rather than a preference: the planner
   * is the one piece of the workspace still finding its shape, so it starts off and stays off
   * until asked for.
   */
  movementPlanner: boolean;
  /**
   * Whether the orders editor uppercases the command keywords as they are typed (Order OCD).
   *
   * Off by default: orders are case-insensitive to the engine, so this is purely a matter of how
   * the player likes their turn to read.
   */
  orderOcd: boolean;
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
  setInterfaceSize: (percent: number) => void;
  setAdvisoryCheck: (code: AdvisoryCheckCode, enabled: boolean) => void;
  setMovementPlanner: (enabled: boolean) => void;
  setOrderOcd: (value: boolean) => void;
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
  | "interfaceSize"
  | "advisoryChecks"
  | "movementPlanner"
  | "orderOcd"
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

function clampTransparency(
  percent: number,
  // The themes do not share a default, so they cannot share a fallback either: an unreadable
  // light value must land on light's 0, or a corrupt blob quietly puts a light user back on
  // see-through panes below AA.
  fallback: number = DEFAULT_PANE_TRANSPARENCY.dark
): number {
  // Coerced before the finite check: storage is hand-editable and other writers exist, so the
  // "number" rehydrated into state can arrive as its string form.
  const numeric = Number(percent);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(95, Math.max(0, Math.round(numeric)));
}

/**
 * The transparency each theme is painted at, from whatever storage held.
 *
 * Before ah-j1xd this was a single number shared by both themes, and it is persisted - so every
 * existing profile arrives here with a number where the code now wants a record. A stored number
 * is a choice the player made, so it is kept, for dark, where see-through panes are affordable;
 * light takes its new default rather than inheriting a value measured against the wrong theme.
 */
function reconcilePaneTransparency(stored: unknown): Record<ThemeName, number> {
  if (typeof stored === "number" || typeof stored === "string") {
    return {
      dark: clampTransparency(stored as number, DEFAULT_PANE_TRANSPARENCY.dark),
      light: DEFAULT_PANE_TRANSPARENCY.light
    };
  }
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    const record = stored as Partial<Record<ThemeName, unknown>>;
    return {
      dark:
        record.dark === undefined
          ? DEFAULT_PANE_TRANSPARENCY.dark
          : clampTransparency(record.dark as number, DEFAULT_PANE_TRANSPARENCY.dark),
      light:
        record.light === undefined
          ? DEFAULT_PANE_TRANSPARENCY.light
          : clampTransparency(record.light as number, DEFAULT_PANE_TRANSPARENCY.light)
    };
  }
  return { ...DEFAULT_PANE_TRANSPARENCY };
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
 * 100% to 200%, in steps of 25. Rounded to a step rather than merely bounded, so a hand-edited
 * localStorage value or an older payload cannot land the slider between its stops.
 */
function clampInterfaceSize(percent: number): number {
  const numeric = Number(percent);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_INTERFACE_SIZE;
  }
  const stepped = Math.round(numeric / 25) * 25;
  return Math.min(200, Math.max(100, stepped));
}

/** Stamps the multiplier every rem in the application is expressed against — the root font size
 * carries it, so type, widths, padding and gaps all follow. See `theme.css`'s `--ui-scale`. */
function applyInterfaceSize(percent: number) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.style.setProperty("--ui-scale", String(percent / 100));
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
  paneTransparency: { ...DEFAULT_PANE_TRANSPARENCY },
  interfaceSize: DEFAULT_INTERFACE_SIZE,
  advisoryChecks: DEFAULT_ADVISORY_CHECKS,
  movementPlanner: false,
  orderOcd: false,
  showShortcutsAtStartup: true,
  snippets: []
};

export const useSettingsStore = create<SettingsState>()(
  persist<SettingsState, [], [], Persisted>(
    (set, get) => ({
      ...DEFAULTS,

      setTheme: (theme) => {
        applyTheme(theme);
        // The panes are repainted too: each theme remembers its own transparency (ah-j1xd), so
        // without this the panes stay at the theme the player just left until something else
        // happens to stamp - which reads as the setting being ignored at random.
        applyPaneTransparency(get().paneTransparency[theme]);
        set({ theme });
      },

      setMapTheme: (id) => {
        set({ mapTheme: knownMapTheme(id) });
      },

      setBiomeTextures: (biomeTextures) => {
        set({ biomeTextures });
      },

      setPaneTransparency: (percent) => {
        // The slider always means the theme the player is looking at.
        const theme = get().theme;
        const clamped = clampTransparency(percent);
        applyPaneTransparency(clamped);
        set({ paneTransparency: { ...get().paneTransparency, [theme]: clamped } });
      },

      setInterfaceSize: (percent) => {
        const clamped = clampInterfaceSize(percent);
        applyInterfaceSize(clamped);
        set({ interfaceSize: clamped });
      },

      setAdvisoryCheck: (code, enabled) => {
        set((state) => ({ advisoryChecks: { ...state.advisoryChecks, [code]: enabled } }));
      },

      setMovementPlanner: (movementPlanner) => {
        set({ movementPlanner });
      },

      setOrderOcd: (orderOcd) => {
        set({ orderOcd });
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
        interfaceSize: state.interfaceSize,
        advisoryChecks: state.advisoryChecks,
        movementPlanner: state.movementPlanner,
        orderOcd: state.orderOcd,
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
  const transparency = reconcilePaneTransparency(useSettingsStore.getState().paneTransparency);
  useSettingsStore.setState({ paneTransparency: transparency });
  applyPaneTransparency(transparency[useSettingsStore.getState().theme]);
  // Same reconciliation for the Interface size setting.
  const interfaceSize = clampInterfaceSize(useSettingsStore.getState().interfaceSize);
  useSettingsStore.setState({ interfaceSize });
  applyInterfaceSize(interfaceSize);
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
  // Migration, not clamping: a player who ticked the old "warn about unguarded hexes" checkbox has
  // `warnOnUnguardedHex: true` sitting in storage under a key this build no longer declares.
  // Rehydration merges unknown keys into state anyway (zustand's default merge does not filter by
  // the store's type), so it is still readable here - and only when `advisoryChecks` itself is
  // untouched from its initial default does that mean the blob never had one, which is the one
  // case the migration is for. Applying the new default instead would silently flip a preference
  // the player chose.
  const state = useSettingsStore.getState();
  const legacyWarnOnUnguardedHex = (state as unknown as { warnOnUnguardedHex?: unknown })
    .warnOnUnguardedHex;
  if (state.advisoryChecks === DEFAULT_ADVISORY_CHECKS && typeof legacyWarnOnUnguardedHex === "boolean") {
    useSettingsStore.setState({
      advisoryChecks: { ...DEFAULT_ADVISORY_CHECKS, "hex-unguarded": legacyWarnOnUnguardedHex }
    });
  } else {
    // Same door every other persisted setting guards at startup: storage is hand-editable, and a
    // garbage or out-of-date value must fall back to the default rather than break the toggles.
    useSettingsStore.setState({
      advisoryChecks: reconcileAdvisoryChecks(useSettingsStore.getState().advisoryChecks)
    });
  }
}

/** Resets the store, remembered preferences included. Tests would otherwise leak state. */
export function resetSettingsStore() {
  MEMORY.clear();
  optionalStorage()?.removeItem("atlantis-hud-settings");
  useSettingsStore.setState({ ...DEFAULTS, paneTransparency: { ...DEFAULT_PANE_TRANSPARENCY } });
  applyTheme(DEFAULTS.theme);
  applyPaneTransparency(DEFAULTS.paneTransparency[DEFAULTS.theme]);
  applyInterfaceSize(DEFAULTS.interfaceSize);
}
