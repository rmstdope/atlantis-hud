import { expect, test, type Page } from "@playwright/test";
import { readReport, reportTurn } from "@atlantis/fixtures";

import { clearGames, createGame } from "./gameSetup";
import { DESKTOP_SHELL_TAG } from "./shells";

/**
 * The assistant asks the HUD to fetch this turn's report (ah-9vmbx.3).
 *
 * What a static render cannot reach: the dialog opening by itself, or waiting its turn behind one
 * the player already has open, where focus goes, the assistant stopping waiting under an open
 * dialog, and the one answer the assistant gets for each way a request ends. Every word and rule is
 * pinned in `assistantFetch.test.ts` and the two dialog tests. `desktop-shell` only: only the
 * desktop bundle passes an assistant transport and the HTTP transport both Fetch roads use, and
 * this walk installs a stand-in for each, as `assistant-send.spec.ts`, `newage-fetch.spec.ts` and
 * `neworigins-fetch.spec.ts` do.
 *
 * The stand-in never records a request body: the login and the download form carry the password.
 */

type Answer = { text: string; isError: boolean };

const TURN_70 = readReport("g7f95t70");
const TURN_71 = readReport("g7f95t71");
const OLDER_TURN = reportTurn("g7f95t70");
const NEWER_TURN = reportTurn("g7f95t71");

declare global {
  interface Window {
    __assistantConnected?: boolean;
    __assistantAsk?: (name: string, args: Record<string, unknown>) => number;
    __assistantAnswer?: (id: number) => Promise<Answer>;
    __assistantWithdraw?: (id: number) => void;
    /** What New Origins' download form answers next. */
    __originsReport?: string;
    /** What the New Age world's report endpoint answers next. */
    __newAgeReport?: string;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ newAge, origins }: { newAge: string; origins: string }) => {
      type Call = { id: number; name: string; arguments: Record<string, unknown> };
      let onCall: ((call: Call, signal: AbortSignal) => Promise<Answer>) | null = null;
      let next = 0;
      const answers = new Map<number, Promise<Answer>>();
      const controllers = new Map<number, AbortController>();
      (window as unknown as { __ATLANTIS_DESKTOP_ASSISTANT__: unknown }).__ATLANTIS_DESKTOP_ASSISTANT__ = {
        async connect(_tools: unknown, handler: typeof onCall) {
          onCall = handler;
          window.__assistantConnected = true;
          return () => undefined;
        },
        async connection() {
          return { url: "http://127.0.0.1:1/mcp", token: "stand-in", error: null };
        }
      };
      window.__assistantAsk = (name, args) => {
        if (onCall === null) {
          throw new Error("the assistant is not connected yet");
        }
        next += 1;
        const controller = new AbortController();
        controllers.set(next, controller);
        answers.set(next, onCall({ id: next, name, arguments: args }, controller.signal));
        return next;
      };
      window.__assistantAnswer = (id) => answers.get(id) ?? Promise.reject(new Error(`no call ${id}`));
      window.__assistantWithdraw = (id) => controllers.get(id)?.abort();

      window.__originsReport = origins;
      window.__newAgeReport = newAge;
      (window as unknown as { __ATLANTIS_DESKTOP_PLUGINS__: unknown }).__ATLANTIS_DESKTOP_PLUGINS__ = {
        async httpRequest(request: { method: string; url: string; body?: string }) {
          if (request.url.includes("/auth/login")) {
            return {
              status: 200,
              body: JSON.stringify({
                access_token: "t",
                token_type: "bearer",
                faction: { id: 95, name: "Merchant Guild", status: "" }
              })
            };
          }
          if (request.url.includes("download-report")) {
            return { status: 200, body: window.__originsReport ?? "" };
          }
          return { status: 200, body: window.__newAgeReport ?? "" };
        }
      };
    },
    { newAge: TURN_71, origins: TURN_70 }
  );
});

async function ask(page: Page, name: string): Promise<number> {
  return page.evaluate((tool) => window.__assistantAsk!(tool, {}), name);
}

async function answerOf(page: Page, id: number): Promise<Answer> {
  return page.evaluate((call) => window.__assistantAnswer!(call), id);
}

