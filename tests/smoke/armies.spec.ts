import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";
import { HOVER_DELAY_MS } from "../../packages/shared/src/unitTooltip";
import { loadReport, mapTransform, selectHex, selectUnit } from "./gameSetup";

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
  // The trailing action column: an extra header cell beyond the twelve the table always draws.
  await expect(headers).toHaveCount(15);
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

  // The Move and Flags columns are part of the persisted table layout.
  await expect(page.getByTestId("panel-units").locator("thead th")).toHaveCount(12);
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

test("shift-clicking and ctrl-clicking change the pick without moving the cursor row", async ({
  page
}) => {
  await workspace(page);
  const row = rows(page);

  await row.nth(0).click();
  await expect(row.nth(0)).toHaveAttribute("data-selected", "true");
  await row.nth(2).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("unit-bulk-line")).toContainText("3 units picked.");
  await expect(row.nth(0)).toHaveAttribute("data-selected", "true");
  await expect(row.nth(2)).toHaveAttribute("data-selected", "false");

  await row.nth(1).click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByTestId("unit-bulk-line")).toContainText("2 units picked.");
  await expect(row.nth(0)).toHaveAttribute("data-selected", "true");
  await expect(row.nth(1)).toHaveAttribute("data-selected", "false");
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

  await box.fill("Cartographers");
  const shown = await rows(page).count();
  expect(shown).toBeGreaterThan(2);

  await rows(page).first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByTestId("unit-bulk-line")).toContainText(`${shown} units picked.`);

  // E1: a row that leaves the view leaves the pick, so the count and the wash always agree.
  // The filter matches each field on its own (`ah-ykac`), so a narrowing has to stay inside one:
  // the Cartographers' two Town Jugglers are the only jugglers in this hex.
  await box.fill("juggler");
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

/** An Army's row in the command palette (ah-mlls.4), found by typing its name. */
async function findInPalette(page: Page, query: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill(query);
  return page.getByTestId("palette-item").first();
}

test("the palette finds an Army by name and choosing it makes it the pane's source", async ({
  page
}) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  // The member stands at (26,52), away from the hex on screen, so a choice that travelled to it
  // or selected its hex would show below (review, #1618).
  await page.getByTestId("unit-source-own").click();
  // The table windows its rows; the filter brings this one into the DOM (as the pick walk does).
  await page.getByLabel("Filter units").fill("Seven of Eight");
  await page.getByTestId(`unit-row-${OTHER_OWN_UNIT}`).click();
  await page.getByTestId("add-to-army").click();
  await page.getByTestId("add-to-army-panel").getByText("Northern Host").click();
  // Back on This hex in Inholm, so the choice below is what changes the source.
  await page.getByTestId("unit-source-hex").click();
  await selectHex(page, "1:7,53");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");
  const map = await mapTransform(page);

  const row = await findInPalette(page, "north");
  await expect(row).toContainText("Northern Host");
  await expect(row).toContainText("1 unit");
  await expect(row).toContainText(/army/i);
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("command-palette")).toHaveCount(0);
  await expect(page.getByTestId("panel-units")).toContainText("— Northern Host, 1 unit");
  await expect(page.getByTestId(/^unit-source-army-/)).toHaveAttribute("data-selected", "true");
  // The keyboard lands on the Army's first row, so the arrows work at once.
  await expect(page.getByTestId(`unit-row-${OTHER_OWN_UNIT}`)).toBeFocused();
  // Neither the map nor the selected hex moves.
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");
  expect(await mapTransform(page)).toBe(map);
});

test("a member's name does not find its Army in the palette", async ({ page }) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  await selectUnit(page, OWN_UNIT);
  await page.getByTestId("add-to-army").click();
  await page.getByTestId("add-to-army-panel").getByText("Northern Host").click();

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("Seven of Eight");
  await expect(page.getByTestId("palette-item").first()).toBeVisible();
  await expect(page.getByTestId("palette-item").filter({ hasText: "Northern Host" })).toHaveCount(0);
});

