import { expect, test, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";

import { clearGames, createGame } from "./gameSetup";

/**
 * Fetch and Send for a New Age world in the web version (ah-oma5).
 *
 * `web` only: the transport here is the browser's own `fetch`, so the stand-in is `page.route`
 * rather than a window global. Playwright answers the CORS preflight itself; every fulfilled
 * response carries `access-control-allow-origin`, without which the real `fetch` would reject
 * exactly as an unreachable world does - tests 1 and 2 are what prove the route answers at all.
 *
 * The stand-in never records a request body's content: the login and the orders upload both carry
 * the faction password in cleartext, so only a length is kept.
 */
const TURN_71 = readReport("g7f95t71");

type Reply = { status: number; body: string };
type World = { loginUnreachable: boolean; orders: Reply; calls: [string, string, number][] };

const CLEAN_SAVE: Reply = {
  status: 200,
  body: JSON.stringify({ saved: true, valid: true, error_count: 0, errors: [], warnings: [], message: "" })
};

const BOTH_CAUSES =
  "Could not reach atlantis-newage.com. Either it is down, or it does not accept requests from this web address.";

let world: World;

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "web", "the browser transport is only there in the web bundle");

  world = { loginUnreachable: false, orders: CLEAN_SAVE, calls: [] };
  await page.route("https://atlantis-newage.com/**", async (route) => {
    const request = route.request();
    const url = request.url();
    world.calls.push([request.method(), url, request.postData()?.length ?? 0]);
    if (url.includes("/auth/login") && world.loginUnreachable) {
      await route.abort("failed");
      return;
    }
    const headers = { "access-control-allow-origin": "*" };
    if (url.includes("/auth/login")) {
      await route.fulfill({
        status: 200,
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          access_token: "t",
          token_type: "bearer",
          faction: { id: 95, name: "Merchant Guild", status: "" }
        })
      });
      return;
    }
    if (url.includes("/files/orders")) {
      await route.fulfill({
        status: world.orders.status,
        headers: { ...headers, "content-type": "application/json" },
        body: world.orders.body
      });
      return;
    }
    await route.fulfill({ status: 200, headers: { ...headers, "content-type": "text/plain" }, body: TURN_71 });
  });
});

/** An Arcanum game whose New Age ruleset has been parsed. */
async function withArcanumGame(page: Page) {
  await clearGames(page);
  await page.getByTestId("game-ruleset").selectOption("newage-arcanum");
  await createGame(page, "Arcanum game");

  // The New Age ruleset arrives late; F2 opens the dictionary only once it has been parsed, so
  // this is the wait - the loop `newage-send.spec.ts` uses.
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

/** An Arcanum game with turn 71 fetched through the browser. */
async function withTurnLoaded(page: Page) {
  await withArcanumGame(page);
  await expect(page.getByTestId("fetch-control")).toHaveText("Fetch");
  await page.getByTestId("fetch-control").click();
  await page.getByTestId("newage-faction-number").fill("95");
  await page.getByTestId("newage-password").fill("right");
  await page.getByTestId("newage-fetch-confirm").click();
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
}

test("a New Age game on the web fetches this turn's report through the browser", async ({ page }) => {
  await withTurnLoaded(page);

  await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(0);
  expect(world.calls).toContainEqual([
    "GET",
    "https://atlantis-newage.com/api/worlds/arcanum/files/report?format=txt",
    0
  ]);
});

test("sends orders from the web and says what the world answered", async ({ page }) => {
  await withTurnLoaded(page);

  await expect(page.getByTestId("send-orders")).toBeEnabled();
  await page.getByTestId("send-orders").click();
  await page.getByTestId("newage-password").fill("hunter2");
  await page.getByTestId("newage-send-confirm").click();

  await expect(page.getByTestId("newage-send-outcome")).toHaveText(
    "Orders for turn 71 were saved. The world found nothing wrong with them."
  );
  const upload = world.calls.find((call) => call[1].endsWith("/files/orders"));
  expect(upload?.[0]).toBe("POST");
  expect(upload?.[2]).toBeGreaterThan(0);
});

test("Fetch on the web names both causes when sign-in cannot reach the world", async ({ page }) => {
  await withArcanumGame(page);
  world.loginUnreachable = true;

  await page.getByTestId("fetch-control").click();
  await page.getByTestId("newage-faction-number").fill("95");
  await page.getByTestId("newage-password").fill("right");
  await page.getByTestId("newage-fetch-scope-history").check();
  await page.getByTestId("newage-fetch-confirm").click();

  await expect(page.getByTestId("newage-fetch-message")).toHaveText(BOTH_CAUSES);
  await expect(page.getByTestId("newage-fetch-panel")).toBeVisible();
  await expect(page.getByTestId("newage-faction-number")).toHaveValue("95");
  await expect(page.getByTestId("newage-password")).toHaveValue("right");
  await expect(page.getByTestId("newage-fetch-scope-history")).toBeChecked();
  await expect(page.getByTestId("newage-fetch-confirm")).toBeEnabled();
});

test("Send on the web names both causes when sign-in cannot reach the world", async ({ page }) => {
  await withTurnLoaded(page);
  world.loginUnreachable = true;

  await page.getByTestId("send-orders").click();
  await page.getByTestId("newage-password").fill("hunter2");
  await page.getByTestId("newage-send-confirm").click();

  await expect(page.getByTestId("newage-send-outcome")).toHaveText(`${BOTH_CAUSES} Nothing was sent.`);
  await expect(page.getByTestId("newage-password")).toHaveValue("hunter2");
  await expect(page.getByTestId("newage-send-confirm")).toBeVisible();
  await expect(page.getByTestId("newage-send-confirm")).toBeEnabled();
  await expect(page.getByTestId("newage-send-close")).toHaveCount(0);
});

test("a New Origins game on the web still offers no Fetch", async ({ page }) => {
  await clearGames(page);
  await page.getByTestId("game-ruleset").selectOption("neworigins");
  await createGame(page, "New Origins game");

  await expect(page.getByTestId("app-header")).toBeVisible();
  await expect(page.getByTestId("fetch-control")).toHaveCount(0);
});
