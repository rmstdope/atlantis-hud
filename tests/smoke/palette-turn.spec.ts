import { expect, test, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";

import { clearGames, closeRulesetCheck, createGame } from "./gameSetup";
import { DESKTOP_SHELL_TAG } from "./shells";

/**
 * ah-mlls.7: the header's Import, Fetch and Send as command palette rows - offered where the header
 * offers the button, greyed with the reason where the header greys it.
 *
 * Which rows exist and why one is greyed is pinned in `paletteTurnActions.test.ts`, how a greyed
 * row reads and how the arrows step over it in `commandPalette.test.ts` and
 * `CommandPalette.test.tsx`. This walks what `packages/shared` cannot run (ah-nass): a row opening
 * the very window or file picker the header's button opens, and the Fetch window's choice not
 * carrying over to the header's next opening.
 *
 * The New Age cases run on `web`, whose transport is the browser's own `fetch` and so can be
 * stood in for with `page.route` (see `newage-web.spec.ts`); the New Origins Fetch row needs the
 * desktop bundle, the only one with that transport.
 */
const TURN_71 = readReport("g7f95t71");

const NO_ATLANTIS_LINE =
  "These orders have no #atlantis line, so the server cannot tell which faction they belong to.";

/** How long the stand-in world takes to answer a sign-in; set per test to hold a fetch mid-run. */
let loginDelayMs = 0;

async function search(page: Page, query: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill(query);
}

function row(page: Page, label: string) {
  return page
    .getByTestId("palette-item")
    .filter({ has: page.getByText(label, { exact: true }) });
}

/** Waits until the game's ruleset has been parsed: F2 opens the dictionary only then. */
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
}

