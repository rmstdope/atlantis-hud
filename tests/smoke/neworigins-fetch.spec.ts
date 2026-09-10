import { expect, test } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";

import { clearGames, createGame } from "./gameSetup";

/**
 * Fetching this turn's report from New Origins (ah-ia0w).
 *
 * The only place this whole path runs: press Fetch, type the faction number and password into the
 * dialog, and see the turn land through the same door a dropped file goes through - being asked
 * first when it would replace what is on screen. There is no sign-in: the site's own download form
 * posts the password with the download itself. `desktop-shell` only, for the reason
 * `newage-fetch.spec.ts` gives: the transport exists only in that bundle, and its absence is the
 * whole of what hides the button on web.
 *
 * The stand-in never records a request body's content: a reply from this host can echo an orders
 * document carrying the password in cleartext, so only a length is kept - which is what proves the
 * password went nowhere it should not.
 */
const TURN_70 = readReport("g7f95t70");
const TURN_71 = readReport("g7f95t71");

const DOWNLOAD_URL = "https://atlantis-pbem.com/game/download-report";

/** The site's own refusal, probed 2026-09-10: `200 OK`, an ordinary page with a red block. */
const REFUSAL_PAGE = `<html><body>
  <div class="alert alert-danger text-center">
    <h3>Faction password is incorrect. Try again or contact the Game Masters on Discord to change your password.</h3>
  </div>
</body></html>`;

const REFUSAL_SENTENCE =
  "Faction password is incorrect. Try again or contact the Game Masters on Discord to change your password.";

type HttpCall = ["httpRequest", string, string, number];

type DownloadReply = { status: number; body: string; throws?: boolean };

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-shell",
    "desktop wiring: the pbem transport is only there in the desktop bundle"
  );

  await page.addInitScript(
    ({ report }: { report: string }) => {
      const calls: unknown[][] = [];
      (
        window as unknown as { __ATLANTIS_DESKTOP_CALLS__: unknown[][] }
      ).__ATLANTIS_DESKTOP_CALLS__ = calls;
      (
        window as unknown as { __ATLANTIS_DOWNLOAD_REPLY__: DownloadReply }
      ).__ATLANTIS_DOWNLOAD_REPLY__ = { status: 200, body: report };
      (
        window as unknown as {
          __ATLANTIS_DESKTOP_PLUGINS__: {
            httpRequest(request: {
              method: string;
              url: string;
              headers: Record<string, string>;
              body?: string;
            }): Promise<{ status: number; body: string }>;
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
          const reply = (window as unknown as { __ATLANTIS_DOWNLOAD_REPLY__: DownloadReply })
            .__ATLANTIS_DOWNLOAD_REPLY__;
          if (reply.throws) {
            throw new Error("the site could not be reached");
          }
          return { status: reply.status, body: reply.body };
        }
      };
    },
    { report: TURN_70 }
  );
});

async function httpCalls(page: import("@playwright/test").Page): Promise<HttpCall[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __ATLANTIS_DESKTOP_CALLS__: HttpCall[] }).__ATLANTIS_DESKTOP_CALLS__
  );
}

/** Sets what the download form answers next. */
async function replyWith(page: import("@playwright/test").Page, reply: DownloadReply) {
  await page.evaluate((next) => {
    (window as unknown as { __ATLANTIS_DOWNLOAD_REPLY__: DownloadReply }).__ATLANTIS_DOWNLOAD_REPLY__ =
      next;
  }, reply);
}

