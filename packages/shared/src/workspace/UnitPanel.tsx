import type { ReportUnit } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { Absent, Field, Row, Section, StaleBanner } from "./primitives";

const PREVIEW = 8;

/**
 * The selected unit in detail. Empty when nothing is selected, as the issue requires.
 *
 * Foreign units are shown in full: inspecting a neighbour is legitimate and useful. It is only
 * *ordering* one that is refused, which the orders panel handles.
 */
export function UnitPanel({ unit, hex }: { unit: ReportUnit | null; hex: HexNode | null }) {
  const stale = hex?.knowledge === "stale";
  const asOf = stale && hex.lastSeenTurn !== null ? `as of turn ${hex.lastSeenTurn}` : null;

  if (!unit) {
    return (
      <CollapsiblePanel panel="unit" title="Unit">
        <Absent>No unit selected.</Absent>
      </CollapsiblePanel>
    );
  }

  const items = [...unit.items].sort((left, right) => right.amount - left.amount);

  return (
    <CollapsiblePanel
      panel="unit"
      title="Unit"
      hint={`— ${unit.name} (${unit.unitId})`}
      asOf={asOf}
    >
      {stale && hex.lastSeenTurn !== null ? (
        <StaleBanner lastSeenTurn={hex.lastSeenTurn} ageInTurns={hex.ageInTurns ?? 0} />
      ) : null}

      <p className="m-0 mb-2">
        <strong className={`font-medium ${unit.own ? "text-brass" : "text-danger"}`}>
          {unit.factionName ?? "Unknown faction"}
          {unit.factionId ? ` (${unit.factionId})` : ""}
        </strong>
        {unit.own ? " · your faction" : " · not your faction"}
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-px">
        <Field label="Hex" value={unit.regionId} />
        <Field label="Men" value={unit.men.toLocaleString()} />
        {unit.weight === null ? null : <Field label="Weight" value={unit.weight} />}
        {unit.capacity === null ? null : <Field label="Capacity" value={unit.capacity} />}
        {unit.structureId === null ? null : <Field label="Structure" value={unit.structureId} />}
      </dl>

      <Section title="Flags">
        {unit.flags.length === 0 ? (
          <Absent>none</Absent>
        ) : (
          <p className="m-0 text-ink-soft">{unit.flags.join(" · ")}</p>
        )}
      </Section>

      <Section title="Skills" count={unit.skills.length || undefined}>
        {unit.skills.length === 0 ? (
          <Absent>none</Absent>
        ) : (
          unit.skills.map((skill) => (
            <Row
              key={skill.tag}
              label={`${skill.name} ${skill.tag}`}
              value={`${skill.level} · ${skill.points}`}
            />
          ))
        )}
      </Section>

      <Section title="Items" count={items.length || undefined}>
        {items.length === 0 ? (
          <Absent>none</Absent>
        ) : (
          <>
            {items.slice(0, PREVIEW).map((item) => (
              <Row
                key={item.tag}
                label={`${item.name} ${item.tag}`}
                value={item.amount.toLocaleString()}
              />
            ))}
            {items.length > PREVIEW ? (
              <p className="m-0 text-select">+ {items.length - PREVIEW} more</p>
            ) : null}
          </>
        )}
      </Section>
    </CollapsiblePanel>
  );
}
