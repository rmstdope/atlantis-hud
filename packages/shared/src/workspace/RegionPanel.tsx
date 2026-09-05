import { Fragment } from "react";
import type { Coordinate, CoreClient, MapLevel, OpenedGame, OrderDiagnostic } from "@atlantis/core-client";
import { structureEntryId, type GameDataIndex } from "../gameData";
import { resourceChecksOf } from "../resourceChecks";
import { abbreviateDirection, levelClause, regionIdOf, type HexNode } from "../hexMapModel";
import { structureLabelParts } from "../structureLabel";
import { useWorkspaceStore } from "../workspaceStore";
import { CollapsiblePanel } from "./CollapsiblePanel";
import {
  Absent,
  Field,
  GameDataItemName,
  GameDataLink,
  PROBLEM_CARD,
  ProblemMessage,
  ProblemWho,
  Row,
  Section,
  SeverityMark,
  StaleBanner
} from "./primitives";
import { RegionNotes } from "./RegionNotes";
import { manifestSegments } from "./vesselManifest";

/**
 * Everything the report says about the selected hex, plus the one interactive exception: the
 * Notes section (ah-o1t) lets the player write, edit and remove notes pinned to the hex.
 *
 * Every line is written out, however many a city carries: the pane scrolls, and a "+ N more"
 * that nothing could expand left the raw report as the only way to the full list. Scrolling is
 * better than not knowing.
 */
export function RegionPanel({
  hex,
  unknown = null,
  levels = [],
  problems = [],
  client,
  game,
  turn,
  known,
  onSelectUnit,
  gameData = null,
  onOpenGameData
}: {
  hex: HexNode | null;
  /**
   * The hex that is selected when no report has ever described it.
   *
   * Clicking empty ground is how a player finds out which hex an ally's coordinates name, so the
   * panel has to answer with the coordinates and with the honest nothing that goes with them.
   */
  unknown?: Coordinate | null;
  /** The known map's levels, so an unexplored hex off the surface can be named in its sentence. */
  levels?: MapLevel[];
  /**
   * What order validation found in this hex, unit-level and hex-level alike.
   *
   * Shown here rather than only in the orders panel because a good half of it is nobody's line:
   * "nobody is guarding this hex" belongs to the hex, and so does a shared purse that will not
   * stretch. The orders panel keeps showing what belongs to the selected unit.
   */
  problems?: OrderDiagnostic[];
  client: CoreClient;
  game: OpenedGame | null;
  turn: number | null;
  /** The unit ids the loaded turn describes, so only a unit that can be reached becomes a button. */
  known?: ReadonlySet<string>;
  /**
   * Go and look at a unit named in a problem.
   *
   * Threaded from `AppShell` rather than read from the store: the unit-to-region lookup lives in
   * `AppShell`'s `unitRegions` memo, so there is nothing in the store to read.
   */
  onSelectUnit?: (unitId: string, regionId?: string) => void;
  /**
   * The game-data dictionary, needed here rather than only in the dialog because an item's
   * category - and so its entry id - is not knowable from its tag alone.
   */
  gameData?: GameDataIndex | null;
  /** Absent while the ruleset has not loaded; nothing is then linked. */
  onOpenGameData?: (entryId: string) => void;
}) {
  /** Both must be present: a link with nothing to open is worse than plain text. */
  const linkable = gameData !== null && onOpenGameData !== undefined ? onOpenGameData : null;
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
            it{levelClause(levels, unknown.z)}.
          </Absent>
        ) : (
          <Absent>No hex selected.</Absent>
        )}
        {unknown ? (
          <RegionNotes regionId={regionIdOf(unknown)} client={client} game={game} turn={turn} />
        ) : null}
      </CollapsiblePanel>
    );
  }

  const region = hex.region;
  // No `useMemo`: this component returns early above (`if (!hex)`), so a hook here would break the
  // rules of hooks. The computation is a handful of array walks over one hex.
  const checks = region === null ? [] : resourceChecksOf(region, gameData);

  return (
    <CollapsiblePanel
      panel="region"
      title="Region"
      hint={`— ${hex.terrain} (${hex.coordinate.x},${hex.coordinate.y})`}
      asOf={asOf}
      actions={problems.length > 0 ? <RegionProblemsToggle count={problems.length} /> : null}
    >
      {stale && hex.lastSeenTurn !== null ? (
        <StaleBanner lastSeenTurn={hex.lastSeenTurn} ageInTurns={hex.ageInTurns ?? 0} />
      ) : null}

      <Problems
        problems={problems}
        regionId={hex.regionId}
        known={known}
        onSelectUnit={onSelectUnit}
      />

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

          {region.products.length > 0 || checks.length > 0 ? (
            <Section title="Products">
              {/*
                Prose rather than rows, so the line is built as fragments: joining it into one
                string first and injecting links afterwards is how the amounts end up linked too.
              */}
              <p className="m-0 text-ink-soft">
                {region.products.map((item, position) => (
                  <Fragment key={item.tag}>
                    {position === 0 ? null : " · "}
                    {item.amount}{" "}
                    <GameDataItemName index={gameData} item={item} onOpen={linkable} />
                  </Fragment>
                ))}
                {/*
                  A resource the terrain may hold that the report did not name: `0 floater hide`
                  where a skilled unit of yours stood and found none, `mushroom?` where nobody
                  here could tell. Italic, as this pane already writes anything that is not a
                  figure the report printed.
                */}
                {checks.map((check, position) => (
                  <Fragment key={`check:${check.tag}`}>
                    {region.products.length + position === 0 ? null : " · "}
                    {check.state === "absent" ? (
                      <span
                        className="italic"
                        title={`A unit with ${check.skill.skillName} ${check.skill.level} stands here, and the report names no ${check.name}.`}
                      >
                        0 <GameDataItemName index={gameData} item={check} onOpen={linkable} />
                      </span>
                    ) : (
                      <span
                        className="italic text-ink-dim"
                        title={`No unit of yours here has ${check.skill.skillName} ${check.skill.level}, so whether this hex holds ${check.name} is unknown.`}
                      >
                        <GameDataItemName index={gameData} item={check} onOpen={linkable} />?
                      </span>
                    )}
                  </Fragment>
                ))}
              </p>
            </Section>
          ) : null}

          {region.wanted.length > 0 ? (
            <Section title="Wanted" count={region.wanted.length}>
              {region.wanted.map((item) => (
                <Row
                  key={item.tag}
                  label={
                    <>
                      <GameDataItemName index={gameData} item={item} onOpen={linkable} /> {item.tag}
                    </>
                  }
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
                  label={
                    <>
                      <GameDataItemName index={gameData} item={item} onOpen={linkable} /> {item.tag}
                    </>
                  }
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
                  {/*
                    Every NAME in the kind is a catalogue entry, and a fleet's kind names several:
                    `Galley, 40 Galleons, 11 Galleys, 10 Balloons` is four vessels, each with an
                    entry of its own, so each is its own link and the counts stay the player's
                    plain text (ah-t5fk). An ordinary kind is one name and so one link, exactly as
                    before. The structure's own name and its number stay plain: linking
                    `Odds and Ends` would look right and open nothing.
                  */}
                  {structureLabelParts(structure).prefix}
                  {linkable !== null && gameData !== null
                    ? manifestSegments(structure.kind).map((segment, index) => (
                        <Fragment key={`${index}-${segment.name}`}>
                          {index === 0 ? null : ", "}
                          {segment.count === null ? null : `${segment.count} `}
                          <GameDataLink
                            entryId={structureEntryId(gameData, segment.name)}
                            onOpen={linkable}
                          >
                            {segment.name}
                          </GameDataLink>
                        </Fragment>
                      ))
                    : structure.kind}
                  {structure.needs === null ? null : `, needs ${structure.needs}`}
                </p>
              ))
            )}
          </Section>
        </>
      )}

      <RegionNotes regionId={hex.regionId} client={client} game={game} turn={turn} />
    </CollapsiblePanel>
  );
}

