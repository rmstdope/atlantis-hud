/**
 * How one row of the *Merged reports* panel names where its hexes came from.
 *
 * A pure function rather than a test on the component: `packages/shared` has no jsdom, so a
 * `*.test.tsx` there renders with `renderToStaticMarkup` and could not observe this any better
 * than reading it directly (`packages/shared/src/testing/README.md`, ah-nass).
 */

import { ATLACLIENT_SOURCE_ID } from "../atlaClientImport";

/**
 * The name and its `(id)` suffix, or the name alone.
 *
 * A map imported from AtlaClient is filed under a reserved id rather than a faction number - it
 * names no faction - so `AtlaClient, turn 16 (atlaclient)` would show the player a parenthesis
 * that means nothing to them.
 */
export function mergedFactionLabel(record: {
  mergedFactionId: string;
  mergedFactionName: string;
}): string {
  return record.mergedFactionId === ATLACLIENT_SOURCE_ID
    ? record.mergedFactionName
    : `${record.mergedFactionName} (${record.mergedFactionId})`;
}