/** Waits until F2's game data opens, which is when the ruleset has been parsed. */
async function rulesetReady(page: Page) {
  const gameData = page.getByTestId("game-data-dialog");
  await expect(async () => {
    if (!(await gameData.isVisible())) {
      await page.keyboard.press("F2");
    }
    await expect(gameData).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(gameData).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__assistantConnected === true)).toBe(true);
}

/** An Arcanum game with no report yet. */
async function emptyNewAgeGame(page: Page) {
  await clearGames(page);
  await page.getByTestId("game-ruleset").selectOption("newage-arcanum");
  await createGame(page, "Arcanum game");
  await rulesetReady(page);
}

/** Presses Escape until the panel has gone: the dialog listens from an effect a frame late. */
async function escapeUntilGone(page: Page, panelId: string) {
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(panelId)).toHaveCount(0, { timeout: 500 });
  }).toPass({ timeout: 5000 });
}

const ASKING = "The assistant is asking for this turn's report.";

test("the assistant asks, the player types the password, and the assistant learns the turn on screen", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await emptyNewAgeGame(page);

  const id = await ask(page, "fetch_report");

  await expect(page.getByTestId("newage-fetch-panel")).toBeVisible();
  await expect(page.getByTestId("assistant-fetch-line")).toHaveText(ASKING);
  await expect(page.getByTestId("newage-fetch-scope-this-turn")).toHaveCount(0);
  await expect(page.getByTestId("newage-password")).toBeFocused();
  await expect(page.getByTestId("newage-faction-number")).toHaveValue("");

  await page.getByTestId("newage-faction-number").fill("95");
  await page.getByTestId("newage-password").fill("hunter2");
  await page.keyboard.press("Enter");

  const answer = await answerOf(page, id);
  expect(answer).toEqual({
    text: `Turn ${NEWER_TURN}'s report was fetched and is on screen in Atlantis HUD now. Read it with the usual tools.`,
    isError: false
  });
  expect(answer.text).not.toContain("hunter2");
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(0);
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
});

test("Escape declines: nothing is fetched, the status line says so, and the assistant is told", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await emptyNewAgeGame(page);

  const id = await ask(page, "fetch_report");
  await expect(page.getByTestId("newage-password")).toBeFocused();
  await escapeUntilGone(page, "newage-fetch-panel");

  await expect(page.getByTestId("import-status")).toHaveText("Fetch declined — the assistant has been told.");
  expect(await answerOf(page, id)).toEqual({
    text: "The player declined to fetch this turn's report. Nothing was fetched.",
    isError: true
  });
});

test("when the assistant stops waiting, the dialog stays with what was typed, and Cancel says nothing", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await emptyNewAgeGame(page);

  const id = await ask(page, "fetch_report");
  await page.getByTestId("newage-faction-number").fill("95");
  await page.getByTestId("newage-password").fill("hunter2");
  await page.evaluate((call) => window.__assistantWithdraw!(call), id);

  await expect(page.getByTestId("assistant-fetch-line")).toHaveText(
    "The assistant stopped waiting. You can still fetch this turn's report here."
  );
  await expect(page.getByTestId("newage-password")).toHaveValue("hunter2");
  await expect(page.getByTestId("newage-fetch-confirm")).toBeEnabled();
  expect((await answerOf(page, id)).text).toBe(
    "The player did not answer the fetch request in Atlantis HUD. Nothing was fetched."
  );

  await page.getByTestId("newage-fetch-cancel").click();
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(0);
  await expect(page.getByTestId("import-status")).not.toContainText("declined");
});

test("a request made over the player's own Fetch waits its turn, and a second one adds nothing", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await emptyNewAgeGame(page);
  await page.getByTestId("fetch-control").click();
  await expect(page.getByTestId("newage-fetch-panel")).toBeVisible();

  const first = await ask(page, "fetch_report");
  const second = await answerOf(page, await ask(page, "fetch_report"));
  expect(second.isError).toBe(true);
  expect(second.text).toContain("already waiting");
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(1);
  await expect(page.getByTestId("assistant-fetch-line")).toHaveCount(0);

  await page.getByTestId("newage-fetch-cancel").click();
  await expect(page.getByTestId("assistant-fetch-line")).toHaveText(ASKING);
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(1);

  await page.getByTestId("newage-fetch-cancel").click();
  expect((await answerOf(page, first)).text).toContain("declined");
});

