import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearGames, createGame } from "./gameSetup";

/**
 * The acceptance vectors of issue #34, end to end, in both shells.
 *
 * Unsaved data for the open game is saved - regularly, on switching games, and on the way out - and
 * reloaded when the game is opened again. Two things were broken before this: nothing ever wrote an
 * order draft, and nothing ever read an imported turn back, so opening a game showed an empty
 * workspace over a database that held the turn.
 *
 * `page.reload()` is how a browser quits and reopens. It is the same idiom `games.spec.ts` uses to
 * prove which game reopens, and here it proves what is inside one.
 */
const REPORT = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-f95-t71.rep"),
  "utf8"
);

/** Inholm holds 92 units; this one is the player's, so its orders are editable. */
const OWN_UNIT = "18642";

/**
 * A write that really happened, with the clock to show for it.
 *
 * Deliberately not the bare word: "unsaved changes" contains "saved", so a substring match on it
 * passes the instant the player types and proves nothing at all. This one only matches the panel
 * once it is showing a time.
 */
const SAVED = /saved \d/u;

/**
 * Opens the turn-71 report and waits for the import to be genuinely finished.
 *
 * Waiting on the status banner alone is not enough the second time: it is already reading
 * "11 regions" from the first import, so the assertion passes before the new one has run and the
 * selection made afterwards is then wiped when it does. The button leaving its "Loading…" state is
 * the shell saying the work is over.
 */
async function openReport(page: Page) {
  const load = page.getByRole("button", { name: /Load report/ });
  await expect(load).toBeEnabled();

  await page.setInputFiles('input[type="file"]', {
    name: "turn-71.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(REPORT, "utf8")
  });

  await expect(page.getByTestId("import-status")).toContainText("11 regions");
  await expect(load).toBeEnabled();
}

async function selectHex(page: Page, regionId: string) {
  const hex = page.getByRole("button", { name: `hex ${regionId}` });
  await hex.focus();
  await hex.press("Enter");
}

/** Filtered down first, because the table only builds the rows that are on screen. */
async function selectUnit(page: Page, unitId: string) {
  const box = page.getByLabel("Filter units");
  await box.fill(unitId);
  const row = page.getByTestId(`unit-row-${unitId}`);
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  await row.getByRole("button").click();
  await box.clear();
}

/** Puts the orders editor for the player's own unit on screen. */
async function openOrders(page: Page) {
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await expect(page.getByTestId("orders-input")).toBeVisible();
}

test("a game reopens on the turn that was loaded in it", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Reopening game");
  await openReport(page);

  await page.reload();

  // The turn, the header and the map all come back without the player opening the file again.
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await expect(page.getByTestId("app-header")).toContainText("Borg TNG");
  await expect(page.getByTestId("app-header")).toContainText("Turn 71");
  await selectHex(page, "1:7,53");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");
});

test("orders typed into a game are still there after a reload", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Typing game");
  await openReport(page);
  await openOrders(page);

  const editor = page.getByTestId("orders-input");
  await editor.fill("@work\n@study combat");

  // The panel says what has actually happened, rather than stamping the clock as it used to.
  await expect(page.getByTestId("orders-status")).toContainText("unsaved changes");
  await expect(page.getByTestId("orders-status")).toContainText(SAVED, { timeout: 20_000 });

  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await openOrders(page);

  await expect(page.getByTestId("orders-input")).toHaveValue(/@study combat/u);
  // And it comes back knowing it is saved, rather than claiming never to have been.
  await expect(page.getByTestId("orders-status")).toContainText(SAVED);
});

test("switching to another game and back loses neither the turn nor the orders", async ({
  page
}) => {
  await clearGames(page);
  await createGame(page, "First game");
  await openReport(page);
  await openOrders(page);
  await page.getByTestId("orders-input").fill("@work\n@teach 18642");

  // Straight to another game, without waiting for the autosave: switching is one of the three
  // moments issue #34 names, and it has to write on its own.
  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await createGame(page, "Second game");

  // The new game is empty - one game's turn must never show under another's name.
  await expect(page.getByTestId("import-status")).toContainText("no report loaded");

  await page.getByTestId("game-indicator").click();
  await page.getByRole("button", { name: "First game", exact: true }).click();

  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await openOrders(page);
  await expect(page.getByTestId("orders-input")).toHaveValue(/@teach 18642/u);
});

test("one game's orders never appear in another", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Alpha game");
  await openReport(page);
  await openOrders(page);
  await page.getByTestId("orders-input").fill("@work\n@build");
  await expect(page.getByTestId("orders-status")).toContainText(SAVED, { timeout: 20_000 });

  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await createGame(page, "Beta game");
  await openReport(page);
  await openOrders(page);

  // The same faction and the same turn, in a different game: its own database, its own template.
  await expect(page.getByTestId("orders-input")).not.toHaveValue(/@build/u);
});

test("a game with no imports opens on an empty workspace rather than an error", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Fresh game");

  // Nothing to restore is the ordinary state of a game just created, and must not read as failure.
  await expect(page.getByTestId("import-status")).toContainText("no report loaded");
  await expect(page.getByTestId("import-status")).not.toContainText("could not");

  await page.reload();

  await expect(page.getByTestId("game-indicator")).toContainText("Fresh game");
  await expect(page.getByTestId("import-status")).toContainText("no report loaded");
});

test("re-opening the same report keeps the orders already written for that turn", async ({
  page
}) => {
  await clearGames(page);
  await createGame(page, "Re-import game");
  await openReport(page);
  await openOrders(page);
  await page.getByTestId("orders-input").fill("@work\n@entertain");
  await expect(page.getByTestId("orders-status")).toContainText(SAVED, { timeout: 20_000 });

  // There is no undo anywhere in this application, so a stray file-open must not erase an evening.
  await openReport(page);
  await openOrders(page);

  await expect(page.getByTestId("orders-input")).toHaveValue(/@entertain/u);
});
