import type { ReportUnit, UnitPreview } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";
import { originalTooltip } from "../unitPreview";
import { describeMen } from "../unitComposition";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { skillEntryId, type GameDataIndex } from "../gameData";
import { highestMagicSkill, type MagicTree } from "../magicTree";
import type { MageStanding } from "../magicStanding";
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
export function UnitPanel({
  unit,
  hex,
  preview = null,
  gameData = null,
  onOpenGameData,
  magicTree = null,
  onOpenMagicTree,
  standing = null
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
}) {
  /** Both must be present: a link with nothing to open is worse than plain text. */
  const linkable = gameData !== null && onOpenGameData !== undefined ? onOpenGameData : null;
  /** The same guard as `linkable`, for the same reason: a door with nothing behind it. */
  const magicLinkable =
    magicTree !== null && onOpenMagicTree !== undefined ? onOpenMagicTree : null;
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
  const mage = magicTree === null ? null : highestMagicSkill(unit.skills, magicTree);

  // What the orders make of the unit, where they touch what this panel shows.
  const nameChange = preview?.changes.find((change) => change.field === "name");
  const flagsChange = preview?.changes.find((change) => change.field === "flags");
  const predictedName = nameChange ? preview?.unit.name : null;
  const predictedFlags = flagsChange ? preview?.unit.flags : null;

  return (
    <CollapsiblePanel
      panel="unit"
      title="Unit"
      hint={`— ${predictedName ?? unit.name} (${unit.unitId})`}
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
        {/*
          A report writes a unit's people and its equipment as one list, so until the report has
          been classified against the item catalogue the count is the leading group only - right
          for most units, wrong for one holding two races. Marking the guess beats presenting it
          as a count.
        */}
        <Field label="Men" value={describeMen(unit)} />
        {unit.weight === null ? null : <Field label="Weight" value={unit.weight} />}
        {unit.capacity === null ? null : <Field label="Capacity" value={unit.capacity} />}
        {unit.structureId === null ? null : <Field label="Structure" value={unit.structureId} />}
      </dl>

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
    </CollapsiblePanel>
  );
}