test("an empty Army reads no units this turn, and choosing it focuses its rail entry", async ({
  page
}) => {
  await workspace(page);
  await newArmy(page, "Coastal Watch");

  const row = await findInPalette(page, "coastal");
  await expect(row).toContainText("no units this turn");
  await page.keyboard.press("Enter");

  const entry = page.getByTestId(/^unit-source-army-/);
  await expect(entry).toHaveAttribute("data-selected", "true");
  await expect(entry).toBeFocused();
});

test("choosing an Army from the palette unfolds a folded units pane", async ({ page }) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  await selectUnit(page, OWN_UNIT);
  await page.getByTestId("add-to-army").click();
  await page.getByTestId("add-to-army-panel").getByText("Northern Host").click();
  const units = page.getByTestId("panel-units");
  await units.getByRole("button", { expanded: true }).click();
  await expect(units).toHaveAttribute("data-collapsed", "true");

  await findInPalette(page, "northern");
  await page.keyboard.press("Enter");

  await expect(units).toHaveAttribute("data-collapsed", "false");
  await expect(units).toContainText("— Northern Host, 1 unit");
  // The rows remount with the unfold, in the same batch as the source change; focus still lands.
  await expect(rows(page).first()).toBeFocused();
});

/**
 * More Armies than fit under the dock's button (ah-gnmx). Made through the rail, the only way in;
 * named so a row's place in the list is plain from its name.
 */
async function manyArmies(page: Page, count: number) {
  for (let n = 1; n <= count; n += 1) {
    await newArmy(page, `Host ${String(n).padStart(2, "0")}`);
  }
  await expect(page.getByTestId(/^unit-source-army-/)).toHaveCount(count);
}

/** The page itself never scrolls: the root clips (ah-gmg8), and nothing may move it anyway. */
async function appScroll(page: Page) {
  return page.evaluate(() => ({
    root: document.getElementById("root")?.scrollTop ?? 0,
    page: document.scrollingElement?.scrollTop ?? 0
  }));
}

test("with many Armies the list stops above the window edge and only its rows scroll", async ({
  page
}) => {
  await workspace(page);
  await manyArmies(page, 20);
  await selectUnit(page, OWN_UNIT);
  await page.getByTestId("add-to-army").click();

  const panel = page.getByTestId("add-to-army-panel");
  const list = page.getByTestId("add-to-army-rows");
  const viewport = page.viewportSize()!;
  const box = (await panel.boundingBox())!;
  const button = (await page.getByTestId("add-to-army").boundingBox())!;

  // Under its button, as today, and clear of the window's bottom edge.
  expect(box.y).toBeGreaterThan(button.y);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 4);

  // The naming line and New Army… stay on screen; the army rows are what scrolls.
  await expect(panel.getByText("into…")).toBeInViewport();
  await expect(page.getByTestId("add-to-army-new")).toBeInViewport();
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await list.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.getByTestId("add-to-army-fade-bottom")).toBeVisible();
  await expect(page.getByTestId("add-to-army-fade-top")).toHaveCount(0);

  // The wheel moves the rows, never the app.
  await list.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByTestId("add-to-army-fade-top")).toBeVisible();
  await expect(page.getByTestId("add-to-army-fade-bottom")).toBeVisible();
  expect(await appScroll(page)).toEqual({ root: 0, page: 0 });

  // Scrolled to the end: the last Army sits above the separator and only the top fades.
  await page.mouse.wheel(0, 5000);
  await expect(page.getByTestId("add-to-army-fade-bottom")).toHaveCount(0);
  await expect(page.getByTestId("add-to-army-fade-top")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Host 20", exact: true })).toBeInViewport();
  expect(await appScroll(page)).toEqual({ root: 0, page: 0 });

  // New Army… is one click away wherever the rows stand.
  await page.getByTestId("add-to-army-new").click();
  await expect(page.getByTestId("rail-name-field")).toBeVisible();
});

