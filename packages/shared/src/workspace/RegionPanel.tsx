import type { HexNode } from "../hexMapModel";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { Absent, Field, Row, Section, StaleBanner } from "./primitives";

/** How many market or structure entries to show before offering the rest as a count. */
const PREVIEW = 6;

/**
 * Everything the report says about the selected hex. Purely informational, as the issue requires:
 * nothing here is interactive.
 *
 * A city can carry two dozen structures and ten market lines, far more than fits, so each section
 * summarises and states what it is holding back rather than silently truncating.
 */
export function RegionPanel({ hex }: { hex: HexNode | null }) {
  const stale = hex?.knowledge === "stale";
  const asOf = stale && hex.lastSeenTurn !== null ? `as of turn ${hex.lastSeenTurn}` : null;

  if (!hex) {
    return (
      <CollapsiblePanel panel="region" title="Region">
        <Absent>No hex selected.</Absent>
      </CollapsiblePanel>
    );
  }

  const region = hex.region;

  return (
    <CollapsiblePanel
      panel="region"
      title="Region"
      hint={`— ${hex.terrain} (${hex.coordinate.x},${hex.coordinate.y})`}
      asOf={asOf}
    >
      {stale && hex.lastSeenTurn !== null ? (
        <StaleBanner lastSeenTurn={hex.lastSeenTurn} ageInTurns={hex.ageInTurns ?? 0} />
      ) : null}

      <p className="m-0 mb-2">
        in {hex.province}
        {hex.settlementName ? (
          <>
            {" · contains "}
            <strong className="font-medium text-brass">{hex.settlementName}</strong>
            {region?.settlement ? ` [${region.settlement.size}]` : null}
          </>
        ) : null}
      </p>

      {!region ? (
        <Absent>
          Known only from a neighbouring hex&apos;s exits. Terrain and province, nothing more.
        </Absent>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-px">
            {region.population === null ? null : (
              <Field
                label="Population"
                value={`${region.population.toLocaleString()}${region.race ? ` ${region.race}` : ""}`}
              />
            )}
            {region.taxBase === null ? null : (
              <Field label="Tax base" value={`$${region.taxBase.toLocaleString()}`} />
            )}
            {region.wages === null ? null : (
              <Field
                label="Wages"
                value={`${region.wages}${region.maxWages === null ? "" : ` (max $${region.maxWages.toLocaleString()})`}`}
              />
            )}
            {region.entertainment === null ? null : (
              <Field label="Entertainment" value={`$${region.entertainment.toLocaleString()}`} />
            )}
          </dl>

          {region.products.length > 0 ? (
            <Section title="Products">
              <p className="m-0 text-ink-soft">
                {region.products.map((item) => `${item.amount} ${item.name}`).join(" · ")}
              </p>
            </Section>
          ) : null}

          {region.wanted.length > 0 ? (
            <Section title="Wanted" count={region.wanted.length}>
              {region.wanted.slice(0, PREVIEW).map((item) => (
                <Row
                  key={item.tag}
                  label={`${item.name} ${item.tag}`}
                  value={`$${item.price} ×${item.amount}`}
                />
              ))}
              <More total={region.wanted.length} shown={PREVIEW} />
            </Section>
          ) : null}

          {region.forSale.length > 0 ? (
            <Section title="For sale" count={region.forSale.length}>
              {region.forSale.slice(0, PREVIEW).map((item) => (
                <Row
                  key={item.tag}
                  label={`${item.name} ${item.tag}`}
                  value={`$${item.price} ×${item.amount}`}
                />
              ))}
              <More total={region.forSale.length} shown={PREVIEW} />
            </Section>
          ) : null}

          <Section title="Exits">
            {region.exits.length === 0 ? (
              <Absent>none reported</Absent>
            ) : (
              region.exits.map((exit) => (
                <p key={exit.direction} className="m-0 text-ink-soft">
                  {exit.direction} — {exit.terrain} ({exit.coordinate.x},{exit.coordinate.y}) in{" "}
                  {exit.province}
                </p>
              ))
            )}
          </Section>

          <Section title="Structures" count={region.structures.length}>
            {region.structures.length === 0 ? (
              <Absent>none reported</Absent>
            ) : (
              <>
                {region.structures.slice(0, PREVIEW).map((structure) => (
                  <p key={structure.structureId} className="m-0 text-ink-soft">
                    {structure.name} [{structure.structureId}] · {structure.kind}
                    {structure.needs === null ? null : `, needs ${structure.needs}`}
                  </p>
                ))}
                <More total={region.structures.length} shown={PREVIEW} />
              </>
            )}
          </Section>
        </>
      )}
    </CollapsiblePanel>
  );
}

function More({ total, shown }: { total: number; shown: number }) {
  if (total <= shown) {
    return null;
  }
  return <p className="m-0 text-select">+ {total - shown} more</p>;
}
