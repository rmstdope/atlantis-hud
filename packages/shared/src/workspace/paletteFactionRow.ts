/**
 * How one faction row of the command palette reads (ah-mlls.3): the attitude word and its colour,
 * and the merged-ally mark. The hover text is `rowTitle`'s, shared with every row.
 *
 * A pure function rather than a test on `CommandPalette`, because `packages/shared` has no jsdom
 * (`testing/README.md`, ah-nass).
 */

import type { PaletteEntry } from "../commandPalette";

export type FactionRow = {
  /** Brass for an ally whose report is merged in, as the faction panel's attitudes list draws it. */
  labelClassName: string | undefined;
  /** ` ⌂` after a merged ally's name, the same mark the attitudes list uses; empty otherwise. */
  mark: string;
  /** The friend-or-foe word. Colour is never the only signal: the word is always there. */
  attitude: { word: string; className: string };
};

/**
 * The attitude's colour. Compared without case: the word is shown in the report's own spelling,
 * whichever that is, and the levels are Ally, Friendly, Neutral, Unfriendly and Hostile
 * (rules/com_attitudes).
 */
function attitudeClass(word: string): string {
  switch (word.toLowerCase()) {
    case "ally":
      return "text-ok";
    case "hostile":
      return "text-danger";
    default:
      return "text-ink-soft";
  }
}

export function factionRow(entry: PaletteEntry): FactionRow {
  const faction = entry.standing ?? { own: false, merged: false, attitude: null };
  const attitude = faction.own
    ? { word: "your faction", className: "text-brass" }
    : faction.attitude === null
      ? { word: "not declared", className: "text-ink-dim italic" }
      : { word: faction.attitude, className: attitudeClass(faction.attitude) };
  return {
    labelClassName: faction.merged ? "text-brass-bright" : undefined,
    mark: faction.merged ? " ⌂" : "",
    attitude
  };
}
