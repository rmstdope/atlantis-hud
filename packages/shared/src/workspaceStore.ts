/**
 * The selection state every widget reads from.
 *
 * The widgets in this workspace are not independent: choosing a hex changes which units are listed,
 * choosing a unit changes what the detail panel and the orders editor show. Previously each panel
 * held its own state and separately asked the user to retype the project, faction and turn, so
 * nothing could be linked to anything else. One store fixes that.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** The four panels that can be folded away to open up the map. */
export type PanelName = "region" | "unit" | "orders" | "units";

/** Map layers the toolbar toggles. Only staleness has an effect so far. */
export type LayerName = "units" | "structures" | "staleness" | "tradeRoutes" | "movement";

export type WorkspaceProject = {
  projectFilePath: string;
  databasePath: string;
  projectId: string;
  factionId: string;
  turnNumber: number;
};

export type WorkspaceState = {
  project: WorkspaceProject | null;
  selectedRegionId: string | null;
  selectedUnitId: string | null;
  /** Level being viewed. A report can describe more than one. */
  level: number;
  collapsed: Record<PanelName, boolean>;
  layers: Record<LayerName, boolean>;

  openProject: (project: WorkspaceProject) => void;
  closeProject: () => void;
  selectRegion: (regionId: string | null) => void;
  selectUnit: (unitId: string | null) => void;
  setLevel: (level: number) => void;
  togglePanel: (panel: PanelName) => void;
  toggleLayer: (layer: LayerName) => void;
};

const INITIAL_COLLAPSED: Record<PanelName, boolean> = {
  region: false,
  unit: false,
  orders: false,
  units: false
};

const INITIAL_LAYERS: Record<LayerName, boolean> = {
  units: true,
  structures: true,
  staleness: true,
  tradeRoutes: false,
  movement: false
};

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

/** Only the layout preferences are remembered; see the note on `partialize`. */
type Persisted = Pick<WorkspaceState, "collapsed" | "layers">;

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      project: null,
      selectedRegionId: null,
      selectedUnitId: null,
      level: 1,
      collapsed: INITIAL_COLLAPSED,
      layers: INITIAL_LAYERS,

      openProject: (project) =>
        set({
          project,
          selectedRegionId: null,
          selectedUnitId: null
        }),

      closeProject: () =>
        set({
          project: null,
          selectedRegionId: null,
          selectedUnitId: null
        }),

      // Moving to another hex abandons the unit that was selected in the old one: keeping it would
      // leave the detail panel and the orders editor describing a unit that is no longer in the list.
      selectRegion: (regionId) =>
        set((state) =>
          state.selectedRegionId === regionId
            ? state
            : { selectedRegionId: regionId, selectedUnitId: null }
        ),

      selectUnit: (unitId) => set({ selectedUnitId: unitId }),

      // Levels are separate maps, so a selection from one does not carry to another.
      setLevel: (level) =>
        set((state) =>
          state.level === level ? state : { level, selectedRegionId: null, selectedUnitId: null }
        ),

      togglePanel: (panel) =>
        set((state) => ({
          collapsed: { ...state.collapsed, [panel]: !state.collapsed[panel] }
        })),

      toggleLayer: (layer) =>
        set((state) => ({
          layers: { ...state.layers, [layer]: !state.layers[layer] }
        }))
    }),
    {
      name: "atlantis-hud-workspace",
      storage: STORAGE,
      // Which panels are folded and which layers are drawn are preferences about the workspace, so
      // they outlive a reload. What is selected is not: a reload leaves no report loaded, and
      // restoring a hex and unit that no longer exist would show stale headings over empty panels.
      partialize: (state) => ({ collapsed: state.collapsed, layers: state.layers })
    }
  )
);

/** Resets the store, remembered preferences included. Tests would otherwise leak state. */
export function resetWorkspaceStore() {
  MEMORY.clear();
  optionalStorage()?.removeItem("atlantis-hud-workspace");
  useWorkspaceStore.setState({
    project: null,
    selectedRegionId: null,
    selectedUnitId: null,
    level: 1,
    collapsed: INITIAL_COLLAPSED,
    layers: INITIAL_LAYERS
  });
}
