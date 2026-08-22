import { describe, expect, it } from "vitest";
import { SETTINGS_TABS, gameSettingsPresentation, nextTab, rulesetOptions } from "./settingsTabs";

describe("settings dialog tabs", () => {
  it("offers global, per-game, warnings, snippets and about, in that order", () => {
    // The order is the reading order of the dialog: what applies everywhere, what applies to the
    // open game, which advisory checks run at all, the player's own snippets, and what this build
    // is. Global first is also the default tab on open.
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      "global",
      "game",
      "warnings",
      "snippets",
      "about"
    ]);
    for (const tab of SETTINGS_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
    }
  });
});

describe("arrow-key tab navigation", () => {
  it("moves right with wrap-around", () => {
    expect(nextTab("global", "ArrowRight")).toBe("game");
    expect(nextTab("game", "ArrowRight")).toBe("warnings");
    expect(nextTab("warnings", "ArrowRight")).toBe("snippets");
    expect(nextTab("snippets", "ArrowRight")).toBe("about");
    expect(nextTab("about", "ArrowRight")).toBe("global");
  });

  it("moves left with wrap-around", () => {
    expect(nextTab("global", "ArrowLeft")).toBe("about");
    expect(nextTab("about", "ArrowLeft")).toBe("snippets");
    expect(nextTab("snippets", "ArrowLeft")).toBe("warnings");
    expect(nextTab("warnings", "ArrowLeft")).toBe("game");
  });

  it("ignores keys that are not arrow navigation", () => {
    expect(nextTab("global", "Enter")).toBeNull();
    expect(nextTab("global", "ArrowDown")).toBeNull();
  });
});

describe("ruleset options", () => {
  it("offers the shipped rulesets for a known id", () => {
    const options = rulesetOptions("neworigins");
    expect(options.map((option) => option.id)).toEqual(["neworigins"]);
  });

  it("shows an id this build does not ship rather than misrepresenting it", () => {
    // A manifest can hold an id from a newer build or a hand edit. A select that silently renders
    // the first shipped option would claim the game runs under a ruleset it does not.
    const options = rulesetOptions("futuredeep");
    expect(options.map((option) => option.id)).toEqual(["neworigins", "futuredeep"]);
    expect(options[1].label).toContain("futuredeep");
    expect(options[1].shipped).toBe(false);
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
      rulesetId: "neworigins",
      map: { width: 72, height: 96, wrapX: true, wrapY: false },
      mapStated: false
    });
  });

  it("shows an assumed map as assumed, for a game that never recorded one", () => {
    // The navigator's choice: an old game adopts the ruleset's default rather than being
    // interrupted for an answer, and this tab is where a player can find out that is what happened.
    const game = {
      gameId: "g1",
      gameName: "Spring campaign",
      databasePath: "idb://g1",
      rulesetId: "neworigins"
    };

    const shown = gameSettingsPresentation(game);

    expect(shown).toMatchObject({
      map: { width: 72, height: 96, wrapX: true, wrapY: false },
      mapStated: false
    });
  });

  it("shows the game's own map as stated, once the player has said", () => {
    // Editing a value writes it, which is what turns an assumption into a statement.
    const game = {
      gameId: "g1",
      gameName: "Spring campaign",
      databasePath: "idb://g1",
      rulesetId: "neworigins",
      map: { width: 40, height: 40, wrapX: true, wrapY: true }
    };

    expect(gameSettingsPresentation(game)).toMatchObject({
      map: { width: 40, height: 40, wrapX: true, wrapY: true },
      mapStated: true
    });
  });

  it("shows no map at all when neither the game nor its ruleset has one", () => {
    const game = {
      gameId: "g1",
      gameName: "Spring campaign",
      databasePath: "idb://g1",
      rulesetId: "some-other-variant"
    };

    expect(gameSettingsPresentation(game)).toMatchObject({ map: null, mapStated: false });
  });
});
