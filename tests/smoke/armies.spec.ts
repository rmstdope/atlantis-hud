import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
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

/** Another of the player's units, standing in the ocean at (26,52) - somewhere else entirely. */
const OTHER_OWN_UNIT = "13401";

/**
 * Watazka, another faction's unit, sighted at (26,52) with no skills - and in a battle roster in
 * the same report reading `riding 5, combat 2, longbow 4`.
 */
const FOREIGN_UNIT = "4839";

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

/** A rail entry by the name on it. `RailEntry` renders a <button> carrying the label and count. */
function railEntry(page: Page, name: string) {
  return page.getByTestId("unit-source-rail").locator("button", { hasText: name });
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

test("exports a foreign unit's battle-learned skills", async ({ page }, testInfo) => {
  await workspace(page);
  await newArmy(page, "Raiders");

  // Watazka is another faction's unit, and the sighting at (26,52) shows it with no skills at all -
  // which is all a sighting ever shows. The same unit stands in a battle roster earlier in this
  // very report reading `riding 5, combat 2, longbow 4`, and that is what has to reach the file.
  await selectHex(page, "1:26,52");
  await selectUnit(page, FOREIGN_UNIT);
  await page.getByTestId("add-to-army").click();
  await page.getByTestId("add-to-army-panel").getByText("Raiders").click();
  await railEntry(page, "Raiders").click();

  await page.getByTestId("army-export").click();
  await expect(page.getByTestId("army-export-panel")).toBeVisible();
  // Waits out the background scan on its own: while it runs the dialog says so instead, so the
  // sentence below appearing is what proves the scan landed.
  await expect(page.getByTestId("army-export-notice").first()).toContainText(
    "1 unit belongs to another faction. It goes out with combat skills read from battle reports."
  );

  const downloading = page.waitForEvent("download");
  await page.getByTestId("army-export-confirm").click();
  const download = await downloading;
  const path = testInfo.outputPath("raiders.json");
  await download.saveAs(path);

  const file = JSON.parse(readFileSync(path, "utf8")) as {
    attackers: { units: { name: string; skills: { abbr: string; level: number }[] }[] };
  };

  expect(file.attackers.units).toHaveLength(1);
  expect(file.attackers.units[0].name).toContain(`(${FOREIGN_UNIT})`);
  // The roster's own order, which is the order `withRosterSkills` keeps.
  expect(file.attackers.units[0].skills).toEqual([
    { abbr: "RIDI", level: 5 },
    { abbr: "COMB", level: 2 },
    { abbr: "LBOW", level: 4 }
  ]);
});

test("a filter does not follow the table from one list to another", async ({ page }) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  await selectUnit(page, OWN_UNIT);
  await page.getByTestId("add-to-army").click();
  await page.getByTestId("add-to-army-panel").getByText("Northern Host").click();

  const pane = page.getByTestId("panel-units");
  const filter = pane.getByLabel("Filter units");

  // All my units, narrowed to nothing at all - the state the bug leaves standing.
  await page.getByTestId("unit-source-own").click();
  await filter.fill("no such unit");
  await expect(pane).toContainText("No unit matches that filter.");

  // The Army arrives whole.
  await railEntry(page, "Northern Host").click();
  await expect(filter).toHaveValue("");
  await expect(pane).not.toContainText("No unit matches that filter.");
  await expect(page.getByTestId(`unit-row-${OWN_UNIT}`)).toBeVisible();

  // Clicking the entry already selected changes no list, so it takes nothing away. This is the
  // assertion that fails if the rule is ever keyed on `source` identity: the rail builds a fresh
  // object for an Army on every click.
  await filter.fill("no such unit");
  await expect(pane).toContainText("No unit matches that filter.");
  await railEntry(page, "Northern Host").click();
  await expect(filter).toHaveValue("no such unit");
});

test("selecting another hex clears the units filter, and an Army on screen is untouched", async ({
  page
}) => {
  await workspace(page);
  const pane = page.getByTestId("panel-units");
  const filter = pane.getByLabel("Filter units");

  // This hex: the next hex is a different list.
  await filter.fill("no such unit");
  await expect(pane).toContainText("No unit matches that filter.");
  await selectHex(page, "1:7,51");
  await expect(filter).toHaveValue("");

  // An Army is not about the hex, so walking the map leaves both the list and its filter alone.
  await selectHex(page, "1:7,53");
  await newArmy(page, "Northern Host");
  await selectUnit(page, OWN_UNIT);
  await page.getByTestId("add-to-army").click();
  await page.getByTestId("add-to-army-panel").getByText("Northern Host").click();
  await railEntry(page, "Northern Host").click();

  await filter.fill("no such unit");
  await selectHex(page, "1:7,51");
  await expect(filter).toHaveValue("no such unit");
  await expect(pane).toContainText("— Northern Host, 1 unit");
});