test.describe("on a New Age game", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "web", "the browser transport is only there in the web bundle");

    loginDelayMs = 0;
    await page.route("https://atlantis-newage.com/**", async (route) => {
      const url = route.request().url();
      const headers = { "access-control-allow-origin": "*" };
      if (url.includes("/auth/login")) {
        if (loginDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, loginDelayMs));
        }
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
      await route.fulfill({
        status: 200,
        headers: { ...headers, "content-type": "text/plain" },
        body: TURN_71
      });
    });

    await clearGames(page);
    await page.getByTestId("game-ruleset").selectOption("newage-arcanum");
    await createGame(page, "Arcanum game");
    await rulesetReady(page);
  });

  test("offers both Fetch choices, and ticks the one chosen for that opening only", async ({ page }) => {
    await search(page, "fetch");
    await expect(row(page, "Fetch latest report")).toHaveCount(1);
    await expect(row(page, "Fetch all reports not yet fetched/imported")).toHaveCount(1);

    await row(page, "Fetch all reports not yet fetched/imported").click();
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await expect(page.getByTestId("newage-fetch-panel")).toBeVisible();
    await expect(page.getByTestId("newage-fetch-scope-history")).toBeChecked();
    await expect(page.getByTestId("newage-fetch-scope-this-turn")).not.toBeChecked();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("newage-fetch-panel")).toHaveCount(0);

    // The header's button opens on "Latest report", as it always has.
    await page.getByTestId("fetch-control").click();
    await expect(page.getByTestId("newage-fetch-scope-this-turn")).toBeChecked();
    await page.keyboard.press("Escape");

    // So does the palette's other row.
    await search(page, "fetch latest");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("newage-fetch-scope-this-turn")).toBeChecked();
  });

  test("does nothing from over a running fetch, as the covered header cannot", async ({ page }) => {
    loginDelayMs = 3000;
    await page.getByTestId("fetch-control").click();
    await page.getByTestId("newage-faction-number").fill("95");
    await page.getByTestId("newage-password").fill("right");
    await page.getByTestId("newage-fetch-confirm").click();
    await expect(page.getByTestId("newage-fetch-working")).toBeVisible();

    await search(page, "fetch latest");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);

    // Still the run, not the form again: the row did not reset the window under it.
    await expect(page.getByTestId("newage-fetch-working")).toBeVisible();
    await expect(page.getByTestId("newage-password")).toHaveCount(0);
    await expect(page.getByTestId("import-status")).toContainText("11 regions");
  });

  test("lists Send greyed with the header's own reason, and choosing it does nothing", async ({
    page
  }) => {
    // No report, so no orders: the header greys Send.
    await expect(page.getByTestId("send-orders")).toBeDisabled();
    await expect(page.getByTestId("send-orders")).toHaveAttribute("title", NO_ATLANTIS_LINE);

    await search(page, "send orders");
    const send = row(page, "Send orders");
    await expect(send).toHaveAttribute("aria-disabled", "true");
    await expect(send).toHaveAttribute("aria-selected", "false");
    await expect(send.getByTestId("palette-unavailable")).toHaveText(NO_ATLANTIS_LINE);
    // The arrows never put the highlight on it.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("End");
    await expect(send).toHaveAttribute("aria-selected", "false");

    await page.keyboard.press("Enter");
    // Forced: Playwright waits for an aria-disabled element to become enabled before clicking it,
    // and the point here is what a click on a greyed row does - nothing.
    await send.click({ force: true });
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(page.getByTestId("newage-send-panel")).toHaveCount(0);
  });

  test("Send orders opens the send window once there are orders to send", async ({ page }) => {
    await page.getByTestId("fetch-control").click();
    await page.getByTestId("newage-faction-number").fill("95");
    await page.getByTestId("newage-password").fill("right");
    await page.getByTestId("newage-fetch-confirm").click();
    await expect(page.getByTestId("import-status")).toContainText("11 regions");
    await closeRulesetCheck(page);
    await expect(page.getByTestId("send-orders")).toBeEnabled();

    await search(page, "send orders");
    await expect(row(page, "Send orders")).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await expect(page.getByTestId("newage-send-panel")).toBeVisible();
  });

  test("Import reports opens the header's file picker", async ({ page }) => {
    // Armed before the search, not just before the Enter (ah-kb9x). Listening for "filechooser"
    // switches Playwright's interception on with a message that is not waited for, and a bare
    // keyboard press has no actionability round trips to give it time: about one run in four the
    // click reached Chromium first, its native dialog opened and was dropped headlessly, and the
    // event never came. The search's own round trips settle the interception before the press.
    const chooser = page.waitForEvent("filechooser");
    await search(page, "import reports");
    await expect(row(page, "Import reports")).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    const picker = await chooser;
    expect(picker.isMultiple()).toBe(true);
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
  });
});

test("a New Origins game on the web offers no Fetch or Send row, as the header has neither", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "web", "the web header is the one without Fetch");

  await clearGames(page);
  await page.getByTestId("game-ruleset").selectOption("neworigins");
  await createGame(page, "New Origins game");
  await expect(page.getByTestId("fetch-control")).toHaveCount(0);
  await expect(page.getByTestId("send-orders")).toHaveCount(0);

  await search(page, "report");
  await expect(row(page, "Import reports")).toHaveCount(1);
  await expect(page.getByTestId("palette-item").filter({ hasText: /^Fetch/ })).toHaveCount(0);
  await page.getByTestId("palette-input").fill("send orders");
  await expect(row(page, "Send orders")).toHaveCount(0);
});

// Tagged for `desktop-shell` alone: the New Origins transport is only there in the desktop bundle.
test(
  "a New Origins game on the desktop offers only Fetch latest report",
  { tag: DESKTOP_SHELL_TAG },
  async ({ page }) => {
    await clearGames(page);
    await page.getByTestId("game-ruleset").selectOption("neworigins");
    await createGame(page, "New Origins game");
    await rulesetReady(page);
    await expect(page.getByTestId("fetch-control")).toBeVisible();

    await search(page, "fetch");
    await expect(row(page, "Fetch latest report")).toHaveCount(1);
    await expect(row(page, "Fetch all reports not yet fetched/imported")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("neworigins-fetch-panel")).toBeVisible();
  }
);
