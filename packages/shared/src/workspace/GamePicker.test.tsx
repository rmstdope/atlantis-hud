import type { GameManifest } from "@atlantis/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GamePicker, RemoveGameConfirm } from "./GamePicker";

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

function drawPicker(games: GameManifest[] = [manifest("g1", "Borg TNG")]) {
  return renderToStaticMarkup(
    <GamePicker
      games={games}
      currentGameId={null}
      busy={false}
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
