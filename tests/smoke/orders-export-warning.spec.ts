import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectOrders, fillOrders, loadReport, selectHex, selectUnit, waitForValidation } from "./gameSetup";

/**
 * Exporting orders that still carry an error warns and asks, but never refuses (ah-koleq).
 *
 * The rule itself is unit-tested in `ordersExportGuard.test.ts`; what only a browser can prove is
 * the shell around it - the wait on a check still running, focus, Escape, the darkened area, and
 * that "Export anyway" really reaches the save path.
 */

/** "Seven of Eight", the player's unit in Inholm at (7,53). */
const OWN_UNIT = "18642";
/** An unclosed quote: the one syntax error the bead was found with. */
const ONE_ERROR = 'DESCRIBE UNIT "Outlaw of Sherwood';
/** An unquoted description of several words is a warning, not an error (ah-vs4tp). */
const WARNING_ONLY = "DESCRIBE UNIT Outlaw of Sherwood";

async function openOrders(page: Page) {
  await loadReport(page, "Export warning smoke");
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
}

async function pressExport(page: Page, item: "export-orders" | "export-orders-long" = "export-orders") {
  await page.getByTestId("export-menu").click();
  await page.getByTestId(item).click();
}

/** Resolves "download" if one starts within the window, else "none". */
function downloadWithin(page: Page, timeout = 1_500): Promise<"download" | "none"> {
  return page
    .waitForEvent("download", { timeout })
    .then(() => "download" as const)
    .catch(() => "none" as const);
}

async function withOneError(page: Page) {
  await openOrders(page);
  await fillOrders(page, ONE_ERROR);
  await waitForValidation(page);
  await expect(page.getByTestId("orders-status-errors")).toHaveText("1 error");
}

test("exporting orders with an error asks first, and Cancel exports nothing", async ({ page }) => {
  await withOneError(page);
  const download = downloadWithin(page);

  await pressExport(page);

  const dialog = page.getByRole("dialog", { name: "Export orders with 1 error?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "The orders checker found 1 error. The game may reject that order or read it differently from what you meant. You can still export the orders as they are."
  );
  // The menu closed behind the choice.
  await expect(page.getByTestId("export-orders")).toHaveCount(0);
  // Focus on Cancel, so a reflexive Enter cancels.
  await expect(page.getByTestId("export-warning-cancel")).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("export-menu")).toBeFocused();
  expect(await download).toBe("none");
});

test("Escape and a press on the darkened area also cancel", async ({ page }) => {
  await withOneError(page);
  const download = downloadWithin(page, 3_000);

  await pressExport(page);
  await expect(page.getByTestId("export-warning-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("export-warning-panel")).toHaveCount(0);
  await expect(page.getByTestId("export-menu")).toBeFocused();

  await pressExport(page);
  await expect(page.getByTestId("export-warning-panel")).toBeVisible();
  await page.getByTestId("export-warning-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("export-warning-panel")).toHaveCount(0);
  await expect(page.getByTestId("export-menu")).toBeFocused();

  expect(await download).toBe("none");
});

test("Export anyway saves the orders as they are, from both order exports", async ({ page }, testInfo) => {
  await withOneError(page);

  for (const item of ["export-orders", "export-orders-long"] as const) {
    await pressExport(page, item);
    const downloading = page.waitForEvent("download");
    await page.getByTestId("export-warning-export").click();
    const file = await downloading;
    const path = testInfo.outputPath(`${item}.txt`);
    await file.saveAs(path);
    // Only the broken line is asserted: the file also carries the faction password.
    expect(readFileSync(path, "utf8")).toContain(ONE_ERROR);
    await expect(page.getByTestId("export-warning-panel")).toHaveCount(0);
  }
});

test("Show errors opens the to-check panel on Problems and exports nothing", async ({ page }) => {
  await withOneError(page);
  const download = downloadWithin(page);

  await pressExport(page);
  await page.getByTestId("export-warning-show-errors").click();

  await expect(page.getByTestId("export-warning-panel")).toHaveCount(0);
  await expect(page.getByTestId("turn-report")).toBeVisible();
  await expect(page.getByTestId("turn-report-tab-problems")).toHaveAttribute("aria-selected", "true");
  expect(await download).toBe("none");
});

test("warnings alone never ask", async ({ page }) => {
  await openOrders(page);
  await fillOrders(page, WARNING_ONLY);
  await waitForValidation(page);
  await expect(page.getByTestId("orders-status-errors")).toHaveText("0 errors");

  const downloading = page.waitForEvent("download");
  await pressExport(page);
  await downloading;
  await expect(page.getByTestId("export-warning-panel")).toHaveCount(0);
});

test("an export pressed while the check is still running waits for it", async ({ page }) => {
  await openOrders(page);
  await fillOrders(page, "@work");
  await waitForValidation(page);

  // No wait for the check: the press lands while it is still debounced or in flight.
  await fillOrders(page, ONE_ERROR);
  await pressExport(page);
  await expect(page.getByRole("dialog", { name: "Export orders with 1 error?" })).toBeVisible();
  await page.getByTestId("export-warning-cancel").click();

  // And the other way: an error fixed just before the press is not counted.
  await fillOrders(page, "@work");
  await expectOrders(page, /^@work\n?$/u);
  const downloading = page.waitForEvent("download");
  await pressExport(page);
  await downloading;
  await expect(page.getByTestId("export-warning-panel")).toHaveCount(0);
});

test("Tab stays among the dialog's three buttons", async ({ page }) => {
  await withOneError(page);
  await pressExport(page);

  const cancel = page.getByTestId("export-warning-cancel");
  const exportAnyway = page.getByTestId("export-warning-export");
  const showErrors = page.getByTestId("export-warning-show-errors");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(exportAnyway).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(showErrors).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(showErrors).toBeFocused();
});

test("on a narrow window Cancel and Export anyway wrap together, still on the right", async ({ page }) => {
  await withOneError(page);
  await pressExport(page);
  await page.setViewportSize({ width: 340, height: 700 });

  const panel = await page.getByTestId("export-warning-panel").boundingBox();
  const show = await page.getByTestId("export-warning-show-errors").boundingBox();
  const cancel = await page.getByTestId("export-warning-cancel").boundingBox();
  const exportAnyway = await page.getByTestId("export-warning-export").boundingBox();
  expect(panel && show && cancel && exportAnyway).toBeTruthy();

  // Inside the window, with a margin on each side.
  expect(panel!.x).toBeGreaterThan(0);
  expect(panel!.x + panel!.width).toBeLessThan(340);
  // Show errors on the first line; the pair together on a lower one.
  expect(cancel!.y).toBeGreaterThan(show!.y + show!.height - 1);
  expect(Math.abs(cancel!.y - exportAnyway!.y)).toBeLessThan(1);
  // Still on the right: Export anyway ends at the panel's padding.
  expect(panel!.x + panel!.width - (exportAnyway!.x + exportAnyway!.width)).toBeLessThan(20);
});