test("deleting the Army on screen clears the filter with it", async ({ page }) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  await railEntry(page, "Northern Host").click();

  const pane = page.getByTestId("panel-units");
  const filter = pane.getByLabel("Filter units");
  await filter.fill("no such unit");

  await page.getByTestId("army-delete").click();
  await page.getByTestId("army-delete-yes").click();

  // The source falls back to This hex, which is a different list, so the box goes with it.
  await expect(pane).toContainText("Units in hex");
  await expect(filter).toHaveValue("");
});

/**
 * Picking several units at once, and dragging them into an Army (`ah-1mpx.4`).
 *
 * All of it lives here for the reason at the top of this file: the pick's arithmetic is unit-tested
 * in `packages/shared/src/workspace/unitPick.ts`, and everything below is pointers, focus and
 * popovers, which that package cannot run.
 */

/** The rows the table is drawing, in the order it is drawing them. */
const rows = (page: Page) => page.locator('tr[data-testid^="unit-row-"]');

/** The one entry in the rail, once a single Army has been made. */
const armyEntry = (page: Page) => page.getByTestId(/^unit-source-army-/);

/**
 * Drags from one element onto another, leaving the pointer over the target and the button down.
 *
 * `hover()` rather than coordinates worked out from a bounding box. A press point computed as
 * "twenty pixels in from the row's left edge" is a guess about column widths, and on CI's fonts it
 * was the wrong one: the press landed somewhere that was not the row, so no drag ever began while
 * the pick itself stood there untouched. `hover()` asks Playwright for a point the element
 * actually receives events at, which is the only thing this walk ever meant by "press the row".
 *
 * Two hovers onto the target: the first crosses the 4px threshold and is what makes the chip, and
 * the second is a move the hit-test reads once there is one.
 */
async function dragOnto(page: Page, from: Locator, onto: Locator) {
  await from.hover();
  await page.mouse.down();
  // Several moves, as a hand makes: one `mousemove` is a thing to depend on rather than a drag,
  // and the chip is made by the first move that travels more than four pixels.
  const box = await from.boundingBox();
  if (!box) {
    throw new Error("nothing to drag");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 10, { steps: 5 });
  await expect(page.getByTestId("unit-drag-chip")).toBeVisible();
  await onto.hover();
  await onto.hover();
}

test("shift-clicking picks the run between two rows, and ctrl-clicking takes one back out", async ({
  page
}) => {
  await workspace(page);
  const row = rows(page);

  await row.nth(0).click();
  await row.nth(2).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("unit-bulk-line")).toContainText("3 units picked.");

  await row.nth(1).click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByTestId("unit-bulk-line")).toContainText("2 units picked.");
});

test("the bulk line appears at two picked and takes the header button out of play", async ({
  page
}) => {
  await workspace(page);
  const row = rows(page);

  // E3: at nought or one, nothing changes at all from what `ah-1mpx.2` shipped.
  await row.nth(0).click();
  await expect(page.getByTestId("unit-bulk-line")).toHaveCount(0);
  await expect(page.getByTestId("add-to-army")).toBeEnabled();

  await row.nth(1).click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByTestId("unit-bulk-line")).toBeVisible();
  // Exactly one live way in at any moment.
  await expect(page.getByTestId("add-to-army")).toBeDisabled();

  await page.getByTestId("bulk-clear").click();
  await expect(page.getByTestId("unit-bulk-line")).toHaveCount(0);
  await expect(page.getByTestId("add-to-army")).toBeEnabled();
});

test("ctrl+A picks every row the filter is showing, and typing in the filter narrows the pick", async ({
  page
}) => {
  await workspace(page);
  const box = page.getByLabel("Filter units");

  await box.fill("scout");
  const shown = await rows(page).count();
  expect(shown).toBeGreaterThan(2);

  await rows(page).first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByTestId("unit-bulk-line")).toContainText(`${shown} units picked.`);

  // E1: a row that leaves the view leaves the pick, so the count and the wash always agree.
  // The filter matches one joined string per row - name, unit number, faction - so this narrows
  // "scout" to the scouts whose unit number starts with a 1.
  await box.fill("scout 1");
  const narrowed = await rows(page).count();
  expect(narrowed).toBeGreaterThan(1);
  expect(narrowed).toBeLessThan(shown);
  await expect(page.getByTestId("unit-bulk-line")).toContainText(`${narrowed} units picked.`);
});

test("escape narrows the pick back to the cursor row", async ({ page }) => {
  await workspace(page);
  const row = rows(page);

  await row.nth(0).click();
  await row.nth(2).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("unit-bulk-line")).toContainText("3 units picked.");

  await page.keyboard.press("Escape");

  await expect(page.getByTestId("unit-bulk-line")).toHaveCount(0);
});

