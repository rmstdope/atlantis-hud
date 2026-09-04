import { expect, test } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";

import { clearGames, createGame } from "./gameSetup";

/**
 * Sending orders to a New Age world (ah-lbd9.4).
 *
 * The only place this bead's whole path runs: sign in, fetch a turn so there are orders to send,
 * press Send, and read what the world answered. `desktop-shell` only, for the reason
 * `desktop-shell.spec.ts` gives - the transport exists only in that bundle.
 *
 * The stand-in never records a request body's content: an orders upload carries the faction
 * password in cleartext in its first line, so only a length is kept - which is what proves the
 * orders left and the password went nowhere it should not.
 *
 * The fixture is faction 95, turn 71, whose orders template line reads `#atlantis 95 "<password>"`,
 * so the stand-in signs in as faction 95 and every assertion here names that turn and that faction.
 */
const TURN_71 = readReport("g7f95t71");

const ORDERS_URL = "https://atlantis-newage.com/api/worlds/arcanum/files/orders";
const LOGIN_URL = "https://atlantis-newage.com/api/worlds/arcanum/auth/login";

type HttpCall = ["httpRequest", string, string, number];

type Reply = { status: number; body: string };

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

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-shell",
    "desktop wiring: the New Age transport is only there in the desktop bundle"
  );

  await page.addInitScript(
    ({ report, orders }: { report: string; orders: Reply }) => {
      const calls: unknown[][] = [];
      (
        window as unknown as { __ATLANTIS_DESKTOP_CALLS__: unknown[][] }
      ).__ATLANTIS_DESKTOP_CALLS__ = calls;
      (
        window as unknown as { __ATLANTIS_ORDERS_REPLY__: Reply }
      ).__ATLANTIS_ORDERS_REPLY__ = orders;
      (
        window as unknown as {
          __ATLANTIS_DESKTOP_PLUGINS__: {
            httpRequest(request: {
              method: string;
              url: string;
              headers: Record<string, string>;
              body?: string;
            }): Promise<Reply>;
          };
        }
      ).__ATLANTIS_DESKTOP_PLUGINS__ = {
        async httpRequest(request: {
          method: string;
          url: string;
          headers: Record<string, string>;
          body?: string;
        }) {
          calls.push(["httpRequest", request.method, request.url, request.body?.length ?? 0]);
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
            return (window as unknown as { __ATLANTIS_ORDERS_REPLY__: Reply })
              .__ATLANTIS_ORDERS_REPLY__;
          }
          return { status: 200, body: report };
        }
      };
    },
    { report: TURN_71, orders: SAVED_WITH_ERRORS }
  );
});

async function httpCalls(page: import("@playwright/test").Page): Promise<HttpCall[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __ATLANTIS_DESKTOP_CALLS__: HttpCall[] }).__ATLANTIS_DESKTOP_CALLS__
  );
}

/** Sets what the orders endpoint answers next. */
async function ordersReplyWith(page: import("@playwright/test").Page, reply: Reply) {
  await page.evaluate((next) => {
    (window as unknown as { __ATLANTIS_ORDERS_REPLY__: Reply }).__ATLANTIS_ORDERS_REPLY__ = next;
  }, reply);
}

