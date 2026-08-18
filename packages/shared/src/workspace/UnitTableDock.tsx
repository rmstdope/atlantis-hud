import type { RegionPreview, ReportUnit } from "@atlantis/core-client";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import type { HexNode } from "../hexMapModel";
import { unitsForHex } from "../hexMapModel";
import { unitStructureLabel } from "../structureLabel";
import { describeMenBriefly, whyEstimated } from "../unitComposition";
import {
  DEFAULT_SORT,
  filterUnits,
  rowHeightAt,
  sortUnits,
  windowRange,
  type SortColumn,
  type SortState
} from "../unitTable";
import { changeFor, mergePreview, originalTooltip, type PreviewedUnit } from "../unitPreview";
import { HOVER_DELAY_MS, type Point } from "../unitTooltip";
import { useSettingsStore } from "../settingsStore";
import { useWorkspaceStore } from "../workspaceStore";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { Absent } from "./primitives";
import { UnitTooltip } from "./UnitTooltip";

/** Rows built beyond each edge of the viewport, so a flick of the wheel does not show a gap. */
const OVERSCAN = 6;

/** The table has eight columns; spacer rows span all of them. */
const COLUMNS = 8;

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
export function UnitTableDock({
  hex,
  preview = null
}: {
  hex: HexNode | null;
  /** The hex's slice of the orders preview, so rows show the coming month. */
  preview?: RegionPreview | null;
}) {
  const selectedUnitId = useWorkspaceStore((state) => state.selectedUnitId);
  const selectUnit = useWorkspaceStore((state) => state.selectUnit);
  const interfaceSize = useSettingsStore((state) => state.interfaceSize);
  const rowHeight = rowHeightAt(interfaceSize);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  // The scroller and header are held as state rather than refs so the effects below re-run when
  // the table is folded away and unfolded, which unmounts and remounts them.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [head, setHead] = useState<HTMLTableSectionElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const refocusWanted = useRef(false);

  // unitsForHex rather than hex.region.units: sorting it again is a no-op because Array.sort is
  // stable, and it guarantees the table cannot drift from the order AppShell picks defaults from.
  // The orders preview folds in on top, so everything below it - filter and sort - already
  // works over the coming month's rows, arrivals and formed units included.
  const units = useMemo(() => mergePreview(unitsForHex(hex), preview), [hex, preview]);
  const structures = useMemo(() => hex?.region?.structures ?? [], [hex]);
  // Built once per hex, not scanned per row: a hex can hold three hundred units across two dozen
  // structures, and the table re-renders on every scroll frame.
  const structuresById = useMemo(
    () => new Map(structures.map((structure) => [structure.structureId, structure])),
    [structures]
  );
  const visible = useMemo(
    () => sortUnits(filterUnits(units, filter, structures), sort, structures),
    [units, filter, sort, structures]
  );
  const selectedIndex = useMemo(
    () => visible.findIndex((unit) => unit.unitId === selectedUnitId),
    [visible, selectedUnitId]
  );

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

  const regionId = hex?.regionId ?? null;

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
    sort,
    filter,
    visible.length,
    viewportHeight,
    rowHeight
  ]);

  // Arrowing to a row that was outside the window selects it before it exists, so the focus has to
  // wait for the render that brings it in.
  useEffect(() => {
    if (!refocusWanted.current || !scroller || !selectedUnitId) {
      return;
    }
    const row = scroller.querySelector<HTMLElement>(
      `[data-testid="unit-row-${CSS.escape(selectedUnitId)}"]`
    );
    if (row) {
      refocusWanted.current = false;
      row.focus();
    }
  }, [scroller, selectedUnitId, start, end]);

  /**
   * The row the pointer has rested on, and where it rested.
   *
   * The point is taken from the pointer rather than from the row, because a row is the width of
   * the table and its own position says nothing about where the user is looking. It is kept in a
   * ref until the wait is up: following the pointer through state would re-render the table on
   * every mouse move, for a figure only one timeout ever reads.
   */
  const [hovered, setHovered] = useState<{ unit: ReportUnit; at: Point } | null>(null);
  const pointerAt = useRef<Point>({ x: 0, y: 0 });
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const forgetHover = () => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHovered(null);
  };

  const restOn = (unit: ReportUnit) => {
    forgetHover();
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      setHovered({ unit, at: pointerAt.current });
    }, HOVER_DELAY_MS);
  };

  // A tooltip that outlived its row would hang over the map with nothing to point at, and every
  // rearrangement of the table does that: another hex, another filter, another report of the same
  // hex, or the panel folded away. `visible` is a fresh array for exactly those and no others, so
  // depending on it rather than on the things that produce it cannot miss one. The work is in the
  // cleanup, which React runs both when the rows change and when the table goes.
  useEffect(
    () => () => {
      if (hoverTimer.current !== null) {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }
      setHovered(null);
    },
    [visible]
  );

  const sortByColumn = (column: SortColumn) =>
    setSort((current) =>
      current.column === column
        ? { ...current, direction: current.direction === "asc" ? "desc" : "asc" }
        : { ...current, column, direction: "asc" }
    );

  const moveSelection = (to: number) => {
    const target = visible[Math.min(Math.max(to, 0), visible.length - 1)];
    // Arrowing past either end lands on the row already selected. Asking for it again re-renders
    // nothing, so the effect above would never run to spend the focus this arms — it would be left
    // owing, and go to whichever row was selected next, including one chosen with the mouse.
    if (target && target.unitId !== selectedUnitId) {
      refocusWanted.current = true;
      selectUnit(target.unitId);
    }
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    // The unit id button sits inside the row and bubbles its own key events up here.
    if (event.target !== event.currentTarget) {
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowDown: () => moveSelection(index + 1),
      ArrowUp: () => moveSelection(index - 1),
      Home: () => moveSelection(0),
      End: () => moveSelection(visible.length - 1),
      Enter: () => selectUnit(visible[index]?.unitId ?? null),
      // Without this, Space scrolls the container out from under the row.
      " ": () => selectUnit(visible[index]?.unitId ?? null)
    };
    const handler = keys[event.key];
    if (handler) {
      event.preventDefault();
      handler();
    }
  };

  const stale = hex?.knowledge === "stale";
  // A stale hex's count would be a lie the moment it left the model: a hex nobody sees carries no
  // units at all now, so the header names the ground and stops there rather than claiming "0 units"
  // (ah-o86). The amber "as of turn N" chip already says the account is dated.
  const hint = hex
    ? stale
      ? `— ${hex.terrain} (${hex.coordinate.x},${hex.coordinate.y})`
      : `— ${hex.terrain} (${hex.coordinate.x},${hex.coordinate.y}), ${units.length} unit${units.length === 1 ? "" : "s"}${visible.length === units.length ? "" : `, ${visible.length} shown`}`
    : undefined;

  return (
    <CollapsiblePanel
      panel="units"
      title="Units in hex"
      hint={hint}
      asOf={stale && hex.lastSeenTurn !== null ? `as of turn ${hex.lastSeenTurn}` : null}
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
        </div>
      }
    >
      {units.length === 0 ? (
        <Absent>
          {hex
            ? stale
              ? `Not seen since turn ${hex.lastSeenTurn} — no current unit information.`
              : "No units reported in this hex."
            : "No hex selected."}
        </Absent>
      ) : visible.length === 0 ? (
        <Absent>No unit matches that filter.</Absent>
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
          <table
            // A grid rather than a plain table: rows here are selectable, and a screen reader only
            // treats a row as something you can land on and choose inside a grid.
            role="grid"
            // Fixed layout, because auto layout measures only the rendered rows and the columns
            // would jump as you scrolled. It also makes the truncation on Skills and Items real.
            //
            // Separated borders, because a sticky header loses its rule under border-collapse in
            // Chrome: a collapsed border belongs to the table, so it does not travel with the cell.
            className="w-full table-fixed border-separate border-spacing-0 tabular-nums"
            aria-rowcount={visible.length + 1}
          >
            <colgroup>
              <col className="w-6" />
              <col className="w-16" />
              <col className="w-52" />
              <col className="w-48" />
              <col className="w-16" />
              <col />
              <col />
              <col className="w-52" />
            </colgroup>
            <thead ref={setHead}>
              {/* Indexed like the rows below it: if some rows carry a position, all of them must. */}
              <tr aria-rowindex={1} className="text-pane-sm uppercase tracking-[0.06em] text-ink-soft">
                <Th>
                  <button
                    type="button"
                    onClick={() =>
                      setSort((current) => ({
                        ...current,
                        groupOwnFirst: !current.groupOwnFirst
                      }))
                    }
                    aria-pressed={sort.groupOwnFirst}
                    aria-label="Group own units first"
                    className={`w-full text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass ${
                      sort.groupOwnFirst ? "text-ok" : "text-ink-dim"
                    }`}
                  >
                    *
                  </button>
                </Th>
                <SortableTh label="Id" column="unitId" sort={sort} onSort={sortByColumn} />
                <SortableTh label="Unit" column="name" sort={sort} onSort={sortByColumn} />
                <SortableTh label="Faction" column="faction" sort={sort} onSort={sortByColumn} />
                <SortableTh label="Men" column="men" sort={sort} onSort={sortByColumn} />
                {/* Skills and Items are comma-joined summaries; ordering them alphabetically
                    would sort on the first skill that happened to be listed. */}
                <Th>Skills</Th>
                <Th>Items</Th>
                <SortableTh
                  label="Structure"
                  column="structure"
                  sort={sort}
                  onSort={sortByColumn}
                />
              </tr>
            </thead>
            <tbody>
              <Spacer rows={start} rowHeight={rowHeight} />
              {visible.slice(start, end).map((unit, offset) => (
                <UnitRow
                  key={unit.unitId}
                  unit={unit}
                  structureLabel={unitStructureLabel(unit.structureId, structuresById)}
                  index={start + offset}
                  rowHeight={rowHeight}
                  selected={unit.unitId === selectedUnitId}
                  onSelect={() => selectUnit(unit.unitId)}
                  onKeyDown={onRowKeyDown}
                  onPointerRest={restOn}
                  onPointerAt={(point) => {
                    pointerAt.current = point;
                  }}
                  onPointerGone={forgetHover}
                />
              ))}
              <Spacer rows={visible.length - end} rowHeight={rowHeight} />
            </tbody>
          </table>
          {hovered ? <UnitTooltip unit={hovered.unit} at={hovered.at} /> : null}
        </div>
      )}
    </CollapsiblePanel>
  );
}

