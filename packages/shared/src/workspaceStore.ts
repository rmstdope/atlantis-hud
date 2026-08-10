/**
 * The selection state every widget reads from.
 *
 * The widgets in this workspace are not independent: choosing a hex changes which units are listed,
 * choosing a unit changes what the detail panel and the orders editor show. Previously each panel
 * held its own state and separately asked the user to retype the game, faction and turn, so
 * nothing could be linked to anything else. One store fixes that.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** The four panels that can be folded away to open up the map. */
export type PanelName = "region" | "unit" | "orders" | "units" | "planner";

/** Map layers the toolbar toggles. Only staleness has an effect so far. */
export type LayerName = "units" | "structures" | "staleness" | "tradeRoutes" | "movement";

/**
 * The game the workspace is showing.
 *
 * Everything here is known the moment a game is opened. The faction and the turn are deliberately
 * absent: they come from whatever report is loaded next, and a game can hold several factions.
 */
export type WorkspaceGame = {
  gameId: string;
  gameName: string;
  databasePath: string;
  rulesetId: string;
};

/**
 * What the planner is doing, if anything.
 *
 * `armed` means the next hex the player picks is a destination rather than a selection. It is a
 * one-shot rather than a mode: the map means one thing at a time, and a mode you can forget you
 * are in makes every later click a surprise.
 */
export type PlannerState = {
  armed: boolean;
  /** The hex a route was last planned to, kept so the overlay survives a re-render. */
  destinationId: string | null;
};

export type WorkspaceState = {
  game: WorkspaceGame | null;
  planner: PlannerState;
  selectedRegionId: string | null;
  selectedUnitId: string | null;
  /** Level being viewed. A report can describe more than one. */
  level: number;
  collapsed: Record<PanelName, boolean>;
  layers: Record<LayerName, boolean>;

  /** Opens a game, abandoning any selection made in the one before it. */
  openGame: (game: WorkspaceGame) => void;
  closeGame: () => void;
  /**
   * Records that the open game is now played under another ruleset.
   *
   * Unlike `openGame` this keeps the selection: a ruleset change is not a game switch, and the hex
   * and unit the player was looking at are still there.
   */
  updateGameRuleset: (rulesetId: string) => void;
  /**
   * Selects a hex, and with it a unit inside that hex.
   *
   * `defaultUnitId` is supplied by the caller, which knows what the hex contains. Landing on a hex
   * with nothing selected leaves the detail and orders panels empty for no reason, so the first
   * unit is chosen straight away — the caller sorts its own faction first.
   */
  selectRegion: (regionId: string | null, defaultUnitId?: string | null) => void;
  selectUnit: (unitId: string | null) => void;
  setLevel: (level: number) => void;
  togglePanel: (panel: PanelName) => void;
  toggleLayer: (layer: LayerName) => void;
  /** Arms destination picking for exactly one click. */
  armPlanner: () => void;
  /** Records where a route was planned to, and disarms. */
  planTo: (destinationId: string) => void;
  /** Clears the route and any armed pick. */
  clearPlan: () => void;
};

const INITIAL_COLLAPSED: Record<PanelName, boolean> = {
  region: false,
  unit: false,
  orders: false,
  units: false,
  planner: false
};

const INITIAL_LAYERS: Record<LayerName, boolean> = {
  units: true,
  structures: true,
  staleness: true,
  tradeRoutes: false,
  // On by default since #83: the layer draws a selected unit's own orders, and a default of off
  // hid that entirely behind a chip nobody had reason to press.
  movement: true
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
      game: null,
      selectedRegionId: null,
      selectedUnitId: null,
      level: 1,
      collapsed: INITIAL_COLLAPSED,
      layers: INITIAL_LAYERS,
      planner: { armed: false, destinationId: null },

      openGame: (game) =>
        set({
          game,
          selectedRegionId: null,
          selectedUnitId: null
        }),

      closeGame: () =>
        set({
          game: null,
          selectedRegionId: null,
          selectedUnitId: null
        }),

      updateGameRuleset: (rulesetId) =>
        set((state) => (state.game ? { game: { ...state.game, rulesetId } } : state)),

      // Moving to another hex abandons the unit that was selected in the old one: keeping it would
      // leave the detail panel and the orders editor describing a unit that is no longer in the list.
      selectRegion: (regionId, defaultUnitId = null) =>
        set((state) =>
          state.selectedRegionId === regionId
            ? state
            : { selectedRegionId: regionId, selectedUnitId: defaultUnitId }
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
        })),

      armPlanner: () => set((state) => ({ planner: { ...state.planner, armed: true } })),
      planTo: (destinationId) => set(() => ({ planner: { armed: false, destinationId } })),
      clearPlan: () => set(() => ({ planner: { armed: false, destinationId: null } }))
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
    game: null,
    selectedRegionId: null,
    selectedUnitId: null,
    level: 1,
    collapsed: INITIAL_COLLAPSED,
    layers: INITIAL_LAYERS
  });
}