test("tabbing to an Army out of view scrolls it into view inside the list", async ({ page }) => {
  await workspace(page);
  await manyArmies(page, 20);
  await selectUnit(page, OWN_UNIT);
  await page.getByTestId("add-to-army").click();

  const last = page.getByTestId("add-to-army-panel").getByRole("button", { name: "Host 20", exact: true });
  await expect(last).not.toBeInViewport();
  for (let n = 0; n < 20; n += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  expect(await appScroll(page)).toEqual({ root: 0, page: 0 });
});

test("with too little room below for five rows the list opens upward", async ({ page }) => {
  await workspace(page);
  await manyArmies(page, 20);
  await selectUnit(page, OWN_UNIT);

  // A window short enough that the room under the dock's button holds fewer than five rows. The
  // dock reflows with the window, so it is shrunk until the button has under 150px beneath it.
  const button = page.getByTestId("add-to-army");
  for (let height = 700; height >= 300; height -= 20) {
    await page.setViewportSize({ width: 1280, height });
    const at = (await button.boundingBox())!;
    if (height - (at.y + at.height) < 150) {
      break;
    }
  }
  await expect(button).toBeInViewport();
  const at = (await button.boundingBox())!;
  expect(page.viewportSize()!.height - (at.y + at.height)).toBeLessThan(150);
  await button.click();

  const panel = page.getByTestId("add-to-army-panel");
  const box = (await panel.boundingBox())!;
  const anchor = (await button.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(anchor.y);
  expect(box.y).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId("add-to-army-new")).toBeInViewport();
  await expect(page.getByTestId("add-to-army-fade-bottom")).toBeVisible();
});

test("a resize refits an open list rather than closing it", async ({ page }) => {
  await workspace(page);
  await manyArmies(page, 20);
  await selectUnit(page, OWN_UNIT);
  await page.getByTestId("add-to-army").click();

  const panel = page.getByTestId("add-to-army-panel");
  const before = (await panel.boundingBox())!;
  await page.setViewportSize({ width: 1280, height: 680 });

  await expect(panel).toBeVisible();
  await expect
    .poll(async () => {
      const after = (await panel.boundingBox())!;
      return after.y + after.height;
    })
    .toBeLessThanOrEqual(680 - 4);
  expect(before.height).toBeGreaterThan(0);
  await expect(page.getByTestId("add-to-army-new")).toBeInViewport();
});

test("the right-click list is capped and scrolls the same way", async ({ page }) => {
  await workspace(page);
  await manyArmies(page, 30);

  await rows(page).nth(0).click({ button: "right" });
  const menu = page.getByTestId("unit-context-menu");
  await expect(menu).toBeVisible();

  const viewport = page.viewportSize()!;
  const box = (await menu.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(4);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 4);
  await expect(menu.getByText("into…")).toBeInViewport();
  await expect(menu.getByTestId("add-to-army-new")).toBeInViewport();

  const list = menu.getByTestId("add-to-army-rows");
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(menu.getByTestId("add-to-army-fade-bottom")).toBeVisible();
  await list.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await appScroll(page)).toEqual({ root: 0, page: 0 });
});

