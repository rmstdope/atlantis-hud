import { expect, test, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";
import { loadReport, selectHex } from "./gameSetup";

/**
 * The `Other factions` source and its faction pin (`ah-1mpx.5`).
 *
 * Everything here is a gesture - clicking, focus, an imperative handle, a key - and none of it can
 * be reached from `packages/shared`, which has no jsdom: a component test there renders with
 * `renderToStaticMarkup`, which runs no effects and attaches no refs
 * (`packages/shared/src/testing/README.md`). Every rule the source has is unit-tested in
 * `foreignUnits.test.ts`; what is walked below is only what a person actually does.
 *
 * **Relations, not counts, and read off the hint rather than off the rows.** `g7f95t71` holds units
 * of seventeen other factions and a substantial group whose owner is concealed, but the exact
 * totals depend on the parser, so a hardcoded number would be a test that breaks on an unrelated
 * parsing fix. Counting `<tr>` elements measures nothing either: the table windows its rows, so the
 * DOM holds seventeen of them whether the list is 92 long or 254. The pane's own hint is the figure
 * on screen, so that is what these assertions compare.
 */
const REPORT = readReport("g7f95t71");

/** Inholm: a city with 24 structures and 92 units, one of them the player's. */
const HEX = "1:7,53";

async function workspace(page: Page) {
  await loadReport(page, "Smoke game", REPORT);
  await selectHex(page, HEX);
  await expect(page.getByTestId("unit-source-rail")).toBeVisible();
}

const rows = (page: Page) => page.getByTestId("panel-units").locator("tbody tr[data-testid]");

/** The pane header's hint, which is the one place the whole list is counted. */
const hint = (page: Page) =>
  page.getByTestId("panel-units").locator("button[aria-expanded]").first();

/**
 * What the hint says the list holds: how many rows the pin left, and how many there were before it.
 * Equal when nothing is pinned, since the hint then omits the `of` clause.
 */
async function counted(page: Page): Promise<{ pinned: number; total: number }> {
  const text = (await hint(page).innerText()).replace(/\s+/gu, " ");
  const found = /(\d+)(?: of (\d+))? units?/u.exec(text);
  expect(found, `no unit count in the hint: ${text}`).not.toBeNull();
  const pinned = Number(found?.[1]);
  return { pinned, total: found?.[2] === undefined ? pinned : Number(found[2]) };
}

test("choosing Other factions lists units of other factions", async ({ page }) => {
  await workspace(page);

  const inHex = (await counted(page)).total;
  expect(inHex).toBeGreaterThan(0);

  await page.getByTestId("unit-source-foreign").click();
  await expect(hint(page)).toContainText("other factions,");

  // The source spans the whole report, so it holds strictly more than one hex does.
  await expect.poll(async () => (await counted(page)).total).toBeGreaterThan(inHex);
  // The Hex column comes with it, exactly as it does for All my units - eleven columns, not ten.
  await expect(page.getByTestId("panel-units").locator("thead th")).toHaveCount(11);
  await expect(page.getByTestId("panel-units").locator("thead")).not.toContainText("Seen");

  // Not one of ours: `All my units` and `Other factions` are exact complements.
  await page.getByTestId("panel-units").getByLabel("Filter units").fill("Borg TNG");
  await expect(rows(page)).toHaveCount(0);
});

test("the dossier's line pins that faction and focuses its first unit", async ({ page }) => {
  await workspace(page);
  await page.getByTestId("unit-source-foreign").click();
  const all = (await counted(page)).total;

  // Read the faction out of the first row rather than knowing the fixture: the cell's own text is
  // what the pin is set from, so this needs no knowledge of the report at all.
  const cell = rows(page).first().getByTestId(/^open-faction-dossier-/);
  const label = ((await cell.textContent()) ?? "").trim();
  expect(label).not.toBe("");

  await cell.click();
  await expect(page.getByTestId("faction-dossier")).toBeVisible();
  await page.getByTestId("dossier-show-units").click();

  await expect(page.getByTestId("foreign-strip")).toContainText(label);
  const pinned = await counted(page);
  expect(pinned.total).toBe(all);
  expect(pinned.pinned).toBeGreaterThan(0);
  expect(pinned.pinned).toBeLessThan(all);
  // The first row is the cursor, so the Unit panel filled in without another click.
  await expect(rows(page).first()).toHaveAttribute("data-selected", "true");

  await page.getByTestId("foreign-unpin").click();
  await expect(page.getByTestId("foreign-strip")).toHaveCount(0);
  await expect.poll(async () => (await counted(page)).pinned).toBe(all);
});

test("Escape in the table clears the pin", async ({ page }) => {
  await workspace(page);
  await page.getByTestId("unit-source-foreign").click();
  const all = (await counted(page)).total;

  await rows(page).first().getByTestId(/^open-faction-dossier-/).click();
  await page.getByTestId("dossier-show-units").click();
  await expect(page.getByTestId("foreign-strip")).toBeVisible();

  // The keyboard is on the first row, which is where the handle put it - so Escape reaches the
  // table's own handler rather than a popover's.
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("foreign-strip")).toHaveCount(0);
  // It clears the pin and not the source: the rail is still on Other factions.
  await expect(page.getByTestId("unit-source-foreign")).toHaveAttribute("data-selected", "true");
  await expect.poll(async () => (await counted(page)).pinned).toBe(all);
});