/** A New Origins game with its ruleset parsed, ready for the Fetch button to be pressed. */
async function newOriginsGame(page: import("@playwright/test").Page, name = "New Origins game") {
  await page.getByTestId("game-ruleset").selectOption("neworigins");
  await createGame(page, name);

  // `parseReport` waits for the ruleset: a status line asserted before it is ready reads `The rules
  // could not be loaded` instead of the counts. F2 opens the dictionary only once the ruleset has
  // been parsed, so this is the wait - the loop `games.spec.ts` uses.
  const gameData = page.getByTestId("game-data-dialog");
  await expect(async () => {
    if (!(await gameData.isVisible())) {
      await page.keyboard.press("F2");
    }
    await expect(gameData).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(gameData).not.toBeVisible();
}

/** Opens the dialog, types both fields and confirms. */
async function fetchWith(page: import("@playwright/test").Page) {
  await page.getByTestId("fetch-control").click();
  await page.getByTestId("newage-faction-number").fill("27");
  await page.getByTestId("newage-password").fill("right");
  await page.getByTestId("neworigins-fetch-confirm").click();
}

test("fetches this turn's report into an empty game", async ({ page }) => {
  await clearGames(page);
  await newOriginsGame(page);

  await expect(page.getByTestId("fetch-control")).toHaveText("Fetch");
  await fetchWith(page);

  await expect(page.getByTestId("import-status")).toContainText("turn 70 loaded —");
  await expect(page.getByTestId("neworigins-fetch-panel")).toHaveCount(0);

  const calls = await httpCalls(page);
  expect(calls.map((call) => [call[1], call[2]])).toEqual([["POST", DOWNLOAD_URL]]);
  // The one call carries a body, and it is the only one that does: a password that reached any
  // other request would show here as a second row with a length.
  expect(calls.filter((call) => call[3] > 0)).toHaveLength(1);
});

test("asks before a newer turn replaces what is on screen, and files it when kept", async ({
  page
}) => {
  await clearGames(page);
  await newOriginsGame(page);
  await fetchWith(page);
  await expect(page.getByTestId("import-status")).toContainText("turn 70 loaded —");

  await replyWith(page, { status: 200, body: TURN_71 });
  await fetchWith(page);

  await expect(page.getByTestId("neworigins-fetch-question")).toContainText(
    "Turn 71 has arrived. Opening it replaces turn 70 on screen"
  );
  await expect(page.getByTestId("neworigins-fetch-keep")).toHaveText("Keep turn 70");
  await page.getByTestId("neworigins-fetch-keep").click();

  await expect(page.getByTestId("import-status")).toContainText(
    "turn 71 stored for history; still showing turn 70."
  );
  await expect(page.getByTestId("turn-chip")).toContainText("70");
});

test("opens a newer turn when asked to", async ({ page }) => {
  await clearGames(page);
  await newOriginsGame(page);
  await fetchWith(page);
  await expect(page.getByTestId("import-status")).toContainText("turn 70 loaded —");

  await replyWith(page, { status: 200, body: TURN_71 });
  await fetchWith(page);
  await expect(page.getByTestId("neworigins-fetch-open")).toHaveText("Open turn 71");
  await page.getByTestId("neworigins-fetch-open").click();

  await expect(page.getByTestId("import-status")).toContainText("turn 71 loaded —");
  await expect(page.getByTestId("turn-chip")).toContainText("71");
});

test("offers a reload when the same turn comes back", async ({ page }) => {
  await clearGames(page);
  await newOriginsGame(page);
  await fetchWith(page);
  await expect(page.getByTestId("import-status")).toContainText("turn 70 loaded —");

  await fetchWith(page);
  await expect(page.getByTestId("neworigins-fetch-question")).toContainText(
    "the turn you already have"
  );
  await expect(page.getByTestId("neworigins-fetch-keep")).toHaveText("Keep what I have");
  await page.getByTestId("neworigins-fetch-keep").click();

  await expect(page.getByTestId("import-status")).toHaveText("still showing turn 70.");
});

test("files an older turn without asking", async ({ page }) => {
  await clearGames(page);
  await newOriginsGame(page);
  await replyWith(page, { status: 200, body: TURN_71 });
  await fetchWith(page);
  await expect(page.getByTestId("import-status")).toContainText("turn 71 loaded —");

  await replyWith(page, { status: 200, body: TURN_70 });
  await fetchWith(page);

  await expect(page.getByTestId("import-status")).toContainText(
    "turn 70 stored for history; still showing turn 71."
  );
  await expect(page.getByTestId("neworigins-fetch-panel")).toHaveCount(0);
});

test("quotes the site's own sentence when it is refused", async ({ page }) => {
  await clearGames(page);
  await newOriginsGame(page);
  await replyWith(page, { status: 200, body: REFUSAL_PAGE });
  await fetchWith(page);

  await expect(page.getByTestId("neworigins-fetch-message")).toHaveText(REFUSAL_SENTENCE);
  await expect(page.getByTestId("neworigins-fetch-panel")).toBeVisible();
  await expect(page.getByTestId("newage-faction-number")).toHaveValue("27");
  await expect(page.getByTestId("newage-password")).toHaveValue("");
});

test("says the site could not be reached, and keeps both fields", async ({ page }) => {
  await clearGames(page);
  await newOriginsGame(page);
  await replyWith(page, { status: 0, body: "", throws: true });
  await fetchWith(page);

  await expect(page.getByTestId("neworigins-fetch-message")).toHaveText(
    "Could not reach atlantis-pbem.com."
  );
  await expect(page.getByTestId("newage-faction-number")).toHaveValue("27");
  await expect(page.getByTestId("newage-password")).toHaveValue("right");
});

test("names the browser route when the reply cannot be read", async ({ page }) => {
  await clearGames(page);
  await newOriginsGame(page);
  await replyWith(page, { status: 200, body: "<html>hello</html>" });
  await fetchWith(page);

  await expect(page.getByTestId("neworigins-fetch-message")).toContainText(
    "downloading the report in a browser and dropping it here still works"
  );
  await expect(page.getByTestId("newage-password")).toHaveValue("right");
});
