import { expect, test, type Locator, type Page } from "@playwright/test";
import { clearGames, createGame, loadReport } from "./gameSetup";

/**
 * Dialogs move by their top bar (ah-aak5), so the map behind them can be seen - the navigator's
 * case is watching a Settings change land on the part of the map the dialog covers.
 *
 * Where a dialog may go is `dialogDrag.ts`'s rule and is unit-tested there; what is asserted here is
 * the part only a browser can show: the press, the pointer capture, the veil, the resize listener.
 */

const KEEP = 80;

function bar(dialog: Locator): Locator {
  return dialog.locator("[data-dialog-bar]");
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("no box");
  return b;
}

/** Press near the left end of the bar (on the title, away from the x) and drag by (dx, dy). */
async function dragBar(page: Page, dialog: Locator, dx: number, dy: number) {
  const b = await box(bar(dialog));
  const x = b.x + 12;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

async function veil(page: Page, backdropId: string): Promise<string> {
  return page.getByTestId(backdropId).evaluate((el) => getComputedStyle(el).backgroundColor);
}

const CLEAR = "rgba(0, 0, 0, 0)";

async function openSettings(page: Page): Promise<Locator> {
  await page.getByTestId("settings-indicator").click();
  const dialog = page.getByTestId("settings-panel");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Drag game");
});

test("dragging the Settings top bar moves it and lifts the veil, which stays lifted", async ({ page }) => {
  const dialog = await openSettings(page);
  await expect(bar(dialog)).toHaveCSS("cursor", "move");
  expect(await veil(page, "settings-backdrop")).not.toBe(CLEAR);

  const before = await box(dialog);
  await dragBar(page, dialog, -120, 90);
  const after = await box(dialog);
  expect(after.x).toBeCloseTo(before.x - 120, 0);
  expect(after.y).toBeCloseTo(before.y + 90, 0);
  expect(await veil(page, "settings-backdrop")).toBe(CLEAR);

  // Back to the centre: still clear until the dialog closes.
  await dragBar(page, dialog, 120, -90);
  expect(await veil(page, "settings-backdrop")).toBe(CLEAR);
});

test("a press on the top bar that does not travel neither moves the dialog nor lifts the veil", async ({
  page
}) => {
  const dialog = await openSettings(page);
  const before = await box(dialog);
  await dragBar(page, dialog, 1, 1);
  expect(await box(dialog)).toEqual(before);
  expect(await veil(page, "settings-backdrop")).not.toBe(CLEAR);
});

test("a dragged dialog keeps part of its top bar in the window at every edge", async ({ page }) => {
  const viewport = page.viewportSize()!;
  const dialog = await openSettings(page);

  await dragBar(page, dialog, -3000, -3000);
  let b = await box(dialog);
  expect(b.y).toBeCloseTo(0, 0);
  expect(b.x + b.width).toBeCloseTo(KEEP, 0);

  // Only the bar's last 80px are in the window now; grab them clear of the x at their right end.
  const barBox = await box(bar(dialog));
  await page.mouse.move(10, barBox.y + barBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewport.width + 3000, viewport.height + 3000, { steps: 8 });
  await page.mouse.up();
  b = await box(dialog);
  expect(b.x).toBeCloseTo(viewport.width - KEEP, 0);
  const barAfter = await box(bar(dialog));
  expect(barAfter.y + barAfter.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(barAfter.y + barAfter.height).toBeGreaterThan(viewport.height - 40);
});

test("a moved dialog is pulled in, not recentred, when the window shrinks", async ({ page }) => {
  const viewport = page.viewportSize()!;
  const dialog = await openSettings(page);
  const start = await box(dialog);
  await dragBar(page, dialog, viewport.width, 40);
  const moved = await box(dialog);
  expect(moved.x).toBeCloseTo(viewport.width - KEEP, 0);

  await page.setViewportSize({ width: viewport.width - 200, height: viewport.height });
  await expect.poll(async () => Math.round((await box(dialog)).x)).toBe(viewport.width - 200 - KEEP);
  expect((await box(dialog)).y).toBeCloseTo(start.y + 40, 0);
});

test("an unmoved dialog stays centred when the window shrinks", async ({ page }) => {
  const viewport = page.viewportSize()!;
  const dialog = await openSettings(page);
  await page.setViewportSize({ width: viewport.width - 200, height: viewport.height });
  await expect
    .poll(async () => {
      const b = await box(dialog);
      return Math.round(b.x + b.width / 2);
    })
    .toBe(Math.round((viewport.width - 200) / 2));
});

test("the x closes without a drag, the uncovered map closes, and reopening is centred and dimmed", async ({
  page
}) => {
  let dialog = await openSettings(page);
  const centred = await box(dialog);

  await dragBar(page, dialog, 200, 60);
  await page.getByTestId("settings-close").click();
  await expect(dialog).toHaveCount(0);

  dialog = await openSettings(page);
  expect(await box(dialog)).toEqual(centred);
  expect(await veil(page, "settings-backdrop")).not.toBe(CLEAR);

  // Moved off to the right: a press on the uncovered left part of the window closes, as today.
  await dragBar(page, dialog, 300, 0);
  await page.mouse.click(10, (await box(dialog)).y + 100);
  await expect(dialog).toHaveCount(0);

  dialog = await openSettings(page);
  expect(await box(dialog)).toEqual(centred);
});

test("switching Settings tabs leaves a moved dialog's top-left corner where it was, and a drag keeps focus", async ({
  page
}) => {
  const dialog = await openSettings(page);
  const focusedBefore = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  await dragBar(page, dialog, -150, -60);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe(focusedBefore);

  const moved = await box(dialog);
  await page.getByTestId("settings-tab-about").click();
  const after = await box(dialog);
  expect(after.x).toBeCloseTo(moved.x, 0);
  expect(after.y).toBeCloseTo(moved.y, 0);
});

test("the Getting around dialog moves by its top bar too", async ({ page }) => {
  await loadReport(page);
  await page.keyboard.press("ControlOrMeta+/");
  const dialog = page.getByRole("dialog", { name: "Getting around", exact: true });
  await expect(dialog).toBeVisible();
  const before = await box(dialog);
  await dragBar(page, dialog, -100, 50);
  const after = await box(dialog);
  expect(after.x).toBeCloseTo(before.x - 100, 0);
  expect(after.y).toBeCloseTo(before.y + 50, 0);
});
