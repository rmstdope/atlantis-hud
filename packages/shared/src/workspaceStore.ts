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
// This is a runtime import, but `panelLayout.ts`'s import back (`import type { PanelName }`) is
// type-only and erased at compile time - so the two modules do not form a runtime cycle.
import {
  clampOrdersHeight,
  clampRailWidth,
  clampUnitsHeight,
  type RailSide
} from "./workspace/panelLayout";
import { columnSharesFromStorage, type ColumnShares } from "./unitTable";
import {
  mapViewCommitted,
  mapViewOpened,
  mapViewSelectionChanged,
  NO_MAP_VIEW,
  type MapViewState
} from "./workspace/mapViewState";
import type { SavedMapView } from "./workspace/mapViewportStorage";
import type { Viewport } from "./workspace/mapViewport";

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
  /**
   * Counts user-initiated selection changes, so the map can replay its lock-on pulse exactly once
   * per change. A restored selection (app load) does not bump it - see `restoreSelection` - which
   * is what keeps the pulse from firing on every launch.
   */
  selectionEpoch: number;
  /** Level being viewed. A report can describe more than one. */
  level: number;
  collapsed: Record<PanelName, boolean>;
  /**
   * The orders editor's dragged height, in rem, or null while the default pin applies.
   *
   * A layout preference about the workspace, exactly like `collapsed` - it lives here rather than
   * in `settingsStore` for the same reason every other panel preference does.
   */
  ordersHeightRem: number | null;
  /**
   * The units-in-hex pane's dragged height, in rem, or null while the default applies - ah-2r3.
   */
  unitsHeightRem: number | null;
  /**
   * The left and right rails' dragged widths, in rem, or null while the default width applies.
   *
   * Layout preferences about the workspace, exactly like `ordersHeightRem` - they outlive the game,
   * so they are not reset by `openGame`/`closeGame`/`setLevel`.
   */
  leftRailWidthRem: number | null;
  rightRailWidthRem: number | null;
  /**
   * The units-in-hex table's dragged column widths, as shares of the table, or null while the
   * shipped shape applies - a layout preference exactly like `ordersHeightRem`, so it lives here
   * and outlives the game the same way. Only the columns a player has actually dragged are
   * present; everything else reads from `DEFAULT_COLUMN_SHARES` through `shareOf` (ah-1owr.2).
   */
  unitColumnShares: ColumnShares | null;
  layers: Record<LayerName, boolean>;
  /** Which marks the map draws over its terrain. */
  badges: Record<BadgeName, boolean>;
  /** Whether the region panel's Problems section is shown. On by default. */
  regionProblemsShown: boolean;
  /**
   * The map view - pan, zoom, restore bookkeeping - as one piece of state; see `mapViewState.ts`.
   * Not persisted by this store: the per-game localStorage record is the persistence (ah-ian).
   */
  mapView: MapViewState;

  /**
   * Opens a game on its saved view: level, selected hex and the pending viewport land in one set,
   * so no render sees a new game over an old view or the reverse (ah-ian).
   */
  openGame: (game: WorkspaceGame, saved: SavedMapView | null) => void;
  closeGame: () => void;
  /**
   * Records that the open game is now played under another ruleset.
   *
   * Unlike `openGame` this keeps the selection: a ruleset change is not a game switch, and the hex
   * and unit the player was looking at are still there.
   */
  updateGameRuleset: (rulesetId: string) => void;
  /**
   * Records that the open game now has another name.
   *
   * Unlike `openGame` this keeps the selection: a rename is not a game switch, and the hex and
   * unit the player was looking at are still there.
   */
  updateGameName: (gameName: string) => void;
  /**
   * Selects a hex, and with it a unit inside that hex.
   *
   * `defaultUnitId` is supplied by the caller, which knows what the hex contains. Landing on a hex
   * with nothing selected leaves the detail and orders panels empty for no reason, so the first
   * unit is chosen straight away — the caller sorts its own faction first.
   */
  selectRegion: (regionId: string | null, defaultUnitId?: string | null) => void;
  /**
   * Restores a selection without bumping `selectionEpoch` - the silent app-load restore is not a
   * user-initiated change, so it must not replay the lock-on pulse. Clears the selected unit the
   * same way `selectRegion` does with no default, since a restored hex carries no unit of its own.
   */
  restoreSelection: (regionId: string | null) => void;
  selectUnit: (unitId: string | null) => void;
  setLevel: (level: number) => void;
  /** Records that the map committed a viewport for the open game on this level. */
  commitMapView: (viewport: Viewport, level: number) => void;
  togglePanel: (panel: PanelName) => void;
  /** Sets (or, with null, resets) the orders editor's dragged height. Clamped on the way in. */
  setOrdersHeight: (rem: number | null) => void;
  /** Sets (or, with null, resets) the units pane's dragged height. Clamped on the way in. */
  setUnitsHeight: (rem: number | null) => void;
  /** Sets (or, with null, resets) one rail's dragged width. Clamped on the way in. */
  setRailWidth: (side: RailSide, rem: number | null) => void;
  /**
   * Writes both sides of a column boundary drag in one commit - `dragColumnShare` always resolves
   * a pair, and setting them as two calls would let a re-render land between them with only one
   * column moved. Merged into what is stored, so an untouched column keeps reading its default.
   */
  setUnitColumnShares: (shares: ColumnShares) => void;
  /** Drops every stored column width, back to the shipped shape. Reachable from Settings. */
  resetUnitColumnShares: () => void;
  toggleLayer: (layer: LayerName) => void;
  toggleBadge: (badge: BadgeName) => void;
  /** Shows or hides the region panel's Problems section. */
  toggleRegionProblems: () => void;
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

