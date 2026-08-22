/**
 * The decidable parts of the settings dialog, kept out of the component so vitest can reach them
 * without rendering — the same split `gameSession.ts` makes for the shell.
 */

import type { MapShape } from "@atlantis/core-client";
import { RULESETS } from "../rulesets";
import { mapShapeOfGame } from "../mapShape";
import type { WorkspaceGame } from "../workspaceStore";

export type SettingsTabId = "global" | "game" | "warnings" | "snippets" | "about";

export type SettingsTab = { id: SettingsTabId; label: string };

/**
 * The reading order of the dialog: what applies everywhere, what applies to the open game, which
 * advisory checks run at all, the player's own snippet library, and what this build is. Global
 * first is also the default tab on open.
 */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  { id: "global", label: "Global" },
  { id: "game", label: "Per game" },
  { id: "warnings", label: "Warnings" },
  { id: "snippets", label: "Snippets" },
  { id: "about", label: "About" }
];

/**
 * Where an arrow key moves the active tab, wrapping at the ends, or `null` for any other key.
 *
 * ARIA tabs are one tab stop: only the selected tab is tabbable and the arrows move within the
 * list, so the reading order of `SETTINGS_TABS` is also the navigation order.
 */
export function nextTab(current: SettingsTabId, key: string): SettingsTabId | null {
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (step === 0) {
    return null;
  }
  const ids = SETTINGS_TABS.map((tab) => tab.id);
  return ids[(ids.indexOf(current) + step + ids.length) % ids.length];
}

export type RulesetOption = { id: string; label: string; shipped: boolean };

/**
 * What the ruleset select offers: every shipped ruleset, plus the game's own id when this build
 * does not ship it (a newer build's manifest, or a hand edit). Without that entry the select
 * would render the first shipped option and claim the game runs under a ruleset it does not.
 */
export function rulesetOptions(currentId: string): RulesetOption[] {
  const options: RulesetOption[] = RULESETS.map(({ id, label }) => ({ id, label, shipped: true }));
  if (!options.some((option) => option.id === currentId)) {
    options.push({ id: currentId, label: `${currentId} (not shipped)`, shipped: false });
  }
  return options;
}

export type GameSettingsPresentation =
  | { kind: "empty" }
  | {
      kind: "ruleset";
      gameName: string;
      rulesetId: string;
      /** The map this game is played on, or `null` when neither it nor its ruleset names one. */
      map: MapShape | null;
      /**
       * Whether the game itself recorded that map, as opposed to inheriting its ruleset's default.
       *
       * The tab must show an assumed map *as assumed*: a game created before the app asked adopts
       * the default silently rather than interrupting, so this is the one place a player can find
       * out that nobody ever confirmed it. Editing a value writes it, which turns the assumption
       * into a statement.
       */
      mapStated: boolean;
    };

/**
 * What the per-game tab shows. The dialog is reachable from the gate screen, where there is no
 * game to configure, so absence is a state of its own rather than a reason to hide the tab.
 */
export function gameSettingsPresentation(game: WorkspaceGame | null): GameSettingsPresentation {
  if (!game) {
    return { kind: "empty" };
  }
  const shape = mapShapeOfGame(game.rulesetId, game.map);
  return {
    kind: "ruleset",
    gameName: game.gameName,
    rulesetId: game.rulesetId,
    map: shape.map,
    mapStated: shape.stated
  };
}
