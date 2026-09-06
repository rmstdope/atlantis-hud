import type { FieldChange, ReportUnit, UnitPreview } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";
import { originalTooltip } from "../unitPreview";
import { describeMen } from "../unitComposition";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { skillEntryId, type GameDataIndex } from "../gameData";
import { highestMagicSkill, type MagicTree } from "../magicTree";
import type { MageStanding } from "../magicStanding";
import { battleSkillGroups, battleSkillSource } from "../battleSkillPresentation";
import type { DerivedSkill } from "../battleSkills";
import type { TurnMessage } from "../turnMessages";
import { presentUnitMovement } from "../unitMovement";
import {
  Absent,
  Field,
  GameDataItemName,
  GameDataLink,
  Row,
  Section,
  StaleBanner
} from "./primitives";

const PREVIEW = 8;

/**
 * The selected unit in detail. Empty when nothing is selected, as the issue requires.
 *
 * Foreign units are shown in full: inspecting a neighbour is legitimate and useful. It is only
 * *ordering* one that is refused, which the orders panel handles.
 *
 * With an orders preview for the unit, the name and flags show the coming month - the fields the
 * table has no room for - each styled as predicted and carrying what the report said.
 */
export function UnitPanelBody({
  unit,
  hex,
  preview = null,
  gameData = null,
  onOpenGameData,
  magicTree = null,
  onOpenMagicTree,
  standing = null,
  derivedSkills = [],
  events = [],
  totalEvents = 0,
  onOpenEvents
}: {
  unit: ReportUnit | null;
  hex: HexNode | null;
  /** The unit as the orders leave it, when they change it. */
  preview?: UnitPreview | null;
  /**
   * The game-data dictionary, needed here rather than only in the dialog because an item's
   * category - and so its entry id - is not knowable from its tag alone.
   */
  gameData?: GameDataIndex | null;
  /** Absent while the ruleset has not loaded; nothing is then linked. */
  onOpenGameData?: (entryId: string) => void;
  /** The magic study tree, for deciding whether this unit is a mage and where the tree opens. */
  magicTree?: MagicTree | null;
  /** Absent while the ruleset has not loaded; the study-tree row is then not offered. */
  onOpenMagicTree?: (tag: string) => void;
  /**
   * Where this unit stands in the magic study tree, when it is one of the faction's own mages.
   * Null leaves the row reading `Mage` exactly as it did before `ah-67h8`.
   */
  standing?: MageStanding | null;
  /**
   * Combat skills recovered from battle rosters for this unit (`ah-1mpx.6.3`), or `[]` for a unit
   * with report-native skills - the two sections are mutually exclusive, and a derived skill never
   * displaces a real one.
   */
  derivedSkills?: readonly DerivedSkill[];
  /** This unit's event lines from the loaded turn, in report order. Empty when it has none. */
  events?: readonly TurnMessage[];
  /** How many events the whole turn has, for the link. 0 means the link is not drawn. */
  totalEvents?: number;
  /** Opens the turn report on its Events tab. Absent means the link is not drawn. */
  onOpenEvents?: () => void;
}) {
  /** Both must be present: a link with nothing to open is worse than plain text. */
  const linkable = gameData !== null && onOpenGameData !== undefined ? onOpenGameData : null;
  /** The same guard as `linkable`, for the same reason: a door with nothing behind it. */
  const magicLinkable =
    magicTree !== null && onOpenMagicTree !== undefined ? onOpenMagicTree : null;
  const stale = hex?.knowledge === "stale";

  if (!unit) {
    return <Absent>No unit selected.</Absent>;
  }

  const items = [...unit.items].sort((left, right) => right.amount - left.amount);
  const mage = magicTree === null ? null : highestMagicSkill(unit.skills, magicTree);
  const movement = preview ? preview.unit.movement : unit.movement;

  // What the orders make of the unit, where they touch what this panel shows. The predicted *name*
  // belongs to the title bar rather than the body, so `unitPanelHint` derives it instead.
  const flagsChange = preview?.changes.find((change) => change.field === "flags");
  const predictedFlags = flagsChange ? preview?.unit.flags : null;

  return (
    <>
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
        {/*
          A report writes a unit's people and its equipment as one list, so until the report has
          been classified against the item catalogue the count is the leading group only - right
          for most units, wrong for one holding two races. Marking the guess beats presenting it
          as a count.
        */}
        <Field label="Men" value={describeMen(unit)} />
        {movement == null ? (
          <>
            {unit.weight === null ? null : <Field label="Weight" value={unit.weight} />}
            {unit.capacity === null ? null : <Field label="Capacity" value={unit.capacity} />}
          </>
        ) : (
          <Field label="Weight" value={movement.load.toLocaleString()} />
        )}
        {unit.structureId === null ? null : <Field label="Structure" value={unit.structureId} />}
      </dl>

      {movement == null ? (
        <Section title="Movement">
          <p className="m-0 text-ink-dim">Movement not disclosed</p>
        </Section>
      ) : (
        <MovementSection
          movement={movement}
          change={preview?.changes.find((item) => item.field === "movement") ?? null}
        />
      )}

      <Section title="Flags">
        {predictedFlags ? (
          <p
            className="m-0 italic text-brass"
            data-predicted="true"
            title={originalTooltip(flagsChange)}
          >
            {predictedFlags.length === 0 ? "none" : predictedFlags.join(" · ")}
          </p>
        ) : unit.flags.length === 0 ? (
          <Absent>none</Absent>
        ) : (
          <p className="m-0 text-ink-soft">{unit.flags.join(" · ")}</p>
        )}
      </Section>

      {/*
        One row per unit rather than one per magic skill: it is a marker as much as a door, and a
        mage's several magic skills all lead to the same picture. It opens on the skill they are
        furthest along in.
      */}
      {mage === null || magicLinkable === null ? null : (
        <p className="m-0 mt-2 text-ink-soft">
          {/* No pronoun: a unit may be a woman, a dozen people, or a dragon. */}
          {standing === null ? (
            "Mage"
          ) : (
            <span className="text-warn">Mage — {standing.counts.open} magic skills open</span>
          )}{" "}
          <button
            type="button"
            data-testid="unit-magic-tree"
            onClick={() => magicLinkable(mage.tag)}
            className="bg-transparent p-0 text-left text-accent underline-offset-2 hover:underline"
          >
            Show in study tree
          </button>
        </p>
      )}

      {unit.own || unit.skills.length > 0 ? (
        <Section title="Skills" count={unit.skills.length || undefined}>
          {unit.skills.length === 0 ? (
            <Absent>none</Absent>
          ) : (
            unit.skills.map((skill) => (
              <Row
                key={skill.tag}
                label={
                  <>
                    {/* The name is the link; the tag beside it is an identifier the eye scans past. */}
                    {linkable ? (
                      <GameDataLink entryId={skillEntryId(skill.tag)} onOpen={linkable}>
                        {skill.name}
                      </GameDataLink>
                    ) : (
                      skill.name
                    )}{" "}
                    {skill.tag}
                  </>
                }

                value={`${skill.level} (${skill.points})`}
              />
            ))
          )}
        </Section>
      ) : (
        <Section title="Skills from battle reports">
          {derivedSkills.length === 0 ? (
            <Absent>
              {"No battle we have seen involved this unit. A report never shows another faction's skills."}
            </Absent>
          ) : (
            battleSkillGroups(derivedSkills).map((group, index) => (
              <div key={index}>
                <p className="m-0 text-ink-soft">
                  {group.skills.map((skill) => `${skill.name.toLowerCase()} ${skill.level}`).join(", ")}
                </p>
                <p className="m-0 text-ink-dim">{battleSkillSource(group, "seen")}</p>
              </div>
            ))
          )}
        </Section>
      )}

      <Section title="Items" count={items.length || undefined}>
        {items.length === 0 ? (
          <Absent>none</Absent>
        ) : (
          <>
            {items.slice(0, PREVIEW).map((item) => (
              <Row
                key={item.tag}
                label={
                  <>
                    <GameDataItemName index={gameData} item={item} onOpen={linkable} />{" "}
                    {item.tag}
                  </>
                }
                value={item.amount.toLocaleString()}
              />
            ))}
            {items.length > PREVIEW ? (
              <p className="m-0 text-select">+ {items.length - PREVIEW} more</p>
            ) : null}
          </>
        )}
      </Section>

      <Section title="Events" count={events.length || undefined}>
        {events.length === 0 ? (
          <Absent>No events for this unit this turn.</Absent>
        ) : (
          <ul data-testid="unit-events" className="m-0 list-none p-0">
            {events.map((message, index) => (
              <li key={index} className="py-0.5">
                {message.verb ? <span className="pr-2 text-ink-dim">{message.verb}</span> : null}
                <span className="text-ink">{message.text}</span>
              </li>
            ))}
          </ul>
        )}
        {totalEvents > 0 && onOpenEvents ? (
          <button
            type="button"
            data-testid="unit-events-all"
            onClick={onOpenEvents}
            className="mt-1 bg-transparent p-0 text-left text-accent underline-offset-2 hover:underline"
          >
            All {totalEvents} events this turn
          </button>
        ) : null}
      </Section>
    </>
  );
}

