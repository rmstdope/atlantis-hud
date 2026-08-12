import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearGames, createGame } from "./gameSetup";

/**
 * The acceptance vectors of issue #33, end to end, in both shells.
 *
 * All user data is divided into games; the top menu says which one is loaded and lets the player
 * switch, create and delete; with no game the only thing possible is creating one; and creating one
 * asks which ruleset it is played under.
 */
const REPORT = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-f95-t71.rep"),
  "utf8"
);

test("with no game, creating one is the only thing on offer", async ({ page }) => {
  await clearGames(page);

  await expect(page.getByTestId("game-gate")).toBeVisible();
  await expect(page.getByTestId("game-name")).toBeVisible();

  // None of the workspace exists yet: there is nowhere for a report or an order to go.
  await expect(page.getByTestId("map-canvas")).toHaveCount(0);
  await expect(page.getByTestId("panel-region")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
});

test("creating a game asks which ruleset it is played under", async ({ page }) => {
  await clearGames(page);

  const ruleset = page.getByTestId("game-ruleset");
  await expect(ruleset).toBeVisible();
  await expect(ruleset.getByRole("option")).toHaveText(["NewOrigins"]);

  await createGame(page, "Ruleset game");
  await expect(page.getByTestId("map-canvas")).toBeVisible();
});

test("a game will not be created without a name", async ({ page }) => {
  await clearGames(page);

  await page.getByTestId("game-name").fill("   ");
  await page.getByRole("button", { name: "Create game" }).click();

  await expect(page.getByTestId("game-form-error")).toContainText("name");
  await expect(page.getByTestId("game-gate")).toBeVisible();
});

test("the header names the open game, and the picker switches between them", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "First game");

  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await createGame(page, "Second game");

  // Creating a game enters it, so the header follows.
  await expect(page.getByTestId("game-indicator")).toContainText("Second game");

  await page.getByTestId("game-indicator").click();
  await expect(page.getByTestId("game-picker")).toBeVisible();
  // Exact, because the delete affordance on the same row is named "delete First game".
  await page.getByRole("button", { name: "First game", exact: true }).click();

  await expect(page.getByTestId("game-indicator")).toContainText("First game");
  await expect(page.getByTestId("game-picker")).toHaveCount(0);
});

/**
 * The indicator is a toggle, not a one-way switch.
 *
 * The trigger sits outside the picker panel, so a dismiss-on-outside-press that does not account
 * for it fires first and closes the picker, and then the button's own toggle reopens it - leaving
 * a control that can only ever open.
 */
test("the indicator closes the picker as well as opening it", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Toggle game");

  await page.getByTestId("game-indicator").click();
  await expect(page.getByTestId("game-picker")).toBeVisible();

  await page.getByTestId("game-indicator").click();
  await expect(page.getByTestId("game-picker")).toHaveCount(0);
});

test("the picker still goes away on Escape and on a press elsewhere", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Dismiss game");

  await page.getByTestId("game-indicator").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("game-picker")).toHaveCount(0);

  await page.getByTestId("game-indicator").click();
  await expect(page.getByTestId("game-picker")).toBeVisible();
  await page.getByTestId("map-canvas").click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("game-picker")).toHaveCount(0);
});

test("a report loaded in one game is not in the other", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Holds the turn");

  await page.setInputFiles('input[type="file"]', {
    name: "turn-71.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(REPORT, "utf8")
  });
  await expect(page.getByTestId("import-status")).toContainText("11 regions");

  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await createGame(page, "Holds nothing");

  // Switching games takes the report with it: it belonged to the game it was imported into.
  await expect(page.getByTestId("import-status")).toContainText("no report loaded");
});

/**
 * The picker renders inside the header, which sets `whitespace-nowrap` so the turn and faction
 * labels never wrap. That inherits, and the delete confirmation is the one piece of prose in
 * there: left alone it runs off the side of the panel as a single line.
 */
test("the delete confirmation wraps inside the picker rather than running off it", async ({
  page
}) => {
  await clearGames(page);
  await createGame(page, "A game with a fairly long name");

  await page.getByTestId("game-indicator").click();
  await page.getByRole("button", { name: "delete A game with a fairly long name" }).click();

  // The box is constrained by its parent either way; what escapes is the text inside it, so the
  // question is whether the line is wider than the box that holds it.
  const overflow = await page
    .getByTestId(/^game-delete-confirm-/u)
    .first()
    .locator("p")
    .evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test("deleting a game asks first, then falls back to the one that is left", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Kept game");

  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await createGame(page, "Doomed game");

  await page.getByTestId("game-indicator").click();
  await page.getByRole("button", { name: "delete Doomed game" }).click();
  await expect(page.getByTestId("game-picker")).toContainText("erased");

  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.getByTestId("game-indicator")).toContainText("Kept game");
});

test("deleting the last game leaves the create screen", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Only game");

  await page.getByTestId("game-indicator").click();
  await page.getByRole("button", { name: "delete Only game" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.getByTestId("game-gate")).toBeVisible();
});

test("the game a player was last in reopens on the next launch", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "First game");

  await page.getByTestId("game-indicator").click();
  await page.getByTestId("new-game").click();
  await createGame(page, "Second game");

  await page.reload();

  await expect(page.getByTestId("game-indicator")).toContainText("Second game");
});
