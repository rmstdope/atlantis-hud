/**
 * How unit ids order.
 *
 * One module, imported by both the units table and the map's default-unit pick, so the two cannot
 * drift apart. It imports nothing, which keeps it out of any cycle between them.
 */

/** Ids are numbers the report hands over as strings, so "9" must not beat "10". */
export function idNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * How two unit ids order: as numbers, with a formed unit's placeholder id ("new-1") last.
 *
 * Two placeholders are compared by code point rather than `localeCompare`: an id is machine text,
 * never a name a person reads, so it must not resolve against the environment's locale.
 */
export function compareUnitIds(left: string, right: string): number {
  const leftNumber = idNumber(left);
  const rightNumber = idNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }
  if (leftNumber !== rightNumber) {
    return leftNumber === null ? 1 : -1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}