test("dragging a picked run onto an Army lifts its count by the number of new units", async ({
  page
}) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  await expect(armyEntry(page)).toContainText("0");
  const row = rows(page);

  await row.nth(0).click();
  await row.nth(1).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("unit-bulk-line")).toContainText("2 units picked.");

  await dragOnto(page, row.nth(1), armyEntry(page));
  await page.mouse.up();

  await expect(page.getByTestId("unit-drag-chip")).toHaveCount(0);
  await expect(armyEntry(page)).toContainText("2");
});

test("a drag that starts on a row outside the pick carries that row alone", async ({ page }) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  const row = rows(page);

  await row.nth(0).click();
  await row.nth(1).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("unit-bulk-line")).toContainText("2 units picked.");

  // E2: pressing a row outside the pick picks it alone first, so only it travels.
  await dragOnto(page, row.nth(3), armyEntry(page));
  await page.mouse.up();

  await expect(armyEntry(page)).toContainText("1");
  await expect(page.getByTestId("unit-bulk-line")).toHaveCount(0);
});

test("an Army that already holds every dragged unit is not a drop target", async ({ page }) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  const row = rows(page);

  await dragOnto(page, row.nth(0), armyEntry(page));
  await page.mouse.up();
  await expect(armyEntry(page)).toContainText("1");

  // W3: you learn before letting go - the entry is no target at all, and says so with a ✓.
  await dragOnto(page, row.nth(0), armyEntry(page));
  await expect(armyEntry(page)).not.toHaveAttribute("data-drop-army");
  await expect(armyEntry(page)).toContainText("✓");
  await page.mouse.up();

  await expect(armyEntry(page)).toContainText("1");
});

test("dropping on + New Army opens the name field and the units join on Enter", async ({ page }) => {
  await workspace(page);
  const row = rows(page);

  await row.nth(0).click();
  await row.nth(1).click({ modifiers: ["Shift"] });

  await dragOnto(page, row.nth(1), page.getByTestId("rail-new-army"));
  await page.mouse.up();

  const field = page.getByTestId("rail-name-field");
  await expect(field).toBeVisible();
  await field.fill("Coastal Watch");
  await field.press("Enter");

  await expect(armyEntry(page)).toContainText("Coastal Watch");
  await expect(armyEntry(page)).toContainText("2");
});

test("right-clicking a row outside the pick picks it alone and opens the menu at the pointer", async ({
  page
}) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  const row = rows(page);

  await row.nth(0).click();
  await row.nth(2).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("unit-bulk-line")).toContainText("3 units picked.");

  await row.nth(4).click({ button: "right" });

  // D4: the menu and the wash always agree, so the row it opened on is picked alone first.
  await expect(page.getByTestId("unit-context-menu")).toBeVisible();
  await expect(page.getByTestId("unit-bulk-line")).toHaveCount(0);
  await expect(page.getByTestId("unit-context-menu")).toContainText("into…");

  await page.getByTestId("unit-context-menu").getByText("Northern Host").click();
  await expect(armyEntry(page)).toContainText("1");
});

test("right-clicking a row inside the pick leaves the pick standing and acts on all of it", async ({
  page
}) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  const row = rows(page);

  await row.nth(0).click();
  await row.nth(2).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("unit-bulk-line")).toContainText("3 units picked.");

  await row.nth(1).click({ button: "right" });

  // The collapse `onPress` defers belongs to a press that turned out not to be a drag; a
  // right-click is never one, so the pick stands and the menu is about all of it (Copilot, #764).
  await expect(page.getByTestId("unit-bulk-line")).toContainText("3 units picked.");
  await expect(page.getByTestId("unit-context-menu")).toContainText("3 units into…");

  await page.getByTestId("unit-context-menu").getByText("Northern Host").click();
  await expect(armyEntry(page)).toContainText("3");
});

test("ctrl-clicking rows across hexes builds a pick and never moves the map", async ({ page }) => {
  await workspace(page);
  await page.getByTestId("unit-source-own").click();
  await page.getByLabel("Filter units").fill("Seven of Eight");

  // A plain press first, on the unit standing in the hex already selected.
  await page.getByTestId(`unit-row-${OWN_UNIT}`).click();
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");

  // The second unit is in (26,52). A modified press adds it to the pick and leaves the map alone -
  // otherwise assembling a force across four hexes would throw the map four times (`ah-y9hx` P1).
  await page.getByTestId(`unit-row-${OTHER_OWN_UNIT}`).click({ modifiers: ["ControlOrMeta"] });

  await expect(page.getByTestId("unit-bulk-line")).toContainText("2 units picked.");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");
});
