/**
 * Recognising a map exported by **AtlaClient**, another Atlantis client, on the way in - and
 * reading how old the hexes in it are.
 *
 * AtlaClient writes its map in the game's own region syntax with no header of any kind, so it
 * parses as a report and would otherwise take the report path. What tells it apart is the turn
 * stamp it welds onto each region's underline: `;16` for a hex as new as the file, `;16-11` for
 * one last seen on turn 11, `;16-0` for one AtlaClient cannot date.
 *
 * **Why this is judged here rather than asked of the core.** The same split this repository already
 * makes: the *merge decision* lives in the core so the two shells cannot answer differently, while
 * *routing* - `isMapExport`, `isMageSheet`, `isOrdersFile` - is judged in the shell, synchronously,
 * before anything is prepared. What is duplicated is one regex, and the committed fixture is
 * asserted against in both languages, which is a stronger cross-language check than the map
 * export's own marker has.
 */

/**
 * The stamp AtlaClient welds onto a region's underline.
 *
 * Must match `read_stamp` in `crates/core/src/report/atlaclient.rs`: at least three dashes, a
 * semicolon, the turn the file was written on, and optionally the turn that hex was last seen.
 * Nothing compiles a check between the two; the committed fixture is what catches a divergence,
 * because both languages assert the same counts against it.
 */
export const ATLACLIENT_STAMP = /^-{3,};(\d+)(?:-(\d+))?$/;

/**
 * The `merged_faction_id` a map imported from AtlaClient is filed under.
 *
 * Must equal `ATLACLIENT_SOURCE_ID` in `crates/core/src/report/atlaclient.rs`.
 */
export const ATLACLIENT_SOURCE_ID = "atlaclient";

/**
 * One stamp's two numbers, or `null` when the line is not a stamp.
 *
 * The line is trimmed first: AtlaClient is a Windows program, so a real export may arrive with
 * CRLF line endings, and the pattern is anchored at `$` - an untrimmed `\r` would never match and
 * the whole file would silently fall through to the report path.
 */
function readStamp(line: string): { fileTurn: number; seen: number } | null {
  const match = ATLACLIENT_STAMP.exec(line.trim());
  if (match === null) {
    return null;
  }
  const fileTurn = Number(match[1]);
  const seen = match[2] === undefined ? fileTurn : Number(match[2]);
  return { fileTurn, seen };
}

/** Whether this file is a map exported by AtlaClient, judged on any line carrying a stamp. */
export function isAtlaClientMap(text: string): boolean {
  return text.split("\n").some((line) => readStamp(line) !== null);
}

/** How old an AtlaClient map's hexes are, for the words the prompt says. */
export type AtlaClientAges = {
  /** The turn the file was written on: the largest number before a dash on any stamp. */
  fileTurn: number;
  /** Hexes stamped as of `fileTurn`. */
  currentHexes: number;
  /** Hexes stamped with an earlier turn above zero. */
  olderHexes: number;
  /** The earliest of those, or `null` when `olderHexes` is zero. */
  oldestTurn: number | null;
  /** Hexes stamped `-0`, which AtlaClient writes when it does not know when it saw them. */
  undatedHexes: number;
};

/**
 * The spread of turns an AtlaClient map covers, or `null` when the text carries no stamp at all.
 *
 * Counted from the stamps rather than from the parsed regions, which can legitimately differ: a
 * region the player annotated in AtlaClient carries their note in front of the terrain, and such a
 * header is not recognised as one, so its hex is dropped while its stamp is still read here.
 */
export function readAtlaClientAges(text: string): AtlaClientAges | null {
  const stamps = text
    .split("\n")
    .map(readStamp)
    .filter((stamp): stamp is { fileTurn: number; seen: number } => stamp !== null);
  if (stamps.length === 0) {
    return null;
  }

  // The maximum rather than the first: AtlaClient writes the same number on every stamp, so this
  // is that number, and it stays total for a hand-edited file too.
  const fileTurn = Math.max(...stamps.map((stamp) => stamp.fileTurn));
  const older = stamps.filter((stamp) => stamp.seen > 0 && stamp.seen < fileTurn);

  return {
    fileTurn,
    currentHexes: stamps.filter((stamp) => stamp.seen >= fileTurn).length,
    olderHexes: older.length,
    oldestTurn: older.length === 0 ? null : Math.min(...older.map((stamp) => stamp.seen)),
    undatedHexes: stamps.filter((stamp) => stamp.seen === 0).length
  };
}
