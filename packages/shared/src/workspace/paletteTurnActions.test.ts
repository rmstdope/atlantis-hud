import { describe, expect, it } from "vitest";

import { importingLabel, paletteTurnActions, type TurnActionsInput } from "./paletteTurnActions";

const NO_ATLANTIS_LINE =
  "These orders have no #atlantis line, so the server cannot tell which faction they belong to.";

const NEW_AGE: TurnActionsInput = {
  gameOpen: true,
  importBusy: false,
  importProgress: null,
  held: null,
  fetch: "new-age",
  send: { canSend: true, reason: NO_ATLANTIS_LINE }
};

describe("paletteTurnActions", () => {
  it("offers all four rows on a New Age game, in the header's order", () => {
    expect(paletteTurnActions(NEW_AGE)).toEqual([
      { id: "import-reports", label: "Import reports" },
      { id: "fetch-latest", label: "Fetch latest report" },
      { id: "fetch-all", label: "Fetch all reports not yet fetched/imported" },
      { id: "send-orders", label: "Send orders" }
    ]);
  });

  it("offers only the latest report on a New Origins game, whose window has no scope", () => {
    const ids = paletteTurnActions({ ...NEW_AGE, fetch: "new-origins" }).map((row) => row.id);
    expect(ids).toEqual(["import-reports", "fetch-latest", "send-orders"]);
  });

  it("offers no Fetch row where the header has no Fetch", () => {
    const ids = paletteTurnActions({ ...NEW_AGE, fetch: null }).map((row) => row.id);
    expect(ids).toEqual(["import-reports", "send-orders"]);
  });

  it("offers no Send row where the header has no Send", () => {
    const ids = paletteTurnActions({ ...NEW_AGE, send: null }).map((row) => row.id);
    expect(ids).toEqual(["import-reports", "fetch-latest", "fetch-all"]);
  });

  it("offers nothing without a game, since there is no header", () => {
    expect(paletteTurnActions({ ...NEW_AGE, gameOpen: false })).toEqual([]);
  });

  it("greys Send with the header's own sentence, word for word", () => {
    const send = paletteTurnActions({
      ...NEW_AGE,
      send: { canSend: false, reason: NO_ATLANTIS_LINE }
    }).find((row) => row.id === "send-orders");
    expect(send).toEqual({ id: "send-orders", label: "Send orders", unavailable: NO_ATLANTIS_LINE });
  });

  it("greys Import while an import runs, with the header's progress label", () => {
    const counted = paletteTurnActions({
      ...NEW_AGE,
      importBusy: true,
      importProgress: { done: 3, total: 7 }
    })[0];
    expect(counted?.unavailable).toBe("Importing 3/7… — wait for it to finish.");

    const uncounted = paletteTurnActions({ ...NEW_AGE, importBusy: true })[0];
    expect(uncounted?.unavailable).toBe("Importing… — wait for it to finish.");
  });

  it("greys Import when the saved data is held in another tab", () => {
    expect(paletteTurnActions({ ...NEW_AGE, held: "game" })[0]?.unavailable).toBe(
      "This game is open in another Atlantis HUD tab."
    );
    expect(paletteTurnActions({ ...NEW_AGE, held: "games-list" })[0]?.unavailable).toBe(
      "Your saved games are open in another Atlantis HUD tab."
    );
  });

  it("names the running import when both apply, as the header's button does", () => {
    expect(
      paletteTurnActions({ ...NEW_AGE, importBusy: true, held: "game" })[0]?.unavailable
    ).toBe("Importing… — wait for it to finish.");
  });
});

describe("importingLabel", () => {
  it("counts only a batch", () => {
    expect(importingLabel(null)).toBe("Importing…");
    expect(importingLabel({ done: 2, total: 5 })).toBe("Importing 2/5…");
  });
});
