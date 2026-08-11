import type { Coordinate, OrderDiagnostic } from "@atlantis/core-client";
import { abbreviateDirection, SURFACE, type HexNode } from "../hexMapModel";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { Absent, Field, Row, Section, StaleBanner } from "./primitives";

/**
 * Everything the report says about the selected hex. Purely informational, as the issue requires:
 * nothing here is interactive.
 *
 * Every line is written out, however many a city carries: the pane scrolls, and a "+ N more"
 * that nothing could expand left the raw report as the only way to the full list. Scrolling is
 * better than not knowing.
 */
export function RegionPanel({
  hex,
  unknown = null,
  problems = []
}: {
  hex: HexNode | null;
  /**
   * The hex that is selected when no report has ever described it.
   *
   * Clicking empty ground is how a player finds out which hex an ally's coordinates name, so the
   * panel has to answer with the coordinates and with the honest nothing that goes with them.
   */
  unknown?: Coordinate | null;
  /**
   * What order validation found in this hex, unit-level and hex-level alike.
   *
   * Shown here rather than only in the orders panel because a good half of it is nobody's line:
   * "nobody is guarding this hex" belongs to the hex, and so does a shared purse that will not
   * stretch. The orders panel keeps showing what belongs to the selected unit.
   */
  problems?: OrderDiagnostic[];
}) {
  const stale = hex?.knowledge === "stale";
  const asOf = stale && hex.lastSeenTurn !== null ? `as of turn ${hex.lastSeenTurn}` : null;

  if (!hex) {
    return (
      <CollapsiblePanel
        panel="region"
        title="Region"
        hint={unknown ? `— unexplored (${unknown.x},${unknown.y})` : undefined}
      >
        {unknown ? (
          <Absent>
            Nothing is known about this hex. No report has described it, and no neighbour has named
            it{unknown.z === SURFACE ? "" : `, on level ${unknown.z}`}.
          </Absent>
        ) : (
          <Absent>No hex selected.</Absent>
        )}
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

      <Problems problems={problems} />

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
              {region.wanted.map((item) => (
                <Row
                  key={item.tag}
                  label={`${item.name} ${item.tag}`}
                  value={`$${item.price} ×${item.amount}`}
                />
              ))}
            </Section>
          ) : null}

          {region.forSale.length > 0 ? (
            <Section title="For sale" count={region.forSale.length}>
              {region.forSale.map((item) => (
                <Row
                  key={item.tag}
                  label={`${item.name} ${item.tag}`}
                  value={`$${item.price} ×${item.amount}`}
                />
              ))}
            </Section>
          ) : null}

          <Section title="Exits">
            {region.exits.length === 0 ? (
              <Absent>none reported</Absent>
            ) : (
              region.exits.map((exit) => (
                <p key={exit.direction} className="m-0 text-ink-soft">
                  {/* The shorthand MOVE orders are written in, not the report's long name. */}
                  {abbreviateDirection(exit.direction)} — {exit.terrain} ({exit.coordinate.x},
                  {exit.coordinate.y}) in {exit.province}
                </p>
              ))
            )}
          </Section>

          <Section title="Structures" count={region.structures.length}>
            {region.structures.length === 0 ? (
              <Absent>none reported</Absent>
            ) : (
              region.structures.map((structure) => (
                <p key={structure.structureId} className="m-0 text-ink-soft">
                  {structure.name} [{structure.structureId}] · {structure.kind}
                  {structure.needs === null ? null : `, needs ${structure.needs}`}
                </p>
              ))
            )}
          </Section>
        </>
      )}
    </CollapsiblePanel>
  );
}

/**
 * What order validation found in this hex.
 *
 * Absent entirely when there is nothing to say. A section reading "none reported" every turn is a
 * line of furniture in a panel that is short of room, and unlike products or structures the
 * absence of a problem is not a fact anyone came here to check.
 *
 * A finding that names a unit says which; one that does not is the hex's own.
 */
function Problems({ problems }: { problems: OrderDiagnostic[] }) {
  if (problems.length === 0) {
    return null;
  }

  return (
    <Section title="Problems" count={problems.length}>
      <ul data-testid="region-problems" className="m-0 list-none p-0">
        {problems.map((problem, index) => (
          <li
            key={`${problem.code}-${problem.unitId ?? "hex"}-${index}`}
            data-testid="region-problem"
            data-code={problem.code}
            className="flex gap-1.5"
          >
            {problem.unitId === null ? null : (
              <span className="shrink-0 tabular-nums text-ink-dim">{problem.unitId}</span>
            )}
            <span className={problem.severity === "error" ? "text-danger" : "text-warn"}>
              {problem.message}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