/**
 * The header chip that hides the Problems section without losing track of what it hides.
 *
 * Modelled on `MapViewControls`: a real checkbox under styled `label` text, lit while the section is
 * shown. Absent entirely when there is nothing to hide - the caller only renders this when
 * `problems.length > 0`.
 */
function RegionProblemsToggle({ count }: { count: number }) {
  const shown = useWorkspaceStore((state) => state.regionProblemsShown);
  const toggle = useWorkspaceStore((state) => state.toggleRegionProblems);

  return (
    <label
      className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-0.5 text-pane-sm normal-case tracking-normal ${
        shown ? "border-select bg-select/15 text-ink" : "border-edge text-ink-dim"
      }`}
    >
      <input
        type="checkbox"
        checked={shown}
        onChange={toggle}
        aria-label={`Problems ${count}`}
        data-testid="region-problems-toggle"
        className="h-3 w-3 accent-select"
      />
      Problems {count}
    </label>
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
 *
 * Hidden while `regionProblemsShown` is off - the header chip stays put and keeps the count, so
 * the diagnostics are put away rather than lost.
 */
function Problems({
  problems,
  regionId,
  known,
  onSelectUnit
}: {
  problems: OrderDiagnostic[];
  /** The hex these findings are in, which is what tells two `new-1`s apart (`ah-9o0c.2`). */
  regionId: string;
  known?: ReadonlySet<string>;
  onSelectUnit?: (unitId: string, regionId?: string) => void;
}) {
  const shown = useWorkspaceStore((state) => state.regionProblemsShown);

  if (problems.length === 0 || !shown) {
    return null;
  }

  return (
    <Section title="Problems" count={problems.length}>
      <ul data-testid="region-problems" className={`m-0 list-none p-0 ${PROBLEM_CARD}`}>
        {problems.map((problem, index) => (
          <li
            key={`${problem.code}-${problem.unitId ?? "hex"}-${index}`}
            data-testid="region-problem"
            data-code={problem.code}
            className="flex gap-1.5 border-t border-edge-soft px-1.5 py-0.5 first:border-t-0"
          >
            <SeverityMark severity={problem.severity} />
            <ProblemWho
              unitId={problem.unitId}
              formed={problem.formed}
              regionId={regionId}
              known={known}
              onSelectUnit={onSelectUnit}
            />
            <span className="text-ink">
              <ProblemMessage
                message={problem.message}
                known={known}
                onSelectUnit={onSelectUnit}
              />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
