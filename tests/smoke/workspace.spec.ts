import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Walks the workspace on a real turn report, in whichever shell the project targets.
 *
 * The two shells render the same components, so the same walk has to hold for both. Anything that
 * passes here for the web and fails for the desktop is a divergence, which is exactly the failure
 * this suite exists to catch.
 */
const REPORT = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-f95-t71.rep"),
  "utf8"
);

/** Inholm: a city with 24 structures and 92 units, one of them the player's. */
const OWN_UNIT = "18642";
const FOREIGN_UNIT = "12538";

/**
 * Selects a hex the way assistive technology does.
 *
 * The map is a canvas, so each hex also exists as a visually hidden button. Hidden means a mouse
 * cannot reach it — that is the point — but it stays focusable, and focus plus Enter is exactly how
 * a screen reader user selects one. Driving it this way tests the accessible path rather than
 * bypassing it with a forced click.
 */
async function selectHex(page: Page, regionId: string) {
  const hex = page.getByRole("button", { name: `hex ${regionId}` });
  await hex.focus();
  await hex.press("Enter");
}

async function loadReport(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("app-header")).toBeVisible();

  await page.setInputFiles('input[type="file"]', {
    name: "turn-71.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(REPORT, "utf8")
  });

  await expect(page.getByTestId("import-status")).toContainText("11 regions");
}

test("loads a report and shows the turn it describes", async ({ page }) => {
  await loadReport(page);

  await expect(page.getByTestId("app-header")).toContainText("Borg TNG (95)");
  await expect(page.getByTestId("app-header")).toContainText("71");
  await expect(page.getByTestId("import-status")).toContainText("units");
});

test("selecting a hex fills the region panel and the unit table together", async ({ page }) => {
  await loadReport(page);

  await selectHex(page, "1:7,53");

  await expect(page.getByTestId("panel-region")).toContainText("Inholm");
  await expect(page.getByTestId("panel-region")).toContainText("12,051");
  await expect(page.getByTestId("panel-units")).toContainText("92 units");
  await expect(page.getByTestId(`unit-row-${OWN_UNIT}`)).toBeVisible();
});

test("selecting your own unit fills the detail panel and opens its orders", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  await page.getByRole("button", { name: `unit ${OWN_UNIT}` }).click();

  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");
  await expect(page.getByTestId("panel-unit")).toContainText("your faction");
  await expect(page.getByTestId("panel-unit")).toContainText("STEA");

  const orders = page.getByTestId("orders-input");
  await expect(orders).toBeVisible();
  await expect(orders).toHaveValue(/@study obse/);
});

test("a foreign unit can be inspected but not ordered", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  await page.getByRole("button", { name: `unit ${FOREIGN_UNIT}` }).click();

  // Inspecting a neighbour is legitimate; ordering one is not.
  await expect(page.getByTestId("panel-unit")).toContainText("Elder Tree Forests");
  await expect(page.getByTestId("panel-unit")).toContainText("not your faction");

  const locked = page.getByTestId("orders-locked");
  await expect(locked).toHaveAttribute("data-lock", "foreign");
  await expect(locked).toContainText("Elder Tree Forests");
  await expect(page.getByTestId("orders-input")).toHaveCount(0);
});

test("with no unit selected the detail panel is empty and orders are refused", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  await expect(page.getByTestId("panel-unit")).toContainText("No unit selected");
  await expect(page.getByTestId("orders-locked")).toHaveAttribute("data-lock", "no-unit");
});

test("changing hex abandons the unit selected in the old one", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await page.getByRole("button", { name: `unit ${OWN_UNIT}` }).click();
  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");

  await selectHex(page, "1:26,52");

  await expect(page.getByTestId("panel-unit")).toContainText("No unit selected");
});

test("editing orders changes only the selected unit's block", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await page.getByRole("button", { name: `unit ${OWN_UNIT}` }).click();

  await page.getByTestId("orders-input").fill("@work");
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");

  // The other unit's block is untouched by that edit.
  await selectHex(page, "1:26,52");
  await page.getByRole("button", { name: "unit 13401" }).click();
  await expect(page.getByTestId("orders-input")).toHaveValue(/@prepare staf/);
});

test("panels fold away and come back", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const region = page.getByTestId("panel-region");
  await expect(region).toHaveAttribute("data-collapsed", "false");

  await region.getByRole("button", { name: /Region/ }).click();
  await expect(region).toHaveAttribute("data-collapsed", "true");
  await expect(region).toContainText("Region");

  await region.getByRole("button", { name: /Region/ }).click();
  await expect(region).toHaveAttribute("data-collapsed", "false");
});

test("a folded panel is still folded after a reload", async ({ page }) => {
  await loadReport(page);

  const region = page.getByTestId("panel-region");
  await region.getByRole("button", { name: /Region/ }).click();
  await expect(region).toHaveAttribute("data-collapsed", "true");

  await page.reload();

  // The layout the user arranged outlives the reload; the report does not, so nothing is selected.
  await expect(page.getByTestId("panel-region")).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByTestId("import-status")).toContainText("no report loaded");
});

test("layer toggles are operable and only staleness does anything yet", async ({ page }) => {
  await loadReport(page);

  const chips = page.getByTestId("layer-chips");
  await expect(chips.getByRole("checkbox", { name: "Trade routes" })).not.toBeChecked();
  await expect(chips.getByRole("checkbox", { name: "Staleness" })).toBeChecked();

  await chips.getByRole("checkbox", { name: "Trade routes" }).check();
  await expect(chips.getByRole("checkbox", { name: "Trade routes" })).toBeChecked();
  // Nothing behind it yet, and nothing breaks.
  await expect(page.getByTestId("map-canvas")).toBeVisible();
});

test("the unit table filters", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  await page.getByLabel("Filter units").fill("Seven of Eight");

  await expect(page.getByTestId(`unit-row-${OWN_UNIT}`)).toBeVisible();
  await expect(page.getByTestId(`unit-row-${FOREIGN_UNIT}`)).toHaveCount(0);
});
