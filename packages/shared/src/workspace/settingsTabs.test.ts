import { describe, expect, it } from "vitest";
import { SETTINGS_TABS, gameSettingsPresentation } from "./settingsTabs";

describe("settings dialog tabs", () => {
  it("offers global, per-game and about, in that order", () => {
    // The order is the reading order of the dialog: what applies everywhere, what applies to the
    // open game, and what this build is. Global first is also the default tab on open.
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual(["global", "game", "about"]);
    for (const tab of SETTINGS_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
    }
  });
});

describe("per-game settings presentation", () => {
  it("shows an empty state when no game is open", () => {
    // The dialog is reachable from the gate screen, where there is no game to configure.
    expect(gameSettingsPresentation(null)).toEqual({ kind: "empty" });
  });

  it("shows the open game's ruleset", () => {
    const game = {
      gameId: "g1",
      gameName: "Spring campaign",
      databasePath: "idb://g1",
      rulesetId: "neworigins"
    };
    expect(gameSettingsPresentation(game)).toEqual({
      kind: "ruleset",
      gameName: "Spring campaign",
      rulesetId: "neworigins"
    });
  });
});
