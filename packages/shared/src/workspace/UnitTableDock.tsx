import type { ReportUnit } from "@atlantis/core-client";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from "react";
import type { HexNode } from "../hexMapModel";
import { unitsForHex } from "../hexMapModel";
import { describeMenBriefly, whyEstimated } from "../unitComposition";
import {
  DEFAULT_SORT,
  ROW_HEIGHT,
  filterUnits,
  sortUnits,
  windowRange,
  type SortColumn,
  type SortState
} from "../unitTable";
import { useWorkspaceStore } from "../workspaceStore";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { Absent } from "./primitives";

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
 * rows of the right height, which is why every row is pinned to ROW_HEIGHT: the arithmetic and the
 * rendering read the same constant, so they cannot drift apart and leave the list misaligned.
 */
export function UnitTableDock({ hex }: { hex: HexNode | null }) {
  const selectedUnitId = useWorkspaceStore((state) => state.selectedUnitId);
  const selectUnit = useWorkspaceStore((state) => state.selectUnit);
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
  const units = useMemo(() => unitsForHex(hex), [hex]);
  const visible = useMemo(() => sortUnits(filterUnits(units, filter), sort), [units, filter, sort]);
  const selectedIndex = useMemo(
    () => visible.findIndex((unit) => unit.unitId === selectedUnitId),
    [visible, selectedUnitId]
  );

  const { start, end } = windowRange(
    scrollTop,
    viewportHeight,
    ROW_HEIGHT,
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
    const update = () => setViewportHeight(measure(scroller, head));
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
    const furthest = Math.max(0, visible.length * ROW_HEIGHT - view);
    const from = Math.min(scroller.scrollTop, furthest);
    const top = selectedIndex * ROW_HEIGHT;

    let next = 0;
    if (selectedIndex >= 0) {
      next = top < from ? top : top + ROW_HEIGHT > from + view ? top + ROW_HEIGHT - view : from;
    }
    next = Math.min(Math.max(next, 0), furthest);

    scroller.scrollTop = next;
    // Assigning scrollTop fires its scroll event asynchronously, so the state has to be set here
    // too — otherwise the next render windows from the old offset and the table paints blank.
    setScrollTop(next);
  }, [scroller, head, selectedIndex, regionId, sort, filter, visible.length, viewportHeight]);

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
  const hint = hex
    ? `— ${hex.terrain} (${hex.coordinate.x},${hex.coordinate.y}), ${stale ? "last known " : ""}${units.length} unit${units.length === 1 ? "" : "s"}${visible.length === units.length ? "" : `, ${visible.length} shown`}`
    : undefined;

  return (
    <CollapsiblePanel
      panel="units"
      title="Units in hex"
      hint={hint}
      asOf={stale && hex.lastSeenTurn !== null ? `as of turn ${hex.lastSeenTurn}` : null}
      actions={
        <input
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="filter units…"
          aria-label="Filter units"
          className="w-44 rounded border border-edge bg-ground px-2 py-0.5 text-[11px] text-ink placeholder:text-ink-dim focus:border-select focus:outline-none"
        />
      }
    >
      {units.length === 0 ? (
        <Absent>{hex ? "No units reported in this hex." : "No hex selected."}</Absent>
      ) : visible.length === 0 ? (
        <Absent>No unit matches that filter.</Absent>
      ) : (
        <div
          ref={setScroller}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          // The vertical bar is always reserved: letting it come and go as the window changes
          // would resize the table, which would remeasure the viewport, which would change the
          // window again.
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
              <col className="w-20" />
            </colgroup>
            <thead ref={setHead}>
              {/* Indexed like the rows below it: if some rows carry a position, all of them must. */}
              <tr aria-rowindex={1} className="text-[10px] uppercase tracking-[0.06em] text-ink-soft">
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
              <Spacer rows={start} />
              {visible.slice(start, end).map((unit, offset) => (
                <UnitRow
                  key={unit.unitId}
                  unit={unit}
                  index={start + offset}
                  selected={unit.unitId === selectedUnitId}
                  onSelect={() => selectUnit(unit.unitId)}
                  onKeyDown={onRowKeyDown}
                />
              ))}
              <Spacer rows={visible.length - end} />
            </tbody>
          </table>
        </div>
      )}
    </CollapsiblePanel>
  );
}

/** Stands in for the rows above or below the window, so the scrollbar reflects the whole list. */
function Spacer({ rows }: { rows: number }) {
  if (rows <= 0) {
    return null;
  }
  const height = rows * ROW_HEIGHT;
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

function UnitRow({
  unit,
  index,
  selected,
  onSelect,
  onKeyDown
}: {
  unit: ReportUnit;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>, index: number) => void;
}) {
  const skills = unit.skills.map((skill) => `${skill.tag} ${skill.level}`).join(", ");
  const items = unit.items.map((item) => `${item.amount} ${item.tag}`).join(", ");

  return (
    <tr
      data-testid={`unit-row-${unit.unitId}`}
      data-selected={selected}
      onClick={onSelect}
      onKeyDown={(event) => onKeyDown(event, index)}
      // Only the selected row is in the tab order, so Tab reaches the table once rather than
      // stopping at every unit on screen; the arrow keys move from there.
      tabIndex={selected ? 0 : -1}
      // Which row is chosen, said out loud. The blue background says it to everyone else.
      aria-selected={selected}
      // ARIA counts the header, so the first unit is row two.
      aria-rowindex={index + 2}
      style={{ height: ROW_HEIGHT }}
      className={`cursor-pointer whitespace-nowrap focus-visible:outline focus-visible:outline-1 focus-visible:outline-select ${
        selected ? "bg-[#22354a] text-[#eaf3fb]" : unit.own ? "text-ink" : "text-ink-soft"
      }`}
    >
      {/* The report's own ownership marker, so the distinction reads before the faction name does. */}
      <Td className={unit.own ? "text-ok" : "text-danger"}>{unit.own ? "*" : "−"}</Td>
      <Td className={unit.own ? "text-select" : "text-[#b98a8a]"}>
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
        {unit.name}
        {unit.onGuard ? <span className="ml-1.5 text-[10px] text-warn">on guard</span> : null}
      </Td>
      <Td className="truncate">
        {unit.factionName ? `${unit.factionName} (${unit.factionId})` : "—"}
      </Td>
      {/* A tilde marks a count the parser guessed at; the unit panel spells out why. */}
      <Td title={whyEstimated(unit)}>{describeMenBriefly(unit)}</Td>
      <Td className="truncate">{skills}</Td>
      <Td className="truncate">{items}</Td>
      <Td>{unit.structureId ? `[${unit.structureId}]` : ""}</Td>
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
