/**
 * The gates earlier reports showed, remembered across turns (`ah-r5fg`).
 *
 * A report prints a hex's gate only when one of the faction's units there knows Gate Lore
 * (data/skills `gate lore [GATE] 1`: "A mage with skill 1 in Gate Lore can see a Gate if one exists
 * in the same region as the mage ... the Gate will appear in the region report"). So a report that
 * covers the hex without a gate line says nothing about the gate unless such a unit stood there -
 * and a gate the player knew about must not vanish just because the mage moved on.
 *
 * Nothing is persisted. It rides on `resourceMemoryStore.ts`'s walk over
 * `imported_turns.raw_report`, so it is rebuilt whenever a game opens, like the resource verdicts.
 *
 * Pure, like `resourceMemory.ts` beside it: no React, no store, no client, no clock.
 */

import type { ParsedReport, ReportRegion } from "@atlantis/core-client";

/** What one turn's report settled about one hex's gate. */
export type RememberedGate = {
  /**
   * The report's gate sentence, verbatim. `null` when a report that could have shown a gate did not
   * - the gate is gone, and an older sighting must not come back.
   */
  sentence: string | null;
  /** The turn whose report settled it. */
  turn: number;
};

/** Every hex's newest gate verdict, by region id. */
export type GateMemory = ReadonlyMap<string, RememberedGate>;

/** Nothing remembered. Exported so callers need not build an empty Map each render. */
export const NO_GATE_MEMORY: GateMemory = new Map();

/** The skill that shows a gate, and the level that is enough (data/skills `gate lore [GATE] 1`). */
const GATE_LORE = { tag: "GATE", level: 1 } as const;

/**
 * One turn folded in. Returns a new map; `memory` is never mutated.
 *
 * A printed gate line is remembered with its turn. No line, with one of our own Gate Lore units in
 * the hex, is a proved absence. No line and no such unit says nothing, and nothing is written.
 */
export function withGateTurn(memory: GateMemory, report: ParsedReport, turn: number): GateMemory {
  const next = new Map(memory);
  for (const region of report.regions) {
    if (region.gate) {
      remember(next, region.regionId, { sentence: region.gate, turn });
      continue;
    }
    // `own === true` is exact, as in `resourceMemory.ts`: a stranger's lore shows us nothing.
    const couldSee = region.units.some(
      (unit) =>
        unit.own === true &&
        unit.skills.some(
          (held) => held.tag.toUpperCase() === GATE_LORE.tag && held.level >= GATE_LORE.level
        )
    );
    if (couldSee) {
      remember(next, region.regionId, { sentence: null, turn });
    }
  }
  return next;
}

/** Two memories folded together, the greater turn winning each hex and `incoming` winning a tie. */
export function mergedGateMemory(existing: GateMemory, incoming: GateMemory): GateMemory {
  const next = new Map(existing);
  for (const [regionId, verdict] of incoming) {
    remember(next, regionId, verdict);
  }
  return next;
}

/** The Gate section's one line: the sentence, and the turn it was seen in when it is remembered. */
export type GateLine = {
  sentence: string;
  /** `null` when the region on screen printed it; otherwise the turn whose report did. */
  seenInTurn: number | null;
};

/**
 * What the Region pane's Gate section shows for the region on screen, or `null` for no section.
 *
 * The region's own sentence wins. Failing that, a remembered gate - unless it was learnt after the
 * turn being viewed, which `resourceChecks.ts` refuses for the same reason; a report with no turn
 * number has nothing better to go on and uses it.
 */
export function gateLineOf(
  region: ReportRegion | null,
  remembered: RememberedGate | undefined,
  viewedTurn: number | null
): GateLine | null {
  if (region === null) {
    return null;
  }
  // `??` as well: a region from a payload stored before the field existed has no `gate` at all.
  const own = region.gate ?? null;
  if (own !== null) {
    return { sentence: own, seenInTurn: null };
  }
  if (
    remembered === undefined ||
    remembered.sentence === null ||
    (viewedTurn !== null && remembered.turn > viewedTurn)
  ) {
    return null;
  }
  return { sentence: remembered.sentence, seenInTurn: remembered.turn };
}

/** The hover on a remembered gate, as agreed in the bead's acceptance. */
export function rememberedGateTitle(turn: number): string {
  return `Seen in turn ${turn}'s report; this turn's report cannot show gates here.`;
}

/** One verdict written under the merge rule: at least as new as the incumbent wins. */
function remember(memory: Map<string, RememberedGate>, regionId: string, verdict: RememberedGate) {
  const held = memory.get(regionId);
  if (held === undefined || held.turn <= verdict.turn) {
    memory.set(regionId, verdict);
  }
}
