import type { ReportUnit } from "@atlantis/core-client";
import { useMemo, useState } from "react";
import type { HexNode } from "../hexMapModel";
import { unitsForHex } from "../hexMapModel";
import { useWorkspaceStore } from "../workspaceStore";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { Absent } from "./primitives";

/**
 * Every unit in the selected hex, as a table, with one selectable.
 *
 * A single hex can hold ninety-odd units across two dozen structures, so the table is really a
 * flattened tree: the Structure column carries the nesting rather than indenting rows, which keeps
 * it sortable and filterable. Own units sort first, so the one that is yours is never buried.
 */
export function UnitTableDock({ hex }: { hex: HexNode | null }) {
  const selectedUnitId = useWorkspaceStore((state) => state.selectedUnitId);
  const selectUnit = useWorkspaceStore((state) => state.selectUnit);
  const [filter, setFilter] = useState("");

  const units = useMemo(() => unitsForHex(hex), [hex]);
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) {
      return units;
    }
    return units.filter((unit) =>
      [unit.name, unit.unitId, unit.factionName ?? "", unit.structureId ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [units, filter]);

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
      ) : (
        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.06em] text-ink-soft">
              <Th className="w-6" label="" />
              <Th label="Id" />
              <Th label="Unit" />
              <Th label="Faction" />
              <Th label="Men" />
              <Th label="Skills" />
              <Th label="Items" />
              <Th label="Structure" />
            </tr>
          </thead>
          <tbody>
            {visible.map((unit) => (
              <UnitRow
                key={unit.unitId}
                unit={unit}
                selected={unit.unitId === selectedUnitId}
                onSelect={() => selectUnit(unit.unitId)}
              />
            ))}
          </tbody>
        </table>
      )}
    </CollapsiblePanel>
  );
}

function Th({ label, className = "" }: { label: string; className?: string }) {
  return (
    <th className={`border-b border-edge px-2 py-1 text-left font-medium ${className}`}>{label}</th>
  );
}

function UnitRow({
  unit,
  selected,
  onSelect
}: {
  unit: ReportUnit;
  selected: boolean;
  onSelect: () => void;
}) {
  const skills = unit.skills.map((skill) => `${skill.tag} ${skill.level}`).join(", ");
  const items = unit.items.map((item) => `${item.amount} ${item.tag}`).join(", ");

  return (
    <tr
      data-testid={`unit-row-${unit.unitId}`}
      data-selected={selected}
      onClick={onSelect}
      className={`cursor-pointer whitespace-nowrap ${
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
          className="focus-visible:outline focus-visible:outline-1 focus-visible:outline-select"
        >
          {unit.unitId}
        </button>
      </Td>
      <Td>
        {unit.name}
        {unit.onGuard ? <span className="ml-1.5 text-[10px] text-warn">on guard</span> : null}
      </Td>
      <Td>{unit.factionName ? `${unit.factionName} (${unit.factionId})` : "—"}</Td>
      <Td>{unit.men || ""}</Td>
      <Td className="max-w-56 truncate">{skills}</Td>
      <Td className="max-w-64 truncate">{items}</Td>
      <Td>{unit.structureId ? `[${unit.structureId}]` : ""}</Td>
    </tr>
  );
}

function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`border-b border-edge-soft px-2 py-0.5 ${className}`}>{children}</td>;
}
