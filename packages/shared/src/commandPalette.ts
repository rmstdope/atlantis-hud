/**
 * The command palette's decidable parts: what it lists, how a query narrows the list, and where
 * the arrow keys move the highlight. All plain functions - the component only renders them.
 */

import type { HexNoteRecord, StudyPlanRecord } from "@atlantis/core-client";
import { orderEntryId, type GameDataEntry } from "./gameData";
import type { HexNode } from "./hexMapModel";
import type { KnownFaction } from "./paletteFactions";

export type PaletteEntryKind =
  /** One of the player's named Armies (ah-mlls.4); choosing it makes it the units pane's source. */
  | "army"
  | "unit"
  /** A faction the loaded reports know (ah-mlls.3); choosing one opens its details. */
  | "faction"
  | "region"
  /**
   * One village, town or city the player knows of (ah-mlls.2), on a row of its own beside its
   * hex's: the hex row carries no settlement name, so typing a town's name finds exactly one row.
   */
  | "settlement"
  /**
   * One structure standing in the world - `Soggy Saw Mill [1]`, not the dictionary's `Mine`.
   *
   * A separate kind from `building` on purpose (ah-wkwk): since ah-5jkt the palette holds both,
   * and typing `mine` matches a page describing what a Mine costs *and* every Mine on the map.
   * The kind label beside the row is what tells them apart.
   */
  | "structure"
  /**
   * A note the player wrote (ah-mlls.5): on a hex, or on a mage in the study planner. Two kinds
   * rather than one `note`, so the kind word says where choosing it goes, and so the best of each
   * gets its own seat at the top (`filterPalette`, rule 3).
   */
  | "hex-note"
  | "mage-note"
  | "action"
  /** An order of the world's grammar; choosing it opens its game data entry (ah-mlls.6). */
  | "order-help"
  /** One thing in the game data dictionary, named by the tab it opens on. */
  | "skill"
  | "man"
  | "mount"
  | "ship"
  | "monster"
  | "equipment"
  | "building"
  | "terrain";

/**
 * Who owns another faction's unit, as the row shows it beside the kind: `Thane's Ring (10)`, or
 * `Faction not shown` with `concealed` set when the report does not say (`rules/stealthobs`).
 */
export type PaletteFaction = { label: string; concealed: boolean };

export type PaletteEntry = {
  id: string;
  kind: PaletteEntryKind;
  /** What a query is matched against - and the only thing (`filterPalette`). */
  label: string;
  /**
   * The owner of another faction's unit seen this turn, absent for every other row. Shown, never
   * searched (ah-mlls.1): typing a faction's name must not flood the list with all its units, so
   * it is kept out of `label` on purpose.
   */
  faction?: PaletteFaction;
  /** The report turn of a historical map result, absent for current entries. */
  lastSeenTurn?: number;
  /** The key chord shown beside an action, where one exists. */
  binding?: string;
  /**
   * What a `faction` row draws beside its label (ah-mlls.3). Kept out of `label` on purpose: the
   * label is the only text searched, and typing "ally" must not list every ally.
   */
  standing?: Pick<KnownFaction, "own" | "merged" | "attitude">;
  /**
   * Words drawn before the kind word - an Army's `5 units` (ah-mlls.4). Shown, never searched,
   * like `faction`. `quiet` draws them dim and in italics.
   */
  count?: { text: string; quiet: boolean };
  /**
   * Set on a note row only (ah-mlls.5), and what makes it one: `label` then holds the note's whole
   * text, and `place` is the dimmed second line - the hex or the mage it was written on. A note
   * row is matched only as consecutive letters and is never listed with nothing typed
   * (`filterPalette`).
   */
  note?: { place: string };
  /**
   * Set on a greyed row (ah-mlls.7), and what makes it one: why it cannot be chosen right now,
   * written out beside the label. Still matched by `filterPalette`, so the player who types "send"
   * learns why Send is off; never highlighted, never run.
   */
  unavailable?: string;
  run: () => void;
};

/** An app command, as `PaletteInput.actions` takes it. */
export type PaletteAction = {
  id: string;
  label: string;
  binding?: string;
  /** Why the action is greyed right now, or absent when it can be chosen (ah-mlls.7). */
  unavailable?: string;
  /** A dim remark on the right, as an Army's count is drawn - the mage sheet's "no mages" (ah-mlls.8). */
  count?: { text: string; quiet: boolean };
  run: () => void;
};

