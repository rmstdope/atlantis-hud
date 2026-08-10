/**
 * The decidable parts of the settings dialog, kept out of the component so vitest can reach them
 * without rendering — the same split `gameSession.ts` makes for the shell.
 */

import type { WorkspaceGame } from "../workspaceStore";

export type SettingsTabId = "global" | "game" | "about";

export type SettingsTab = { id: SettingsTabId; label: string };

/**
 * The reading order of the dialog: what applies everywhere, what applies to the open game, and
 * what this build is. Global first is also the default tab on open.
 */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  { id: "global", label: "Global" },
  { id: "game", label: "Per game" },
  { id: "about", label: "About" }
];

export type GameSettingsPresentation =
  | { kind: "empty" }
  | { kind: "ruleset"; gameName: string; rulesetId: string };

/**
 * What the per-game tab shows. The dialog is reachable from the gate screen, where there is no
 * game to configure, so absence is a state of its own rather than a reason to hide the tab.
 */
export function gameSettingsPresentation(game: WorkspaceGame | null): GameSettingsPresentation {
  if (!game) {
    return { kind: "empty" };
  }
  return { kind: "ruleset", gameName: game.gameName, rulesetId: game.rulesetId };
}