/** The level the map opens on before a game says otherwise: the surface. */
export const DEFAULT_LEVEL = 1;

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

/** `null` for an empty record, so "nothing customized" reads the same way rail widths do. */
function emptyToNull(shares: ColumnShares): ColumnShares | null {
  return Object.keys(shares).length > 0 ? shares : null;
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
type Persisted = Pick<
  WorkspaceState,
  | "collapsed"
  | "ordersHeightRem"
  | "unitsHeightRem"
  | "leftRailWidthRem"
  | "rightRailWidthRem"
  | "unitColumnShares"
  | "layers"
  | "badges"
  | "regionProblemsShown"
>;

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      game: null,
      selectedRegionId: null,
      selectedUnitId: null,
      selectionEpoch: 0,
      level: DEFAULT_LEVEL,
      collapsed: INITIAL_COLLAPSED,
      ordersHeightRem: null,
      unitsHeightRem: null,
      leftRailWidthRem: null,
      rightRailWidthRem: null,
      unitColumnShares: null,
      layers: INITIAL_LAYERS,
      badges: allBadges(true),
      regionProblemsShown: true,
      planner: { armed: false, destinationId: null },
      mapView: NO_MAP_VIEW,

      openGame: (game, saved) =>
        set({
          game,
          level: saved?.level ?? DEFAULT_LEVEL,
          selectedRegionId: saved?.regionId ?? null,
          selectedUnitId: null,
          selectionEpoch: 0,
          mapView: mapViewOpened(game.gameId, saved)
        }),

      closeGame: () =>
        set({
          game: null,
          selectedRegionId: null,
          selectedUnitId: null,
          selectionEpoch: 0,
          mapView: NO_MAP_VIEW
        }),

      updateGameRuleset: (rulesetId) =>
        set((state) => (state.game ? { game: { ...state.game, rulesetId } } : state)),

      updateGameName: (gameName) =>
        set((state) => (state.game ? { game: { ...state.game, gameName } } : state)),

      // Moving to another hex abandons the unit that was selected in the old one: keeping it would
      // leave the detail panel and the orders editor describing a unit that is no longer in the list.
      selectRegion: (regionId, defaultUnitId = null) =>
        set((state) =>
          state.selectedRegionId === regionId
            ? state
            : {
                selectedRegionId: regionId,
                selectedUnitId: defaultUnitId,
                selectionEpoch: state.selectionEpoch + 1,
                mapView: mapViewSelectionChanged(state.mapView, regionId)
              }
        ),

      restoreSelection: (regionId) =>
        set((state) => ({
          selectedRegionId: regionId,
          selectedUnitId: null,
          mapView: mapViewSelectionChanged(state.mapView, regionId)
        })),

      selectUnit: (unitId) => set({ selectedUnitId: unitId }),

      // Levels are separate maps, so a selection from one does not carry to another.
      setLevel: (level) =>
        set((state) =>
          state.level === level
            ? state
            : {
                level,
                selectedRegionId: null,
                selectedUnitId: null,
                selectionEpoch: 0,
                mapView: mapViewSelectionChanged(state.mapView, null)
              }
        ),

      commitMapView: (viewport, level) =>
        set((state) => ({ mapView: mapViewCommitted(state.mapView, viewport, level) })),

      togglePanel: (panel) =>
        set((state) => ({
          collapsed: { ...state.collapsed, [panel]: !state.collapsed[panel] }
        })),

      setOrdersHeight: (rem) => set(() => ({ ordersHeightRem: clampOrdersHeight(rem) })),

      setUnitsHeight: (rem) => set(() => ({ unitsHeightRem: clampUnitsHeight(rem) })),

      setRailWidth: (side, rem) =>
        set(() =>
          side === "left"
            ? { leftRailWidthRem: clampRailWidth(rem) }
            : { rightRailWidthRem: clampRailWidth(rem) }
        ),

      // No clamp on the way in, unlike `setUnitsHeight`: `dragColumnShare` is the only producer
      // and it already clamps, and clamping a merge of two columns against a whole-table
      // invariant would be wrong. `columnSharesFromStorage` is the guard, and it runs on load.
      setUnitColumnShares: (shares) =>
        set((state) => ({ unitColumnShares: { ...state.unitColumnShares, ...shares } })),

      resetUnitColumnShares: () => set(() => ({ unitColumnShares: null })),

      toggleLayer: (layer) =>
        set((state) => ({
          layers: { ...state.layers, [layer]: !state.layers[layer] }
        })),

      toggleBadge: (badge) =>
        set((state) => ({
          badges: { ...state.badges, [badge]: !state.badges[badge] }
        })),

      setAllBadges: (on) => set(() => ({ badges: allBadges(on) })),

      toggleRegionProblems: () =>
        set((state) => ({ regionProblemsShown: !state.regionProblemsShown })),

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
        ordersHeightRem: state.ordersHeightRem,
        unitsHeightRem: state.unitsHeightRem,
        leftRailWidthRem: state.leftRailWidthRem,
        rightRailWidthRem: state.rightRailWidthRem,
        unitColumnShares: state.unitColumnShares,
        layers: state.layers,
        badges: state.badges,
        regionProblemsShown: state.regionProblemsShown
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
          ordersHeightRem: clampOrdersHeight(stored.ordersHeightRem),
          unitsHeightRem: clampUnitsHeight(stored.unitsHeightRem),
          leftRailWidthRem: clampRailWidth(stored.leftRailWidthRem),
          rightRailWidthRem: clampRailWidth(stored.rightRailWidthRem),
          // Not a boolean record, so `reconcile` does not apply - `columnSharesFromStorage` is
          // its equivalent, dropping unknown columns and renormalising what survives so the
          // stored shape still covers exactly the whole table.
          unitColumnShares: emptyToNull(columnSharesFromStorage(stored.unitColumnShares ?? {})),
          layers: reconcile(INITIAL_LAYERS, stored.layers ?? {}),
          badges: badgesFromStorage(stored.badges ?? {}),
          // Not a record, so `reconcile` does not apply: a missing or malformed key must read
          // as shown, or an upgrade silently hides every player's diagnostics.
          regionProblemsShown:
            typeof stored.regionProblemsShown === "boolean" ? stored.regionProblemsShown : true
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
    selectionEpoch: 0,
    level: DEFAULT_LEVEL,
    collapsed: INITIAL_COLLAPSED,
    ordersHeightRem: null,
    unitsHeightRem: null,
    leftRailWidthRem: null,
    rightRailWidthRem: null,
    unitColumnShares: null,
    layers: INITIAL_LAYERS,
    badges: allBadges(true),
    regionProblemsShown: true,
    mapView: NO_MAP_VIEW
  });
}
