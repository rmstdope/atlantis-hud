import type {
  CoreClient,
  DeclaredAttitudes,
  OpenedGame,
  OrdersPreviewResponse,
  RegionPreview,
  ReportUnit,
  StructureInfo,
  UnitSilver
} from "@atlantis/core-client";
import {
  cloneElement,
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode
} from "react";
import type { HexNode } from "../hexMapModel";
import { unitsForHex } from "../hexMapModel";
import { unitStructureLabel } from "../structureLabel";
import { describeMenBriefly } from "../unitComposition";
import { derivedSkillsFor, NO_DERIVED_SKILLS, type DerivedSkills } from "../battleSkills";
import { unitSkillsCell } from "../battleSkillPresentation";
import { presentUnitMovement } from "../unitMovement";
import { flagLetters, flagWords } from "../unitFlags";
import {
  columnHasOwnPopup,
  columnHasPopup,
  popupAsText,
  popupForCell,
  type PopupFacts
} from "../unitCellPopup";
import {
  DEFAULT_SORT,
  EXTRA_COLUMN_SHARES,
  UNIT_COLUMNS,
  filterUnits,
  rowHeightAt,
  sharesFor,
  shareScaleFor,
  shownColumns,
  mergeShownOrder,
  sortAfterHiding,
  nextSort,
  sortUnits,
  windowRange,
  COLUMN_LABELS,
  columnWidthStyle,
  orderOf,
  silverKey,
  unitRowKey,
  unitRowSelector,
  silverIsRed,
  silverShown,
  type ColumnShares,
  type ExtraColumn,
  type SortColumn,
  type SortState,
  type DrawnColumnId,
  type UnitColumn
} from "../unitTable";
import { isCursorRow, unitCursor } from "./unitCursor";
import {
  changeFor,
  originalTooltip,
  dissolves,
  formatItems,
  hasUncertainTransportTarget,
  mergePreview,
  mergePreviewAcross,
  type PreviewedUnit
} from "../unitPreview";
import { HOVER_DELAY_MS, type Point } from "../unitTooltip";
import { useSettingsStore } from "../settingsStore";
import { useWorkspaceStore } from "../workspaceStore";
import { useArmiesStore } from "../armiesStore";
import { attitudeToward } from "../factionDossier";
import { alreadyIn } from "../armies";
import { isTopDismissLayer, pushDismissLayer } from "../dismissStack";
import { isMacPlatform } from "../shortcuts";
import { AddToArmyMenu } from "./AddToArmyMenu";
import { armyRows, seenLabel, staleLine, type ArmyRows } from "./armyRows";
import { ChipPopover } from "./popover";
import { ForeignStrip } from "./ForeignStrip";
import { foreignEmptyLine, pinForRow, pinnedRows, pinStillApplies } from "./foreignUnits";
import { reduce as reduceRail, type RailMode } from "./railEditState";
import { guardSelection } from "./selectionGuard";
import { createUnitDragChip, type UnitDragChip } from "./unitDragChip";
import { UnitBulkLine } from "./UnitBulkLine";
import { UnitContextMenu } from "./UnitContextMenu";
import { UnitSourceRail } from "./UnitSourceRail";
import {
  NO_PICK,
  afterGesture,
  narrowedTo,
  onPress,
  pickedIn,
  type UnitPick
} from "./unitPick";
import { useArmyActions } from "./useArmyActions";
import {
  dimsDeparting,
  drawnColumnsFor,
  extraColumnsFor,
  FOREIGN_SOURCE,
  headerFor,
  HEX_SOURCE,
  listShown,
  sortSurvives,
  sourceStillThere,
  travelsOnSelect,
  type DrawnColumn,
  type FactionPin,
  type UnitSource
} from "./unitSource";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { NO_ORDERS_TEMPLATE, type ReportedLongOrder } from "../ordersDocument";
import { ColumnReorderHandle } from "./ColumnReorderHandle";
import { ColumnSplitter } from "./ColumnSplitter";
import { Absent, SeverityMark, UNIT_LINK_CLASS } from "./primitives";
import { UnitCellPopup } from "./UnitCellPopup";
import { UnitTooltip } from "./UnitTooltip";

/** Rows built beyond each edge of the viewport, so a flick of the wheel does not show a gap. */
const OVERSCAN = 6;

/** What each extra column's header says; the trailing action column deliberately has none. */
const EXTRA_COLUMN_LABELS: Record<ExtraColumn, string> = { hex: "Hex", seen: "Seen", remove: "" };

/** Nothing to show for the two sources that are not an Army. */
const NO_ARMY_ROWS: ArmyRows = { rows: [], seen: new Map(), missing: 0 };

/** Stands in for an absent `onFailure`, so the actions need no null check of their own. */
const noop = () => {};

/** The columns whose header carries a sort control. */
const SORTABLE_COLUMNS: ReadonlySet<UnitColumn> = new Set<UnitColumn>([
  "unitId",
  "name",
  "faction",
  "men",
  "structure",
  "longOrder",
  "silver"
]);

/**
 * Every unit in the selected hex, as a table, with one selectable.
 *
 * A single hex can hold three hundred units across two dozen structures, so the table is really a
 * flattened tree: the Structure column carries the nesting rather than indenting rows, which keeps
 * it sortable and filterable. Own units sort first, so the one that is yours is never buried.
 *
 * Only the rows on screen are built. The scrolled-away ones are stood in for by a pair of empty
 * rows of the right height, which is why every row is pinned to `rowHeightAt(interfaceSize)`: the
 * arithmetic and the rendering read the same number, so they cannot drift apart and leave the list
 * misaligned - including as the Interface size setting scales it (ah-46p.2).
 */
/**
 * The empty column maps, shared rather than built per render.
 *
 * `visible` is memoised on these, and a `new Map()` built afresh each time the memo re-ran rebuilt
 * every row on nothing at all: `getSilver` changes identity on every validation (`ah-1wcw.1`, fixed
 * in `ah-1wcw.6`). A hovered popup no longer dies of that churn (`ah-3oy3`), but the wasted
 * re-renders are reason enough to keep these shared.
 */
const NO_LONG_ORDERS: ReadonlyMap<string, string | null> = new Map();
const NO_SILVER: ReadonlyMap<string, number | null> = new Map();
/** For the same reason: an empty row list nobody rebuilds. */
const NO_UNITS: ReportUnit[] = [];

/**
 * What the shell may ask of the dock. The state stays here; only the action crosses the boundary.
 * Modelled on `MapCanvasHandle` and `OrdersEditorHandle`.
 */
export type UnitTableDockHandle = {
  /** Shows one faction's units: selects `Other factions` and pins it. */
  showForeignFaction(pin: FactionPin): void;
};

type UnitTableDockProps = {
  hex: HexNode | null;
  /** The hex's slice of the orders preview, so rows show the coming month. */
  preview?: RegionPreview | null;
  /** The whole report's orders preview, so a list spanning hexes shows the coming month too. */
  ordersPreview?: OrdersPreviewResponse | null;
  /** The month-long order a unit's live orders carry, for the Long order column. */
  getLongOrder?: (unitId: string, regionId: string) => string | null;
  /** What the report's orders template said this unit's long order was (`ah-rgkk.5.4`). */
  getReportedLongOrder?: (unitId: string) => ReportedLongOrder;
  /** Each own unit's silver forecast, or null where there is none. `ah-1wcw.1`. */
  getSilver?: (unitId: string, regionId: string) => UnitSilver | null;
  /** The unit-anchored `not-enough-silver` findings, by unit id. */
  silverWarnings?: ReadonlySet<string>;
  /** Selects a unit and opens its orders. Absent means the cell is not clickable. */
  onSelectUnit?: (unitId: string, regionId?: string) => void;
  /**
   * Wraps a foreign faction's name so it can open that faction's dossier beside the row clicked
   * (ah-bu2c). Left off, the name prints as it always did.
   */
  renderFactionName?: (factionId: string, label: ReactNode) => ReactNode;
  /** Every own unit in this turn's report, for the `All my units` source (`ah-1mpx.2`). */
  ownUnits?: ReportUnit[];
  /** This turn's units by unit number, for resolving an Army's members. `armies.ts`' `unitsByIdIn`. */
  unitsById?: ReadonlyMap<string, ReportUnit>;
  /** `parsed.header.turnNumber`. Null when no report is loaded, or it names no turn. */
  currentTurn?: number | null;
  client?: CoreClient;
  game?: OpenedGame | null;
  /** A save that failed and was rolled back. Wired to the header status line. */
  onFailure?: (message: string) => void;
  /**
   * Opens the export dialog for an Army. Absent in a component test, where the strip is inert.
   *
   * The dock does not own the dialog: every modal in this application is mounted by `AppShell`,
   * and a `fixed inset-0` backdrop rendered from inside a pane is a pane pretending to be a window.
   */
  onExportArmy?: (armyId: string) => void;
  /**
   * The source the pane starts on, `This hex` unless told otherwise.
   *
   * The shell never passes it: the source is local, not persisted (T2), and reopening the
   * application lands on `This hex`. It exists so a component test can render the pane on a source
   * a static render cannot click its way to - `packages/shared` has no jsdom, so there is no other
   * way in (`testing/README.md`).
   */
  initialSource?: UnitSource;
  /** Every unit in this turn's report that is not yours, for `Other factions` (`ah-1mpx.5`). */
  foreignUnits?: ReportUnit[];
  /**
   * The pin the pane starts with. A test seam exactly like `initialSource`: the shell never passes
   * it, and a static render cannot click its way to a pinned state.
   */
  initialPin?: FactionPin | null;
  /** The faction attitudes this turn's report declares, for the `Other factions` strip. */
  attitudes?: DeclaredAttitudes | null;
  /**
   * The pick the pane starts on, empty unless told otherwise.
   *
   * The shell never passes it, and nothing persists it (`ah-1mpx.4`): it exists for the same
   * reason `initialSource` does, so a component test can render a pick a static render cannot
   * click its way to. In a live render the source effect below clears it as the pane mounts,
   * which is why it is of no use to a real caller.
   */
  initialPick?: UnitPick;
  /**
   * Combat skills recovered from this game's battle rosters (`ah-1mpx.6.2`), for a foreign unit's
   * Skills cell and hover. Absent draws exactly as before - `not disclosed` for every foreign unit
   * with nothing of its own.
   */
  derivedSkills?: DerivedSkills;
};

