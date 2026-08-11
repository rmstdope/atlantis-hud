import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearGames, createGame, expectOrders, expectOrdersNot, fillOrders, ordersInput } from "./gameSetup";

/**
 * The orders editor itself: undo, completion, and diagnostics in the margin (#89).
 *
 * These walks are about the editing surface rather than about what the orders mean, which
 * workspace.spec.ts already covers. They exist because the editor is CodeMirror now, and every
 * behaviour here - history, the completion popup, the lint gutter - is configuration that a
 * refactor could drop without any other test noticing.
 */

const REPORT = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-f95-t71.rep"),
  "utf8"
);

/** "Seven of Eight", the player's unit in Inholm at (7,53). */
const OWN_UNIT = "18642";
/** Another of the player's units, in the mountain at (26,52) - a different editor entirely. */
const OTHER_OWN_UNIT = "13401";

async function selectHex(page: Page, regionId: string) {
  const hex = page.getByRole("button", { name: `hex ${regionId}` });
  await hex.focus();
  await hex.press("Enter");
}

async function selectUnit(page: Page, unitId: string) {
  const box = page.getByLabel("Filter units");
  await box.fill(unitId);
  const row = page.getByTestId(`unit-row-${unitId}`);
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  await row.getByRole("button").click();
  await box.clear();
}

async function loadReport(page: Page) {
  await clearGames(page);
  await createGame(page, "Editor smoke");
  await page.setInputFiles('input[type="file"]', {
    name: "turn-71.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(REPORT, "utf8")
  });
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
}

test("typing can be undone and redone from the keyboard", async ({ page }) => {
  await loadReport(page);

  await fillOrders(page, "@work");
  await expectOrders(page, /@work/);
  // History groups edits that land within half a second of each other; standing well clear of
  // that window is what makes "one undo, one step" deterministic rather than a race.
  await page.waitForTimeout(700);
  // The second edit is typed rather than filled: keystrokes are what the history feature
  // serves, and a whole-draft replacement is a burst of mutations whose echoes can still be
  // crossing React while the next assertion reads the editor.
  const orders = ordersInput(page);
  await orders.click();
  await orders.press("ControlOrMeta+a");
  await orders.press("ArrowRight");
  await orders.press("Enter");
  await orders.pressSequentially("TAX");
  await expectOrders(page, /TAX/);

  await ordersInput(page).press("ControlOrMeta+z");
  await expectOrders(page, /^@work\n?$/);

  await ordersInput(page).press("ControlOrMeta+Shift+z");
  await expectOrders(page, /TAX/);
});

test("undo cannot resurrect another unit's orders", async ({ page }) => {
  await loadReport(page);

  await fillOrders(page, "@work");
  await expectOrders(page, /@work/);

  await selectHex(page, "1:26,52");
  await selectUnit(page, OTHER_OWN_UNIT);
  // The second unit's own template orders, exactly as the report wrote them. Asserting the
  // verbatim text matters: an undo that rewound into 18642's draft, into an intermediate splice,
  // or into an empty editor would each leave something different here, and a looser "does not
  // contain @work" passed while one of those bugs existed.
  await expectOrders(page, /^@prepare staf\n@study comb\n?$/);

  // A fresh unit means a fresh history, and reconcile splices carry no history entry at all:
  // undo has nothing to undo, so nothing may change - not the text, and not the save state,
  // because an undo that "did something" here would write into the faction document.
  await ordersInput(page).press("ControlOrMeta+z");
  await expectOrders(page, /^@prepare staf\n@study comb\n?$/);
  await expectOrdersNot(page, /@work/);
});

test("a half-typed command offers its completions", async ({ page }) => {
  await loadReport(page);

  // The vocabulary arrives from the core asynchronously; typing before it lands would get
  // silence and prove nothing about completion.
  await expect(page.locator('[data-commands-ready="true"]')).toBeVisible();

  // The template arrives with orders already on the unit; completion speaks only at the start
  // of a command, so the walk starts from a clean line rather than mid-word in "@study obse".
  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type("stu");

  const popup = page.locator(".cm-tooltip-autocomplete");
  await expect(popup).toBeVisible();
  // The *selected* option, not merely a listed one: Enter accepts the selection, and until the
  // popup has made one it falls through to a plain newline - a race an assertion on the list
  // alone walked straight into.
  await expect(popup.locator("li[aria-selected]")).toContainText("STUDY");
  // acceptCompletion deliberately ignores Enter within 75ms of the popup opening (its
  // interactionDelay, there to stop a newline meant for the document accepting a completion).
  // A human never presses inside that window; this test just did.
  await page.waitForTimeout(150);

  await page.keyboard.press("Enter");
  await expectOrders(page, /STUDY/);
  await expect(popup).toHaveCount(0);
});

test("the caret follows the theme instead of defaulting to black", async ({ page }) => {
  await loadReport(page);

  // The editor uses the browser's native caret, and CodeMirror's base styles paint it black
  // unless told otherwise - invisible on the dark theme's near-black ground. Pinning the caret
  // to the text colour asserts the mechanism whatever the theme in force.
  const colors = await ordersInput(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return { caret: style.caretColor, text: style.color };
  });
  expect(colors.caret).toBe(colors.text);
});

test("a bad order is marked in the editor's own margin", async ({ page }) => {
  await loadReport(page);

  await fillOrders(page, "WROK");

  // The gutter mark and the underline are the editor's part of the story; the list below the
  // editor already has its own coverage and keeps working alongside them.
  await expect(page.getByTestId("orders-input").locator(".cm-lint-marker")).toBeVisible();
  await expect(page.getByTestId("orders-diagnostics")).toContainText("WROK");
});