/**
 * What the palette lists, by source. Every source is optional and an absent one lists nothing, so
 * a new kind of row is a new optional field here and never a required one: a required field
 * breaks every caller that predates it, which is how four sibling beads left main red between
 * them (ah-1xl5; docs/retrospectives/ah-mlls.3.md). The app's own input is assembled in
 * `workspace/paletteInput.ts`.
 */
export type PaletteInput = {
  /** The player's named Armies, in the order the units pane's source rail lists them. */
  armies?: Array<{ armyId: string; name: string; shownCount: number; run: () => void }>;
  ownUnits?: Array<{ unitId: string; name: string; run: () => void }>;
  /** Other factions' units in this turn's report, in report order. */
  foreignUnits?: Array<{
    regionId: string;
    unitId: string;
    name: string;
    faction: PaletteFaction;
    run: () => void;
  }>;
  staleUnits?: Array<{
    regionId: string;
    unitId: string;
    name: string;
    lastSeenTurn: number;
    run: () => void;
  }>;
  /** Every settlement on the known map, labelled by `settlementPaletteRows`. */
  settlements?: Array<{ regionId: string; label: string; lastSeenTurn?: number; run: () => void }>;
  /** Every faction the loaded reports know, in `paletteFactions` order. */
  factions?: Array<KnownFaction & { run: () => void }>;
  regions?: Array<{ regionId: string; label: string; run: () => void }>;
  /** Every structure in this turn's report, labelled by `structurePaletteLabel`. */
  structures?: Array<{
    structureId: string;
    label: string;
    lastSeenTurn?: number;
    run: () => void;
  }>;
  actions?: PaletteAction[];
  /** The world's orders, as the core grammar lists them; each opens its game data entry. */
  orderCommands?: readonly string[];
  /**
   * Every dictionary entry, or [] when the ruleset has not loaded. Its orders are skipped: each is
   * already a row of `orderCommands`, which keeps the row's old place and look (ah-mlls.6).
   */
  gameData?: readonly GameDataEntry[];
  openGameData?: (entryId: string) => void;
  /** Every hex note of the open game, placed by `hexNotePaletteRows`. */
  hexNotes?: Array<{ noteId: string; regionId: string; text: string; place: string; run: () => void }>;
  /** Every non-empty note on a mage seen this turn, placed by `mageNotePaletteRows`. */
  mageNotes?: Array<{ key: string; text: string; place: string; run: () => void }>;
};

/**
 * Everything the palette can offer, in reading order: the player's named Armies (ah-mlls.4), then
 * their units because going to one is the palette's daily use, then other factions' units seen this turn, then units only
 * remembered from older reports - what is true this turn before what was true once (ah-mlls.1).
 * `filterPalette` sorts stably, so this one order is also the tie-break between equal matches.
 * Then the towns and cities, then the factions (ah-mlls.3), then places - the hexes, then the
 * structures standing in them -
 * then the app's own actions, then the order vocabulary, then the game data dictionary. An order
 * row opens the order's dictionary entry (ah-mlls.6); it used to type the keyword into the orders,
 * which the navigator gave up so that every palette row does one thing.
 *
 * The dictionary goes last on purpose: it is two hundred and seventy-odd entries, and an empty
 * query should still show the player's own units first. The tag rides in the label so typing
 * `MITH` finds mithril, and so the palette reads the way the panes already do.
 */