export const UnitTableDock = forwardRef<UnitTableDockHandle, UnitTableDockProps>(
  function UnitTableDock(
    {
      hex,
      preview = null,
      ordersPreview = null,
      getLongOrder,
      getReportedLongOrder,
      getSilver,
      silverWarnings,
      onSelectUnit,
      renderFactionName,
      ownUnits,
      unitsById,
      currentTurn = null,
      client,
      game = null,
      onFailure,
      onExportArmy,
      initialSource = HEX_SOURCE,
      foreignUnits,
      initialPin = null,
      attitudes = null,
      initialPick = NO_PICK,
      derivedSkills = NO_DERIVED_SKILLS
    },
    ref
  ) {
  const selectedUnitId = useWorkspaceStore((state) => state.selectedUnitId);
  const selectedUnitRegionId = useWorkspaceStore((state) => state.selectedUnitRegionId);
  /**
   * The cursor as a pair. Memoised rather than selected: a zustand selector building a fresh object
   * re-renders for ever under `useSyncExternalStore` (`ah-bubf`).
   */
  const cursor = useMemo(
    () => unitCursor({ selectedUnitId, selectedUnitRegionId }),
    [selectedUnitId, selectedUnitRegionId]
  );
  const selectUnit = useWorkspaceStore((state) => state.selectUnit);
  const columnShares = useWorkspaceStore((state) => state.unitColumnShares);
  const setColumnShares = useWorkspaceStore((state) => state.setUnitColumnShares);
  const storedColumnOrder = useWorkspaceStore((state) => state.unitColumnOrder);
  const setColumnOrder = useWorkspaceStore((state) => state.setUnitColumnOrder);
  // The order everything below draws in - the colgroup, the header and every row alike, so the
  // three cannot fall out of step (ah-1owr.3).
  const order = useMemo(() => orderOf(storedColumnOrder), [storedColumnOrder]);
  const columnsShown = useWorkspaceStore((state) => state.unitColumnsShown);
  // The order actually drawn: the hidden columns taken out (ah-20di). `order` stays the unit of
  // storage and of a reorder commit, so hiding a column never rewrites the stored order.
  const visibleOrder = useMemo(() => shownColumns(order, columnsShown), [order, columnsShown]);
  // The `<col>` elements a drag writes to directly, and the table it measures a share against.
  const colRefs = useRef<Partial<Record<UnitColumn, HTMLTableColElement | null>>>({});
  const tableRef = useRef<HTMLTableElement | null>(null);
  // Where a reorder draws its drop line and its chip: a sibling of the table, never inside
  // `<thead>`, so table layout cannot touch it and the row height cannot move.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const interfaceSize = useSettingsStore((state) => state.interfaceSize);
  const countUpkeep = useSettingsStore((state) => state.countUpkeep);
  const rowHeight = rowHeightAt(interfaceSize);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  // The Armies are read here rather than passed in, exactly as the two stores above are; `client`
  // and `game` arrive as props, as `RegionNotes` takes them. `status` is deliberately not read:
  // the rail is complete from its first paint (`ah-1mpx.2` S1).
  const armies = useArmiesStore((state) => state.armies);
  const [source, setSource] = useState<UnitSource>(initialSource);
  const [pin, setPin] = useState<FactionPin | null>(initialPin);
  const [mode, dispatch] = useReducer(reduceRail, { kind: "idle" } as RailMode);
  /** The rows picked for a bulk action, beside - never instead of - the cursor row. */
  const [pick, setPick] = useState<UnitPick>(initialPick);
  /** Where the Army menu is anchored, or null when it is closed. */
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  /** The rail entry under the pointer mid-drag, and the Armies that would take nothing. */
  const [drag, setDrag] = useState<DragState | null>(null);
  // The platform's own command modifier and only that one, resolved exactly as `matchShortcut`
  // does it. Read once per render rather than threaded in as a prop, as `AppShell` reads it.
  const isMac = isMacPlatform();
  const canEditArmies = Boolean(client && game);
  const actions = useArmyActions({
    client,
    game,
    currentTurn,
    onFailure: onFailure ?? noop
  });

  // The scroller and header are held as state rather than refs so the effects below re-run when
  // the table is folded away and unfolded, which unmounts and remounts them.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [head, setHead] = useState<HTMLTableSectionElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const refocusWanted = useRef(false);
  // The strip's ✕, so a pin that leaves the table empty has somewhere to put the keyboard.
  const unpinRef = useRef<HTMLButtonElement | null>(null);
  // Set by `showForeignFaction`; spent by the effect below, once the rows it asks for exist.
  const focusFirstWanted = useRef(false);

  const regionId = hex?.regionId ?? null;

  // A filter typed against one list must not survive into another (ah-1t41). The text was typed
  // to find something in a list that has just been replaced, so left standing it narrows a list
  // nobody aimed it at - an Army that reads as empty while the rail beside it says twelve.
  //
  // Adjusted during render rather than in an effect, and that is the point: an effect runs after
  // the commit, so the new list would be painted once through the old filter before being
  // corrected. React re-runs this component before committing instead, so the wrong picture is
  // never drawn. The guard is what makes that legal and what makes it terminate.
  //
  // `listShown` rather than `source` identity: the rail hands back a fresh object every time an
  // Army entry is clicked (`UnitSourceRail.tsx:81`), so identity would clear the box on a
  // re-click of an Army and not on a re-click of This hex. It is also what folds the hex in for
  // This hex alone.
  const shown = listShown(source, regionId);
  const [wasShowing, setWasShowing] = useState(shown);
  if (wasShowing !== shown) {
    setWasShowing(shown);
    setFilter("");
  }

  const armyIds = useMemo(() => armies.map((army) => army.id), [armies]);
  const army = useMemo(
    () => (source.kind === "army" ? (armies.find((one) => one.id === source.armyId) ?? null) : null),
    [armies, source]
  );

  // An Army that was deleted, or a game that closed, must not leave the table pointed at nothing.
  useEffect(() => {
    setSource((current) => sourceStillThere(current, armyIds));
  }, [armyIds]);

  // The pin dies when the source changes and survives everything else - a turn load included,
  // since a pin is a faction *number* and those are stable across turns (round 3, Q1).
  useEffect(() => {
    setPin((current) => pinStillApplies(source, current));
  }, [source]);

  // A sort on a column the new source does not draw is a table in an order nothing explains.
  useEffect(() => {
    setSort((current) => (sortSurvives(current, source) ? current : DEFAULT_SORT));
  }, [source]);

  /**
   * The sort actually applied: one on a hidden column falls back to `DEFAULT_SORT.column`, which
   * is never hideable (ah-20di). Derived per
   * render rather than written back to `sort`, so showing the column again restores the sort it
   * had - and the header that would change it back is off screen while it is hidden.
   */
  const effectiveSort = useMemo(() => sortAfterHiding(sort, columnsShown), [sort, columnsShown]);

  /**
   * `All my units` with the whole report's preview folded in - and **only** when that is the source
   * on screen (`ah-tguk`).
   *
   * The gate is not an optimisation. `ordersPreview` is a fresh object on every one of the shell's
   * 300ms debounce ticks, whether or not the orders changed anything, so folding it unconditionally
   * would put a changing dependency into `sourced` below - and `sourced` rebuilds `This hex`'s rows
   * with `unitsForHex`, a fresh array every call, so every preview tick would rebuild the whole
   * table (`ah-1wcw.1`, and again here). Gated, this answers the very same `ownUnits` array for
   * every other source, and `sourced` does not re-run.
   */
  const ownRows = useMemo(
    () =>
      source.kind === "own"
        ? mergePreviewAcross(ownUnits ?? NO_UNITS, ordersPreview)
        : (ownUnits ?? NO_UNITS),
    [source, ownUnits, ordersPreview]
  );

  /**
   * The rows for the current source, and everything the extra columns need alongside them.
   *
   * `unitsForHex` rather than `hex.region.units`: sorting it again is a no-op because both paths
   * key on the same total order - own units first, then `compareUnitIds` (`ah-26jt`) - and it
   * guarantees the table cannot drift from the order `AppShell` picks defaults from. The orders
   * preview folds in on top, so everything below it - filter and sort - already works over the
   * coming month's rows, arrivals and formed units included.
   *
   * **The preview folds in for both sources that list your own units** (`ah-tguk`): `This hex`
   * merges the selected hex's slice, `All my units` the whole report's - one row per unit, on the
   * hex the report gave it, because `mergePreviewAcross` drops the paired `arriving` row. Neither
   * `Other factions` nor an Army takes any: you write no orders for another faction's units, and an
   * Army is a snapshot whose members may be several turns old.
   */
  const sourced = useMemo((): ArmyRows => {
    if (source.kind === "hex") {
      return { ...NO_ARMY_ROWS, rows: mergePreview(unitsForHex(hex), preview) };
    }
    if (source.kind === "own") {
      return { ...NO_ARMY_ROWS, rows: ownRows };
    }
    if (source.kind === "foreign") {
      // The spread is `ArmyRows.rows` being `ReportUnit[]` where `pinnedRows` answers readonly.
      return { ...NO_ARMY_ROWS, rows: [...pinnedRows(foreignUnits ?? [], pin)] };
    }
    return army ? armyRows(army, unitsById ?? new Map(), currentTurn) : NO_ARMY_ROWS;
  }, [source, hex, preview, ownRows, foreignUnits, pin, army, unitsById, currentTurn]);

  const units = sourced.rows;
  const extras = useMemo(() => extraColumnsFor(source), [source]);
  // The selected hex's structures. A source spanning hexes has no single such list, and a rebuilt
  // Army member has no `structureId` at all, so the Structure column simply reads empty there -
  // which is honest: nobody can see what a remembered unit is standing in.
  const structures = useMemo(() => hex?.region?.structures ?? [], [hex]);
  // Built once per hex, not scanned per row: a hex can hold three hundred units across two dozen
  // structures, and the table re-renders on every scroll frame.
  const structuresById = useMemo(
    () => new Map(structures.map((structure) => [structure.structureId, structure])),
    [structures]
  );
  /** Every row's name by unit number, for a popup naming the unit men came from (`ah-rgkk.2.3`). */
  const unitNames = useMemo(
    // `units`, not the filtered rows: a giver the current filter hides is still named.
    () => new Map(units.map((row) => [row.unitId, row.name])),
    [units]
  );
  // Only asked for when the table sorts on it: every other arrangement would read the document
  // once per unit for an answer nothing compares.
  const longOrders = useMemo(() => {
    if (effectiveSort.column !== "longOrder" || !getLongOrder) {
      return NO_LONG_ORDERS;
    }
    return new Map(
      units
        .filter((entry) => entry.own)
        // Keyed by the row rather than by the unit number, as the silver map beside it is: a
        // source spanning hexes can hold two `new-1`s (`ah-9o0c.2`).
        .map((entry) => [
          unitRowKey(entry.regionId, entry.unitId),
          getLongOrder(entry.unitId, entry.regionId)
        ])
    );
  }, [units, effectiveSort.column, getLongOrder]);
  // Same bargain as `longOrders` above: built only when the table actually sorts on it.
  const silverByUnit = useMemo(() => {
    if (effectiveSort.column !== "silver" || !getSilver) {
      return NO_SILVER;
    }
    return new Map(
      units
        .filter((entry) => entry.own)
        // The row's own hex, not the selected one: `silverKey` keys the forecast by region, so a
        // source spanning hexes must look each row up where it actually stands.
        // A dissolving row prints no month end, so it sorts as having none: a column that
        // printed a dash and sorted on a figure is the defect the dash exists to avoid
        // (`ah-ty3s.3`, decision **S1**).
        .map((entry) => [
          unitRowKey(entry.regionId, entry.unitId),
          dissolves(entry) ? null : silverShown(getSilver(entry.unitId, entry.regionId), countUpkeep)
        ])
    );
  }, [units, effectiveSort.column, getSilver, countUpkeep]);
  const visible = useMemo(
    () =>
      sortUnits(
        filterUnits(units, filter, structures, (unit) => unitSkillsCell(unit, derivedSkills)),
        effectiveSort,
        structures,
        longOrders,
        silverByUnit,
        sourced.seen
      ),
    [units, filter, effectiveSort, structures, longOrders, silverByUnit, sourced.seen, derivedSkills]
  );
  /** The unit numbers the table is drawing, in the order it is drawing them. */
  const rowKeys = useMemo(
    () => visible.map((unit) => unitRowKey(unit.regionId, unit.unitId)),
    [visible]
  );
  const selectedIndex = useMemo(
    () => visible.findIndex((unit) => isCursorRow(cursor, unit.regionId, unit.unitId)),
    [visible, cursor]
  );

  /**
   * Shows one faction's units, for the dossier popover's line into the list.
   *
   * The state stays here and only the action crosses the boundary, as `MapCanvas` puts it: the
   * shell holds a ref, not a copy of the source. Focus cannot be taken here, because the row it
   * wants does not exist until the rows recompute - the effect below spends the request instead.
   */
  const showForeignFaction = useCallback((next: FactionPin) => {
    setSource(FOREIGN_SOURCE);
    setPin(next);
    focusFirstWanted.current = true;
  }, []);
  useImperativeHandle(ref, () => ({ showForeignFaction }), [showForeignFaction]);

  useEffect(() => {
    if (!focusFirstWanted.current) {
      return;
    }
    focusFirstWanted.current = false;
    // The first row *after* sorting and filtering: the row the eye lands on (round 3, Q2). It is
    // also the cursor, so the Unit panel fills in at once.
    const first = visible[0];
    if (first) {
      // Not the player choosing: opening a foreign faction's list lands on its first row, and
      // recording that would make the hex reopen on a foreign unit (`ah-17t5`).
      selectUnit(first.unitId, first.regionId, { remember: false });
      // The existing scroll-into-view-then-focus machinery, not a second focus effect.
      refocusWanted.current = true;
    } else {
      unpinRef.current?.focus();
    }
  }, [visible, selectUnit]);

  // E1: the filter narrows the pick, and so does a turn load - `visible` is rebuilt from the new
  // report, so a picked unit the new turn does not mention is dropped, which needs no case of its
  // own. `narrowedTo` answers with the identical object when nothing was dropped, so this settles
  // in one render.
  useEffect(() => {
    setPick((current) => narrowedTo(current, rowKeys));
  }, [rowKeys]);

  // Round 3, G1: changing the source clears the pick outright. Not merely narrowed - two sources
  // can share rows (every `This hex` row is also an `All my units` row), and a pick that survived
  // the jump would be a pick the player did not make on the list they are now looking at.
  useEffect(() => {
    setPick(NO_PICK);
  }, [source]);

  const { start, end } = windowRange(
    scrollTop,
    viewportHeight,
    rowHeight,
    visible.length,
    OVERSCAN
  );

  /** Usable height for rows: what the scroller shows, less the header sitting over the top of it. */
  const measure = (element: HTMLDivElement, header: HTMLTableSectionElement | null) =>
    Math.max(0, element.clientHeight - (header?.offsetHeight ?? 0));

  useLayoutEffect(() => {
    if (!scroller) {
      return;
    }
    const update = () => {
      setViewportHeight(measure(scroller, head));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller, head]);

  /**
   * Decides where the table is scrolled to, and is the only thing that does.
   *
   * Keeping the selected row on screen and returning to the top are the same question, so they are
   * answered in one place: two effects each assigning scrollTop would race, and which one won would
   * depend on whether the selection happened to move — the table would jump to the top in some
   * rearrangements and follow the selection in others, for no reason a user could see.
   *
   * A selection is followed by the shortest scroll that brings it into view, so a rearrangement
   * that leaves it where it was does not move the table at all. With nothing selected there is
   * nothing to follow, and the top is the only sensible place to be.
   *
   * The dependencies are the values themselves rather than a string built from them: `sort` is
   * state, so it is a fresh object exactly when the ordering changes, and comparing the values
   * directly cannot confuse two arrangements the way a delimited key could.
   */
  useEffect(() => {
    if (!scroller) {
      return;
    }
    const view = measure(scroller, head);
    const furthest = Math.max(0, visible.length * rowHeight - view);
    const from = Math.min(scroller.scrollTop, furthest);
    const top = selectedIndex * rowHeight;

    let next = 0;
    if (selectedIndex >= 0) {
      next = top < from ? top : top + rowHeight > from + view ? top + rowHeight - view : from;
    }
    next = Math.min(Math.max(next, 0), furthest);

    scroller.scrollTop = next;
    // Assigning scrollTop fires its scroll event asynchronously, so the state has to be set here
    // too — otherwise the next render windows from the old offset and the table paints blank.
    setScrollTop(next);
  }, [
    scroller,
    head,
    selectedIndex,
    regionId,
    effectiveSort,
    filter,
    visible.length,
    viewportHeight,
    rowHeight
  ]);

  // Arrowing to a row that was outside the window selects it before it exists, so the focus has to
  // wait for the render that brings it in.
  useEffect(() => {
    if (!refocusWanted.current || !scroller || !cursor) {
      return;
    }
    const row = scroller.querySelector<HTMLElement>(
      unitRowSelector(cursor.regionId, cursor.unitId)
    );
    if (row) {
      refocusWanted.current = false;
      row.focus();
    }
  }, [scroller, cursor, start, end]);

  /**
   * The row the pointer has rested on, and where it rested.
   *
   * The point is taken from the pointer rather than from the row, because a row is the width of
   * the table and its own position says nothing about where the user is looking. It is kept in a
   * ref until the wait is up: following the pointer through state would re-render the table on
   * every mouse move, for a figure only one timeout ever reads.
   */
  const [hovered, setHovered] = useState<{
    key: string;
    column: DrawnColumnId;
    at: Point;
  } | null>(null);

  /**
   * The hovered row as the table currently holds it, or null when the rows no longer have it.
   *
   * The lookup is the whole of the guarantee that a popup cannot outlive its row: a rearrangement
   * that drops the row removes the popup on the next render, and one that merely rebuilds the same
   * rows keeps it and refreshes its figures.
   */
  const hoveredRow = useMemo(() => {
    if (!hovered) {
      return null;
    }
    const unit = visible.find((one) => unitRowKey(one.regionId, one.unitId) === hovered.key);
    return unit ? { unit, column: hovered.column, at: hovered.at } : null;
  }, [hovered, visible]);
  const pointerAt = useRef<Point>({ x: 0, y: 0 });
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The cell the timer is counting for.
   *
   * Without it a hand that is not perfectly still never sees a popup at all: every `pointermove`
   * inside one cell would clear the timer and start it again.
   */
  const pending = useRef<{ unitId: string; regionId: string; column: DrawnColumnId } | null>(null);

  const forgetHover = () => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    pending.current = null;
    setHovered(null);
  };

  const restOn = (unit: PreviewedUnit, column: DrawnColumnId | undefined) => {
    // A spacer row's `colSpan` cell carries no column, and neither does one of the five silent
    // ones - and resting on either closes what is open rather than leaving a stale popup over it.
    if (column === undefined || !columnHasPopup(column)) {
      forgetHover();
      return;
    }

    // Already open on this cell's own row: the popup becomes the new column at once and moves to
    // it, with no second wait (`ah-rgkk.1`, decision **C1**). Reading a row column by column costs
    // one wait, not one per cell.
    const key = unitRowKey(unit.regionId, unit.unitId);
    if (hovered && hovered.key === key) {
      if (hovered.column !== column) {
        setHovered({ key, column, at: pointerAt.current });
      }
      return;
    }

    if (
      pending.current !== null &&
      pending.current.unitId === unit.unitId &&
      pending.current.regionId === unit.regionId &&
      pending.current.column === column
    ) {
      return;
    }

    forgetHover();
    pending.current = { unitId: unit.unitId, regionId: unit.regionId, column };
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      pending.current = null;
      setHovered({ key, column, at: pointerAt.current });
    }, HOVER_DELAY_MS);
  };

  // A row the table no longer holds is forgotten outright, not merely undrawn: a key kept in state
  // would reopen the popup untouched if the row came back (a filter character typed and deleted
  // again), and would short-circuit `restOn`'s C1 branch into opening with no wait at all. This
  // fires only when the row is genuinely gone, so it reintroduces none of the churn the `[visible]`
  // cleanup had.
  useEffect(() => {
    if (hovered && !hoveredRow) {
      setHovered(null);
    }
  }, [hovered, hoveredRow]);

  // Only the timer, and only on unmount: a rearrangement of the rows is no longer a reason to
  // close anything, because `hoveredRow` above cannot name a row that is not there.
  useEffect(
    () => () => {
      if (hoverTimer.current !== null) {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }
    },
    []
  );

  /**
   * What `Enter` in the rail's name field means, in the one place that knows which mode it is in.
   *
   * The reducer has already been driven to `idle` by the same event, so the mode is read here
   * before dispatching - which is why the rail's `onEvent` dispatches and then calls this rather
   * than the other way round.
   */
  const commitName = () => {
    if (mode.kind === "creating") {
      void actions.create(mode.draft, mode.withUnits);
    } else if (mode.kind === "renaming") {
      void actions.rename(mode.armyId, mode.draft);
    }
  };

  // Against the sort on screen rather than the raw state: with a sort on a hidden column the
  // header shows the default column, and reading the raw state would write back what is drawn
  // (ah-20di).
  const sortByColumn = (column: SortColumn) => setSort(nextSort(effectiveSort, column));

  const moveSelection = (to: number, options: { extend?: boolean } = {}) => {
    const target = visible[Math.min(Math.max(to, 0), visible.length - 1)];
    if (!target) {
      return;
    }
    // Shift+Arrow extends the pick from its anchor; a plain arrow collapses it, exactly as a plain
    // click does (`ah-1mpx.4` G1).
    setPick((current) =>
      afterGesture(
        current,
        {
          kind: options.extend ? "extend" : "plain",
          rowKey: unitRowKey(target.regionId, target.unitId)
        },
        rowKeys
      )
    );
    // Arrowing past either end lands on the row already selected. Asking for it again re-renders
    // nothing, so the effect above would never run to spend the focus this arms — it would be left
    // owing, and go to whichever row was selected next, including one chosen with the mouse.
    if (!isCursorRow(cursor, target.regionId, target.unitId)) {
      refocusWanted.current = true;
      selectUnit(target.unitId, target.regionId);
    }
  };

  /** Picks a row alone and puts the cursor on it - what a click, Enter and Space all mean. */
  const settleOn = (pickNext: UnitPick, rowUnitId: string, rowRegionId: string) => {
    setPick(pickNext);
    // The row's own unit and the row's own hex. Since `ah-ty3s.1` a formed row selects itself
    // rather than the unit that wrote its `FORM`, and the hex is what tells two `new-1`s apart -
    // `rules/form` puts a formed unit "in the same region as the unit which formed it".
    selectUnit(rowUnitId, rowRegionId);
  };

  /**
   * Takes the map to a unit's hex, for a list that spans hexes (`ah-y9hx`).
   *
   * Called *after* `settleOn`, never instead of it. `onSelectUnit` is the shell's `goToUnit`, which
   * does nothing at all for a unit this turn's report does not have - a remembered Army member - so
   * a row that cannot be travelled to must already have been selected by the time this runs
   * (decision S1: such a row still highlights, and nothing is said).
   *
   * Deliberately not called from `moveSelection`, from Space, or from a press with a modifier held:
   * walking a list and building a pick must both leave the map alone.
   */
  const travelTo = (unitId: string, regionId: string) => {
    if (travelsOnSelect(source)) {
      // The row's own hex goes with it: a unit this month's `FORM` orders create is not in the
      // report, so `goToUnit` could not look one up, and two hexes can each hold a `new-1`
      // (`ah-9o0c.2`).
      onSelectUnit?.(unitId, regionId);
    }
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    // The unit id button sits inside the row and bubbles its own key events up here.
    if (event.target !== event.currentTarget) {
      return;
    }
    // Only here, on the row's own handler, which is why Ctrl/Cmd+A inside the filter box still
    // selects the filter's text: that input is a different element and this handler never sees its
    // keys. It is deliberately not a shortcut in `shortcuts.ts` for that reason.
    if ((isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setPick((current) => afterGesture(current, { kind: "all" }, rowKeys));
      return;
    }
    // The pick is keyed on the row, the cursor on the unit: two hexes may hold the same number.
    const hereRow = visible[index] ?? null;
    const here = hereRow?.unitId ?? null;
    const hereKey = hereRow ? unitRowKey(hereRow.regionId, hereRow.unitId) : null;
    const chose = (travel: boolean) => {
      if (hereRow === null || here === null || hereKey === null) {
        return;
      }
      // Choosing a row from the keyboard collapses a pick exactly as a plain click does.
      settleOn(afterGesture(pick, { kind: "plain", rowKey: hereKey }, rowKeys), here, hereRow.regionId);
      if (travel) {
        travelTo(here, hereRow.regionId);
      }
    };
    const keys: Record<string, () => void> = {
      ArrowDown: () => moveSelection(index + 1, { extend: event.shiftKey }),
      ArrowUp: () => moveSelection(index - 1, { extend: event.shiftKey }),
      Home: () => moveSelection(0),
      End: () => moveSelection(visible.length - 1),
      /**
       * Escape, which two beads have now given a meaning on a row: `ah-1mpx.4` narrows the pick
       * back to the cursor row (round 3), and `ah-1mpx.5` drops the faction pin. Neither plan
       * anticipated the other, so they are composed by the rule this codebase already keeps for
       * Escape: it means only the topmost thing (`dismissLayer.ts`), never two at once. A standing
       * pick is the more transient of the two, so it goes first and a second press unpins.
       *
       * The cursor row is this row: only the selected row is in the tab order, so only it can have
       * the focus this handler needs. Neither branch changes the source.
       */
      Escape: () => {
        if (pick.ids.size >= 2 && hereKey !== null) {
          setPick(afterGesture(pick, { kind: "plain", rowKey: hereKey }, rowKeys));
          return;
        }
        setPin(null);
      },
      // The table is one tab stop per row with a roving tabIndex, so without this a keyboard
      // player can find a unit in a list spanning hexes and never reach the ground it stands on
      // (`ah-y9hx` K1). It travels whatever the pick is standing at: collapsing to the cursor row
      // and going there is exactly what a plain click does.
      Enter: () => chose(true),
      // Space stays where it was. It is also how a reader stops a list scrolling, so a mis-hit
      // must not move the map - and without this line it scrolls the container out from under the
      // row.
      " ": () => chose(false)
    };
    const handler = keys[event.key];
    if (handler) {
      event.preventDefault();
      handler();
    }
  };

  /** The columns actually drawn, the table's own and the source's, in render order. */
  const drawn = useMemo(() => drawnColumnsFor(visibleOrder, extras), [visibleOrder, extras]);
  /** What the extra columns take, which is what the rest has to be scaled back to leave. */
  const extraShare = extras.reduce((total, column) => total + EXTRA_COLUMN_SHARES[column], 0);
  const drawnShares: ColumnShares = useMemo(
    () => sharesFor(visibleOrder, columnShares, extraShare),
    [visibleOrder, columnShares, extraShare]
  );
  // What one stored share is worth on screen, so a resize or a reorder measures against the table
  // the columns are actually laid out in rather than the whole of it.
  // With a column hidden, `sharesFor` renormalises what is drawn, so a scale of `1 - extraShare`
  // would make every drag overshoot - smoothly enough to read as a feel problem rather than a bug.
  const shareScale = shareScaleFor(visibleOrder, columnShares, extraShare);

  const stale = hex?.knowledge === "stale";
  // A stale hex's count would be a lie the moment it left the model: a hex nobody sees carries no
  // units at all now, so the header names the ground and stops there rather than claiming "0 units"
  // (ah-o86). The amber "as of turn N" chip already says the account is dated.
  const hexHint = hex
    ? stale
      ? `— ${hex.terrain} (${hex.coordinate.x},${hex.coordinate.y})`
      : `— ${hex.terrain} (${hex.coordinate.x},${hex.coordinate.y}), ${units.length} unit${units.length === 1 ? "" : "s"}${visible.length === units.length ? "" : `, ${visible.length} shown`}`
    : undefined;
  const header = headerFor({
    source,
    armyName: army?.name ?? null,
    unitCount: units.length,
    shownCount: visible.length,
    hexHint,
    pin,
    foreignTotal: foreignUnits?.length ?? 0
  });

  const selectedUnit = useMemo(
    () => visible.find((entry) => isCursorRow(cursor, entry.regionId, entry.unitId)) ?? null,
    [visible, cursor]
  );
  /**
   * The rows a bulk action acts on: the pick when it is two or more, the cursor row otherwise.
   *
   * One list for the bulk line, the header's popover and the right-click menu alike, so what a
   * menu says and what is washed can never disagree.
   */
  const acting = useMemo(
    () => (pick.ids.size >= 2 ? pickedIn(pick, visible) : selectedUnit ? [selectedUnit] : []),
    [pick, visible, selectedUnit]
  );
  /** E3: two or more picked is what draws the bulk line and stands the header trigger down. */
  const bulk = pick.ids.size >= 2;

  /**
   * What a press on a row does, before anything is known about whether it becomes a drag.
   *
   * Selection moved from `click` to `pointerdown` here so that a press on a row already in the
   * pick can defer its collapse to a release that never became a drag - otherwise a pick you had
   * just built would fall to one row under your finger the moment you grabbed it (E2).
   */
  const pressRow = (
    event: PointerEvent<HTMLTableRowElement>,
    unit: ReportUnit,
    rowUnitId: string
  ) => {
    if (event.button !== 0) {
      return;
    }
    const modifiers = { shift: event.shiftKey, mod: isMac ? event.metaKey : event.ctrlKey };
    // A modified press writes the pick alone, leaving the cursor and map where they are
    // (`ah-y9hx` P1): a five-unit pick across four hexes would otherwise throw the map four times,
    // and one Shift+click adding ten rows would send it to the last of them.
    const plain = !modifiers.shift && !modifiers.mod;
    const outcome = onPress(pick, unitRowKey(unit.regionId, unit.unitId), modifiers, rowKeys);
    if (outcome.now) {
      if (plain) {
        settleOn(outcome.now, rowUnitId, unit.regionId);
        travelTo(rowUnitId, unit.regionId);
      } else {
        setPick(outcome.now);
      }
    }
    // Mouse only. A row is a scrollable surface on a touch screen, and `touch-none` on it would
    // cost the table its scrolling; `selectionGuard.ts` records that touch is not a platform this
    // application serves. A tap still picks, through `outcome.now` above.
    if (!outcome.draggable || !byMouse(event)) {
      return;
    }
    const deferred = outcome.onRelease;
    // A deferred settle can only follow a plain press - `onPress` returns `onRelease` only after
    // its shift and mod branches have both returned - so it travels unconditionally, and for the
    // same reason a plain press does: a release that never became a drag *is* a plain click.
    beginDrag(
      event,
      unit,
      deferred
        ? () => {
            settleOn(deferred, rowUnitId, unit.regionId);
            travelTo(rowUnitId, unit.regionId);
          }
        : undefined
    );
  };

  /**
   * Carrying rows to the rail, following `ColumnReorderHandle.onPointerDown` step for step - the
   * selection guard, the dismiss layer, window-level listeners and a capture-phase Escape that
   * answers only while it is the top layer.
   *
   * A local function rather than a hook: it closes over the pick, the rows, the Armies and the
   * writes, and threading six things through a hook would buy nothing testable - `packages/shared`
   * cannot press a pointer either way. Only the chip is extracted, because the chip is the part
   * that writes to the DOM and can be pinned without one.
   */
  const beginDrag = (
    event: PointerEvent<HTMLTableRowElement>,
    unit: ReportUnit,
    onSettle?: () => void
  ) => {
    const startX = event.clientX;
    const startY = event.clientY;
    const releaseSelection = guardSelection();
    // Escape must mean "cancel this drag" even under an open dialog's own capture-phase listener.
    const layer = pushDismissLayer();
    let chip: UnitDragChip | null = null;
    let carried: readonly ReportUnit[] = [];
    let over: DropTarget | null = null;

    const move = (moveEvent: globalThis.PointerEvent) => {
      if (!chip) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) {
          return;
        }
        // Resolved once, as the drag begins: a press on a row outside the pick carries that row
        // alone, and a press on one inside it carries the whole pick (E2).
        carried =
          pick.ids.has(unitRowKey(unit.regionId, unit.unitId)) && pick.ids.size >= 2
            ? pickedIn(pick, visible)
            : [unit];
        const carriedIds = carried.map((one) => one.unitId);
        // W2: the count for a pick, the unit's own name for one - `Vanguard`, never `1 unit`.
        chip = createUnitDragChip(
          carried.length > 1 ? `${carried.length} units` : (carried[0]?.name ?? unit.name)
        );
        setDrag({
          units: carried,
          over: null,
          // W3: an Army that would take nothing is no target at all, so the drop refuses before
          // the pointer is released rather than being refused after it.
          full: new Set(
            armies
              .filter((one) => alreadyIn(one, carriedIds) === carriedIds.length)
              .map((one) => one.id)
          )
        });
      }
      chip.moveTo(moveEvent.clientX, moveEvent.clientY);
      const next = dropTargetAt(moveEvent.clientX, moveEvent.clientY);
      // Only when the target actually changes, so a move within one entry re-renders nothing.
      if (!sameTarget(next, over)) {
        over = next;
        setDrag((current) => (current ? { ...current, over: next } : current));
      }
    };

    /** `commit` is false for `pointercancel` and for Escape. Safe to run twice. */
    const end = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelDrag);
      document.removeEventListener("keydown", onEscape, true);
      const dragged = chip !== null;
      chip?.remove();
      chip = null;
      releaseSelection();
      layer();
      setDrag(null);
      if (!dragged) {
        // Below the threshold this was a click after all, so a deferred collapse falls due.
        if (commit) {
          onSettle?.();
        }
        return;
      }
      if (!commit || !over) {
        return;
      }
      if (over.kind === "army") {
        void actions.addUnits(over.armyId, carried);
      } else {
        // D1: the rail's own inline name field opens holding the carried units; they join on
        // Enter and Escape abandons the name and the units together.
        dispatch({ type: "new-clicked", withUnits: carried });
      }
    };

    const up = () => end(true);
    const cancelDrag = () => end(false);
    const onEscape = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key === "Escape" && isTopDismissLayer(layer)) {
        keyEvent.stopPropagation();
        end(false);
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelDrag);
    document.addEventListener("keydown", onEscape, true);
  };

  /**
   * The right-click menu, at the pointer (D4).
   *
   * A row outside the pick is picked alone first, by the same rule the press follows, so what the
   * menu says and what is washed always agree - and a row already inside a pick of two or more
   * leaves it standing, which is what the menu is for. Both fall out of applying `now` and only
   * `now`, exactly as `pressRow` does: `onRelease` is the collapse a *press* defers until it knows
   * it was not a drag, and a right-click never becomes one (Copilot, #764).
   */
  const contextRow = (
    event: ReactMouseEvent<HTMLTableRowElement>,
    unit: ReportUnit,
    rowUnitId: string
  ) => {
    event.preventDefault();
    const outcome = onPress(
      pick,
      unitRowKey(unit.regionId, unit.unitId),
      { shift: false, mod: false },
      rowKeys
    );
    if (outcome.now) {
      settleOn(outcome.now, rowUnitId, unit.regionId);
    }
    setMenu({ at: "pointer", point: { x: event.clientX, y: event.clientY } });
  };

  const missing = staleLine(sourced.missing);
  const foreignEmpty =
    source.kind === "foreign"
      ? foreignEmptyLine({
          hasReport: currentTurn !== null,
          total: foreignUnits?.length ?? 0,
          pinned: units.length,
          shown: visible.length,
          pin
        })
      : null;
  const nothingToSay = emptyLine({
    source,
    hex,
    stale,
    armyName: army?.name ?? null,
    hasReport: currentTurn !== null,
    foreign: foreignEmpty?.text ?? null
  });

  return (
    <CollapsiblePanel
      panel="units"
      title={header.title}
      hint={header.hint}
      // The amber "as of turn N" chip is about a stale *hex*. An Army spanning five hexes has no
      // single such turn, and the Seen column carries that per unit instead.
      asOf={
        source.kind === "hex" && stale && hex.lastSeenTurn !== null
          ? `as of turn ${hex.lastSeenTurn}`
          : null
      }
      actions={
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="filter units…"
            aria-label="Filter units"
            className="w-44 rounded border border-edge bg-ground px-2 py-0.5 text-pane text-ink placeholder:text-ink-dim focus:border-select focus:outline-none"
          />
          {canEditArmies ? (
            <ChipPopover
              open={menu?.at === "header" && selectedUnit !== null}
              onDismiss={() => setMenu(null)}
              panel={
                selectedUnit ? (
                  <AddToArmyMenu
                    units={[selectedUnit]}
                    armies={armies}
                    onAdd={(armyId) => void actions.addUnit(armyId, selectedUnit)}
                    // U2: this drops into the rail's own inline editor, carrying the unit, rather
                    // than opening a second name field of its own.
                    onNewArmy={() => dispatch({ type: "new-clicked", withUnits: [selectedUnit] })}
                    onDismiss={() => setMenu(null)}
                  />
                ) : null
              }
            >
              <button
                type="button"
                data-testid="add-to-army"
                // Never hidden, only disabled: an unavailable item that is simply absent reads as
                // a feature the application does not have (`ExportMenu.tsx:20-22`). A report
                // naming no turn has no `seenTurn` to stamp a snapshot with, so there is nothing
                // to add a unit as.
                // E3: exactly one live way in at any moment - the bulk line's own trigger is the
                // way in while two or more rows are picked.
                disabled={selectedUnit === null || currentTurn === null || bulk}
                onClick={() => setMenu((open) => (open?.at === "header" ? null : { at: "header" }))}
                className="rounded border border-edge px-2 py-0.5 text-pane text-brass hover:bg-panel disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Add to army ▾
              </button>
            </ChipPopover>
          ) : null}
        </div>
      }
    >
      <div className="flex h-full min-h-0">
        <UnitSourceRail
          source={source}
          onSource={setSource}
          armies={armies}
          hexCount={hex ? unitsForHex(hex).length : null}
          ownCount={ownUnits?.length ?? 0}
          foreignCount={foreignUnits?.length ?? 0}
          mode={mode}
          onEvent={(event) => {
            dispatch(event);
            if (event.type === "committed") {
              commitName();
            }
          }}
          canEdit={canEditArmies}
          dropOver={drag?.over ?? null}
          dropFull={drag?.full}
          dragging={drag !== null}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {army ? (
            <ArmyStrip
              name={army.name}
              memberCount={army.members.length}
              confirming={mode.kind === "deleting" && mode.armyId === army.id}
              canExport={currentTurn !== null && onExportArmy !== undefined}
              onExport={() => onExportArmy?.(army.id)}
              onRename={() => dispatch({ type: "rename-clicked", armyId: army.id, name: army.name })}
              onDelete={() => dispatch({ type: "delete-clicked", armyId: army.id })}
              onCancelDelete={() => dispatch({ type: "delete-cancelled" })}
              onConfirmDelete={() => {
                void actions.remove(army.id);
                dispatch({ type: "deleted" });
              }}
            />
          ) : null}
          {source.kind === "foreign" && pin ? (
            <ForeignStrip
              pin={pin}
              attitude={pin.kind === "hidden" ? null : attitudeToward(attitudes, pin.factionId)}
              onClear={() => setPin(null)}
              buttonRef={unpinRef}
            />
          ) : null}
          {army && missing ? (
            <p
              data-testid="army-stale-line"
              className="flex items-center border-y border-edge-soft px-2 py-1.5 text-pane text-warn"
            >
              {missing.text}
              {/* No confirmation: the rows are on screen and named, and removing a unit from an
                  Army destroys nothing - the unit is untouched and can be added back from any
                  list (`ah-1mpx.2` S5). */}
              <button
                type="button"
                data-testid="army-remove-stale"
                onClick={() =>
                  void actions.removeUnits(
                    army.id,
                    army.members
                      .filter((member) => !(unitsById ?? new Map()).has(member.unitId))
                      .map((member) => member.unitId)
                  )
                }
                className="ml-2 rounded border border-edge px-2 py-0.5 text-pane text-ink hover:bg-panel focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
              >
                {missing.button}
              </button>
            </p>
          ) : null}
          {/* D2/D3: one home for every bulk action, on every source and not only inside an Army,
              and the only place a keyboard reaches one. */}
          {bulk ? (
            <UnitBulkLine
              count={pick.ids.size}
              armyName={army?.name ?? null}
              addTrigger={
                canEditArmies ? (
                  <ChipPopover
                    open={menu?.at === "bulk"}
                    onDismiss={() => setMenu(null)}
                    panel={
                      <AddToArmyMenu
                        units={acting}
                        armies={armies}
                        onAdd={(armyId) => void actions.addUnits(armyId, acting)}
                        onNewArmy={() => dispatch({ type: "new-clicked", withUnits: acting })}
                        onDismiss={() => setMenu(null)}
                      />
                    }
                  >
                    <button
                      type="button"
                      data-testid="bulk-add"
                      // A report naming no turn has no `seenTurn` to stamp a snapshot with, so
                      // there is nothing to add these rows as - the same guard the header carries.
                      disabled={currentTurn === null}
                      onClick={() =>
                        setMenu((open) => (open?.at === "bulk" ? null : { at: "bulk" }))
                      }
                      className="rounded border border-edge px-2 py-0.5 text-pane text-brass hover:bg-panel disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      Add to army…
                    </button>
                  </ChipPopover>
                ) : null
              }
              onRemove={() => {
                if (army) {
                  // An Army stores **unit ids**, while the pick is keyed on `(regionId, unitId)`
                  // (`ah-9o0c.2`): pass the rows' own unit ids, never the pick's keys.
                  void actions.removeUnits(
                    army.id,
                    acting.map((one) => one.unitId)
                  );
                }
              }}
              onClear={() => setPick(NO_PICK)}
            />
          ) : null}
      {units.length === 0 ? (
        <Absent>
          {nothingToSay}
          {foreignEmpty?.showAll ? (
            <button
              type="button"
              data-testid="foreign-show-all"
              onClick={() => setPin(null)}
              className="ml-2 rounded border border-edge px-2 py-0.5 text-pane text-ink hover:bg-panel focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass"
            >
              {foreignEmpty.showAll}
            </button>
          ) : null}
        </Absent>
      ) : visible.length === 0 ? (
        <Absent>{foreignEmpty?.text ?? "No unit matches that filter."}</Absent>
      ) : (
        <div
          ref={setScroller}
          onScroll={(event) => {
            // The rows slide out from under the pointer, so whatever is being pointed at is not
            // what the tooltip was opened for.
            forgetHover();
            setScrollTop(event.currentTarget.scrollTop);
          }}
          onPointerLeave={forgetHover}
          // The vertical bar is always reserved: letting it come and go as the window changes
          // would resize the table, which would remeasure the viewport, which would change the
          // window again. The scroller carries no height of its own now - it fills the slot the
          // shell gives the panel (ah-2r3), which is what the panel itself fills too.
          className="h-full overflow-y-scroll overflow-x-hidden"
        >
          {/*
            A positioned wrapper so a reorder can draw its drop line and its chip over the table
            without taking part in its layout. It is a sibling of the `<table>`, never a child of
            `<thead>`: a positioned element inside a `table-fixed` header is at the mercy of table
            layout, and every row must stay exactly `rowHeightAt(interfaceSize)` tall or the
            windowing misaligns (ah-1owr.3).
          */}
          <div className="relative">
            <div
              ref={overlayRef}
              data-testid="column-drag-overlay"
              aria-hidden
              // Without this the drop line eats the `pointerup` that ends the drag.
              className="pointer-events-none absolute inset-0 z-20"
            />
          <table
            // A grid rather than a plain table: rows here are selectable, and a screen reader only
            // treats a row as something you can land on and choose inside a grid.
            role="grid"
            // In a grid `aria-selected` is the selection and focus is the cursor, so several rows
            // may carry it at once - which is exactly what a pick is.
            aria-multiselectable={true}
            // Fixed layout, because auto layout measures only the rendered rows and the columns
            // would jump as you scrolled. It also makes the truncation on Skills and Items real.
            //
            // Separated borders, because a sticky header loses its rule under border-collapse in
            // Chrome: a collapsed border belongs to the table, so it does not travel with the cell.
            ref={tableRef}
            className="w-full table-fixed border-separate border-spacing-0 tabular-nums"
            aria-rowcount={visible.length + 1}
          >
            {/*
              Percentages, never pixels: the table is `w-full table-fixed` inside a scroller that
              hides horizontal overflow, so a pixel total larger than the box lays the rightmost
              columns out past the right edge with nothing to scroll them back (ah-1owr.2).
            */}
            <colgroup>
              {drawn.map((entry) =>
                entry.kind === "unit" ? (
                  <col
                    key={entry.column}
                    ref={(element) => {
                      colRefs.current[entry.column as UnitColumn] = element;
                    }}
                    style={columnWidthStyle(entry.column, drawnShares)}
                  />
                ) : (
                  // Fixed: these columns are neither dragged nor reordered nor stored, so a stored
                  // width for one that is absent in most views would mean nothing.
                  <col
                    key={`extra-${entry.column}`}
                    style={{ width: `${EXTRA_COLUMN_SHARES[entry.column] * 100}%` }}
                  />
                )
              )}
            </colgroup>
            <thead ref={setHead}>
              {/* Indexed like the rows below it: if some rows carry a position, all of them must. */}
              <tr aria-rowindex={1} className="text-pane-sm uppercase tracking-[0.06em] text-ink-soft">
                {drawn.map((entry) => {
                  if (entry.kind === "extra") {
                    return (
                      <ExtraTh
                        key={`extra-${entry.column}`}
                        column={entry.column}
                        sort={effectiveSort}
                        onSort={sortByColumn}
                      />
                    );
                  }
                  const column = entry.column;
                  const index = visibleOrder.indexOf(column);
                  return (
                    <ColumnHeaderCell
                      key={column}
                      column={column}
                      sort={effectiveSort}
                      onSort={sortByColumn}
                      onToggleGroupOwn={() =>
                        setSort((current) => ({ ...current, groupOwnFirst: !current.groupOwnFirst }))
                      }
                      // The last column has no boundary to its right, so it carries no handle - and
                      // neither does `own`, whose 24px is narrower than the grip's own hit area:
                      // a handle there would sit on top of the group-own-units toggle and swallow
                      // its clicks. It is a fixed marker column, not one anybody resizes.
                      splitter={
                        column !== "own" && index < visibleOrder.length - 1 ? (
                          <ColumnSplitter
                            left={column}
                            right={visibleOrder[index + 1]}
                            columns={colRefs}
                            table={tableRef}
                            shares={columnShares}
                            scale={shareScale}
                            onCommit={setColumnShares}
                          />
                        ) : null
                      }
                      // The marker column never moves, so it carries no grip: 24px has no room for
                      // one, and the leftmost spot is where a marker belongs anyway.
                      reorder={
                        column !== "own" ? (
                          <ColumnReorderHandle
                            column={column}
                            order={visibleOrder}
                            shares={columnShares}
                            scale={shareScale}
                            table={tableRef}
                            overlay={overlayRef}
                            // A drag can only travel across columns the player can see; a hidden
                            // column keeps the array index it had in the stored order.
                            onCommit={(next) => setColumnOrder(mergeShownOrder(order, next))}
                          />
                        ) : null
                      }
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <Spacer rows={start} rowHeight={rowHeight} columns={drawn.length} />
              {visible.slice(start, end).map((unit, offset) => (
                <UnitRow
                  key={unitRowKey(unit.regionId, unit.unitId)}
                  unit={unit}
                  structureLabel={unitStructureLabel(unit.structureId, structuresById)}
                  reportedStructureLabel={reportedStructureLabelFor(unit, structuresById)}
                  drawn={drawn}
                  index={start + offset}
                  rowHeight={rowHeight}
                  selected={isCursorRow(cursor, unit.regionId, unit.unitId)}
                  picked={pick.ids.has(unitRowKey(unit.regionId, unit.unitId))}
                  onSelect={selectUnit}
                  onPress={pressRow}
                  onContextMenu={contextRow}
                  // The row's own hex, not the selected one: `silverKey` keys the forecast by
                  // region, so a source spanning hexes must look each row up where it stands.
                  regionId={unit.regionId}
                  seen={seenLabel(sourced.seen.get(unit.unitId), currentTurn)}
                  fromReport={source.kind !== "army" || (unitsById?.has(unit.unitId) ?? false)}
                  dimDeparting={dimsDeparting(source)}
                  onRemove={army ? () => void actions.removeUnit(army.id, unit.unitId) : undefined}
                  getLongOrder={getLongOrder}
                  getReportedLongOrder={getReportedLongOrder}
                  getSilver={getSilver}
                  silverWarnings={silverWarnings}
                  countUpkeep={countUpkeep}
                  derivedSkills={derivedSkills}
                  unitNames={unitNames}
                  onSelectUnit={onSelectUnit}
                  renderFactionName={renderFactionName}
                  onPinFaction={source.kind === "foreign" ? setPin : undefined}
                  onKeyDown={onRowKeyDown}
                  onPointerRest={restOn}
                  onPointerAt={(point) => {
                    pointerAt.current = point;
                  }}
                  onPointerGone={forgetHover}
                />
              ))}
              <Spacer rows={visible.length - end} rowHeight={rowHeight} columns={drawn.length} />
            </tbody>
          </table>
          </div>
          {/* Which of the two panels opens is the resolver's answer, not this component's, so
              the popup and the cell's own hidden sentence can never disagree (`ah-rgkk.1`). */}
          <HoveredPopup
            hovered={hoveredRow}
            getSilver={getSilver}
            getLongOrder={getLongOrder}
            getReportedLongOrder={getReportedLongOrder}
            silverWarnings={silverWarnings}
            countUpkeep={countUpkeep}
            derivedSkills={derivedSkills}
            structuresById={structuresById}
            unitNames={unitNames}
          />
        </div>
      )}
          {/* D4: the same list the button opens, at the pointer. The three conditions are the ones
              that already disable the header trigger - a right-click with no game open, or on a
              report naming no turn, opens nothing. */}
          {menu?.at === "pointer" && acting.length > 0 && canEditArmies && currentTurn !== null ? (
            <UnitContextMenu
              at={menu.point}
              units={acting}
              armies={armies}
              onAdd={(armyId) => void actions.addUnits(armyId, acting)}
              onNewArmy={() => dispatch({ type: "new-clicked", withUnits: acting })}
              onDismiss={() => setMenu(null)}
            />
          ) : null}
        </div>
      </div>
    </CollapsiblePanel>
  );
});

/**
 * What the Hex column shows: the hex's coordinates, out of the `z:x,y` a region id is.
 *
 * The level is left off - the column is 79px, and a source spanning hexes almost always spans one
 * level. A region id in an unexpected shape is printed as it stands rather than guessed at.
 */
function hexLabel(regionId: string): string {
  const [, coordinate] = regionId.split(":");
  return coordinate === undefined ? regionId : `(${coordinate})`;
}

/** Whether an event came from a mouse, as opposed to a finger or a pen held against the screen. */
const byMouse = (event: PointerEvent<HTMLElement>) => event.pointerType === "mouse";

/**
 * Where the `Add to army` list is anchored, or null when it is closed.
 *
 * The dock's own bookkeeping, exported by nobody. Three anchors and one state, because E3 allows
 * exactly one live way in at any moment.
 */
type MenuAnchor = { at: "header" } | { at: "bulk" } | { at: "pointer"; point: Point };

/**
 * The structure this month's orders moved a unit **out of**, labelled by the same helper and from
 * the same map as the side it moved into, so the two can never be named differently
 * (`ah-rgkk.5.3`). An empty original is the report saying "in no structure", which is a `null` id
 * and not a structure called "" - the same guard `markOrQuote` keeps against `Number("")`.
 */
function reportedStructureLabelFor(
  unit: PreviewedUnit,
  structuresById: ReadonlyMap<string, StructureInfo>
): string | null {
  const change = changeFor(unit, "structureId");
  if (!change) {
    return null;
  }
  const id = change.original.trim() === "" ? null : change.original;
  return unitStructureLabel(id, structuresById);
}

/** Which rail entry a drag may be dropped on. */
type DropTarget = { kind: "army"; armyId: string } | { kind: "new" };

/** The drag in flight: what it carries, what it is over, and what would refuse it. */
type DragState = {
  /** The rows being carried, resolved once when the drag begins. */
  units: readonly ReportUnit[];
  over: DropTarget | null;
  full: ReadonlySet<string>;
};

/**
 * How far the pointer must travel before a press becomes a drag.
 *
 * `ColumnReorderHandle` needs no threshold because it lives on a dedicated grip; a row is also a
 * click target, so without this every click would be a one-pixel drag.
 */
const DRAG_THRESHOLD_PX = 4;

const sameTarget = (left: DropTarget | null, right: DropTarget | null) =>
  left === right ||
  (left?.kind === "army" && right?.kind === "army" && left.armyId === right.armyId) ||
  (left?.kind === "new" && right?.kind === "new");

/** The rail entry under the pointer, found by attribute rather than by measuring the rail. */
function dropTargetAt(clientX: number, clientY: number): DropTarget | null {
  const node = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>("[data-drop-army],[data-drop-new]");
  if (!node) {
    return null;
  }
  const armyId = node.dataset.dropArmy;
  return armyId ? { kind: "army", armyId } : { kind: "new" };
}

/** Stands in for the rows above or below the window, so the scrollbar reflects the whole list. */
function Spacer({
  rows,
  rowHeight,
  columns
}: {
  rows: number;
  rowHeight: number;
  /** Every drawn column, the source's included: a short spacer would leave a gap on the right. */
  columns: number;
}) {
  if (rows <= 0) {
    return null;
  }
  const height = rows * rowHeight;
  // A row with no cell in it is not reliably given a height, so the height goes on both.
  return (
    <tr aria-hidden style={{ height }}>
      <td colSpan={columns} className="border-0 p-0" style={{ height }} />
    </tr>
  );
}

/**
 * A header cell for a column the source added.
 *
 * `Seen` sorts; `Hex` does not - a hex is where a unit stands, and ordering a list of five hexes
 * by their coordinates puts nothing useful together (round 3). The trailing action column has no
 * label at all: it is a place for a button, not a heading.
 */
function ExtraTh({
  column,
  sort,
  onSort
}: {
  column: ExtraColumn;
  sort: SortState;
  onSort: (column: SortColumn) => void;
}) {
  if (column === "seen") {
    return (
      <SortableTh label={EXTRA_COLUMN_LABELS.seen} column="seen" sort={sort} onSort={onSort} />
    );
  }
  return <Th>{EXTRA_COLUMN_LABELS[column]}</Th>;
}

/**
 * The strip above the table while an Army is the source: its name, `Export…`, `Rename` and
 * `Delete`.
 *
 * `Export…` comes first of the three: it is the primary action, and putting it before the
 * destructive one keeps `Delete` last, where the strip already trained the eye to find it. Never
 * hidden, only disabled - the policy this dock states for `Add to army`.
 */
function ArmyStrip({
  name,
  memberCount,
  confirming,
  canExport,
  onExport,
  onRename,
  onDelete,
  onCancelDelete,
  onConfirmDelete
}: {
  name: string;
  memberCount: number;
  confirming: boolean;
  /** False when the report names no turn: there is then no way to tell fresh from remembered. */
  canExport: boolean;
  /** Opens the export dialog for this Army. */
  onExport: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const button =
    "rounded border border-edge px-2 py-0.5 text-pane text-ink hover:bg-panel focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass";
  const danger =
    "rounded border border-danger/60 px-2 py-0.5 text-pane text-danger hover:bg-panel focus-visible:outline focus-visible:outline-1 focus-visible:outline-danger";
  const primary =
    "rounded border border-brass px-2 py-0.5 text-pane text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim";

  return (
    <div
      data-testid="army-strip"
      className="flex items-center gap-2 border-b border-edge px-2 py-1.5 text-pane text-ink"
    >
      {confirming ? (
        <>
          <span data-testid="army-delete-confirm">
            Delete {name}? The {memberCount} units in it are not affected.
          </span>
          <span className="ml-auto" />
          <button type="button" data-testid="army-delete-yes" onClick={onConfirmDelete} className={danger}>
            Delete
          </button>
          <button type="button" data-testid="army-delete-no" onClick={onCancelDelete} className={button}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <b className="font-medium text-brass-bright">{name}</b>
          <span className="ml-auto" />
          <button
            type="button"
            data-testid="army-export"
            disabled={!canExport}
            onClick={onExport}
            className={primary}
          >
            Export…
          </button>
          <button type="button" data-testid="army-rename" onClick={onRename} className={button}>
            Rename
          </button>
          <button type="button" data-testid="army-delete" onClick={onDelete} className={danger}>
            Delete
          </button>
        </>
      )}
    </div>
  );
}

/**
 * What the pane says when there is nothing to list.
 *
 * The two degenerate lines for the new sources are written to the pattern the dock already ships
 * for a hex; the empty-Army pair is worded so it stays true once `ah-1mpx.4` adds dragging (S3).
 */
function emptyLine(args: {
  source: UnitSource;
  hex: HexNode | null;
  stale: boolean;
  armyName: string | null;
  hasReport: boolean;
  /** `foreignEmptyLine`'s sentence for the `Other factions` source; every word of it is its rule. */
  foreign?: string | null;
}): ReactNode {
  if (args.source.kind === "hex") {
    return args.hex
      ? args.stale
        ? `Not seen since turn ${args.hex.lastSeenTurn} — no current unit information.`
        : "No units reported in this hex."
      : "No hex selected.";
  }
  if (!args.hasReport) {
    return "No report loaded.";
  }
  if (args.source.kind === "own") {
    return "No units of your own in this turn's report.";
  }
  if (args.source.kind === "foreign") {
    return args.foreign;
  }
  return (
    <>
      <b className="mb-1 block text-ink-soft">{args.armyName} has no units yet.</b>
      <span className="text-pane-sm">
        Add units to it with <span className="text-brass-bright">Add to army</span>, on any unit in
        any list.
      </span>
    </>
  );
}

/**
 * Dispatches one column to the header cell it needs: the "own" toggle button, a sortable column,
 * or a plain label. The one place that knows all three shapes, so the header row can just map over
 * the column list without caring which kind each entry turns out to be.
 */
function ColumnHeaderCell({
  column,
  sort,
  onSort,
  onToggleGroupOwn,
  splitter,
  reorder
}: {
  column: UnitColumn;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  onToggleGroupOwn: () => void;
  /** The resize handle for this column's boundary with the next, or null for the last column. */
  splitter: ReactNode;
  /** The drag-to-reorder grip, or null for the marker column, which never moves. */
  reorder: ReactNode;
}) {
  if (column === "own") {
    return (
      <Th splitter={splitter} reorder={reorder}>
        <button
          type="button"
          onClick={onToggleGroupOwn}
          aria-pressed={sort.groupOwnFirst}
          aria-label="Group own units first"
          className={`w-full text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass ${
            sort.groupOwnFirst ? "text-ok" : "text-ink-dim"
          }`}
        >
          *
        </button>
      </Th>
    );
  }
  if (SORTABLE_COLUMNS.has(column)) {
    return (
      <SortableTh
        label={COLUMN_LABELS[column] ?? column}
        column={column as SortColumn}
        sort={sort}
        onSort={onSort}
        splitter={splitter}
        reorder={reorder}
      />
    );
  }
  // Skills and Items are comma-joined summaries; ordering them alphabetically would sort on the
  // first skill that happened to be listed, so neither carries a sort - just a label.
  return (
    <Th splitter={splitter} reorder={reorder}>
      {COLUMN_LABELS[column] ?? column}
    </Th>
  );
}

function Th({
  children,
  splitter,
  reorder
}: {
  children?: ReactNode;
  splitter?: ReactNode;
  reorder?: ReactNode;
}) {
  return (
    // The background is opaque and sits on the cells rather than the row: the panel behind is
    // translucent over the map, and a see-through header would show the rows sliding under it.
    //
    // `relative` so the resize handle can be absolutely positioned over the boundary without
    // taking part in the cell's layout - a handle in the flow would change the header's height,
    // which the row-height arithmetic assumes is fixed.
    <th className="relative sticky top-0 z-10 border-b border-edge bg-panel px-2 py-1 text-left font-medium">
      {/*
        The reorder grip leads the label and the resize handle sits on the trailing edge, so a
        press is never ambiguous about which of the two gestures it meant (ah-1owr.3).
      */}
      <div className="flex items-center gap-1">
        {reorder}
        <span className="min-w-0 flex-1 truncate">{children}</span>
      </div>
      {splitter}
    </th>
  );
}

function SortableTh({
  label,
  column,
  sort,
  onSort,
  splitter,
  reorder
}: {
  label: string;
  column: SortColumn;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  splitter?: ReactNode;
  reorder?: ReactNode;
}) {
  const active = sort.column === column;
  return (
    <th
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className="relative sticky top-0 z-10 border-b border-edge bg-panel px-2 py-1 text-left font-medium"
    >
      {/* Grip, then the sort button - the same leading-edge placement every header uses. */}
      <div className="flex items-center gap-1">
        {reorder}
        <button
          type="button"
          onClick={() => onSort(column)}
          className={`flex min-w-0 flex-1 items-center gap-1 uppercase tracking-[0.06em] focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass ${
            active ? "text-brass" : ""
          }`}
        >
          <span className="min-w-0 truncate">{label}</span>
          <span aria-hidden className={active ? "text-brass" : "text-ink-dim"}>
            {active ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </div>
      {splitter}
    </th>
  );
}

/**
 * The one panel a rested-on cell opens: the whole-unit summary, or that column's own popup.
 *
 * A component rather than a branch inside the dock's JSX because it is the only place the
 * resolver's three answers are turned into what is drawn, and because the facts it needs are the
 * ones the row already had — read here from the dock's own scope rather than carried up through
 * state, so nothing has to be kept in step with the pointer.
 */
function HoveredPopup({
  hovered,
  getSilver,
  getLongOrder,
  getReportedLongOrder,
  silverWarnings,
  countUpkeep,
  derivedSkills,
  structuresById,
  unitNames
}: {
  hovered: { unit: PreviewedUnit; column: DrawnColumnId; at: Point } | null;
  getSilver?: (unitId: string, regionId: string) => UnitSilver | null;
  getLongOrder?: (unitId: string, regionId: string) => string | null;
  /** What the report's orders template said this unit's long order was (`ah-rgkk.5.4`). */
  getReportedLongOrder?: (unitId: string) => ReportedLongOrder;
  silverWarnings?: ReadonlySet<string>;
  countUpkeep: boolean;
  derivedSkills: DerivedSkills;
  structuresById: ReadonlyMap<string, StructureInfo>;
  /** Every row's name by unit number, for a Skills popup naming a giver (`ah-rgkk.2.3`). */
  unitNames: ReadonlyMap<string, string>;
}) {
  if (!hovered) {
    return null;
  }

  const { unit, column, at } = hovered;
  const silver = unit.own ? (getSilver?.(unit.unitId, unit.regionId) ?? null) : null;
  // The same guard the row uses (`warned`, below): a finding that names a unit with no forecast
  // has no working to explain, and without this the popup and the cell's own hidden sentence
  // would be drawn from different arguments to `summariseUnit`.
  const warned =
    silver !== null && (silverWarnings?.has(silverKey(unit.regionId, unit.unitId)) ?? false);
  const dissolving = dissolves(unit);
  const spec = popupForCell(column, unit, {
    structureLabel: unitStructureLabel(unit.structureId, structuresById),
    reportedStructureLabel: reportedStructureLabelFor(unit, structuresById),
    longOrder: unit.own ? (getLongOrder?.(unit.unitId, unit.regionId) ?? null) : null,
    reportedLongOrder: getReportedLongOrder?.(unit.unitId) ?? NO_ORDERS_TEMPLATE,
    silver,
    silverWarned: warned,
    countUpkeep,
    derivedSkills: derivedSkillsFor(derivedSkills, unit),
    dissolving,
    unitNames
  });

  if (spec.kind === "unit") {
    return (
      <UnitTooltip
        unit={unit}
        at={at}
        silver={silver}
        warned={warned}
        derivedSkills={derivedSkillsFor(derivedSkills, unit)}
        dissolving={dissolving ? { into: unit.dissolvesInto ?? null } : null}
      />
    );
  }

  // `silent` cannot be reached: `restOn` refuses to open a popup for a column that has none.
  if (spec.kind === "silent") {
    return null;
  }

  return (
    <UnitCellPopup
      popup={spec.popup}
      column={column}
      at={at}
      anchorKey={`${unit.regionId}/${unit.unitId}/${column}`}
    />
  );
}

/**
 * The columns whose cells carry their own explanation: every one but the five silent ones and the
 * two that open the whole-unit summary, which has no `ColumnPopup` to write out (`name` keeps its
 * own `was: …` span instead).
 *
 * Derived from the resolver rather than written out, so a column added to the table cannot quietly
 * lose its explanation by being forgotten in a second list.
 */
const EXPLAINED_COLUMNS: readonly DrawnColumnId[] = [
  ...UNIT_COLUMNS,
  ...(Object.keys(EXTRA_COLUMN_SHARES) as ExtraColumn[])
].filter(columnHasOwnPopup);

/** How a changed cell says it shows the coming month rather than the report. */
const PREDICTED = "italic text-brass";

function UnitRow({
  unit,
  structureLabel,
  reportedStructureLabel,
  drawn,
  index,
  rowHeight,
  selected,
  picked,
  onSelect,
  onPress,
  onContextMenu,
  regionId,
  onKeyDown,
  onPointerRest,
  onPointerAt,
  onPointerGone,
  getLongOrder,
  getReportedLongOrder,
  getSilver,
  silverWarnings,
  countUpkeep,
  onSelectUnit,
  renderFactionName,
  onPinFaction,
  seen,
  fromReport,
  dimDeparting,
  onRemove,
  derivedSkills,
  unitNames
}: {
  unit: PreviewedUnit;
  /** The columns the header is drawing, so a row's cells can never fall out of step with it. */
  drawn: readonly DrawnColumn[];
  /**
   * The structure this unit stands in — its full label, or a bare `[id]` when the region never
   * described it — and null when the unit stands in the open.
   */
  structureLabel: string | null;
  /** The structure the unit's orders moved it out of, for the Structure popup (`ah-rgkk.5.3`). */
  reportedStructureLabel: string | null;
  index: number;
  rowHeight: number;
  selected: boolean;
  /** In the pick - the wider, bulk-action selection that sits beside the cursor (`ah-1mpx.4`). */
  picked: boolean;
  /**
   * Highlights a unit. Called with the formed unit's own id, or, for a formed row, its parent's
   * (`ah-jw85`) - `UnitRow` decides which, since only it knows a formed row from an ordinary one.
   *
   * Takes the row's own hex too, because a unit number is not unique across a report (`ah-bubf`) -
   * and it is the row's hex even for a formed row: `rules/form` puts a formed unit "in the same
   * region as the unit which formed it".
   */
  onSelect: (unitId: string, regionId: string) => void;
  /**
   * A press on the row, which is where selection now happens - `onClick` would be too late for a
   * press that may become a drag. Handed the row's own unit and the id the cursor should land on -
   * since `ah-ty3s.1` those are the same id for every row, a formed one included, but the two
   * arguments are kept apart because the cursor's id is the row's business and not the caller's.
   */
  onPress: (
    event: PointerEvent<HTMLTableRowElement>,
    unit: ReportUnit,
    rowUnitId: string
  ) => void;
  /** A right-click on the row: the Army menu, at the pointer. */
  onContextMenu: (
    event: ReactMouseEvent<HTMLTableRowElement>,
    unit: ReportUnit,
    rowUnitId: string
  ) => void;
  /** The hex this row stands in, so its silver forecast is looked up by the right key. */
  regionId: string;
  onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>, index: number) => void;
  /**
   * The pointer is over this cell of this row: start counting towards its popup, swap an open one
   * to it, or close what is open where the column says nothing.
   */
  onPointerRest: (unit: PreviewedUnit, column: DrawnColumnId | undefined) => void;
  /** Where the pointer is now, so the summary opens where the user stopped looking. */
  onPointerAt: (point: Point) => void;
  onPointerGone: () => void;
  /** The month-long order this unit's live orders carry, where it is one of ours. */
  getLongOrder?: (unitId: string, regionId: string) => string | null;
  /** What the report's orders template said this unit's long order was (`ah-rgkk.5.4`). */
  getReportedLongOrder?: (unitId: string) => ReportedLongOrder;
  /** This unit's silver forecast, where it is one of ours. `ah-1wcw.1`. */
  getSilver?: (unitId: string, regionId: string) => UnitSilver | null;
  /** The unit-anchored `not-enough-silver` findings, by unit id. */
  silverWarnings?: ReadonlySet<string>;
  /** Whether the Silver column charges each unit its monthly maintenance (`ah-1wcw.4`). */
  countUpkeep: boolean;
  /** Selects a unit and opens its orders. */
  onSelectUnit?: (unitId: string, regionId?: string) => void;
  /** Wraps a foreign faction's name so it can open that faction's dossier (ah-bu2c). */
  renderFactionName?: (factionId: string, label: ReactNode) => ReactNode;
  /**
   * Narrows `Other factions` to what this row's faction cell names. Absent in every other source:
   * pinning narrows a list, and no other source has a list to narrow (`ah-1mpx.5`, Q4).
   */
  onPinFaction?: (pin: FactionPin) => void;
  /** What the Seen column reads: `now`, or `turn 68` for a remembered member. */
  seen: string;
  /** False for an Army member this turn's report does not mention - its Hex reads dimmed. */
  fromReport: boolean;
  /** Whether a row that leaves this month reads dimmed - `dimsDeparting(source)` (`ah-tguk`). */
  dimDeparting: boolean;
  /** Drops this unit from the Army on screen. Absent for every source that is not an Army. */
  onRemove?: () => void;
  /** Combat skills recovered from battle rosters, for a foreign unit's Skills cell (`ah-1mpx.6.3`). */
  derivedSkills: DerivedSkills;
  /** Every row's name by unit number, for a Skills popup naming a giver (`ah-rgkk.2.3`). */
  unitNames: ReadonlyMap<string, string>;
}) {
  const skills = unitSkillsCell(unit, derivedSkills);
  const items = formatItems(unit.items, unit.created);

  // Which cells the orders changed, so each one can say so and show what the report said.
  const nameChange = changeFor(unit, "name");
  const guardChange = changeFor(unit, "onGuard");
  const menChange = changeFor(unit, "men");
  const itemsChange = changeFor(unit, "items");
  const skillsChange = changeFor(unit, "skills");
  const structureChange = changeFor(unit, "structureId");
  const movementChange = changeFor(unit, "movement");
  const flagsChange = changeFor(unit, "flags");
  // A row that is somewhere else next month reads dimmed; its marker says where it went.
  const departing = unit.previewStatus === "departing";
  const dissolving = dissolves(unit);
  // A unit this month's FORM creates. Orthogonal to `departing`: it can be both (`ah-4hux`).
  const formed = unit.formed === true;
  // Only for our own units: there is nothing of anybody else's orders to read.
  const longOrder = unit.own ? (getLongOrder?.(unit.unitId, regionId) ?? null) : null;
  // Only our own units have a month to price; `getSilver` returns null for everyone else anyway,
  // and the cell is empty either way.
  const silver = unit.own ? (getSilver?.(unit.unitId, regionId) ?? null) : null;
  // Which pin this row's faction cell would set, and so whether that cell is a control at all.
  // One rule, in `foreignUnits.ts`, rather than a second concealed-test spelled out down here that
  // could drift from it.
  const factionPin = onPinFaction ? pinForRow(unit) : null;
  // The silver findings that name this unit - `not-enough-silver`, or `upkeep-exceeds-unclaimed`
  // where the faction's unclaimed fund could not reach it (`ah-fjty`). In a hex whose units share,
  // the shortfall finding is anchored to the hex and names no unit, and blaming one of several
  // would be as wrong there as it is in the Problems panel - so there is deliberately no fallback
  // to the hex.
  const warned = silver !== null && (silverWarnings?.has(silverKey(regionId, unit.unitId)) ?? false);
  // The setting decides whether maintenance comes off the figure (`ah-1wcw.4`); the core computes
  // both answers, so switching it costs no round trip through the checks.
  const shownSilver = silverShown(silver, countUpkeep);
  // A dissolving unit will not exist at month end, so the column shows no figure for it - the dash
  // is written explicitly rather than taken from `silverFigure(null)`, whose `?` means "could not
  // be priced", a different sentence (`ah-ty3s.3`, decision **S1**).
  const figure = dissolving ? (
    <>
      <span className="sr-only">no month end</span>
      <span aria-hidden className="text-ink-dim">
        —
      </span>
    </>
  ) : (
    silverFigure(shownSilver)
  );

  /**
   * Every cell, keyed the same way the header's dispatch is, so reordering the columns never means
   * reordering this.
   */
  /**
   * What resting on each cell says, resolved once for the row (`ah-rgkk.1`).
   *
   * Every cell that has a popup draws its words twice: as an `sr-only` sentence here, and - when
   * the pointer rests on it - as the popup the dock portals. Both come from this one call, so the
   * hidden sentence and the visible panel can never disagree.
   */
  const explanations = useMemo(() => {
    const popupFacts: PopupFacts = {
      structureLabel,
      reportedStructureLabel,
      longOrder,
      reportedLongOrder: getReportedLongOrder?.(unit.unitId) ?? NO_ORDERS_TEMPLATE,
      silver,
      silverWarned: warned,
      countUpkeep,
      derivedSkills: derivedSkillsFor(derivedSkills, unit),
      dissolving: Boolean(dissolving),
      unitNames
    };
    return new Map(
      EXPLAINED_COLUMNS.map((column) => [column, popupForCell(column, unit, popupFacts)])
    );
    // Everything the resolver reads, and nothing else: a row re-renders on selection, on the pick
    // and on every scroll frame, and none of those changes a word of what a cell means.
  }, [
    unit,
    structureLabel,
    reportedStructureLabel,
    longOrder,
    getReportedLongOrder,
    silver,
    warned,
    countUpkeep,
    derivedSkills,
    dissolving,
    unitNames
  ]);

  const explain = (column: DrawnColumnId) => {
    const spec = explanations.get(column);
    // `data-explains` marks it as the cell's explanation rather than its content, so a test - or
    // anything else reading the table - can tell the two apart (`ah-rgkk.1`).
    return spec?.kind === "column" ? (
      <span className="sr-only" data-explains={column}>
        {popupAsText(spec.popup)}
      </span>
    ) : null;
  };

  const cellsByColumn: Record<UnitColumn, ReactElement<TdProps>> = {
    // The report's own ownership marker, so the distinction reads before the faction name does.
    own: <Td className={unit.own ? "text-ok" : "text-danger"}>{unit.own ? "*" : "−"}</Td>,
    unitId: (
      <Td className={unit.own ? "text-select" : "text-unit-foreign/70"}>
        <button
          type="button"
          onClick={() => onSelect(unit.unitId, regionId)}
          aria-label={`unit ${unit.unitId}`}
          tabIndex={-1}
          className="focus-visible:outline focus-visible:outline-1 focus-visible:outline-select"
        >
          {unit.unitId}
        </button>
      </Td>
    ),
    name: (
      <Td className="truncate">
        <span
          className={nameChange ? PREDICTED : undefined}
          data-predicted={nameChange ? "true" : undefined}
        >
          {unit.name}
        </span>
        {/* Name opens the whole-unit summary rather than a column popup, so what the report said
            has no popup to live in - and it must still be reachable without a mouse. */}
        {nameChange ? (
          <span className="sr-only" data-explains="name">
            {" "}
            {originalTooltip(nameChange)}
          </span>
        ) : null}
        {unit.onGuard ? (
          <span
            className={`ml-1.5 text-pane-sm text-warn${guardChange ? " italic" : ""}`}
            data-predicted={guardChange ? "true" : undefined}
          >
            on guard
            {guardChange ? (
              <span className="sr-only" data-explains="name">
                {" "}
                {originalTooltip(guardChange)}
              </span>
            ) : null}
          </span>
        ) : null}
        {/* First of the markers, before the destination arrow and the hull: the navigator chose
            `new → 1:7,51` rather than `→ 1:7,51 new` (`ah-4hux`, decisions O1 and D1). Carried
            on the arriving row too, where "this unit does not exist yet" matters most. */}
        {formed ? <span className={`ml-1.5 text-pane-sm ${PREDICTED}`}>new</span> : null}
        {/* Where the unit is bound or from, said inline: the row is the story of a move. */}
        {departing && unit.departingTo ? (
          <span className="ml-1.5 text-pane-sm text-ink-dim">→ {unit.departingTo}</span>
        ) : null}
        {departing && !unit.departingTo ? (
          <span className="ml-1.5 text-pane-sm text-ink-dim">→ …</span>
        ) : null}
        {/* Brass and upright, not the italic that means "a field the orders changed": the unit
            wrote no order, it is simply going where its ship goes. Deliberately not gated on
            `departingTo`, so a passenger of an untraceable ship still names the hull. */}
        {departing && unit.aboard ? (
          <span className="ml-1.5 text-pane-sm text-brass">aboard {unit.aboard}</span>
        ) : null}
        {unit.previewStatus === "arriving" ? (
          <span className={`ml-1.5 text-pane-sm ${PREDICTED}`}>← {unit.arrivingFrom ?? "…"}</span>
        ) : null}
        {/* `rules/form` dissolves a FORM that gains nobody. The row stays while its block stands
            (`ah-ty3s.3`, decision **K2**), and names the cause so the fix - recruit somebody - is
            inferable from the row itself. */}
        {dissolving ? (
          <span className="ml-1.5 text-pane-sm text-warn" data-testid={`unit-dissolving-${unit.unitId}`}>
            <span className="sr-only">dissolves, no recruits</span>
            <span aria-hidden>dissolves — no recruits</span>
          </span>
        ) : null}
      </Td>
    ),
    // A foreign faction that names itself can be opened; a concealed one has nothing to open, and
    // our own faction is printed plainly - the faction view already says everything a dossier
    // would, and a second button in a row of ours would make "the button in this row" ambiguous
    // for everything that selects a unit that way.
    //
    // `not shown` rather than the dash it used to read: the dash says "nothing here" where the
    // truth is that somebody owns this unit and the rules do not let you know who (`rules/stealthobs`,
    // Q4). Inside `Other factions` it also pins every unit hiding its owner; elsewhere it is plain
    // text, because there is no list for it to narrow.
    faction: (
      <Td className="truncate">
        {/* Both controls in this cell stop the *pointerdown* as well as the click: with selection
            on pointerdown (`ah-1mpx.4`), a control that stops only the click would do its own job
            and select the row underneath it - which is what Copilot caught on #478 and
            `workspace.spec.ts`'s dossier walk still guards. */}
        {unit.factionName === null || unit.factionId === null ? (
          onPinFaction && factionPin?.kind === "hidden" ? (
            <button
              type="button"
              data-testid="foreign-pin-hidden"
              // Every control inside a row: the table is one tab stop per row with a roving index.
              tabIndex={-1}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onPinFaction(factionPin)}
              className={UNIT_LINK_CLASS}
            >
              not shown
            </button>
          ) : (
            <span className="text-ink-dim">not shown</span>
          )
        ) : unit.own ? (
          `${unit.factionName} (${unit.factionId})`
        ) : renderFactionName ? (
          // Built by the shell, so the row is the only place its press can be stopped.
          <span onPointerDown={(event) => event.stopPropagation()}>
            {renderFactionName(unit.factionId, `${unit.factionName} (${unit.factionId})`)}
          </span>
        ) : (
          `${unit.factionName} (${unit.factionId})`
        )}
      </Td>
    ),
    // A tilde marks a count the parser guessed at; the unit panel spells out why. A count the
    // orders changed explains itself with the report's figure instead.
    men: (
      <Td className={menChange ? PREDICTED : ""}>
        {describeMenBriefly(unit)}
        {explain("men")}
      </Td>
    ),
    movement: (() => {
      if (unit.movement == null) {
        return (
          <Td>
            <span className="sr-only">Movement not disclosed</span>
            <span aria-hidden className="text-ink-dim">
              —
            </span>
            {explain("movement")}
          </Td>
        );
      }
      const presentation = presentUnitMovement(unit.movement);
      const toneClass =
        presentation.tone === "danger"
          ? "text-danger"
          : presentation.tone === "brass"
            ? "text-brass"
            : presentation.tone === "select"
              ? "text-select"
              : "text-ink-soft";
      return (
        <Td
          className={movementChange ? PREDICTED : toneClass}
          predicted={Boolean(movementChange)}
        >
          <span className="sr-only">{presentation.label}</span>
          <span aria-hidden>{presentation.code}</span>
          {explain("movement")}
        </Td>
      );
    })(),
    // A code for the eye and words for a screen reader, exactly as the Move cell above does; the
    // hover carries every flag in the report's own words, including the ones with no letter.
    flags: (() => {
      const letters = flagLetters(unit.flags);
      const words = flagWords(unit.flags);
      return (
        <Td
          className={`truncate${flagsChange ? ` ${PREDICTED}` : ""}`}
          predicted={Boolean(flagsChange)}
        >
          <span className="sr-only">{words ?? "No flags set"}</span>
          {letters === "" ? (
            <span aria-hidden className="text-ink-dim">
              —
            </span>
          ) : (
            <span aria-hidden>{letters}</span>
          )}
          {explain("flags")}
        </Td>
      );
    })(),
    // A report discloses a foreign unit's large items and never its skills (`rules/reportformat`),
    // so an empty cell there would be indistinguishable from a unit that genuinely has none - which
    // for one of ours it does mean, since our own report prints `Skills: none.` (Q3).
    skills: (
      <Td
        className={`truncate${skillsChange ? ` ${PREDICTED}` : ""}`}
        predicted={Boolean(skillsChange)}
      >
        {skills === "" && !unit.own ? (
          <span className="italic text-ink-dim">not disclosed</span>
        ) : (
          skills
        )}
        {explain("skills")}
      </Td>
    ),
    items: (
      <Td
        className={`truncate${itemsChange ? ` ${PREDICTED}` : ""}`}
        predicted={Boolean(itemsChange)}
      >
        {items}
        {/*
          A transport whose target the report cannot settle leaves the month partly uncounted just
          as an unreadable order does, so it earns the same mark. A target refusal the report can
          prove does not: it is certain, and the hover says so (`ah-64wm`).
        */}
        {(unit.uncounted && unit.uncounted.length > 0) || hasUncertainTransportTarget(unit) ? (
          <span className="text-ink-dim"> + ?</span>
        ) : null}
        {explain("items")}
      </Td>
    ),
    structure: (
      <Td className={`truncate${structureChange ? ` ${PREDICTED}` : ""}`}>
        {structureLabel ?? ""}
        {explain("structure")}
      </Td>
    ),
    // A unit of ours spending the month on nothing is worth flagging, hence the red dash; a unit
    // that is not ours simply has nothing to say here.
    longOrder: (
      <Td className="truncate">
        {unit.own ? (longOrder ?? <span className="text-danger">—</span>) : ""}
        {explain("longOrder")}
      </Td>
    ),
    // What this unit is expected to hold when the month ends (ah-1wcw.1). Red is this unit,
    // counted alone, in trouble: ending below zero, or unable to pay for its own orders out of
    // silver that reaches it in time (ah-uwa3). ⚠ is a silver finding that names this unit -
    // `not-enough-silver`, which pools across the hex's sharing units, or `upkeep-exceeds-unclaimed`
    // (ah-fjty). The two mean different things on purpose, so a ⚠
    // on a positive figure is not a contradiction - the hover explains it.
    silver: (
      <Td
        className={`text-right tabular-nums${
          !dissolving && silverIsRed(shownSilver, silver) ? " text-danger" : ""
        }`}
      >
        {silver === null ? (
          ""
        ) : warned ? (
          <button
            type="button"
            data-testid={`unit-silver-${unit.unitId}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSelectUnit?.(unit.unitId, regionId)}
            className={`inline-flex items-center gap-0.5 ${UNIT_LINK_CLASS}`}
          >
            <span className="sr-only">unit {unit.unitId} </span>
            <SeverityMark severity="warning" />
            {figure}
          </button>
        ) : (
          <span
            className={
              !silverIsRed(shownSilver, silver) && silverIsDim(shownSilver)
                ? "text-ink-dim"
                : undefined
            }
          >
            {figure}
          </span>
        )}
        {explain("silver")}
      </Td>
    )
  };

  /**
   * The cells for the columns this source added.
   *
   * `Hex` reads dimmed for a remembered member, being where the unit *was*; `Seen` amber for the
   * same reason. `Remove` is empty on every row but the selected one, so nothing reflows as the
   * selection moves - and it is `tabIndex={-1}` like the unit-id button beside it, because the
   * table is one tab stop per row and a control inside a cell would put a second stop in every
   * one of three hundred rows (`AppShell.tsx:3570-3575`). Its keyboard route is the standing bulk
   * line and the rail.
   */
  const extraCells: Record<ExtraColumn, ReactElement<TdProps>> = {
    hex: <Td className={`truncate${fromReport ? "" : " text-ink-dim"}`}>{hexLabel(unit.regionId)}</Td>,
    seen: <Td className={fromReport ? "text-ink-dim" : "text-warn"}>{seen}</Td>,
    remove: (
      <Td>
        {selected && onRemove ? (
          <button
            type="button"
            data-testid={`army-remove-${unit.unitId}`}
            tabIndex={-1}
            // With selection on `pointerdown`, stopping the click is no longer enough: without
            // this, pressing Remove would pick the row and arm a drag underneath it.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              // The row is itself a click target that selects the unit; removing is not selecting.
              event.stopPropagation();
              onRemove();
            }}
            className="rounded border border-edge px-1.5 text-pane-sm text-danger hover:bg-panel"
          >
            Remove
          </button>
        ) : null}
      </Td>
    )
  };

  return (
    <tr
      data-testid={`unit-row-${unit.unitId}`}
      // Two hexes may each hold a `new-1`: the hex is what tells the two rows apart (`ah-9o0c.2`).
      data-region-id={unit.regionId}
      data-selected={selected}
      data-picked={picked}
      data-preview-status={unit.previewStatus}
      data-preview-formed={formed ? "true" : undefined}
      data-preview-dissolving={dissolving ? "true" : undefined}
      // Pointerdown rather than click: a press on a row already in the pick must be able to defer
      // what it means until it is known whether it became a drag (`ah-1mpx.4` E2).
      onPointerDown={(event) => onPress(event, unit, unit.unitId)}
      // The browser's own drag, refused. A Shift+click extends the document's text selection as
      // well as the pick, so the next press lands *inside* selected text - and a press on selected
      // text followed by a move is how a browser starts dragging that text, which cancels the
      // pointer stream this drag is built on. `ColumnReorderHandle` refuses the same thing by
      // calling `preventDefault` on its pointerdown; a row cannot, because it must still take
      // focus, so it is refused here instead.
      onDragStart={(event) => event.preventDefault()}
      onContextMenu={(event) => onContextMenu(event, unit, unit.unitId)}
      onKeyDown={(event) => onKeyDown(event, index)}
      // Pointer events rather than mouse events, for the guard: a finger has no hover to leave,
      // so a touch would open a summary that never closed. Only a mouse can rest on something.
      // `onPointerOver` rather than `onPointerEnter`: only the bubbling one has the cell under
      // the pointer as its target, and `onPointerEnter`'s target is the `<tr>` itself - from which
      // no cell can be read at all (`ah-rgkk.1`).
      onPointerOver={(event) => {
        if (!byMouse(event)) {
          return;
        }
        onPointerAt({ x: event.clientX, y: event.clientY });
        onPointerRest(unit, columnOf(event));
      }}
      onPointerMove={(event) => {
        if (!byMouse(event)) {
          return;
        }
        onPointerAt({ x: event.clientX, y: event.clientY });
        onPointerRest(unit, columnOf(event));
      }}
      onPointerLeave={onPointerGone}
      // Only the selected row is in the tab order, so Tab reaches the table once rather than
      // stopping at every unit on screen; the arrow keys move from there.
      tabIndex={selected ? 0 : -1}
      // Which rows are chosen, said out loud. The blue background says it to everyone else. In a
      // grid `aria-selected` is the selection and focus is the cursor, so a picked row carries it
      // too - and for a pick of one the two name the same row, as they always did.
      aria-selected={picked || selected}
      // ARIA counts the header, so the first unit is row two.
      aria-rowindex={index + 2}
      style={{ height: rowHeight }}
      className={`cursor-pointer whitespace-nowrap focus-visible:outline focus-visible:outline-1 focus-visible:outline-select ${
        selected
          ? "bg-select/25 text-ink"
          : picked
            ? "bg-select/15 text-ink"
            : unit.own
              ? "text-ink"
              : "text-ink-soft"
      }${(departing && dimDeparting) || dissolving ? " opacity-60" : ""}`}
    >
      {/* The column is cloned in rather than written at each cell: the record's key already *is*
          the column, so fifteen hand-written props are fifteen chances to drift (`ah-rgkk.1`). */}
      {drawn.map((entry) =>
        entry.kind === "unit" ? (
          <Fragment key={entry.column}>
            {cloneElement(cellsByColumn[entry.column], { column: entry.column })}
          </Fragment>
        ) : (
          <Fragment key={`extra-${entry.column}`}>
            {cloneElement(extraCells[entry.column], { column: entry.column })}
          </Fragment>
        )
      )}
    </tr>
  );
}

/**
 * Which column the pointer is actually over, read back off the `<td>` the event came from.
 *
 * `undefined` for anything that is not a cell of the table - a spacer row's `colSpan` cell carries
 * no column - and the caller treats that exactly as it treats a silent one.
 */
function columnOf(event: PointerEvent<HTMLTableRowElement>): DrawnColumnId | undefined {
  const cell = (event.target as HTMLElement | null)?.closest?.("td");
  return (cell?.dataset.column as DrawnColumnId | undefined) || undefined;
}

export type TdProps = {
  children?: ReactNode;
  className?: string;
  /**
   * Which column this cell is, stamped on the `<td>` as `data-column`.
   *
   * The row's pointer handlers read it back off the element under the pointer, which is how one
   * handler on the `<tr>` knows which cell was rested on (`ah-rgkk.1`). Not written by hand at
   * each cell: `UnitRow` clones it in from the key of the record the cell was stored under, so it
   * cannot drift from the column it is drawn for.
   */
  column?: string;
  /**
   * Marks the cell itself as a projection, for the smoke suite to find - exactly as `name`'s
   * inner span already carries `data-predicted` (`ah-agbm`). Only the ITEMS cell has no inner
   * wrapper to carry it, so it goes straight on the `<td>`.
   */
  predicted?: boolean;
};

function Td({ children, className = "", column, predicted }: TdProps) {
  return (
    <td
      className={`border-b border-edge-soft px-2 py-0.5 ${className}`}
      data-column={column}
      data-predicted={predicted ? "true" : undefined}
    >
      {children}
    </td>
  );
}

/**
 * What the Silver cell prints: the figure, or `?` for a month that could not be priced.
 *
 * Never a number that might be wrong - see `orders::silver` in the core, which is where the
 * decision that a doubted term poisons the whole side is made.
 */
function silverFigure(shown: number | null): string {
  return shown === null ? "?" : String(shown);
}

/**
 * A `?` and a plain `0` both read dim: neither is a number to act on.
 *
 * Only reached for a figure that is not red - a `0` whose orders cannot be paid is a number to act
 * on, so red wins over dim at the one call site (`ah-uwa3`).
 */
function silverIsDim(shown: number | null): boolean {
  return shown === null || shown === 0;
}
