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

export type ThemeName = "dark" | "light";

/** How see-through the floating panes start out: enough map underneath to navigate by. */
export const DEFAULT_PANE_TRANSPARENCY = 75;

export type SettingsState = {
  theme: ThemeName;
  biomeTextures: boolean;
  /**
   * How see-through the panes floating over the map are, in percent.
   *
   * 0 is opaque and 90 is the most transparent the slider offers - never 100, because a pane that
   * cannot be seen at all can also not be found to make visible again.
   */
  paneTransparency: number;
  /** Applies instantly: the settings dialog has no OK button to wait for. */
  setTheme: (theme: ThemeName) => void;
  setBiomeTextures: (enabled: boolean) => void;
  setPaneTransparency: (percent: number) => void;
};

type Persisted = Pick<SettingsState, "theme" | "biomeTextures" | "paneTransparency">;

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
function clampTransparency(percent: number): number {
  // Coerced before the finite check: storage is hand-editable and other writers exist, so the
  // "number" rehydrated into state can arrive as its string form.
  const numeric = Number(percent);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_PANE_TRANSPARENCY;
  }
  return Math.min(90, Math.max(0, Math.round(numeric)));
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

export const useSettingsStore = create<SettingsState>()(
  persist<SettingsState, [], [], Persisted>(
    (set) => ({
      theme: "dark",
      biomeTextures: true,
      paneTransparency: DEFAULT_PANE_TRANSPARENCY,

      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },

      setBiomeTextures: (biomeTextures) => {
        set({ biomeTextures });
      },

      setPaneTransparency: (percent) => {
        const clamped = clampTransparency(percent);
        applyPaneTransparency(clamped);
        set({ paneTransparency: clamped });
      }
    }),
    {
      name: "atlantis-hud-settings",
      storage: STORAGE,
      partialize: (state) => ({
        theme: state.theme,
        biomeTextures: state.biomeTextures,
        paneTransparency: state.paneTransparency
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
}

/** Resets the store, remembered preferences included. Tests would otherwise leak state. */
export function resetSettingsStore() {
  MEMORY.clear();
  optionalStorage()?.removeItem("atlantis-hud-settings");
  useSettingsStore.setState({
    theme: "dark",
    biomeTextures: true,
    paneTransparency: DEFAULT_PANE_TRANSPARENCY
  });
  applyTheme("dark");
  applyPaneTransparency(DEFAULT_PANE_TRANSPARENCY);
}