function MovementSection({
  movement,
  change
}: {
  movement: NonNullable<ReportUnit["movement"]>;
  change: FieldChange | null;
}) {
  const presentation = presentUnitMovement(movement);
  const tone =
    presentation.tone === "danger"
      ? "text-danger"
      : presentation.tone === "brass"
        ? "text-brass"
        : presentation.tone === "select"
          ? "text-select"
          : "text-ink-soft";
  const capacities = [
    ["Fly", "fly", movement.fly],
    ["Ride", "ride", movement.ride],
    ["Walk", "walk", movement.walk]
  ] as const;
  const usable = capacities
    .filter(([, , capacity]) => capacity >= movement.load)
    .map(([label]) => label);
  const explanation =
    movement.status === "overloaded"
      ? `The load is ${movement.load.toLocaleString()}. No movement capacity can carry it.`
      : `The load is ${movement.load.toLocaleString()}. ${usable.join(" and ")} can carry it.`;

  return (
    <Section title="Movement">
      <div className="mb-2">
        <strong
          className={`block font-medium ${change ? "italic text-brass" : tone}`}
          data-predicted={change ? "true" : undefined}
          title={change ? originalTooltip(change) : presentation.label}
        >
          {presentation.label}
        </strong>
        {movement.status === "overloaded" ? null : (
          <span className="text-ink-soft">Fastest available movement</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {capacities.map(([label, mode, capacity]) => {
          const active = movement.capacityMode === mode;
          return (
            <div
              key={mode}
              className={`rounded border border-edge px-2 py-1 ${
                active ? `${tone} font-medium` : "text-ink-soft"
              }`}
            >
              <div>{label}</div>
              <div className="tabular-nums">{capacity.toLocaleString()}</div>
            </div>
          );
        })}
      </div>
      <p className="m-0 mt-2 text-ink-soft">{explanation}</p>
    </Section>
  );
}

/**
 * What the unit's title bar says about it: the `— name (id)` hint and the stale-turn marker.
 *
 * Pulled out of the panel because the shared Unit/Movement slot's title bar is a tab strip with no
 * room for either, so the Unit tab renders these as its own first line instead (ah-zh5i.2). The
 * name is the predicted one where the orders rename the unit, exactly as the panel always showed it.
 */
export function unitPanelHint(
  unit: ReportUnit | null,
  hex: HexNode | null,
  preview: UnitPreview | null
): { hint: string | undefined; asOf: string | null } {
  const stale = hex?.knowledge === "stale";
  const asOf = stale && hex.lastSeenTurn !== null ? `as of turn ${hex.lastSeenTurn}` : null;
  if (!unit) {
    return { hint: undefined, asOf };
  }
  const nameChange = preview?.changes.find((change) => change.field === "name");
  const predictedName = nameChange ? preview?.unit.name : null;
  return { hint: `— ${predictedName ?? unit.name} (${unit.unitId})`, asOf };
}

/**
 * The selected unit in detail, as a panel of its own.
 *
 * This is the movement planner's off path, which is the default and so almost every player: no tab
 * strip, no `Plan move`, exactly the panel that has always been here. With the planner on, the
 * shared slot renders `UnitPanelBody` and `unitPanelHint` itself.
 */
export function UnitPanel(props: Parameters<typeof UnitPanelBody>[0]) {
  const { hint, asOf } = unitPanelHint(props.unit, props.hex, props.preview ?? null);

  return (
    <CollapsiblePanel panel="unit" title="Unit" hint={hint} asOf={asOf}>
      <UnitPanelBody {...props} />
    </CollapsiblePanel>
  );
}
