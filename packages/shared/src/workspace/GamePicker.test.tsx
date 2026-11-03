import type { GameManifest } from "@atlantis/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GamePicker, ImportBackupConfirm, RemoveGameConfirm, pickerErrorPlacement } from "./GamePicker";

/**
 * The picker's remove panel (ah-58n.2).
 *
 * This package has no jsdom, so nothing here presses anything: the panel is rendered directly with
 * the state it would be in, and what is asserted is the markup - the copy, the buttons and the
 * accessible names. Opening the panel, Escape closing it and focus landing back on the `✕` are the
 * smoke suite's business (`tests/smoke/games.spec.ts`), which has a real browser to do it in.
 */

function manifest(gameId: string, gameName: string): GameManifest {
  return {
    manifestVersion: 1,
    metadata: { gameId, gameName, rulesetId: "neworigins" },
    reportSources: [],
    createdAt: "2026-08-01T09:00:00Z",
    lastOpenedAt: "2026-08-09T18:00:00Z"
  };
}

function drawPanel(overrides: Partial<Parameters<typeof RemoveGameConfirm>[0]> = {}) {
  return renderToStaticMarkup(
    <RemoveGameConfirm
      gameId="g1"
      gameName="Borg TNG"
      busy={false}
      failure={null}
      onDelete={() => {}}
      onReset={() => {}}
      onRetry={() => {}}
      onCancel={() => {}}
      {...overrides}
    />
  );
}

function drawPicker(games: GameManifest[] = [manifest("g1", "Borg TNG")], busy = false) {
  return renderToStaticMarkup(
    <GamePicker
      games={games}
      currentGameId={games[0]?.metadata.gameId ?? null}
      busy={busy}
      error={null}
      onOpen={() => {}}
      onCreate={() => {}}
      onDelete={async () => null}
      onReset={async () => null}
      onExport={() => {}}
      onImport={() => {}}
      onRename={async () => true}
    />
  );
}

describe("the remove-game panel", () => {
  it("offers Delete, Reset and Cancel in one panel", () => {
    const markup = drawPanel();

    expect(markup).toContain('data-testid="game-delete-confirm-g1"');
    expect(markup).toContain(">Delete</button>");
    expect(markup).toContain(">Reset</button>");
    expect(markup).toContain(">Cancel</button>");
  });

  it("says what is lost and what is kept", () => {
    const markup = drawPanel();

    expect(markup).toContain("Delete “Borg TNG”, or empty it and keep the game?");
    expect(markup).toContain(
      "Either way its turns, orders, remembered map and notes are erased. Reset keeps the name and " +
        "ruleset."
    );
    expect(markup).toContain("Export it first if you might want it back.");
  });

  it("gives Cancel the focus when the panel opens", () => {
    expect(drawPanel()).toContain("autofocus");
  });

  it("keeps the panel open on a failed reset and offers Try again", () => {
    const markup = drawPanel({ failure: "“Borg TNG” could not be reset: disk full" });

    expect(markup).toContain("“Borg TNG” could not be reset: disk full");
    expect(markup).toContain(">Try again</button>");
    expect(markup).toContain(">Cancel</button>");
    // The question has been answered; only the failure and the way out remain.
    expect(markup).not.toContain("or empty it and keep the game?");
    expect(markup).not.toContain(">Delete</button>");
    expect(markup).not.toContain(">Reset</button>");
  });

  // The panel is the only place either failure is reported, so a panel dismissed while one of the
  // two is in flight would leave a failed delete or reset entirely unannounced.
  it("offers no way out while one of the two is in flight", () => {
    const markup = drawPanel({ busy: true });

    // Three buttons, three `disabled` - Cancel included, which is the one that used to escape.
    expect(markup.match(/disabled=""/gu) ?? []).toHaveLength(3);
  });

  it("reports a failed delete in the same place", () => {
    const markup = drawPanel({ failure: "“Borg TNG” could not be deleted: disk full" });

    expect(markup).toContain("“Borg TNG” could not be deleted: disk full");
    expect(markup).toContain(">Try again</button>");
  });
});

describe("a game row", () => {
  it("names its remove control for the panel it opens, not for one of the two outcomes", () => {
    const markup = drawPicker();

    expect(markup).toContain('aria-label="remove Borg TNG"');
    expect(markup).not.toContain('aria-label="delete Borg TNG"');
  });

  // Decision C: the `✕` opens one panel, and nothing else is added to the row. The row is all
  // there is until it is pressed, so neither of the panel's two outcomes may be reachable yet.
  it("carries no remove control of its own beyond the ✕", () => {
    const markup = drawPicker();

    expect(markup).not.toContain(">Reset</button>");
    expect(markup).not.toContain(">Delete</button>");
  });
});

/**
 * ah-md91c: "+ Import game backup…" lives on the Games tab, directly below "+ New game…".
 * The Games tab is the picker's default, so the static render shows it; that the This game tab no
 * longer offers import is the smoke suite's (`tests/smoke/backup.spec.ts`), since switching tabs
 * needs a click.
 */