export function buildPaletteEntries(input: PaletteInput): PaletteEntry[] {
  const openGameData = input.openGameData ?? (() => {});
  return [
    // Armies before everything (ah-mlls.4): there are a handful of them, and placed after the
    // player's own units they would sit below dozens of rows until something was typed.
    ...(input.armies ?? []).map<PaletteEntry>((army) => ({
      id: `army-${army.armyId}`,
      kind: "army",
      label: army.name,
      count: armyCountLabel(army.shownCount),
      run: army.run
    })),
    ...(input.ownUnits ?? []).map<PaletteEntry>((unit) => ({
      id: `unit-${unit.unitId}`,
      kind: "unit",
      label: `${unit.name} (${unit.unitId})`,
      run: unit.run
    })),
    ...(input.foreignUnits ?? []).map<PaletteEntry>((unit) => ({
      id: `foreign-unit-${unit.regionId}-${unit.unitId}`,
      kind: "unit",
      label: `${unit.name} (${unit.unitId})`,
      faction: unit.faction,
      run: unit.run
    })),
    ...(input.staleUnits ?? []).map<PaletteEntry>((unit) => ({
      id: `stale-unit-${unit.regionId}-${unit.unitId}`,
      kind: "unit",
      label: `${unit.name} (${unit.unitId})`,
      lastSeenTurn: unit.lastSeenTurn,
      run: unit.run
    })),
    // After every unit and ahead of the hexes: a handful of much-visited places would otherwise
    // sit below hundreds of hexes with nothing typed (ah-mlls.2).
    ...(input.settlements ?? []).map<PaletteEntry>((settlement) => ({
      id: `settlement-${settlement.regionId}`,
      kind: "settlement",
      label: settlement.label,
      lastSeenTurn: settlement.lastSeenTurn,
      run: settlement.run
    })),
    // Right after the towns and cities and ahead of the hexes, so a dozen factions are a short
    // scroll away with nothing typed rather than behind hundreds of hexes (ah-mlls.3).
    ...(input.factions ?? []).map<PaletteEntry>((faction) => ({
      id: `faction-${faction.factionId}`,
      kind: "faction",
      label: `${faction.name ?? "Unnamed faction"} (${faction.factionId})`,
      ...(faction.lastSeenTurn === undefined ? {} : { lastSeenTurn: faction.lastSeenTurn }),
      standing: { own: faction.own, merged: faction.merged, attitude: faction.attitude },
      run: faction.run
    })),
    ...(input.regions ?? []).map<PaletteEntry>((region) => ({
      id: `region-${region.regionId}`,
      kind: "region",
      label: region.label,
      run: region.run
    })),
    ...(input.structures ?? []).map<PaletteEntry>((structure) => ({
      id: `structure-${structure.structureId}`,
      kind: "structure",
      label: structure.label,
      lastSeenTurn: structure.lastSeenTurn,
      run: structure.run
    })),
    // With the places, since a note is about somewhere; never listed with nothing typed, so where
    // they sit here only decides ties (ah-mlls.5).
    ...(input.hexNotes ?? []).map<PaletteEntry>((note) => ({
      id: `hex-note-${note.noteId}`,
      kind: "hex-note",
      label: note.text,
      note: { place: note.place },
      run: note.run
    })),
    ...(input.mageNotes ?? []).map<PaletteEntry>((note) => ({
      id: `mage-note-${note.key}`,
      kind: "mage-note",
      label: note.text,
      note: { place: note.place },
      run: note.run
    })),
    ...(input.actions ?? []).map<PaletteEntry>((action) => ({
      id: `action-${action.id}`,
      kind: "action",
      label: action.label,
      binding: action.binding,
      ...(action.unavailable === undefined ? {} : { unavailable: action.unavailable }),
      ...(action.count === undefined ? {} : { count: action.count }),
      run: action.run
    })),
    ...(input.orderCommands ?? []).map<PaletteEntry>((command) => ({
      id: `order-${command}`,
      kind: "order-help",
      label: command,
      run: () => openGameData(orderEntryId(command))
    })),
    ...(input.gameData ?? []).flatMap<PaletteEntry>((entry) =>
      entry.category === "order"
        ? []
        : [
            {
              id: `data-${entry.id}`,
              kind: entry.category,
              label: entry.tag === null ? entry.name : `${entry.name} ${entry.tag}`,
              run: () => openGameData(entry.id)
            }
          ]
    )
  ];
}

/**
 * The palette's "Export mage sheet" row (ah-mlls.8): the same export as the Export menu's item,
 * gated the same way - a report to name the sheet after and the game data to tell a mage from a
 * woodcutter. Unlike the commands that come and go with what is loaded, it is never hidden: greyed,
 * it says what is missing, and a missing report is named first, since loading one comes first.
 *
 * With no mages it can still be chosen, as the menu's item can, and says so beforehand.
 */
