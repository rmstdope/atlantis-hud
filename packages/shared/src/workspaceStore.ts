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
import { allBadges, type BadgeName } from "./workspace/mapThemes/hexView";

/** The four panels that can be folded away to open up the map. */
export type PanelName = "region" | "unit" | "orders" | "units" | "planner";

/**
 * Map layers the toolbar toggles. Every one of them drives the map.
 *
 * What a hex *draws over its terrain* is not here: those are the badges, one toggle per mark, and
 * they replaced the two chips - "units" and "structures" - that used to speak for all nine.
 */
export type LayerName = "staleness" | "movement";

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
  /** Which marks the map draws over its terrain. */
  badges: Record<BadgeName, boolean>;

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
  toggleBadge: (badge: BadgeName) => void;
  /** Shows or hides the whole set at once, which is what a nine-box panel owes the player. */
  setAllBadges: (on: boolean) => void;
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
  staleness: true,
  // On by default since #83: the layer draws a selected unit's own orders, and a default of off
  // hid that entirely behind a chip nobody had reason to press.
  movement: true
};

/**
 * A stored record of toggles, reconciled against the set this build knows.
 *
 * Storage is hand-editable and outlives a release, so a record can arrive missing a toggle that did
 * not exist when it was written, or carrying one that has since gone. A missing key reads as
 * `false` - a mark quietly gone from the map, with nothing on screen to say why - so the defaults
 * stand underneath, and anything outside the set is dropped rather than kept as a phantom toggle.
 */
function reconcile<K extends string>(
  defaults: Record<K, boolean>,
  stored: Partial<Record<string, boolean>>
): Record<K, boolean> {
  const known = Object.keys(defaults) as K[];
  return {
    ...defaults,
    ...(Object.fromEntries(
      known.filter((key) => typeof stored[key] === "boolean").map((key) => [key, stored[key]])
    ) as Record<K, boolean>)
  };
}

/** What a stored badge record means here; see `reconcile`. */
export function badgesFromStorage(
  stored: Partial<Record<string, boolean>>
): Record<BadgeName, boolean> {
  return reconcile(allBadges(true), stored);
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

/** Only the layout preferences are remembered; see the note on `partialize`. */
type Persisted = Pick<WorkspaceState, "collapsed" | "layers" | "badges">;

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      game: null,
      selectedRegionId: null,
      selectedUnitId: null,
      level: 1,
      collapsed: INITIAL_COLLAPSED,
      layers: INITIAL_LAYERS,
      badges: allBadges(true),
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

      toggleBadge: (badge) =>
        set((state) => ({
          badges: { ...state.badges, [badge]: !state.badges[badge] }
        })),

      setAllBadges: (on) => set(() => ({ badges: allBadges(on) })),

      armPlanner: () => set((state) => ({ planner: { ...state.planner, armed: true } })),
      planTo: (destinationId) => set(() => ({ planner: { armed: false, destinationId } })),
      clearPlan: () => set(() => ({ planner: { armed: false, destinationId: null } }))
    }),
    {
      name: "atlantis-hud-workspace",
      storage: STORAGE,
      // Which panels are folded, which layers are drawn and which badges the map carries are
      // preferences about the workspace, so they outlive a reload. What is selected is not: a
      // reload leaves no report loaded, and restoring a hex and unit that no longer exist would
      // show stale headings over empty panels.
      partialize: (state) => ({
        collapsed: state.collapsed,
        layers: state.layers,
        badges: state.badges
      }),
      /**
       * What comes back out of storage, taken key by key rather than spread.
       *
       * Zustand replaces the whole state with whatever this returns, so a spread of the stored
       * blob would let any key in it land in the store - including over an action, which the next
       * click would then try to call. Only the three preferences written above are read back, and
       * each is reconciled against the set this build knows rather than trusted; see `reconcile`.
       */
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<Persisted>;
        return {
          ...current,
          collapsed: reconcile(INITIAL_COLLAPSED, stored.collapsed ?? {}),
          layers: reconcile(INITIAL_LAYERS, stored.layers ?? {}),
          badges: badgesFromStorage(stored.badges ?? {})
        };
      }
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
    layers: INITIAL_LAYERS,
    badges: allBadges(true)
  });
}
