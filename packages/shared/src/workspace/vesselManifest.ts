/** One comma-separated piece of a ship structure's kind: a name, and the count written before it. */
export type ManifestSegment = { name: string; count: number | null };

/**
 * The segments of a structure kind (ah-t5fk).
 *
 * A ship structure's kind is a label followed by the fleet's inventory —
 * `Galley, 40 Galleons, 11 Galleys, 10 Balloons` — while an ordinary building's kind is a single
 * name. Both are the same shape here: one segment, or several.
 *
 * Only the leading integer of a segment is read as a count, because the counts in a real report are
 * always written as numerals; a segment without one carries `count: null` and is nothing but a name.
 *
 * ONE parser, called from two places that use it differently ON PURPOSE:
 *   - `vesselCount` (`mapThemes/hexView.ts`) drops the FIRST segment, because ah-3pr9 established
 *     that the leading word is the fleet's label rather than a vessel — `Cloudship, 14 Cloudships`
 *     totals 14, not 15.
 *   - the region pane (`RegionPanel.tsx`) links EVERY segment, including the first, because it is a
 *     real vessel name with a real dictionary entry and is what keeps `Ship [623] : Galley`
 *     clickable.
 * Do not "fix" that difference to make the two agree: aligning them breaks the Ships badge.
 */
export function manifestSegments(kind: string): ManifestSegment[] {
  return kind.split(",").map((part) => {
    const found = /^\s*(\d+)\b\s*/u.exec(part);
    return found === null
      ? { name: part.trim(), count: null }
      : { name: part.slice(found[0].length).trim(), count: Number(found[1]) };
  });
}