export function mageSheetPaletteAction(input: {
  hasReport: boolean;
  hasGameData: boolean;
  mageCount: number;
  run: () => void;
}): PaletteAction {
  const row = { id: "export-mage-sheet", label: "Export mage sheet", run: input.run };
  if (!input.hasReport) {
    return { ...row, unavailable: "needs a report" };
  }
  if (!input.hasGameData) {
    return { ...row, unavailable: "needs the game data" };
  }
  if (input.mageCount === 0) {
    return { ...row, count: { text: "no mages", quiet: true } };
  }
  return row;
}

/**
 * How an Army row counts its units: how many of its members this turn's report shows, the same
 * number the units pane's source rail prints beside it (`shownMemberCount`). None reads as words
 * rather than a zero, quiet, because an Army whose units are only remembered is not empty.
 */
export function armyCountLabel(shown: number): { text: string; quiet: boolean } {
  if (shown === 0) {
    return { text: "no units this turn", quiet: true };
  }
  return { text: `${shown} unit${shown === 1 ? "" : "s"}`, quiet: false };
}

/**
 * One palette row per hex with a settlement, in the map's hex order: `Akroitos [city] · plain
 * (12,34) in Hope`. The size is the report's own word (`contains Akroitos [city]`), kept in the
 * text so typing `city` lists every city; the rest is the hex row's own label, so the two cannot
 * drift apart.
 *
 * A hex not in this turn's report - stale, or only named by a neighbour's exits - carries the turn
 * it was last seen, which the palette shows as `last seen turn N`.
 */
export function settlementPaletteRows(
  hexes: readonly HexNode[],
  currentTurn: number | null
): Array<{ regionId: string; label: string; lastSeenTurn?: number }> {
  return hexes.flatMap((hex) => {
    if (hex.settlement === null) {
      return [];
    }
    const label = `${hex.settlement.name} [${hex.settlement.size}] · ${hex.label}`;
    const earlier =
      hex.knowledge !== "current" &&
      currentTurn !== null &&
      hex.lastSeenTurn !== null &&
      hex.lastSeenTurn < currentTurn;
    return [
      earlier
        ? { regionId: hex.regionId, label, lastSeenTurn: hex.lastSeenTurn as number }
        : { regionId: hex.regionId, label }
    ];
  });
}

/**
 * One palette row per hex note, in the order given (the notes store's, newest first): the note's
 * text, and its place as `hill (3,29) in Grey Reach · turn 61`. The hex reads as its own palette
 * row does (`labelFor`); the turn is left off a note stamped 0, which is how a note written before
 * any report was loaded is stored and why the hex's Notes section hides its stamp too.
 */
export function hexNotePaletteRows(
  notes: readonly HexNoteRecord[],
  labelFor: (regionId: string) => string
): Array<{ noteId: string; regionId: string; text: string; place: string }> {
  return notes.map((note) => ({
    noteId: note.id,
    regionId: note.regionId,
    text: note.text,
    place: note.turn > 0 ? `${labelFor(note.regionId)} · turn ${note.turn}` : labelFor(note.regionId)
  }));
}

/**
 * One palette row per mage note worth finding: a non-empty note, on a mage the study planner lists
 * (choosing the row picks him there) and whose unit this turn's report shows. A dead, given-away or
 * unseen mage's note is left out until he is seen again (ah-mlls.5).
 */
export function mageNotePaletteRows(
  plans: readonly StudyPlanRecord[],
  groups: ReadonlyArray<{
    mages: ReadonlyArray<{ key: string; factionId: string; unitId: string; name: string }>;
  }>,
  seenUnitIds: ReadonlySet<string>
): Array<{ key: string; text: string; place: string }> {
  const mages = new Map(
    groups.flatMap((group) => group.mages).map((mage) => [mage.key, mage] as const)
  );
  return plans.flatMap((plan) => {
    const text = plan.comment.trim();
    const mage = mages.get(`${plan.factionId}/${plan.unitId}`);
    if (text === "" || mage === undefined || !seenUnitIds.has(mage.unitId)) {
      return [];
    }
    return [{ key: mage.key, text, place: `${mage.name} (${mage.unitId}) · study planner` }];
  });
}

/** How far into its line a match may start before the line is cut to bring it closer. */
const SNIPPET_FAR = 30;
/** How much of the line a cut keeps ahead of the match. */
const SNIPPET_LEAD = 20;