/** A signed-in Arcanum game with turn 71 loaded, so there are orders to send. */
async function signedInWithTurn(page: import("@playwright/test").Page) {
  await clearGames(page);
  await page.getByTestId("game-ruleset").selectOption("newage-arcanum");
  await createGame(page, "Arcanum game");

  // The New Age ruleset is around 300 KiB and arrives late; a status line asserted before it is
  // ready reads `The rules could not be loaded` instead of the counts. F2 opens the dictionary only
  // once the ruleset has been parsed, so this is the wait - the loop `games.spec.ts:58-64` uses.
  const gameData = page.getByTestId("game-data-dialog");
  await expect(async () => {
    if (!(await gameData.isVisible())) {
      await page.keyboard.press("F2");
    }
    await expect(gameData).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(gameData).not.toBeVisible();

  await page.getByTestId("newage-control").click();
  await page.getByTestId("newage-faction-number").fill("95");
  await page.getByTestId("newage-password").fill("right");
  await page.getByTestId("newage-signin-confirm").click();
  await expect(page.getByTestId("newage-control")).toContainText("Merchant Guild");

  await page.getByTestId("newage-control").click();
  await page.getByTestId("newage-fetch-report").click();
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
}

test("sends orders and reports that the world saved them with errors", async ({ page }) => {
  await signedInWithTurn(page);

  await page.getByTestId("send-orders").click();
  await expect(page.getByTestId("newage-send-meta")).toContainText(
    "turn 71 · atlantis-newage.com"
  );
  // A session is already in hand, so only the password is asked for.
  await expect(page.getByTestId("newage-faction-number")).toHaveCount(0);
  await expect(page.getByTestId("newage-send-confirm")).toHaveText("Send");

  await page.getByTestId("newage-password").fill("hunter2");
  await page.getByTestId("newage-send-confirm").click();

  await expect(page.getByTestId("newage-send-outcome")).toHaveText(
    "Orders for turn 71 were saved, but the world found 2 errors in them."
  );
  await expect(page.getByTestId("newage-send-errors").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("newage-send-warnings").locator("li")).toHaveCount(1);
  // Both lists carry entries, so the world's own message would only repeat them.
  await expect(page.getByTestId("newage-send-report")).toHaveCount(0);
  await expect(page.getByTestId("newage-send-close")).toBeVisible();
  await expect(page.getByTestId("newage-send-confirm")).toHaveCount(0);
  await expect(page.getByTestId("newage-send-cancel")).toHaveCount(0);

  const calls = await httpCalls(page);
  const upload = calls.find((call) => call[2] === ORDERS_URL);
  expect(upload?.[1]).toBe("POST");
  expect(upload?.[3]).toBeGreaterThan(0);
  // Only the login and the upload carry a body at all; neither body is ever recorded.
  expect(new Set(calls.filter((call) => call[3] > 0).map((call) => call[2]))).toEqual(
    new Set([LOGIN_URL, ORDERS_URL])
  );
});

test("signs in as part of sending when the session has run out", async ({ page }) => {
  await signedInWithTurn(page);

  await page.getByTestId("newage-control").click();
  await page.getByTestId("newage-signout").click();
  await expect(page.getByTestId("newage-control")).toContainText("Sign in to Arcanum");

  await page.getByTestId("send-orders").click();
  // The loaded report's own faction is what the field is prefilled with.
  await expect(page.getByTestId("newage-faction-number")).toHaveValue("95");
  await expect(page.getByTestId("newage-send-confirm")).toHaveText("Sign in and send");

  await page.getByTestId("newage-password").fill("hunter2");
  await page.getByTestId("newage-send-confirm").click();

  await expect(page.getByTestId("newage-send-outcome")).toHaveText(
    "Orders for turn 71 were saved, but the world found 2 errors in them."
  );
  // The sign-in happened inside the send: the chip behind the dialog names the faction again.
  await expect(page.getByTestId("newage-control")).toContainText("Merchant Guild");
});

test("says so when the world saved nothing, and keeps the password field", async ({ page }) => {
  await signedInWithTurn(page);
  await ordersReplyWith(page, {
    status: 200,
    body: JSON.stringify({
      saved: false,
      valid: false,
      error_count: 0,
      errors: [],
      warnings: [],
      message: "Wrong faction password"
    })
  });

  await page.getByTestId("send-orders").click();
  await page.getByTestId("newage-password").fill("wrong");
  await page.getByTestId("newage-send-confirm").click();

  await expect(page.getByTestId("newage-send-outcome")).toHaveText(
    "The world did not save these orders. Check the faction password and try again."
  );
  // Nothing else explains the refusal, so the world's own words are quoted.
  await expect(page.getByTestId("newage-send-report")).toHaveText("Wrong faction password");
  // Retyping the password is the fix, so the field is back and empty.
  await expect(page.getByTestId("newage-password")).toHaveValue("");
  await expect(page.getByTestId("newage-send-confirm")).toBeVisible();
});

test("returns focus to Send when the dialog is dismissed", async ({ page }) => {
  await signedInWithTurn(page);

  await page.getByTestId("send-orders").click();
  await expect(page.getByTestId("newage-send-panel")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("newage-send-panel")).toHaveCount(0);
  await expect(page.getByTestId("send-orders")).toBeFocused();
});
