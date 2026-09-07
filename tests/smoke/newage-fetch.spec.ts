import { expect, test } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";

import { clearGames, createGame } from "./gameSetup";

/**
 * Fetching from a New Age world (ah-coij).
 *
 * The only place this whole path runs: press Fetch, type the faction number and password into the
 * dialog, choose what to bring, and see the turn land through the same door a dropped file goes
 * through. There is no session - the credentials are asked for at the moment they are used and are
 * kept nowhere. `desktop-shell` only, for the reason `desktop-shell.spec.ts` gives: the transport
 * exists only in that bundle.
 *
 * The stand-in never records a request body's content: a New Age reply can carry a password in
 * cleartext, so only a length is kept, which is what proves the password went nowhere it should
 * not.
 */
const TURN_70 = readReport("g7f95t70");
const TURN_71 = readReport("g7f95t71");
const TURN_72 = readReport("g7f95t72");

const REPORT_URL = "https://atlantis-newage.com/api/worlds/arcanum/files/report?format=txt";

type HttpCall = ["httpRequest", string, string, number];

/** What the world's history endpoints answer, per turn. Set by `historyWith`. */
type HistoryStandIn = {
  turns: { status: number; body: string };
  reports: Record<string, { status: number; body: string }>;
};

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
        window as unknown as { __ATLANTIS_HISTORY__: HistoryStandIn }
      ).__ATLANTIS_HISTORY__ = { turns: { status: 500, body: "" }, reports: {} };
      // The stand-in answers instantly, so a whole multi-turn run is over before a walk could
      // press anything. A delay on each history report is what makes "mid-run" reachable at all.
      (
        window as unknown as { __ATLANTIS_HISTORY_DELAY_MS__: number }
      ).__ATLANTIS_HISTORY_DELAY_MS__ = 0;
      (
        window as unknown as { __ATLANTIS_LOGIN_REPLY__: { status: number; body: string } }
      ).__ATLANTIS_LOGIN_REPLY__ = {
        status: 200,
        body: JSON.stringify({
          access_token: "t",
          token_type: "bearer",
          faction: { id: 27, name: "Merchant Guild", status: "" }
        })
      };
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
          if (request.url.includes("/files/history/")) {
            const history = (window as unknown as { __ATLANTIS_HISTORY__: HistoryStandIn })
              .__ATLANTIS_HISTORY__;
            if (request.url.includes("/files/history/turns")) {
              return history.turns;
            }
            const turn = /\/files\/history\/(\d+)\/report/.exec(request.url)?.[1] ?? "";
            const delay = (window as unknown as { __ATLANTIS_HISTORY_DELAY_MS__: number })
              .__ATLANTIS_HISTORY_DELAY_MS__;
            if (delay > 0) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
            return history.reports[turn] ?? { status: 500, body: "" };
          }
          if (request.url.includes("/auth/login")) {
            return (
              window as unknown as { __ATLANTIS_LOGIN_REPLY__: { status: number; body: string } }
            ).__ATLANTIS_LOGIN_REPLY__;
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

/** Makes each history report take this long, so a run can be caught while it is going. */
async function historyDelay(page: import("@playwright/test").Page, ms: number) {
  await page.evaluate((next) => {
    (window as unknown as { __ATLANTIS_HISTORY_DELAY_MS__: number }).__ATLANTIS_HISTORY_DELAY_MS__ =
      next;
  }, ms);
}

/** Sets what the login endpoint answers next. */
async function loginReplyWith(
  page: import("@playwright/test").Page,
  reply: { status: number; body: string }
) {
  await page.evaluate((next) => {
    (
      window as unknown as { __ATLANTIS_LOGIN_REPLY__: { status: number; body: string } }
    ).__ATLANTIS_LOGIN_REPLY__ = next;
  }, reply);
}

/** Sets what the world's history endpoints answer. */
async function historyWith(page: import("@playwright/test").Page, history: HistoryStandIn) {
  await page.evaluate((next) => {
    (window as unknown as { __ATLANTIS_HISTORY__: HistoryStandIn }).__ATLANTIS_HISTORY__ = next;
  }, history);
}

/** An Arcanum game with its ruleset parsed, ready for the Fetch button to be pressed. */
async function arcanumGame(page: import("@playwright/test").Page, name = "Arcanum game") {
  await page.getByTestId("game-ruleset").selectOption("newage-arcanum");
  await createGame(page, name);

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
}

/** Opens the dialog, types both fields and confirms with the chosen scope. */
async function fetchWith(
  page: import("@playwright/test").Page,
  { scope = "this-turn" }: { scope?: "this-turn" | "history" } = {}
) {
  await page.getByTestId("newage-control").click();
  await page.getByTestId("newage-faction-number").fill("27");
  await page.getByTestId("newage-password").fill("right");
  if (scope === "history") {
    await page.getByTestId("newage-fetch-scope-history").check();
  }
  await page.getByTestId("newage-fetch-confirm").click();
}

/** Focus then Enter: the header sits under the dialog's backdrop and cannot be clicked. */
async function activate(page: import("@playwright/test").Page, testId: string) {
  await page.getByTestId(testId).focus();
  await page.keyboard.press("Enter");
}

test("fetches this turn's report with the password typed into the dialog", async ({ page }) => {
  await clearGames(page);
  await arcanumGame(page);

  await expect(page.getByTestId("newage-control")).toHaveText("Fetch");
  await fetchWith(page);

  await expect(page.getByTestId("import-status")).toContainText("11 regions");
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(0);

  const calls = await httpCalls(page);
  expect(calls).toContainEqual(["httpRequest", "GET", REPORT_URL, 0]);
  // Only the login carries a body: nothing else this walk performs sends one.
  expect(calls.filter((call) => call[3] > 0).map((call) => call[2])).toEqual([
    "https://atlantis-newage.com/api/worlds/arcanum/auth/login"
  ]);
});

test("asks again when the world refuses the password, and keeps the faction number", async ({
  page
}) => {
  await clearGames(page);
  await arcanumGame(page);
  await loginReplyWith(page, { status: 401, body: "" });

  await fetchWith(page);

  await expect(page.getByTestId("newage-fetch-panel")).toBeVisible();
  await expect(page.getByTestId("newage-fetch-message")).toHaveText(
    "The world did not accept that faction number and password."
  );
  await expect(page.getByTestId("newage-password")).toHaveValue("");
  await expect(page.getByTestId("newage-faction-number")).toHaveValue("27");
});

test("says so when the world has no report yet", async ({ page }) => {
  await clearGames(page);
  await arcanumGame(page);
  await replyWith(page, { status: 200, body: "" });

  await fetchWith(page);

  await expect(page.getByTestId("import-status")).toContainText(
    "could not fetch this turn's report: the world has no report for you yet"
  );
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(0);
});

test("fetches every missing turn in one press and says what happened", async ({ page }) => {
  await clearGames(page);
  await arcanumGame(page);
  // Turn 72 is the turn on screen, so 70 and 71 are the earlier ones brought in bulk - and 72 is
  // asked for once, as this turn's report, never a second time through history.
  await replyWith(page, { status: 200, body: TURN_72 });
  await historyWith(page, {
    turns: { status: 200, body: JSON.stringify({ turns: [70, 71, 72] }) },
    reports: {
      "70": { status: 200, body: TURN_70 },
      "71": { status: 200, body: TURN_71 }
    }
  });

  await fetchWith(page, { scope: "history" });

  await expect(page.getByTestId("import-status")).toContainText(
    "2 turns stored for history; still showing turn 72."
  );

  const historyCalls = (await httpCalls(page))
    .map((call) => call[2])
    .filter((url) => url.includes("/files/history/") && !url.includes("/turns"));
  expect(historyCalls.filter((url) => url.includes("/history/72/"))).toEqual([]);
  expect(historyCalls).toHaveLength(2);
});

test("stops a run when the dialog is cancelled and keeps what landed", async ({ page }) => {
  await clearGames(page);
  await arcanumGame(page);
  await replyWith(page, { status: 200, body: TURN_72 });
  await historyWith(page, {
    turns: { status: 200, body: JSON.stringify({ turns: [70, 71, 72] }) },
    reports: {
      "70": { status: 200, body: TURN_70 },
      "71": { status: 200, body: TURN_71 }
    }
  });

  await historyDelay(page, 2000);

  await fetchWith(page, { scope: "history" });

  // Cancel while turn 70 is in flight. The run stops at the next turn boundary rather than here,
  // which is what keeps a report from being abandoned half-written - so turn 70 still lands.
  await expect(page.getByTestId("newage-fetch-working")).toContainText("Fetching turn");
  await page.getByTestId("newage-fetch-cancel").click();
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(0);

  // Turn 70's report was already in flight when Cancel landed, so it still arrives and is stored.
  // Waiting for its own line settles the screen before anything is asserted about it, rather than
  // racing the delayed reply - and the line is asserted whole, because `runSummary` says
  // `1 turn stored for history` for a run of one and a substring test would not see it.
  await expect(page.getByTestId("import-status")).toHaveText(
    "turn 70 stored for history; still showing turn 72."
  );

  // And the turn that landed is reachable, which is the whole promise of stopping rather than
  // discarding. Opening the picker re-lists the turns itself, so these rows assert that promise
  // and not the run's own end-of-run refresh.
  await page.getByTestId("turn-chip").click();
  await expect(page.getByTestId("turn-picker")).toBeVisible();
  await expect(page.getByTestId("turn-row-70")).toBeVisible();
  await expect(page.getByTestId("turn-row-72")).toContainText("playing");

  // The proof that the run stopped, and the last thing asserted because it is the only claim here
  // that cannot be satisfied in passing. Every assertion above is about a moment: a run that
  // carried on writes turn 70's line too, and only replaces it with `2 turns stored for history`
  // a couple of seconds later - so a poll can match the good text while the bad run is still
  // going. The request list cannot un-record a call, and turn 71 is requested the instant turn 70
  // is stored, so by the time the picker has been opened it would be here.
  const historyCalls = (await httpCalls(page))
    .map((call) => call[2])
    .filter((url) => url.includes("/files/history/") && !url.includes("/turns"));
  expect(historyCalls).toHaveLength(1);
  expect(historyCalls[0]).toContain("/history/70/");
});

test("keeps this turn when the world would not say which turns it holds", async ({ page }) => {
  await clearGames(page);
  await arcanumGame(page);
  await historyWith(page, { turns: { status: 500, body: "" }, reports: {} });

  await fetchWith(page, { scope: "history" });

  // The report landed, so this is a warning about the listing rather than a failed fetch: the
  // status line carries the warning, and the turn it fetched is the one on screen.
  await expect(page.getByTestId("import-status")).toContainText(
    "would not say which turns it holds"
  );
  await expect(page.getByTestId("turn-chip")).toContainText("71");
});

test("switching game closes the fetch dialog, and coming back does not reopen it", async ({
  page
}) => {
  await clearGames(page);
  await arcanumGame(page, "First Arcanum game");

  // A second game on the same world: only the open game changes, so this walk pins the
  // `openGameId` dependency of the guard on its own. A game on another ruleset would take
  // `newAgeWorld` to null, and the dialog is not rendered at all then - which would pass whether
  // the guard fired or not.
  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await arcanumGame(page, "Second Arcanum game");

  await page.getByTestId("newage-control").click();
  await expect(page.getByTestId("newage-fetch-panel")).toBeVisible();

  await activate(page, "game-indicator");
  await expect(page.getByTestId("game-picker")).toBeVisible();
  await page.getByRole("button", { name: "First Arcanum game", exact: true }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("game-indicator")).toContainText("First Arcanum game");
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(0);

  // Back again: the phase must not have survived the trip.
  await page.getByTestId("game-indicator").click();
  await page.getByRole("button", { name: "Second Arcanum game", exact: true }).click();
  await expect(page.getByTestId("game-indicator")).toContainText("Second Arcanum game");
  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(0);
  await expect(page.getByTestId("newage-control")).toHaveText("Fetch");
});