/**
 * A note row's top line (ah-mlls.5): the line of the note holding the first case-insensitive
 * match of `query`, split around it so the match can be drawn bold, in the note's own case.
 *
 * A match more than `SNIPPET_FAR` characters into its line would be cut off on a narrow row, so
 * the line is then started up to `SNIPPET_LEAD` characters before it - at the first word start in
 * that stretch, when it has one - and `lead` asks for a `…` in front. The end is left whole: the
 * row cuts it with CSS, wherever the width runs out.
 */
export function noteSnippet(
  text: string,
  query: string
): { lead: boolean; before: string; match: string; after: string } {
  const needle = query.trim().toLowerCase();
  const at = needle === "" ? -1 : text.toLowerCase().indexOf(needle);
  if (at === -1) {
    return { lead: false, before: text.split("\n")[0] ?? "", match: "", after: "" };
  }
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const nextBreak = text.indexOf("\n", at);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const end = Math.min(at + needle.length, lineEnd);

  let start = lineStart;
  if (at - lineStart > SNIPPET_FAR) {
    start = at - SNIPPET_LEAD;
    for (let p = start; p < at; p += 1) {
      if (/\s/.test(text[p - 1] ?? "")) {
        start = p;
        break;
      }
    }
  }
  return {
    lead: start > lineStart,
    before: text.slice(start, at),
    match: text.slice(at, end),
    after: text.slice(end, lineEnd)
  };
}

/**
 * How well a query fits a label: 0 a prefix, 1 a word start, 2 a substring anywhere, 3 a
 * subsequence - letters in order with gaps, which is how a half-remembered name still finds its
 * unit. Null is no match at all.
 *
 * Tier 3 is a *fallback* tier rather than merely the worst one (ah-yk6b): `filterPalette` shows it
 * only when nothing matched more strongly, so "mine" does not offer "Magician's Tower" while a
 * Mine is standing on the map.
 */
function score(label: string, query: string, consecutiveOnly = false): number | null {
  const haystack = label.toLowerCase();
  if (haystack.startsWith(query)) {
    return 0;
  }
  const at = haystack.indexOf(query);
  if (at !== -1) {
    return /[^a-z0-9]/.test(haystack[at - 1] ?? "") ? 1 : 2;
  }
  if (consecutiveOnly) {
    return null;
  }
  let from = 0;
  for (const letter of query) {
    from = haystack.indexOf(letter, from);
    if (from === -1) {
      return null;
    }
    from += 1;
  }
  return SUBSEQUENCE;
}

/** The fallback tier `score` returns, named so the two rules below agree with it by construction. */
const SUBSEQUENCE = 3;

/**
 * The entries a query leaves standing, best fit first, reading order among equals.
 *
 * Three rules, all of them ah-yk6b, and all of them about one kind of thing not being able to
 * hide another:
 *
 *  1. **No cap.** Every match is returned; the list scrolls (`CommandPalette`). It used to slice
 *     to 12 with nothing on screen to say so, which is how five Mine structures could sit below
 *     the fold behind units named "Miners".
 *  2. **Subsequence matches are a fallback, not a result.** If anything matched as prefix, word
 *     start or substring, only those are returned. When a subsequence match is all there is, it
 *     is kept, which is the half-remembered-name rescue the rule exists for.
 *  3. **Every matching kind gets a seat at the top.** The best of each kind leads, in fit order,
 *     then everything else in fit order. A single overwhelming kind can therefore never crowd the
 *     others off the first screenful, which was the complaint even before scrolling.
 *
 * An empty query is untouched by all three: it is the whole list, in the order
 * `buildPaletteEntries` built it - less the notes, which are found by a remembered word and would
 * otherwise push everything else down with their two-line rows (ah-mlls.5).
 *
 * A note never matches as a subsequence: across up to 500 characters a typo would find most notes
 * with nothing on the row to say why.
 */