test("no hover popup from the table is drawn over an open Add to army list", async ({ page }) => {
  // ah-1lac: the popup and the list share a layer, so a popup left open as the list opened was
  // drawn over its army rows and hid them.
  await workspace(page);
  await manyArmies(page, 8);

  const row = page.getByTestId(`unit-row-${OWN_UNIT}`);
  const popups = page.locator('[data-testid="unit-tooltip"], [data-testid="unit-cell-popup"]');

  // The whole-unit card, open on the Name cell, as the pointer comes to rest before the right-click.
  await row.locator('td[data-column="name"]').hover();
  await expect(page.getByTestId("unit-tooltip")).toBeVisible();
  await row.locator('td[data-column="name"]').click({ button: "right" });
  const menu = page.getByTestId("unit-context-menu");
  await expect(menu).toBeVisible();
  await expect(popups).toHaveCount(0);

  // Nor does resting on another row's cell open one while the list is up.
  await rows(page).nth(0).locator('td[data-column="men"]').hover();
  await page.waitForTimeout(HOVER_DELAY_MS * 2);
  await expect(menu).toBeVisible();
  await expect(popups).toHaveCount(0);

  // The button's form of the same list keeps the table quiet the same way.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await page.getByTestId("add-to-army").click();
  await expect(page.getByTestId("add-to-army-panel")).toBeVisible();
  await rows(page).nth(0).locator('td[data-column="men"]').hover();
  await page.waitForTimeout(HOVER_DELAY_MS * 2);
  await expect(page.getByTestId("add-to-army-panel")).toBeVisible();
  await expect(popups).toHaveCount(0);

  // And the bulk line's, with two rows picked.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-to-army-panel")).toHaveCount(0);
  await rows(page).nth(0).click();
  await rows(page).nth(1).click({ modifiers: ["Shift"] });
  await page.getByTestId("bulk-add").click();
  await expect(page.getByTestId("add-to-army-panel")).toBeVisible();
  await rows(page).nth(2).locator('td[data-column="men"]').hover();
  await page.waitForTimeout(HOVER_DELAY_MS * 2);
  await expect(page.getByTestId("add-to-army-panel")).toBeVisible();
  await expect(popups).toHaveCount(0);

  // Closed again, the table's popups come back.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-to-army-panel")).toHaveCount(0);
  await rows(page).nth(3).locator('td[data-column="name"]').hover();
  await expect(page.getByTestId("unit-tooltip")).toBeVisible();
});

test("a list that fits is drawn as it always was", async ({ page }) => {
  await workspace(page);
  await newArmy(page, "Northern Host");
  await selectUnit(page, OWN_UNIT);
  await page.getByTestId("add-to-army").click();

  const list = page.getByTestId("add-to-army-rows");
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(false);
  await expect(page.getByTestId("add-to-army-fade-top")).toHaveCount(0);
  await expect(page.getByTestId("add-to-army-fade-bottom")).toHaveCount(0);
  const box = (await page.getByTestId("add-to-army-panel").boundingBox())!;
  const button = (await page.getByTestId("add-to-army").boundingBox())!;
  expect(box.y).toBeGreaterThan(button.y);
});

test("the list hung outside the dock still behaves as the button's own", async ({ page }) => {
  await workspace(page);
  await manyArmies(page, 20);
  await selectUnit(page, OWN_UNIT);
  const button = page.getByTestId("add-to-army");
  const panel = page.getByTestId("add-to-army-panel");

  // The panel takes focus as it opens, and a press inside it - on its naming line - keeps it.
  await button.click();
  await expect(panel).toBeFocused();
  await panel.getByText("into…").click();
  await expect(panel).toBeVisible();

  // Escape closes it and gives focus back to the button.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();

  // The button toggles it: a second press closes rather than reopens.
  await button.click();
  await expect(panel).toBeVisible();
  await button.click();
  await expect(panel).toHaveCount(0);

  // And each opening starts at the top of the list.
  await button.click();
  const list = page.getByTestId("add-to-army-rows");
  await list.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await button.click();
  expect(await list.evaluate((el) => el.scrollTop)).toBe(0);
});

test("Shift+Tab from the list's first Army goes back to the button", async ({ page }) => {
  await workspace(page);
  await manyArmies(page, 3);
  await selectUnit(page, OWN_UNIT);
  const button = page.getByTestId("add-to-army");
  await button.click();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Host 01", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(button).toBeFocused();
});

test("the bulk line's list is kept inside the window too", async ({ page }) => {
  await workspace(page);
  await manyArmies(page, 20);
  const row = rows(page);
  await row.nth(0).click();
  await row.nth(1).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("unit-bulk-line")).toContainText("2 units picked.");

  await page.getByTestId("bulk-add").click();
  const panel = page.getByTestId("add-to-army-panel");
  await expect(panel).toContainText("2 units into…");
  const viewport = page.viewportSize()!;
  const box = (await panel.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(4);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 4);
  await expect(page.getByTestId("add-to-army-new")).toBeInViewport();
  await expect(panel.getByText("into…")).toBeInViewport();
});
