/**
 * The selection state every widget reads from.
 *
 * The widgets in this workspace are not independent: choosing a hex changes which units are listed,
 * choosing a unit changes what the detail panel and the orders editor show. Previously each panel
 * held its own state and separately asked the user to retype the project, faction and turn, so
 * nothing could be linked to anything else. One store fixes that.
 */

import { create } from "zustand";

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

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
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
}));

/** Resets the store. Exists for tests, which would otherwise leak state between cases. */
export function resetWorkspaceStore() {
  useWorkspaceStore.setState({
    project: null,
    selectedRegionId: null,
    selectedUnitId: null,
    level: 1,
    collapsed: INITIAL_COLLAPSED,
    layers: INITIAL_LAYERS
  });
}
