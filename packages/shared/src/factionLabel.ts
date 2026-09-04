/**
 * How a report names its own faction.
 *
 * Its own module rather than `reportLoad.ts`'s: `mageSheetImport.ts` needs it for its refusal
 * messages, and `reportLoad.ts` needs `mageSheetImport.ts` for `routeReport` - a cycle.
 */

import type { ParsedReport } from "@atlantis/core-client";

/**
 * How a report names its own faction, as `Borg TNG (95)`, or `null` when it names none.
 *
 * The header has always shown this; the foreign-report prompt needs it too, and for two reports at
 * once. A report with an id and no name still has something to say, so it says that rather than
 * nothing - but a header with no report loaded shows no faction at all, which is why this stays
 * nullable rather than inventing a placeholder here.
 */
export function factionLabelOf(report: ParsedReport | null): string | null {
  const name = report?.header.factionName;
  const id = report?.header.factionId;
  if (name && id) {
    return `${name} (${id})`;
  }
  return name ?? id ?? null;
}