test("a concealed unit's faction cell pins every unit hiding its faction", async ({ page }) => {
  await workspace(page);
  await page.getByTestId("unit-source-foreign").click();
  const all = (await counted(page)).total;

  // `rules/stealthobs`: equal Observation shows the unit and not the name of its owning faction,
  // so this group exists in any substantial report and belongs to no faction at all. It sorts to
  // the end of the Faction column in either direction - `compareValues` settles a null last - and
  // the table windows its rows, so End is what brings one into the DOM at all.
  await page.getByTestId("panel-units").locator("thead").getByText("Faction").click();
  await rows(page).first().click();
  await page.keyboard.press("End");

  const concealed = page.getByTestId("foreign-pin-hidden").first();
  await expect(concealed).toBeVisible();
  await concealed.click();

  await expect(page.getByTestId("foreign-strip")).toContainText("Faction not shown");
  await expect(page.getByTestId("foreign-strip")).toContainText(
    "Their owner is concealed from you this turn."
  );
  await expect(hint(page)).toContainText("faction not shown,");
  const hiding = await counted(page);
  expect(hiding.total).toBe(all);
  expect(hiding.pinned).toBeGreaterThan(0);
  expect(hiding.pinned).toBeLessThan(all);
  // Every row left is one whose owner the report withholds - the whole window of them.
  await expect(page.getByTestId("foreign-pin-hidden")).toHaveCount(await rows(page).count());
});

test("a foreign unit's row takes the map to its hex", async ({ page }) => {
  await workspace(page);
  await page.getByTestId("unit-source-foreign").click();

  // The Hex column's position depends on where `name` has been dragged to (`drawnColumnsFor` puts
  // `hex` immediately after it), so it is found by its header rather than counted from the left.
  const headers = page.getByTestId("panel-units").locator("thead th");
  // Case-folded: the header cells are uppercased in CSS, so `allInnerTexts` answers "HEX".
  const hexColumn =
    (await headers.allInnerTexts()).findIndex((text) => text.trim().toLowerCase() === "hex") + 1;
  expect(hexColumn).toBeGreaterThan(0);

  const row = rows(page).first();
  const where = (await row.locator(`td:nth-child(${hexColumn})`).innerText()).trim(); // "(26,52)"
  expect(where).toMatch(/^\(\d+,\d+\)$/u);

  await row.click();
  await expect(page.getByTestId("panel-region")).toContainText(where);
});

test("the attitude's lead-in gives way before the faction name does", async ({ page }) => {
  await workspace(page);
  await page.getByTestId("unit-source-foreign").click();
  await rows(page).first().getByTestId(/^open-faction-dossier-/).click();
  await page.getByTestId("dossier-show-units").click();

  const lead = page.getByTestId("foreign-attitude-lead");
  const attitude = page.getByTestId("foreign-attitude");
  await expect(lead).toBeVisible();
  // Whatever this fixture declares toward whichever faction the first row named. Read, never
  // named: hardcoding one makes this a test of the fixture (the test above reads its `label` off
  // the cell for the same reason).
  const declared = ((await attitude.textContent()) ?? "").trim();
  expect(declared).not.toBe("");

  // The dock is the full width of the map area, so the window is what narrows the strip.
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.setViewportSize({ width: 520, height: viewport.height });

  await expect(lead).toBeHidden();
  // Both facts survive at every width - that is what the lead-in is spent to keep.
  await expect(page.getByTestId("foreign-chip")).toBeVisible();
  await expect(attitude).toHaveText(declared);

  await page.setViewportSize(viewport);
  await expect(lead).toBeVisible();
});