/** Whether an event came from a mouse, as opposed to a finger or a pen held against the screen. */
const byMouse = (event: PointerEvent<HTMLElement>) => event.pointerType === "mouse";

/** Stands in for the rows above or below the window, so the scrollbar reflects the whole list. */
function Spacer({ rows, rowHeight }: { rows: number; rowHeight: number }) {
  if (rows <= 0) {
    return null;
  }
  const height = rows * rowHeight;
  // A row with no cell in it is not reliably given a height, so the height goes on both.
  return (
    <tr aria-hidden style={{ height }}>
      <td colSpan={COLUMNS} className="border-0 p-0" style={{ height }} />
    </tr>
  );
}

function Th({ children }: { children?: ReactNode }) {
  return (
    // The background is opaque and sits on the cells rather than the row: the panel behind is
    // translucent over the map, and a see-through header would show the rows sliding under it.
    <th className="sticky top-0 z-10 border-b border-edge bg-panel px-2 py-1 text-left font-medium">
      {children}
    </th>
  );
}

function SortableTh({
  label,
  column,
  sort,
  onSort
}: {
  label: string;
  column: SortColumn;
  sort: SortState;
  onSort: (column: SortColumn) => void;
}) {
  const active = sort.column === column;
  return (
    <th
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className="sticky top-0 z-10 border-b border-edge bg-panel px-2 py-1 text-left font-medium"
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`flex w-full items-center gap-1 uppercase tracking-[0.06em] focus-visible:outline focus-visible:outline-1 focus-visible:outline-brass ${
          active ? "text-brass" : ""
        }`}
      >
        {label}
        <span aria-hidden className={active ? "text-brass" : "text-ink-dim"}>
          {active ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

/** How a changed cell says it shows the coming month rather than the report. */
const PREDICTED = "italic text-brass";

function UnitRow({
  unit,
  structureLabel,
  index,
  rowHeight,
  selected,
  onSelect,
  onKeyDown,
  onPointerRest,
  onPointerAt,
  onPointerGone
}: {
  unit: PreviewedUnit;
  /**
   * The structure this unit stands in — its full label, or a bare `[id]` when the region never
   * described it — and null when the unit stands in the open.
   */
  structureLabel: string | null;
  index: number;
  rowHeight: number;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>, index: number) => void;
  /** The pointer has arrived: start counting towards this unit's summary. */
  onPointerRest: (unit: ReportUnit) => void;
  /** Where the pointer is now, so the summary opens where the user stopped looking. */
  onPointerAt: (point: Point) => void;
  onPointerGone: () => void;
}) {
  const skills = unit.skills.map((skill) => `${skill.tag} ${skill.level}`).join(", ");
  const items = unit.items.map((item) => `${item.amount} ${item.tag}`).join(", ");

  // Which cells the orders changed, so each one can say so and show what the report said.
  const nameChange = changeFor(unit, "name");
  const guardChange = changeFor(unit, "onGuard");
  const menChange = changeFor(unit, "men");
  const itemsChange = changeFor(unit, "items");
  const structureChange = changeFor(unit, "structureId");
  // The cell truncates, so the whole label belongs in the tooltip whether or not it also changed;
  // when it did change, what the report said goes on a line beneath it.
  const structureTitle =
    [structureLabel, originalTooltip(structureChange)].filter(Boolean).join("\n") || undefined;
  // A row that is somewhere else next month reads dimmed; its marker says where it went.
  const departing = unit.previewStatus === "departing";

  return (
    <tr
      data-testid={`unit-row-${unit.unitId}`}
      data-selected={selected}
      data-preview-status={unit.previewStatus}
      onClick={onSelect}
      onKeyDown={(event) => onKeyDown(event, index)}
      // Pointer events rather than mouse events, for the guard: a finger has no hover to leave,
      // so a touch would open a summary that never closed. Only a mouse can rest on something.
      onPointerEnter={(event) => {
        if (!byMouse(event)) {
          return;
        }
        onPointerAt({ x: event.clientX, y: event.clientY });
        onPointerRest(unit);
      }}
      onPointerMove={(event) => {
        if (byMouse(event)) {
          onPointerAt({ x: event.clientX, y: event.clientY });
        }
      }}
      onPointerLeave={onPointerGone}
      // Only the selected row is in the tab order, so Tab reaches the table once rather than
      // stopping at every unit on screen; the arrow keys move from there.
      tabIndex={selected ? 0 : -1}
      // Which row is chosen, said out loud. The blue background says it to everyone else.
      aria-selected={selected}
      // ARIA counts the header, so the first unit is row two.
      aria-rowindex={index + 2}
      style={{ height: rowHeight }}
      className={`cursor-pointer whitespace-nowrap focus-visible:outline focus-visible:outline-1 focus-visible:outline-select ${
        selected ? "bg-select/25 text-ink" : unit.own ? "text-ink" : "text-ink-soft"
      }${departing ? " opacity-60" : ""}`}
    >
      {/* The report's own ownership marker, so the distinction reads before the faction name does. */}
      <Td className={unit.own ? "text-ok" : "text-danger"}>{unit.own ? "*" : "−"}</Td>
      <Td className={unit.own ? "text-select" : "text-unit-foreign/70"}>
        <button
          type="button"
          onClick={onSelect}
          aria-label={`unit ${unit.unitId}`}
          tabIndex={-1}
          className="focus-visible:outline focus-visible:outline-1 focus-visible:outline-select"
        >
          {unit.unitId}
        </button>
      </Td>
      <Td className="truncate">
        <span
          className={nameChange ? PREDICTED : undefined}
          data-predicted={nameChange ? "true" : undefined}
          title={originalTooltip(nameChange)}
        >
          {unit.name}
        </span>
        {unit.onGuard ? (
          <span
            className={`ml-1.5 text-pane-sm text-warn${guardChange ? " italic" : ""}`}
            data-predicted={guardChange ? "true" : undefined}
            title={originalTooltip(guardChange)}
          >
            on guard
          </span>
        ) : null}
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
        {unit.previewStatus === "formed" ? (
          <span className={`ml-1.5 text-pane-sm ${PREDICTED}`}>new</span>
        ) : null}
      </Td>
      <Td className="truncate">
        {unit.factionName ? `${unit.factionName} (${unit.factionId})` : "—"}
      </Td>
      {/* A tilde marks a count the parser guessed at; the unit panel spells out why. A count the
          orders changed explains itself with the report's figure instead. */}
      <Td
        className={menChange ? PREDICTED : ""}
        title={originalTooltip(menChange) ?? whyEstimated(unit)}
      >
        {describeMenBriefly(unit)}
      </Td>
      <Td className="truncate">{skills}</Td>
      <Td className={`truncate${itemsChange ? ` ${PREDICTED}` : ""}`} title={originalTooltip(itemsChange)}>
        {items}
      </Td>
      <Td className={`truncate${structureChange ? ` ${PREDICTED}` : ""}`} title={structureTitle}>
        {structureLabel ?? ""}
      </Td>
    </tr>
  );
}

function Td({
  children,
  className = "",
  title
}: {
  children?: ReactNode;
  className?: string;
  /** Hover text, used to explain a figure the cell has no room to qualify. */
  title?: string;
}) {
  return (
    <td className={`border-b border-edge-soft px-2 py-0.5 ${className}`} title={title}>
      {children}
    </td>
  );
}
