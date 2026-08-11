/**
 * The command palette's decidable parts: what it lists, how a query narrows the list, and where
 * the arrow keys move the highlight. All plain functions - the component only renders them.
 */

export type PaletteEntryKind = "unit" | "region" | "action" | "order-help";

export type PaletteEntry = {
  id: string;
  kind: PaletteEntryKind;
  label: string;
  /** The key chord shown beside an action, where one exists. */
  binding?: string;
  run: () => void;
};

export type PaletteInput = {
  ownUnits: Array<{ unitId: string; name: string; run: () => void }>;
  regions: Array<{ regionId: string; label: string; run: () => void }>;
  actions: Array<{ id: string; label: string; binding?: string; run: () => void }>;
  orderCommands: readonly string[];
  insertOrder: (command: string) => void;
};

/**
 * Everything the palette can offer, in reading order: the player's units first because going to
 * one is the palette's daily use, then places, then the app's own actions, then the order
 * vocabulary as a typeable reference.
 */
export function buildPaletteEntries(input: PaletteInput): PaletteEntry[] {
  return [
    ...input.ownUnits.map<PaletteEntry>((unit) => ({
      id: `unit-${unit.unitId}`,
      kind: "unit",
      label: `${unit.name} (${unit.unitId})`,
      run: unit.run
    })),
    ...input.regions.map<PaletteEntry>((region) => ({
      id: `region-${region.regionId}`,
      kind: "region",
      label: region.label,
      run: region.run
    })),
    ...input.actions.map<PaletteEntry>((action) => ({
      id: `action-${action.id}`,
      kind: "action",
      label: action.label,
      binding: action.binding,
      run: action.run
    })),
    ...input.orderCommands.map<PaletteEntry>((command) => ({
      id: `order-${command}`,
      kind: "order-help",
      label: command,
      run: () => input.insertOrder(command)
    }))
  ];
}

/**
 * How well a query fits a label: 0 a prefix, 1 a word start, 2 a substring anywhere, 3 a
 * subsequence - letters in order with gaps, which is how a half-remembered name still finds its
 * unit. Null is no match at all.
 */
function score(label: string, query: string): number | null {
  const haystack = label.toLowerCase();
  if (haystack.startsWith(query)) {
    return 0;
  }
  const at = haystack.indexOf(query);
  if (at !== -1) {
    return /[^a-z0-9]/.test(haystack[at - 1] ?? "") ? 1 : 2;
  }
  let from = 0;
  for (const letter of query) {
    from = haystack.indexOf(letter, from);
    if (from === -1) {
      return null;
    }
    from += 1;
  }
  return 3;
}

/**
 * The entries a query leaves standing, best fit first, reading order among equals - the sort is
 * stable, so an empty query is simply the whole list as built.
 */
export function filterPalette(
  entries: readonly PaletteEntry[],
  query: string,
  limit?: number
): PaletteEntry[] {
  const needle = query.trim().toLowerCase();
  const kept =
    needle === ""
      ? [...entries]
      : entries
          .map((entry) => ({ entry, fit: score(entry.label, needle) }))
          .filter((scored): scored is { entry: PaletteEntry; fit: number } => scored.fit !== null)
          .sort((a, b) => a.fit - b.fit)
          .map((scored) => scored.entry);
  return limit === undefined ? kept : kept.slice(0, limit);
}

/**
 * Where an arrow key moves the highlight, wrapping at the ends, or null for any other key -
 * which stays with the input, where typing belongs.
 */
export function paletteKeyReduce(
  state: { index: number; count: number },
  key: string
): number | null {
  if (state.count === 0) {
    return null;
  }
  switch (key) {
    case "ArrowDown":
      return (state.index + 1) % state.count;
    case "ArrowUp":
      return (state.index - 1 + state.count) % state.count;
    case "Home":
      return 0;
    case "End":
      return state.count - 1;
    default:
      return null;
  }
}
