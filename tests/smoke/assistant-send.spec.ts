import { expect, test, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";

import { clearGames, closeRulesetCheck, createGame, STANDARD_TURN } from "./gameSetup";
import { DESKTOP_SHELL_TAG } from "./shells";

/**
 * The assistant asks the HUD to send the orders (ah-9vmbx.2).
 *
 * What a static render cannot reach: the dialog opening by itself over the workspace, where focus
 * goes, the player's go-ahead reaching the world, and the one answer the assistant gets for each
 * way a request ends. Every word and rule is pinned in `assistantSend.test.ts` and the two dialog
 * tests. `desktop-shell` only: only the desktop bundle passes an assistant transport and a New Age
 * transport, and this walk installs a stand-in for each, as `assistant-changes.spec.ts` and
 * `newage-send.spec.ts` do.
 *
 * The stand-in never records a request body: an orders upload carries the faction password.
 */

type Answer = { text: string; isError: boolean };
type Reply = { status: number; body: string };

const TURN_71 = readReport("g7f95t71");
const ORDERS_URL = "https://atlantis-newage.com/api/worlds/arcanum/files/orders";

const SAVED_WITH_ERRORS: Reply = {
  status: 200,
  body: JSON.stringify({
    saved: true,
    valid: false,
    error_count: 2,
    errors: [{ msg: "MOVE: no such direction." }, { msg: "STUDY: not a skill this unit can learn." }],
    warnings: ["Faction has unused tax points."],
    message: "Orders saved with 2 syntax errors"
  })
};

declare global {
  interface Window {
    __assistantAsk?: (name: string, args: Record<string, unknown>) => number;
    __assistantAnswer?: (id: number) => Promise<Answer>;
    __assistantWithdraw?: (id: number) => void;
    __uploads?: string[];
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ report, orders }: { report: string; orders: Reply }) => {
      type Call = { id: number; name: string; arguments: Record<string, unknown> };
      let onCall: ((call: Call, signal: AbortSignal) => Promise<Answer>) | null = null;
      let next = 0;
      const answers = new Map<number, Promise<Answer>>();
      const controllers = new Map<number, AbortController>();
      (window as unknown as { __ATLANTIS_DESKTOP_ASSISTANT__: unknown }).__ATLANTIS_DESKTOP_ASSISTANT__ = {
        async connect(_tools: unknown, handler: typeof onCall) {
          onCall = handler;
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

      const uploads: string[] = [];
      window.__uploads = uploads;
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
          if (request.url.includes("/files/orders")) {
            uploads.push(request.url);
            return orders;
          }
          return { status: 200, body: report };
        }
      };
    },
    { report: TURN_71, orders: SAVED_WITH_ERRORS }
  );
});

async function ask(page: Page, name: string, args: Record<string, unknown> = {}): Promise<number> {
  return page.evaluate(([tool, input]) => window.__assistantAsk!(tool as string, input as Record<string, unknown>), [name, args] as const);
}

async function answerOf(page: Page, id: number): Promise<Answer> {
  return page.evaluate((call) => window.__assistantAnswer!(call), id);
}

async function call(page: Page, name: string, args: Record<string, unknown> = {}): Promise<Answer> {
  return answerOf(page, await ask(page, name, args));
}

async function uploads(page: Page): Promise<number> {
  return page.evaluate(() => window.__uploads?.length ?? 0);
}

