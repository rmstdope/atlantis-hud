/**
 * What a committed mage sheet is named, and how one is told from another.
 *
 * The twin of `reportFixtures.ts` for `tests/fixtures/mage-sheets/`. A mage sheet is a report
 * fragment written by `export_mage_sheet`, not a turn report, so it gets a directory and a naming
 * rule of its own - the reports' pattern with a `mages-` prefix and an optional variant (ah-fu0j).
 */
export const MAGE_SHEET_NAME =
  /^mages-([a-z]+)-(\d+\.\d+\.\d+)-g(\d+)-f(\d+)-t(\d+)(?:-([a-z][a-z0-9-]*))?\.txt$/;

export type ParsedMageSheetName = {
  ruleset: string;
  version: string;
  game: string;
  faction: string;
  turn: string;
  /** `trimmed`, or null for the plain sheet of that game, faction and turn. */
  variant: string | null;
};

/** Parses a mage sheet's filename, or `null` when it does not match the naming rule. */
export function parseMageSheetName(name: string): ParsedMageSheetName | null {
  const match = MAGE_SHEET_NAME.exec(name);
  if (!match) {
    return null;
  }
  const [, ruleset, version, game, faction, turn, variant] = match;
  return { ruleset, version, game, faction, turn, variant: variant ?? null };
}

/** The key that makes two mage sheets duplicates: same game, faction, turn and variant. */
export function duplicateMageSheetKey(parsed: ParsedMageSheetName): string {
  return `g${parsed.game}-f${parsed.faction}-t${parsed.turn}-${parsed.variant ?? ""}`;
}
