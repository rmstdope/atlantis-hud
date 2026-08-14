/**
 * What the battles view decides, kept apart from how it looks.
 *
 * The repository has no jsdom, so anything that has to be checked without a DOM lives here: the
 * one-line summary a list row shows, and who a roster entry belongs to. See `BadgeMenu.test.tsx`'s
 * doc comment for why component tests can only render to static markup - the logic that matters
 * belongs in a pure function like this one so it can be tested directly.
 */

import type { Battle, BattleRound, BattleUnit } from "@atlantis/core-client";
import { regionIdOf } from "../hexMapModel";

/** How a roster entry relates to the viewer, in the three states the data actually supports. */
export type Allegiance = "own" | "other" | "unknown";

/**
 * The one-line summary a battle reads as in the list rail.
 *
 * `attacker`, `defender`, `hex` and the losses are null when the battle's headline was not
 * recognised - there is nothing to compute them from - and `headline` carries the verbatim text
 * so the row can still say something rather than render empty.
 */
export type BattleSummary = {
  headline: string;
  attacker: string | null;
  defender: string | null;
  hex: string | null;
  attackerLosses: number | null;
  defenderLosses: number | null;
  hasSpoils: boolean;
};

function combatantLabel(combatant: { name: string; id: string } | null): string | null {
  return combatant ? `${combatant.name} (${combatant.id})` : null;
}

/**
 * Losses are read off `casualties` by matching the combatant id, rather than by position - the
 * list is Total Casualties as the report wrote it, in whatever order that was.
 */
function lossesOf(battle: Battle, combatantId: string | undefined): number | null {
  if (!combatantId) {
    return null;
  }
  const casualty = battle.casualties.find((entry) => entry.combatant?.id === combatantId);
  return casualty?.lost ?? null;
}

/** The list row: who fought whom, where, and the outcome in casualties. */
export function summarise(battle: Battle, hexLabel: (regionId: string) => string): BattleSummary {
  return {
    headline: battle.headline,
    attacker: combatantLabel(battle.attacker),
    defender: combatantLabel(battle.defender),
    hex: battle.coordinate ? hexLabel(regionIdOf(battle.coordinate)) : null,
    attackerLosses: lossesOf(battle, battle.attacker?.id),
    defenderLosses: lossesOf(battle, battle.defender?.id),
    hasSpoils: battle.spoils !== null
  };
}

/**
 * The heading a round reads as. `number` is null only for the free round a rout opens - the
 * report itself has no number for it, so "Free round" is what it says rather than a made-up
 * ordinal.
 */
export function roundLabel(round: BattleRound): string {
  return round.number === null ? "Free round" : `Round ${round.number}`;
}

/** What an assassination's roster and outcome read as: no view for a battle that was not one. */
export type AssassinationView = {
  attackers: string[];
  defenders: string[];
  casualtyText: string;
};

/**
 * An assassination prints no attackers - the assassin is never named for the victim's faction -
 * and its casualty line is a bare "Casualties" heading with nothing after it in the report's own
 * structured fields, so this reads the fact from `battle.defender` (the victim) instead.
 */
export function assassinationView(battle: Battle): AssassinationView | null {
  if (!battle.assassination) {
    return null;
  }
  const victim = combatantLabel(battle.defender) ?? battle.headline;
  return {
    attackers: ["?"],
    defenders: [victim],
    casualtyText: `${victim} is assassinated`
  };
}

/**
 * Whose unit a roster entry is.
 *
 * Three states, not two: many roster lines print no faction at all (`Ailen's Acolyte (2965),
 * behind, leader [LEAD], ...`), and those cannot be told apart from an enemy's - "unknown" says so
 * plainly rather than guessing "other".
 */
export function allegianceOf(unit: BattleUnit, viewerFactionId: string | null): Allegiance {
  if (unit.faction === null) {
    return "unknown";
  }
  return viewerFactionId !== null && unit.faction.id === viewerFactionId ? "own" : "other";
}

/** How a roster heading reads: how many units, and how many of them are the viewer's own. */
export function rosterCounts(
  units: BattleUnit[],
  viewerFactionId: string | null
): { total: number; own: number } {
  return {
    total: units.length,
    own: units.filter((unit) => allegianceOf(unit, viewerFactionId) === "own").length
  };
}