export function filterPalette(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return entries.filter((entry) => entry.note === undefined);
  }

  const scored = entries
    .map((entry) => ({ entry, fit: score(entry.label, needle, entry.note !== undefined) }))
    .filter((s): s is { entry: PaletteEntry; fit: number } => s.fit !== null);

  // Rule 2. `some` before `filter`, so an all-subsequence result survives intact.
  const strong = scored.some((s) => s.fit < SUBSEQUENCE)
    ? scored.filter((s) => s.fit < SUBSEQUENCE)
    : scored;

  // Stable, so entries of equal fit keep `buildPaletteEntries`' reading order.
  const byFit = [...strong].sort((a, b) => a.fit - b.fit).map((s) => s.entry);

  // Rule 3. Walking an already fit-sorted list and taking the first of each kind yields the
  // representatives *in fit order* for free - so the best match overall is still the first row.
  const seen = new Set<PaletteEntryKind>();
  const leading: PaletteEntry[] = [];
  const rest: PaletteEntry[] = [];
  for (const entry of byFit) {
    if (seen.has(entry.kind)) {
      rest.push(entry);
    } else {
      seen.add(entry.kind);
      leading.push(entry);
    }
  }
  return [...leading, ...rest];
}

/**
 * Rows to a PageUp or PageDown. Measuring a list against its row height was fiddlier than it is
 * worth for a key that only has to move "about a screenful"; ten is close to what fits the
 * palette's 70vh list on an ordinary window.
 */
export const PALETTE_PAGE_ROWS = 10;

/**
 * The row nearest `from` that can be chosen, looking `first` way and then the other; -1 when every
 * row is greyed (ah-mlls.7). `from` is clamped into the list first.
 */
function nearestEnabled(
  from: number,
  enabled: readonly boolean[],
  first: "forward" | "backward"
): number {
  const last = enabled.length - 1;
  const start = Math.max(0, Math.min(last, from));
  const ahead = () => {
    for (let at = start; at <= last; at += 1) {
      if (enabled[at]) return at;
    }
    return -1;
  };
  const behind = () => {
    for (let at = start; at >= 0; at -= 1) {
      if (enabled[at]) return at;
    }
    return -1;
  };
  if (first === "forward") {
    const found = ahead();
    return found !== -1 ? found : behind();
  }
  const found = behind();
  return found !== -1 ? found : ahead();
}

/**
 * Which row the highlight is drawn on: `index`, or the nearest row below it that can be chosen,
 * or above it when none is below; -1 when nothing can be chosen (ah-mlls.7). A greyed row is
 * never highlighted, so Enter can never land on one.
 */
export function settleHighlight(index: number, enabled: readonly boolean[]): number {
  return enabled.length === 0 ? -1 : nearestEnabled(index, enabled, "forward");
}

/**
 * Where an arrow key moves the highlight, or null for any other key - which stays with the input,
 * where typing belongs.
 *
 * It clamps at the ends rather than wrapping (ah-yk6b). Wrapping was harmless on a list capped at
 * twelve; on an uncapped one, holding Down would cycle past what you wanted for ever, and a single
 * Up from the top would teleport you 200 rows. `Home` and `End` still make that jump on purpose.
 *
 * Clamping returns the same index rather than null: null would fall through to the input, where
 * the missing `preventDefault` would move the text caret instead of doing nothing.
 */
export function paletteKeyReduce(
  state: {
    index: number;
    count: number;
    pageSize: number;
    /**
     * Which rows can be chosen, by index; absent means all. A greyed row (ah-mlls.7) is stepped
     * over: the move lands on the nearest row that can be chosen in the key's direction, or comes
     * back the other way when nothing lies beyond. With every row greyed the index is returned
     * unchanged, so the key is still claimed from the input.
     */
    enabled?: readonly boolean[];
  },
  key: string
): number | null {
  if (state.count === 0) {
    return null;
  }
  const last = state.count - 1;
  const clamp = (at: number) => Math.max(0, Math.min(last, at));
  let target: number;
  let direction: "forward" | "backward";
  switch (key) {
    case "ArrowDown":
      [target, direction] = [clamp(state.index + 1), "forward"];
      break;
    case "ArrowUp":
      [target, direction] = [clamp(state.index - 1), "backward"];
      break;
    case "PageDown":
      [target, direction] = [clamp(state.index + state.pageSize), "forward"];
      break;
    case "PageUp":
      [target, direction] = [clamp(state.index - state.pageSize), "backward"];
      break;
    case "Home":
      [target, direction] = [0, "forward"];
      break;
    case "End":
      [target, direction] = [last, "backward"];
      break;
    default:
      return null;
  }
  if (state.enabled === undefined) {
    return target;
  }
  const landed = nearestEnabled(target, state.enabled, direction);
  return landed === -1 ? clamp(state.index) : landed;
}
