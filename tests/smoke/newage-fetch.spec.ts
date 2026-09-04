import { expect, test } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";

import { clearGames, createGame } from "./gameSetup";

/**
 * Fetching this turn's report from a New Age world (ah-lbd9.3).
 *
 * The only place this bead's whole path runs: sign in, open the world popover, ask for the report,
 * and see the turn land through the same door a dropped file goes through. `desktop-shell` only,
 * for the reason `desktop-shell.spec.ts` gives - the transport exists only in that bundle.
 *
 * The stand-in never records a request body's content: a New Age reply can carry a password in
 * cleartext, so only a length is kept, which is what proves the password went nowhere it should
 * not.
 */
const TURN_71 = readReport("g7f95t71");

const REPORT_URL = "https://atlantis-newage.com/api/worlds/arcanum/files/report?format=txt";

type HttpCall = ["httpRequest", string, string, number];

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-shell",
    "desktop wiring: the New Age transport is only there in the desktop bundle"
  );

  await page.addInitScript(
    ({ report }: { report: string }) => {
      const calls: unknown[][] = [];
      (
        window as unknown as { __ATLANTIS_DESKTOP_CALLS__: unknown[][] }
      ).__ATLANTIS_DESKTOP_CALLS__ = calls;
      (
        window as unknown as { __ATLANTIS_REPORT_REPLY__: { status: number; body: string } }
      ).__ATLANTIS_REPORT_REPLY__ = { status: 200, body: report };
      (
        window as unknown as {
          __ATLANTIS_DESKTOP_PLUGINS__: {
            httpRequest(
              request: { method: string; url: string; headers: Record<string, string>; body?: string }
            ): Promise<{ status: number; body: string }>;
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
                faction: { id: 27, name: "Merchant Guild", status: "" }
              })
            };
          }
          return (
            window as unknown as { __ATLANTIS_REPORT_REPLY__: { status: number; body: string } }
          ).__ATLANTIS_REPORT_REPLY__;
        }
      };
    },
    { report: TURN_71 }
  );
});

async function httpCalls(page: import("@playwright/test").Page): Promise<HttpCall[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __ATLANTIS_DESKTOP_CALLS__: HttpCall[] }).__ATLANTIS_DESKTOP_CALLS__
  );
}

/** Sets what the report endpoint answers next. */
async function replyWith(
  page: import("@playwright/test").Page,
  reply: { status: number; body: string }
) {
  await page.evaluate((next) => {
    (
      window as unknown as { __ATLANTIS_REPORT_REPLY__: { status: number; body: string } }
    ).__ATLANTIS_REPORT_REPLY__ = next;
  }, reply);
}

/** A signed-in Arcanum game with the ruleset loaded and the world popover open. */
async function signedInWithPopover(page: import("@playwright/test").Page) {
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
  await page.getByTestId("newage-faction-number").fill("27");
  await page.getByTestId("newage-password").fill("right");
  await page.getByTestId("newage-signin-confirm").click();
  await expect(page.getByTestId("newage-control")).toContainText("Merchant Guild");

  await page.getByTestId("newage-control").click();
}

test("fetches this turn's report into the game", async ({ page }) => {
  await signedInWithPopover(page);
  await page.getByTestId("newage-fetch-report").click();

  await expect(page.getByTestId("import-status")).toContainText("11 regions");

  const calls = await httpCalls(page);
  expect(calls).toContainEqual(["httpRequest", "GET", REPORT_URL, 0]);
  // Only the login carries a body: nothing else this walk performs sends one.
  expect(calls.filter((call) => call[3] > 0).map((call) => call[2])).toEqual([
    "https://atlantis-newage.com/api/worlds/arcanum/auth/login"
  ]);
});

test("asks for the password again when the session has run out, and then fetches", async ({
  page
}) => {
  await signedInWithPopover(page);
  await replyWith(page, { status: 401, body: "" });
  await page.getByTestId("newage-fetch-report").click();

  await expect(page.getByTestId("newage-signin-panel")).toBeVisible();
  await expect(page.getByTestId("newage-signin-notice")).toHaveText(
    "Your session has ended. Sign in again to continue."
  );
  await expect(page.getByTestId("newage-signin-confirm")).toHaveText("Sign in and fetch");
  // The dead token was dropped, so the chip behind the dialog offers a sign-in again.
  await expect(page.getByTestId("newage-control")).toContainText("Sign in to Arcanum");

  await replyWith(page, { status: 200, body: TURN_71 });
  // No report is on screen yet, so there is no faction id to prefill from: both fields are typed.
  await page.getByTestId("newage-faction-number").fill("27");
  await page.getByTestId("newage-password").fill("right");
  await page.getByTestId("newage-signin-confirm").click();

  await expect(page.getByTestId("newage-signin-panel")).not.toBeVisible();
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
});

test("says so when the world has no report yet", async ({ page }) => {
  await signedInWithPopover(page);
  await replyWith(page, { status: 200, body: "" });
  await page.getByTestId("newage-fetch-report").click();

  await expect(page.getByTestId("import-status")).toContainText(
    "could not fetch this turn's report: the world has no report for you yet"
  );
});
