import { UNSAFE_FILE_NAME_CHARACTERS } from "./gameBackup";

/**
 * The file a mage sheet is saved as: `mages-<faction>-turn-<n>.txt` (`ah-lyg6.1.1`).
 *
 * The faction goes in by name, because a recipient sorting their downloads reads names rather than
 * numbers; the id is the honest fallback, because a report can carry no faction name at all.
 * Sanitising follows `backupFileName` - each run of characters a file system may refuse becomes one
 * `-` - and additionally collapses each run of whitespace, so a name is one word in a shell.
 */
export function mageSheetFileName(
  factionName: string | null,
  factionId: string | null,
  turnNumber: number | null
): string {
  const faction = safe(factionName) ?? safe(factionId) ?? "unknown";
  const turn = turnNumber === null ? "unknown" : String(turnNumber);
  return `mages-${faction}-turn-${turn}.txt`;
}

function safe(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const cleaned = value
    .trim()
    .replace(UNSAFE_FILE_NAME_CHARACTERS, "-")
    .replace(/\s+/gu, "-");
  return cleaned === "" ? null : cleaned;
}
