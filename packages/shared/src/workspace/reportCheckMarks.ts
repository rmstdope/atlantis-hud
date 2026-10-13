/**
 * Which reports have had their ruleset check (ah-fdmb), so a report is checked only the first time
 * it is opened: "opening it again later, after a reload included, never warns again".
 *
 * Kept per game in localStorage, keyed by `openedReportKey` (faction and turn), as the map view is
 * (`mapViewportStorage.ts`). Remembering is a convenience: storage that is missing, blocked or
 * corrupt reads as no marks and never throws, which at worst checks a report a second time.
 */

/** The minimal interface this module needs from any storage backend. */
export type MarkStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Versioned since ah-m6pw, which moved every turn the core derives up by one (the engine makes
 * January of Year 1 turn 1). Marks kept under the unversioned key name each turn one lower, so they
 * are read from there once, moved up by one, and written under this key from then on.
 */
function marksKey(gameId: string): string {
  return `atlantis-hud-ruleset-checked-v2-${gameId}`;
}

function oldCountMarksKey(gameId: string): string {
  return `atlantis-hud-ruleset-checked-${gameId}`;
}

function readMarks(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
}

/** `faction:turn` one turn later; a key whose turn is not a number is kept as it is. */
function onEngineCount(key: string): string {
  const split = key.lastIndexOf(":");
  const turn = Number(key.slice(split + 1));
  return split >= 0 && key.slice(split + 1) !== "" && Number.isInteger(turn)
    ? `${key.slice(0, split)}:${turn + 1}`
    : key;
}

/** localStorage, or `null` where there is none or it may not be touched. */
export function optionalMarkStorage(): MarkStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The reports of `gameId` already checked. */
export function checkedKeys(storage: MarkStorage | null, gameId: string): Set<string> {
  try {
    const current = storage?.getItem(marksKey(gameId)) ?? null;
    if (current !== null) {
      return new Set(readMarks(current));
    }
    return new Set(readMarks(storage?.getItem(oldCountMarksKey(gameId)) ?? "[]").map(onEngineCount));
  } catch {
    return new Set();
  }
}

/** Marks `keys` of `gameId` as checked, alongside those already marked. */
export function markChecked(storage: MarkStorage | null, gameId: string, keys: readonly string[]): void {
  try {
    const all = checkedKeys(storage, gameId);
    keys.forEach((key) => all.add(key));
    storage?.setItem(marksKey(gameId), JSON.stringify([...all]));
  } catch {
    // A mark that cannot be written costs at most a second check of the same report.
  }
}

/**
 * Takes the mark off `keys` of `gameId`: reports marked before their check, whose check then could
 * not run (the rulesets could not be read), so their first real opening is still to come.
 */
export function unmarkChecked(storage: MarkStorage | null, gameId: string, keys: readonly string[]): void {
  try {
    const all = checkedKeys(storage, gameId);
    keys.forEach((key) => all.delete(key));
    storage?.setItem(marksKey(gameId), JSON.stringify([...all]));
  } catch {
    // As above: at worst the report is not checked again.
  }
}
