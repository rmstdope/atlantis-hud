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

export type SettingsState = {
  theme: ThemeName;
  biomeTextures: boolean;
  /** Applies instantly: the settings dialog has no OK button to wait for. */
  setTheme: (theme: ThemeName) => void;
  setBiomeTextures: (enabled: boolean) => void;
};

type Persisted = Pick<SettingsState, "theme" | "biomeTextures">;

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

      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },

      setBiomeTextures: (biomeTextures) => {
        set({ biomeTextures });
      }
    }),
    {
      name: "atlantis-hud-settings",
      storage: STORAGE,
      partialize: (state) => ({ theme: state.theme, biomeTextures: state.biomeTextures })
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
}

/** Resets the store, remembered preferences included. Tests would otherwise leak state. */
export function resetSettingsStore() {
  MEMORY.clear();
  optionalStorage()?.removeItem("atlantis-hud-settings");
  useSettingsStore.setState({ theme: "dark", biomeTextures: true });
  applyTheme("dark");
}
