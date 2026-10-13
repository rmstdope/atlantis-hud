/**
 * The AtlaClient sighting cap a game database stored below version 8 takes (ah-vtgk).
 *
 * The turn move the same upgrade makes below version 7 (ah-m6pw) is not here: which stored fields
 * hold a turn is the core's one list (`atlantis_hud_core::stored_turns`, ah-aguu), asked through
 * `rowOnEngineTurns` in `webStore.ts`.
 *
 * Pure, and kept apart from the store, because vitest has no IndexedDB: the upgrade in
 * `webStore.ts` only walks each store and writes back what this returns (`rewriteStore`).
 */

type Row = Record<string, unknown>;

/**
 * The `mergedFactionId` an AtlaClient map's merge is filed under. Must equal
 * `ATLACLIENT_SOURCE_ID` in `crates/core/src/report/atlaclient.rs` (and in
 * `packages/shared/src/atlaClientImport.ts`, which this package does not depend on).
 */
const ATLACLIENT_SOURCE_ID = "atlaclient";

/**
 * The newest imported turn of every faction holding an AtlaClient merge (ah-vtgk).
 *
 * Before ah-m6pw an AtlaClient map's stamps were already the engine's turns while HUD numbered its
 * own one lower, so a hex merged from one was stored a turn too new, and the turn move
 * keeps that difference. Nothing records which sighting came from AtlaClient, so the repair is the
 * bound that always holds: no sighting is newer than the newest report of the faction it is filed
 * under. Migration 16 makes the same repair to a desktop game, and a version-1 backup's restore to
 * the file.
 *
 * Takes the merge rows and the imported turns' keys (`[factionId, turnNumber]`), so the upgrade
 * never has to read a whole report to learn its turn.
 */
export function atlaClientCaps(
  mergedReports: readonly unknown[],
  importedTurnKeys: readonly unknown[]
): Map<string, number> {
  const merged = new Set<string>();
  for (const merge of mergedReports) {
    const row = merge as Row;
    if (row.mergedFactionId === ATLACLIENT_SOURCE_ID && typeof row.factionId === "string") {
      merged.add(row.factionId);
    }
  }
  const caps = new Map<string, number>();
  for (const key of importedTurnKeys) {
    if (!Array.isArray(key)) {
      continue;
    }
    const [factionId, turnNumber] = key as unknown[];
    if (typeof factionId === "string" && typeof turnNumber === "number" && merged.has(factionId)) {
      caps.set(factionId, Math.max(caps.get(factionId) ?? turnNumber, turnNumber));
    }
  }
  return caps;
}

/** The sighting no newer than its faction's cap; one with no cap, or under it, comes back as is. */
export function capAtlaClientSighting<T extends Row>(row: T, caps: ReadonlyMap<string, number>): T {
  const cap = typeof row.factionId === "string" ? caps.get(row.factionId) : undefined;
  return cap !== undefined && typeof row.lastSeenTurn === "number" && row.lastSeenTurn > cap
    ? { ...row, lastSeenTurn: cap }
    : row;
}