describe("importing a game backup from the Games tab", () => {
  const position = (markup: string, testId: string) => markup.indexOf(`data-testid="${testId}"`);

  it("offers + Import game backup… directly below + New game…", () => {
    const markup = drawPicker();

    expect(markup).toMatch(/data-testid="import-game"[^>]*>\+ Import game backup…<\/button>/);
    expect(position(markup, "new-game")).toBeGreaterThan(-1);
    expect(position(markup, "import-game")).toBeGreaterThan(position(markup, "new-game"));
    // Nothing between them but the link itself.
    const between = markup.slice(position(markup, "new-game"), position(markup, "import-game"));
    expect(between.match(/<button/g)).toHaveLength(1);
  });

  it("draws the import link in the same style as + New game…", () => {
    const markup = drawPicker();
    const classOf = (testId: string) =>
      new RegExp(`<button[^>]*data-testid="${testId}"[^>]*class="([^"]*)"|<button[^>]*class="([^"]*)"[^>]*data-testid="${testId}"`).exec(markup);
    const newGame = classOf("new-game");
    const importGame = classOf("import-game");
    expect(importGame?.[1] ?? importGame?.[2]).toBe(newGame?.[1] ?? newGame?.[2]);
  });

  it("no longer carries the explaining line", () => {
    expect(drawPicker()).not.toContain("Import creates a new game");
  });

  it("keeps the import link below the new-game form while it is open", () => {
    // With no games the form is open from the start.
    const markup = drawPicker([]);

    expect(markup).not.toContain('data-testid="new-game"');
    expect(position(markup, "game-form")).toBeGreaterThan(-1);
    expect(position(markup, "import-game")).toBeGreaterThan(position(markup, "game-form"));
  });

  it("disables both links while something is running", () => {
    const markup = drawPicker([manifest("g1", "Borg TNG")], true);

    expect(markup).toMatch(/<button[^>]*data-testid="new-game"[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*data-testid="import-game"[^>]*disabled=""/);
  });
});

describe("the import replace question", () => {
  function drawQuestion(busy = false) {
    return renderToStaticMarkup(
      <ImportBackupConfirm
        gameName="Borg TNG"
        busy={busy}
        onReplace={() => {}}
        onKeepBoth={() => {}}
        onCancel={() => {}}
      />
    );
  }

  it("asks in today's words", () => {
    const markup = drawQuestion();

    expect(markup).toContain(
      "“Borg TNG” is already here. Replace it with the backup, or import the backup as a second game?"
    );
    expect(markup).toContain("Replacing erases its current turns, orders and remembered map.");
  });

  it("offers Replace, Keep both and Cancel, with Cancel focused", () => {
    const markup = drawQuestion();

    expect(markup).toMatch(/data-testid="game-import-replace"[^>]*>Replace<\/button>/);
    expect(markup).toMatch(/data-testid="game-import-keep-both"[^>]*>Keep both<\/button>/);
    expect(markup).toMatch(/<button[^>]*data-testid="game-import-cancel"[^>]*autofocus=""[^>]*>Cancel<\/button>|<button[^>]*autofocus=""[^>]*data-testid="game-import-cancel"[^>]*>Cancel<\/button>/i);
  });

  it("disables Replace and Keep both while busy", () => {
    const markup = drawQuestion(true);

    expect(markup).toMatch(/<button[^>]*data-testid="game-import-replace"[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*data-testid="game-import-keep-both"[^>]*disabled=""/);
  });
});

/**
 * Where the picker's one shared error shows (ah-md91c, "Import fails"): in the menu's error line
 * under the Games content, even while the new-game form is open beside the import link - the form's
 * own box is for a failed create only.
 */
describe("where a failure in the Games tab is reported", () => {
  it("shows nothing when nothing failed", () => {
    expect(pickerErrorPlacement({ error: null, creating: true, lastAction: "import", tab: "games" })).toBeNull();
  });

  it("puts a failed import in the menu's error line while the form is open", () => {
    expect(pickerErrorPlacement({ error: "bad", creating: true, lastAction: "import", tab: "games" })).toBe("picker");
  });

  it("puts a failed import in the menu's error line with the form closed", () => {
    expect(pickerErrorPlacement({ error: "bad", creating: false, lastAction: "import", tab: "games" })).toBe("picker");
  });

  it("keeps a failed create in the form, as today", () => {
    expect(pickerErrorPlacement({ error: "bad", creating: true, lastAction: "create", tab: "games" })).toBe("form");
  });

  it("uses the menu's error line for anything else with the form closed, as today", () => {
    expect(pickerErrorPlacement({ error: "bad", creating: false, lastAction: null, tab: "games" })).toBe("picker");
  });

  it("puts any failure on the This game tab in the menu's error line, even with the form left open", () => {
    expect(pickerErrorPlacement({ error: "bad", creating: true, lastAction: "create", tab: "settings" })).toBe(
      "picker"
    );
  });

  it("draws the error line under the Games content at rest", () => {
    const markup = renderToStaticMarkup(
      <GamePicker
        games={[manifest("g1", "Borg TNG")]}
        currentGameId="g1"
        busy={false}
        error="Could not import that backup."
        onOpen={() => {}}
        onCreate={() => {}}
        onDelete={async () => null}
        onReset={async () => null}
        onExport={() => {}}
        onImport={() => {}}
        onRename={async () => true}
      />
    );
    expect(markup.indexOf('data-testid="game-picker-error"')).toBeGreaterThan(
      markup.indexOf('data-testid="import-game"')
    );
  });
});
