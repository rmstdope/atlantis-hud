import type { ReportUnit, UnitSilver } from "@atlantis/core-client";
import { useSettingsStore } from "../settingsStore";
import { battleSkillGroups, battleSkillSource } from "../battleSkillPresentation";
import type { DerivedSkill } from "../battleSkills";
import { summariseUnit, type Point } from "../unitTooltip";
import { Absent, Row, Section } from "./primitives";
import { TooltipPortal } from "./TooltipPortal";

/**
 * A unit's full skills and items, shown where the pointer came to rest.
 *
 * Portalled and placed by `TooltipPortal`, which the per-cell popup shares (`ah-rgkk.1`), so the
 * two land the same way and avoid the edges of the window by the same arithmetic.
 */
export function UnitTooltip({
  unit,
  at,
  silver = null,
  warned = false,
  derivedSkills = [],
  dissolving = null
}: {
  unit: ReportUnit;
  at: Point;
  /** This unit's silver forecast, where it has one. `ah-1wcw.1`. */
  silver?: UnitSilver | null;
  /** Whether this unit carries the `not-enough-silver` finding, which the note explains. */
  warned?: boolean;
  /**
   * Combat skills recovered from battle rosters for this unit (`ah-1mpx.6.3`), or `[]` for a unit
   * with report-native skills or nothing recovered - in which case the tooltip draws exactly as it
   * always has.
   */
  derivedSkills?: readonly DerivedSkill[];
  /**
   * Set on a row `rules/form` dissolves, naming the unit its goods revert to - or `into: null`
   * where the hex shows no own unit of ours (`ah-ty3s.3`).
   */
  dissolving?: { into: string | null } | null;
}) {
  // The Silver column's upkeep setting also decides the hover's fifth row (`ah-1wcw.4`).
  const countUpkeep = useSettingsStore((state) => state.countUpkeep);
  const summary = summariseUnit(unit, silver, warned, countUpkeep, dissolving);
  const groups = derivedSkills.length > 0 ? battleSkillGroups(derivedSkills) : [];

  return (
    <TooltipPortal at={at} anchorKey={unit.unitId} testId="unit-tooltip">
      {groups.length > 0 ? (
        <>
          <p className="m-0 font-medium text-brass">
            {unit.name} ({unit.unitId}) — skills
          </p>

          <Section title="Skills">
            {groups.map((group, index) => (
              <div key={index}>
                <p className="m-0">
                  {group.skills.map((skill) => `${skill.name.toLowerCase()} ${skill.level}`).join(", ")}
                </p>
                <p className="m-0 text-ink-dim">{battleSkillSource(group, "read")}</p>
              </div>
            ))}
            <p className="m-0 text-ink-dim">A report never shows another faction&apos;s skills.</p>
          </Section>

          <Section title="Items" count={summary.items.length || undefined}>
            {summary.items.length === 0 ? (
              <Absent>none</Absent>
            ) : (
              summary.items.map((item) => <Row key={item.label} label={item.label} value={item.value} />)
            )}
          </Section>
        </>
      ) : (
        <>
          <p className="m-0 font-medium text-brass">{summary.title}</p>

          <Section title="Skills" count={summary.skills.length || undefined}>
            {summary.skills.length === 0 ? (
              <Absent>none</Absent>
            ) : (
              summary.skills.map((skill) => (
                <Row key={skill.label} label={skill.label} value={skill.value} />
              ))
            )}
          </Section>

          <Section title="Items" count={summary.items.length || undefined}>
            {summary.items.length === 0 ? (
              <Absent>none</Absent>
            ) : (
              summary.items.map((item) => <Row key={item.label} label={item.label} value={item.value} />)
            )}
          </Section>
        </>
      )}

      {/* Outside the skills/items ternary, so it cannot be lost if the battle-skills branch ever
          applies to one of our own units. */}
      {summary.note ? <p className="m-0 mt-1 text-pane-sm text-warn">{summary.note}</p> : null}

      {summary.silver ? (
        <Section title="Silver">
          {summary.silver.rows.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
          {summary.silver.note ? (
            // `whitespace-pre-line` is what makes a second note a second line: the note joins every
            // sentence that applies with a newline, and JSX would otherwise collapse it to a space
            // (`ah-x36v`). Runs of spaces still collapse, so a single-sentence note is unaffected.
            <p className="m-0 mt-1 whitespace-pre-line text-pane-sm text-ink-dim">
              {summary.silver.note}
            </p>
          ) : null}
        </Section>
      ) : null}
    </TooltipPortal>
  );
}