/** An Arcanum game with turn 72 fetched, so there are orders to send - as `newage-send.spec.ts`. */
async function withTurnLoaded(page: Page) {
  await clearGames(page);
  await page.getByTestId("game-ruleset").selectOption("newage-arcanum");
  await createGame(page, "Arcanum game");
  const gameData = page.getByTestId("game-data-dialog");
  await expect(async () => {
    if (!(await gameData.isVisible())) {
      await page.keyboard.press("F2");
    }
    await expect(gameData).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(gameData).not.toBeVisible();

  await page.getByTestId("fetch-control").click();
  await page.getByTestId("newage-faction-number").fill("95");
  await page.getByTestId("newage-password").fill("right");
  await page.getByTestId("newage-fetch-confirm").click();
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
  await closeRulesetCheck(page);
  await expect.poll(async () => (await call(page, "get_turn_overview")).isError).toBe(false);
}

/** Has the assistant change one unit's orders, so one change waits for Keep or Revert. */
async function oneAssistantChange(page: Page) {
  const overview = JSON.parse((await call(page, "get_turn_overview")).text) as { turnKey: string };
  const units = JSON.parse((await call(page, "list_units")).text) as { unitId: string }[];
  const unitId = units[0]!.unitId;
  const { version } = JSON.parse((await call(page, "get_orders", { unitId })).text) as { version: string };
  const written = await call(page, "write_orders", { turnKey: overview.turnKey, units: [{ unitId, version, orders: "work" }] });
  expect(written.isError, written.text).toBe(false);
}

const panel = (page: Page) => page.getByTestId("newage-send-panel");

test("the assistant asks, the player types the password, and both learn what the world said", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await withTurnLoaded(page);
  await oneAssistantChange(page);

  const id = await ask(page, "send_orders");

  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("assistant-send-line")).toHaveText(
    "Your assistant asks to send these orders. Type the faction password to send them, or Cancel to refuse."
  );
  await expect(page.getByTestId("assistant-send-reminders")).toContainText(
    "1 change by the assistant you have not kept or reverted yet"
  );
  await expect(page.getByTestId("newage-password")).toBeFocused();

  await page.getByTestId("newage-password").fill("hunter2");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("newage-send-outcome")).toHaveText(
    `Orders for turn ${STANDARD_TURN} were saved, but the world found 2 errors in them.`
  );
  await expect(page.getByTestId("assistant-send-line")).toBeVisible();
  await expect(page.getByTestId("assistant-send-reminders")).toHaveCount(0);
  await expect(page.getByTestId("newage-send-close")).toBeFocused();

  const answer = await answerOf(page, id);
  expect(answer.isError).toBe(false);
  expect(answer.text).toContain("MOVE: no such direction.");
  expect(answer.text).toContain("STUDY: not a skill this unit can learn.");
  expect(answer.text).toContain("Faction has unused tax points.");
  expect(answer.text).not.toContain("hunter2");
  // Sending keeps nothing: the assistant's change still waits for the player.
  await page.getByTestId("newage-send-close").click();
  // The chip stands in for the panel only while the panel is closed; either says it is listed.
  await expect(
    page.getByTestId("assistant-changes-chip").or(page.getByTestId("assistant-changes-panel"))
  ).toBeVisible();
});

test("Escape refuses: nothing is sent and the assistant hears the player declined", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await withTurnLoaded(page);

  const id = await ask(page, "send_orders");
  await expect(page.getByTestId("newage-password")).toBeFocused();
  // The dialog listens for Escape from an effect, which can land a frame after it is drawn.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0, { timeout: 500 });
  }).toPass({ timeout: 5000 });
  expect(await answerOf(page, id)).toEqual({
    text: "The player declined to send the orders. Nothing was sent.",
    isError: true
  });
  expect(await uploads(page)).toBe(0);
});

test("when the assistant stops waiting, the prompt says so and can send nothing", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await withTurnLoaded(page);

  const id = await ask(page, "send_orders");
  await expect(panel(page)).toBeVisible();
  await page.getByTestId("newage-password").fill("hunter2");
  await page.evaluate((call) => window.__assistantWithdraw!(call), id);

  await expect(page.getByTestId("assistant-send-stopped")).toHaveText(
    "The assistant stopped waiting for an answer, so nothing was sent. Ask it again, or press Send in the top bar."
  );
  await expect(page.getByTestId("newage-password")).toHaveCount(0);
  await expect(page.getByTestId("newage-send-confirm")).toHaveCount(0);
  await expect(page.getByTestId("newage-send-close")).toBeFocused();
  expect((await answerOf(page, id)).isError).toBe(true);

  await page.getByTestId("newage-send-close").click();
  await expect(panel(page)).toHaveCount(0);
  expect(await uploads(page)).toBe(0);
});

test("a second request while one waits is refused with nothing shown", { tag: DESKTOP_SHELL_TAG }, async ({ page }) => {
  await withTurnLoaded(page);

  const first = await ask(page, "send_orders");
  await expect(panel(page)).toBeVisible();

  const second = await call(page, "send_orders");
  expect(second.isError).toBe(true);
  expect(second.text).toContain("already waiting");
  await expect(panel(page)).toHaveCount(1);

  await page.getByTestId("newage-send-cancel").click();
  expect((await answerOf(page, first)).text).toContain("declined");
});
