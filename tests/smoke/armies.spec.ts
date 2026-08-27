import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";
import { loadReport, selectHex, selectUnit } from "./gameSetup";

/**
 * Armies, as a player assembles them (`ah-1mpx.2`).
 *
 * Everything about clicking, focus and popovers is here rather than in `packages/shared`, which
 * has no jsdom: a component test there renders with `renderToStaticMarkup`, which runs no effects
 * and cannot click (`packages/shared/src/testing/README.md`). Every walk below is one rule from
 * the interview behind the bead.
 */
const REPORT = readReport("g7f95t71");

/** Inholm: a city with 24 structures and 92 units, one of them the player's. */
const OWN_UNIT = "18642";

/** A game with a turn on screen and a hex selected, which is where every walk here starts. */
async function workspace(page: Page) {
  await loadReport(page, "Smoke game", REPORT);
  await selectHex(page, "1:7,53");
  await expect(page.getByTestId("unit-source-rail")).toBeVisible();
}

/** Makes one Army through the rail's own inline editor, which is the only way in. */
async function newArmy(page: Page, name: string) {
  await page.getByTestId("rail-new-army").click();
  const field = page.getByTestId("rail-name-field");
  await expect(field).toBeVisible();
  await field.fill(name);
  await field.press("Enter");
}

test("a new Army is named in the rail and appears among the others", async ({ page }) => {
  await workspace(page);

  await newArmy(page, "Northern Host");
  await expect(page.getByText("Northern Host")).toBeVisible();

  // Escape abandons a second one, and nothing is created.
  await page.getByTestId("rail-new-army").click();
  const field = page.getByTestId("rail-name-field");
  await field.fill("Coastal Watch");
  await field.press("Escape");

  await expect(page.getByTestId("rail-name-field")).toHaveCount(0);
  await expect(page.getByText("Coastal Watch")).toHaveCount(0);
});

test("a unit is added from the header menu and the Army's count follows", async ({ page }) => {
  await workspace(page);
  await newArmy(page, "Northern Host");

  const armyEntry = page.getByTestId(/^unit-source-army-/);
  await expect(armyEntry).toContainText("0");

  await selectUnit(page, OWN_UNIT);
  await page.getByTestId("add-to-army").click();
  await expect(page.getByTestId("add-to-army-panel")).toBeVisible();
  await page.getByTestId("add-to-army-panel").getByText("Northern Host").click();

  await expect(armyEntry).toContainText("1");

  // Reopened, that Army is ticked and inert: a menu called Add to army only ever adds.
  await page.getByTestId("add-to-army").click();
  const already = page.getByTestId("add-to-army-panel").getByRole("button", { name: /Northern Host/ });
  await expect(already).toBeDisabled();
  await expect(already).toContainText("✓");
});

test("choosing an Army shows its units, and the pane says so", async ({ page }) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  await selectUnit(page, OWN_UNIT);
  await page.getByTestId("add-to-army").click();
  await page.getByTestId("add-to-army-panel").getByText("Northern Host").click();

  await page.getByTestId(/^unit-source-army-/).click();

  await expect(page.getByTestId("panel-units")).toContainText("— Northern Host, 1 unit");
  const headers = page.getByTestId("panel-units").locator("thead th");
  await expect(headers).toContainText(["Hex"]);
  await expect(headers).toContainText(["Seen"]);
  // The trailing action column: an extra header cell beyond the ten the table always draws.
  await expect(headers).toHaveCount(13);
});

test("clicking a hex while an Army is the source keeps the Army and lights This hex", async ({
  page
}) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  await selectUnit(page, OWN_UNIT);
  await page.getByTestId("add-to-army").click();
  await page.getByTestId("add-to-army-panel").getByText("Northern Host").click();
  await page.getByTestId(/^unit-source-army-/).click();

  // A hex known only from a neighbour's exits: it carries no units at all, which is exactly the
  // case that would be mistaken for the Army list emptying if the source did not hold.
  await selectHex(page, "1:7,51");

  // The table is still the Army's, and This hex carries the new hex's count with its mark.
  await expect(page.getByTestId("panel-units")).toContainText("— Northern Host, 1 unit");
  await expect(page.getByTestId("unit-source-hex")).toContainText("●");
});

test("This hex draws exactly the columns it drew before", async ({ page }) => {
  await workspace(page);

  // The test that the persisted column machinery was left alone: ten columns, as ever.
  await expect(page.getByTestId("panel-units").locator("thead th")).toHaveCount(10);
});

test("deleting an Army asks first, and Cancel leaves it there", async ({ page }) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  await page.getByTestId(/^unit-source-army-/).click();

  await page.getByTestId("army-delete").click();
  await expect(page.getByTestId("army-delete-confirm")).toContainText(
    "Delete Northern Host? The 0 units in it are not affected."
  );

  await page.getByTestId("army-delete-no").click();
  await expect(page.getByTestId("army-delete-confirm")).toHaveCount(0);
  await expect(page.getByTestId(/^unit-source-army-/)).toHaveCount(1);

  await page.getByTestId("army-delete").click();
  await page.getByTestId("army-delete-yes").click();

  await expect(page.getByTestId(/^unit-source-army-/)).toHaveCount(0);
  // The source falls back to This hex once the Army it was pointing at has gone.
  await expect(page.getByTestId("panel-units")).toContainText("Units in hex");
});

test("exports an Army as a battle file", async ({ page }, testInfo) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  await selectUnit(page, OWN_UNIT);
  await page.getByTestId("add-to-army").click();
  await page.getByTestId("add-to-army-panel").getByText("Northern Host").click();
  await page.getByTestId(/^unit-source-army-/).click();

  await page.getByTestId("army-export").click();
  await expect(page.getByTestId("army-export-panel")).toBeVisible();
  await expect(page.getByTestId("army-export-summary")).toContainText("1 unit will be exported.");
  await expect(page.getByTestId("army-export-notice")).toContainText(
    "The defending side will be empty."
  );

  const downloading = page.waitForEvent("download");
  await page.getByTestId("army-export-confirm").click();
  const download = await downloading;
  const path = testInfo.outputPath("northern-host.json");
  await download.saveAs(path);

  expect(download.suggestedFilename()).toBe("northern-host.json");
  const file = JSON.parse(readFileSync(path, "utf8")) as {
    attackers: { units: { name: string; skills: unknown[] }[] };
    defenders: { units: unknown[] };
  };

  // Both keys, always: the simulator refuses the whole file when either is missing, and `skills`
  // is the array its format sniff reads even when the unit has none.
  expect(Object.keys(file)).toEqual(["attackers", "defenders"]);
  expect(file.defenders.units).toEqual([]);
  expect(file.attackers.units).toHaveLength(1);
  expect(file.attackers.units[0].name).toContain(`(${OWN_UNIT})`);
  expect(Array.isArray(file.attackers.units[0].skills)).toBe(true);

  await expect(page.getByTestId("import-status")).toContainText("exported Northern Host");
});
