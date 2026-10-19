/**
 * How a sentence names a unit (`ah-uxaw`), mirroring the core's `orders::naming`.
 *
 * A unit the report shows reads `Ivanhoe (683)`. A unit this month's `FORM` creates has no number
 * yet, so it reads by the alias the player writes for it (`rules/form`: "The new unit can then be
 * referred to as NEW in place of the regular unit number") followed by the unit whose orders form
 * it: `new 1, formed by Ivanhoe (683)`. The words are the navigator's
 * (`docs/ui/ah-uxaw-formed-unit-name.html`).
 */

/** The prefix the core files a formed unit's id under (`effects::FORMED_ID_PREFIX`). */
const FORMED_PREFIX = "new-";

/** What a formed phrase carries between its alias and its former. */
const FORMED_BY = ", formed by ";

/** A unit as a sentence needs it: the shape of `ItemChangeParty` and `StudyTeacher`. */
export type SentenceUnit = {
  unitId: string;
  name: string | null;
  /** The unit whose orders form it, as a sentence names that unit; absent for a reported unit. */
  formedBy?: string | null;
};

/**
 * `Ivanhoe (683)`; `new 1, formed by Ivanhoe (683)` for a formed unit, or `new 1` alone where the
 * core could not say who formed it - never `Unit (new 1) (new-1)`; `unit 1502` where no name is known.
 */
export function unitInSentence(unit: SentenceUnit): string {
  if (unit.unitId.startsWith(FORMED_PREFIX)) {
    const alias = `new ${unit.unitId.slice(FORMED_PREFIX.length)}`;
    return unit.formedBy == null ? alias : `${alias}${FORMED_BY}${unit.formedBy}`;
  }
  return unit.name === null ? `unit ${unit.unitId}` : `${unit.name} (${unit.unitId})`;
}

/**
 * `label` as it stands when the sentence goes on after it: a formed phrase is set off by commas,
 * so it gains its closing one; every other label is returned as it is.
 */
export function midSentence(label: string): string {
  return label.includes(FORMED_BY) ? `${label},` : label;
}
