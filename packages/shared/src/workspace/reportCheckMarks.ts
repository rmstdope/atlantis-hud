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

function marksKey(gameId: string): string {
  return `atlantis-hud-ruleset-checked-${gameId}`;
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
    const parsed: unknown = JSON.parse(storage?.getItem(marksKey(gameId)) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
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