test("the player's own Fetch that brings the turn answers a waiting request, and nothing more opens", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await emptyNewAgeGame(page);
  await page.getByTestId("fetch-control").click();

  const id = await ask(page, "fetch_report");
  await page.getByTestId("newage-faction-number").fill("95");
  await page.getByTestId("newage-password").fill("hunter2");
  await page.getByTestId("newage-fetch-confirm").click();

  expect((await answerOf(page, id)).text).toContain(`Turn ${NEWER_TURN}'s report was fetched`);
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(0);
  await expect(page.getByTestId("assistant-fetch-line")).toHaveCount(0);
});

test("on New Origins a newer turn still asks first, and Keep tells the assistant it was only stored", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await clearGames(page);
  await page.getByTestId("game-ruleset").selectOption("neworigins");
  await createGame(page, "New Origins game");
  await rulesetReady(page);
  await page.getByTestId("fetch-control").click();
  await page.getByTestId("newage-faction-number").fill("27");
  await page.getByTestId("newage-password").fill("right");
  await page.getByTestId("neworigins-fetch-confirm").click();
  await expect(page.getByTestId("import-status")).toContainText(`turn ${OLDER_TURN} loaded`);
  await page.evaluate((report) => {
    window.__originsReport = report;
  }, TURN_71);

  const id = await ask(page, "fetch_report");
  await expect(page.getByTestId("assistant-fetch-line")).toHaveText(ASKING);
  await expect(page.getByTestId("newage-faction-number")).toHaveValue("95");
  await page.getByTestId("newage-password").fill("hunter2");
  await page.getByTestId("neworigins-fetch-confirm").click();

  await expect(page.getByTestId("neworigins-fetch-keep")).toHaveText(`Keep turn ${OLDER_TURN}`);
  await expect(page.getByTestId("assistant-fetch-line")).toHaveText(ASKING);
  await page.getByTestId("neworigins-fetch-keep").click();

  expect(await answerOf(page, id)).toEqual({
    text: `Turn ${NEWER_TURN}'s report was fetched and stored for history, but the player kept turn ${OLDER_TURN} on screen.`,
    isError: false
  });
});

test("a request made over the command palette opens once the palette closes, and another one then adds nothing", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await emptyNewAgeGame(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();

  const first = await ask(page, "fetch_report");
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(0);

  // Only the dismiss stack sees the palette close: no Fetch or Send phase moves.
  await escapeUntilGone(page, "command-palette");
  await expect(page.getByTestId("assistant-fetch-line")).toHaveText(ASKING);
  await expect(page.getByTestId("newage-password")).toBeFocused();

  const second = await answerOf(page, await ask(page, "fetch_report"));
  expect(second.isError).toBe(true);
  expect(second.text).toContain("already waiting");
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(1);

  await page.getByTestId("newage-fetch-cancel").click();
  expect((await answerOf(page, first)).text).toContain("declined");
});

test("a request the assistant gives up on while it waits its turn never opens", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await emptyNewAgeGame(page);
  await page.getByTestId("fetch-control").click();
  await expect(page.getByTestId("newage-fetch-panel")).toBeVisible();

  const id = await ask(page, "fetch_report");
  await page.evaluate((call) => window.__assistantWithdraw!(call), id);
  expect((await answerOf(page, id)).text).toBe(
    "The player did not answer the fetch request in Atlantis HUD. Nothing was fetched."
  );

  // The click's commit and its effects flush before the click resolves, so a dialog wrongly
  // still queued would already be on screen here.
  await page.getByTestId("newage-fetch-cancel").click();
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(0);
  await expect(page.getByTestId("import-status")).not.toContainText("declined");
});

test("a fetched report the HUD cannot read is answered as not loaded, never as loaded", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await emptyNewAgeGame(page);
  await page.evaluate(() => {
    window.__newAgeReport = "This is not an Atlantis report.";
  });

  const id = await ask(page, "fetch_report");
  await page.getByTestId("newage-faction-number").fill("95");
  await page.getByTestId("newage-password").fill("hunter2");
  await page.keyboard.press("Enter");

  expect(await answerOf(page, id)).toEqual({
    text: "A report was fetched but Atlantis HUD could not load it; the player was shown why. The turn on screen is unchanged.",
    isError: true
  });
  await expect(page.getByTestId("import-status")).toContainText("could not read");
});
