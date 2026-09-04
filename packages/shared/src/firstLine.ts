/**
 * The first line that is not blank, comments included.
 *
 * Its own module so the two files that recognise one of our own formats - `mapExportImport.ts` and
 * `mageSheetImport.ts` - can each read it without importing each other, the same reason
 * `factionLabel.ts` exists.
 *
 * Deliberately *not* `firstNonBlankLine` from `./ordersImport`: that one skips every line starting
 * with `;` on its way to `#atlantis`, and both of our markers are `;` lines, so it would answer the
 * first region header and every marker test would be false. 24 of the 26 committed report fixtures
 * open with `;Treasury:`, so a real turn report's first line is usually a comment too - which is
 * why the test on it is on the line's content and never on the semicolon.
 */
export function firstLineOf(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line !== "") {
      return line;
    }
  }
  return "";
}
