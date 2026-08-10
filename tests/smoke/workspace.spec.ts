import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { clearGames, createGame } from "./gameSetup";
import { join } from "node:path";
// The real constant, not a copy of it: this test exists to catch the rendered height and the
// windowing arithmetic drifting apart, which a hard-coded 22 here would hide.
import { ROW_HEIGHT } from "../../packages/shared/src/unitTable";
// Likewise the hover delay: the test waits a fraction of it, so a copy here could outlive a change.
import { HOVER_DELAY_MS } from "../../packages/shared/src/unitTooltip";

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
/** Another faction, and another turn: it can be switched to, but never merged. */
const OTHER_FACTION_OLDER = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-f73-t2.rep"),
  "utf8"
);
/** Another faction, same turn: the one case a merge is offered for. */
const ALLY_REPORT = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-f73-t71.rep"),
  "utf8"
);
/** The player's own faction, one turn back, which is what the plain older-turn warning guards. */
const OWN_OLDER_REPORT = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-f95-t70.rep"),
  "utf8"
);

/** Inholm: a city with 24 structures and 92 units, one of them the player's. */
const OWN_UNIT = "18642";
const FOREIGN_UNIT = "12538";

/**
 * Clicks a unit in the table.
 *
 * Scoped to its row rather than found by accessible name: Playwright matches names by substring,
 * and the orders panel header also reads "unit 18642" once that unit is selected.
 *
 * Filtered down to the one unit first, because the table only builds the rows on screen and a unit
 * sitting three hundred rows down is not in the page to be clicked. This is also how a player
 * finds one unit among the three hundred in an ocean hex. The two waits matter: the filter matches
 * on structure id as well as unit id, and typing into it re-renders the table underneath the row
 * we are about to click.
 */
async function selectUnit(page: Page, unitId: string) {
  const box = page.getByLabel("Filter units");
  await box.fill(unitId);
  const row = page.getByTestId(`unit-row-${unitId}`);
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  await row.getByRole("button").click();
  await box.clear();
}

/**
 * Selects a hex the way assistive technology does.
 *
 * Each hex in the map is itself a button — an SVG shape carrying a role, a label and a tabindex.
 * It used to be a separate off-screen element, because a canvas says nothing to a screen reader,
 * but the map is SVG now and the shape and the control are the same thing.
 *
 * Focus plus Enter rather than a click: that is how a keyboard user selects a hex, so driving it
 * this way tests the accessible path instead of bypassing it. Only the focused hex carries
 * `tabindex="0"` — the map is one tab stop, not several thousand — and `focus()` reaches the
 * others regardless, which is why this keeps working for any hex on the level.
 */
async function selectHex(page: Page, regionId: string) {
  const hex = page.getByRole("button", { name: `hex ${regionId}` });
  await hex.focus();
  await hex.press("Enter");
}

async function loadReport(page: Page) {
  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();
  await createGame(page, "Smoke game");
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

/** Drops a file onto the workspace the way the hidden file input receives one. */
async function choose(page: Page, name: string, contents: string) {
  await page.setInputFiles('input[type="file"]', {
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(contents, "utf8")
  });
}

/**
 * An older report of the player's *own* faction still gets the plain warning from issue #47.
 *
 * Kept on its own fixture rather than reusing faction 73's turn 2, which is also another faction
 * and so now goes to the prompt below instead. Without this the native confirmation would have no
 * end-to-end coverage at all and could be deleted by a refactor without anything failing.
 */
test("an older report from your own faction still asks first", async ({ page }) => {
  await loadReport(page);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);

  const dialog = page.waitForEvent("dialog");
  await choose(page, "turn-70.rep", OWN_OLDER_REPORT);
  const confirmation = await dialog;
  expect(confirmation.type()).toBe("confirm");
  expect(confirmation.message()).toContain("older than the currently loaded turn");
  await confirmation.dismiss();

  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);
});

test("a report from another faction can be turned away", async ({ page }) => {
  await loadReport(page);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);

  await choose(page, "turn-2.rep", OTHER_FACTION_OLDER);

  const prompt = page.getByTestId("foreign-report-prompt");
  await expect(prompt).toBeVisible();
  // Another turn, so merging is not on offer at all, and the box says why as well as warning that
  // the report is older than the one loaded.
  await expect(page.getByTestId("foreign-report-merge")).toHaveCount(0);
  await expect(prompt).toContainText("Merging needs a report from turn 71");
  await expect(prompt).toContainText("older than the turn you have loaded");

  await page.getByTestId("foreign-report-cancel").click();

  await expect(prompt).toHaveCount(0);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);
  await expect(page.getByTestId("app-header")).toContainText("Borg TNG (95)");
});

test("a report from another faction can take over the workspace", async ({ page }) => {
  await loadReport(page);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);

  await choose(page, "turn-2.rep", OTHER_FACTION_OLDER);
  await page.getByTestId("foreign-report-switch").click();

  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*2\b/);
  await expect(page.getByTestId("app-header")).toContainText("Borg (73)");
});

/**
 * The whole of issue #53: an ally's report for the same turn, folded into the map, without the
 * player ceasing to be who they were.
 *
 * Faction 95 stands in the swamp at (10,50) and knows the jungle at (9,51) only as a name on that
 * swamp's south-west exit. Faction 73 stands in both, and in a plain at (9,53) that faction 95 has
 * never heard of - so the hex the map gains is proof the merge reached storage and came back.
 */
test("an ally's report for the same turn can be merged into the map", async ({ page }) => {
  await loadReport(page);

  await choose(page, "turn-71-f73.rep", ALLY_REPORT);
  const prompt = page.getByTestId("foreign-report-prompt");
  await expect(prompt).toContainText("Borg (73)");
  await page.getByTestId("foreign-report-merge").click();

  await expect(page.getByTestId("import-status")).toContainText("merged 3 regions from Borg (73)");
  await expect(page.getByTestId("import-status")).toContainText("2 new to your map");

  // Still faction 95's turn 71. That is the difference between merging and switching.
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);
  await expect(page.getByTestId("app-header")).toContainText("Borg TNG (95)");

  // And the header now says whose eyes are in the map.
  await expect(page.getByTestId("merged-factions-chip")).toContainText("+1 merged");
  await page.getByTestId("merged-factions-chip").click();
  await expect(page.getByTestId("merged-factions")).toContainText("Borg (73)");

  // A hex only faction 73 ever stood in is now on the map and can be selected.
  await selectHex(page, "1:9,53");
  await expect(page.getByTestId("panel-region")).toContainText("(9,53)");
});

/** What merging must leave alone: the turn on screen has not changed, so nothing else may move. */
test("merging leaves the orders and the selection where they were", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");

  const orders = page.getByTestId("orders-input");
  await orders.fill("@study obse\n@work");
  await expect(orders).toHaveValue("@study obse\n@work");

  await choose(page, "turn-71-f73.rep", ALLY_REPORT);
  await page.getByTestId("foreign-report-merge").click();
  await expect(page.getByTestId("import-status")).toContainText("merged");

  // With the trailing newline the editor appends once a draft is saved - merging flushes the
  // draft on its way in, so the save has landed by the time the merge reports done. The words
  // themselves are what merging must not move.
  await expect(orders).toHaveValue("@study obse\n@work\n");
  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");
});

/** Merging is remembered, so a reopened game still says whose eyes are in its map. */
test("a merge survives a reload", async ({ page }) => {
  await loadReport(page);
  await choose(page, "turn-71-f73.rep", ALLY_REPORT);
  await page.getByTestId("foreign-report-merge").click();
  await expect(page.getByTestId("merged-factions-chip")).toContainText("+1 merged");

  await page.reload();

  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await expect(page.getByTestId("merged-factions-chip")).toContainText("+1 merged");
  await selectHex(page, "1:9,53");
  await expect(page.getByTestId("panel-region")).toContainText("(9,53)");
});

test("selecting a hex fills the region panel and the unit table together", async ({ page }) => {
  await loadReport(page);

  await selectHex(page, "1:7,53");

  await expect(page.getByTestId("panel-region")).toContainText("Inholm");
  await expect(page.getByTestId("panel-region")).toContainText("12,051");
  await expect(page.getByTestId("panel-units")).toContainText("92 units");
  await expect(page.getByTestId(`unit-row-${OWN_UNIT}`)).toBeVisible();
});

test("selecting a hex selects a unit in it, preferring your own", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  // Ninety-two units stand here and one of them is the player's; landing on that one saves them
  // hunting for it, and leaves no panel blank for no reason.
  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");
  await expect(page.getByTestId(`unit-row-${OWN_UNIT}`)).toHaveAttribute("data-selected", "true");
});

test("selecting your own unit fills the detail panel and opens its orders", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  await selectUnit(page, OWN_UNIT);

  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");
  await expect(page.getByTestId("panel-unit")).toContainText("your faction");
  await expect(page.getByTestId("panel-unit")).toContainText("STEA");

  const orders = page.getByTestId("orders-input");
  await expect(orders).toBeVisible();
  await expect(orders).toHaveValue(/@study obse/);

  // The server's own description of the unit is not an order and does not belong in the editor.
  // The unit panel above already says all of it.
  await expect(orders).not.toHaveValue(/Seven of Eight/);
  await expect(orders).not.toHaveValue(/;/);
});

/**
 * The editor writes every keystroke into the faction document and reads it straight back, and the
 * document cannot hold a blank line at the end of a block. Taking that answer unconditionally used
 * to swallow the newline, leaving the player able to overtype the lines already there and nothing
 * else.
 */
test("a new line can be opened at the end of a unit's orders", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  const orders = page.getByTestId("orders-input");
  const before = (await orders.inputValue()).trimEnd();

  await orders.click();
  // The caret goes to the very end deterministically: End and Control+End differ by platform, and
  // this suite runs on both shells.
  await orders.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(element.value.length, element.value.length);
  });
  await orders.press("Enter");
  await orders.pressSequentially("@work");

  await expect(orders).toHaveValue(`${before}\n@work`);
});

test("a bad order names itself, and belongs to the unit that carries it", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  await page.getByTestId("orders-input").fill("@study obse\nWROK");

  const problems = page.getByTestId("orders-diagnostics");
  await expect(problems).toContainText("unknown order command: WROK");
  // Numbered from the top of this unit's block, which is what the editor shows.
  await expect(problems).toContainText("line 2");
  await expect(page.getByTestId("orders-status")).toContainText("1 error");

  // Another unit is not answerable for it, though the document still is.
  await selectHex(page, "1:26,52");
  await selectUnit(page, "13401");
  await expect(page.getByTestId("orders-diagnostic")).toHaveCount(0);
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");
  // Counted apart from this unit's own, so the two figures are never added up by mistake.
  await expect(page.getByTestId("orders-status")).toContainText("1 elsewhere");
});

test("an order with the wrong argument is caught, and the offending word quoted", async ({
  page
}) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // GIVE takes a quantity before the item, and "swords" is not one. Only a parser that reads the
  // arguments finds this; checking the command name alone accepts it.
  await page.getByTestId("orders-input").fill("GIVE 4573 swords");

  const problems = page.getByTestId("orders-diagnostics");
  await expect(problems).toContainText("found \"swords\"");
  // The word itself, quoted out of the line by column, so the player is not left counting across.
  await expect(page.getByTestId("orders-diagnostic-token")).toHaveText("swords");
  await expect(page.getByTestId("orders-status")).toContainText("1 error");

  // Corrected, it is accepted.
  await page.getByTestId("orders-input").fill("GIVE 4573 10 swords");
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");
  await expect(page.getByTestId("orders-diagnostic")).toHaveCount(0);
});

test("a TURN block left open is reported against the unit that wrote it", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // The block is closed by ENDTURN, and is not. The core always found this, but filed it against
  // the line that discovered it - the *next* unit's line - which is outside this unit's block, so
  // the panel showed the unit that wrote it nothing at all.
  await page.getByTestId("orders-input").fill("turn\nstudy illu");

  const problems = page.getByTestId("orders-diagnostics");
  await expect(problems).toContainText("never closed by ENDTURN");
  await expect(problems).toContainText("line 1");
  await expect(page.getByTestId("orders-status")).toContainText("1 error");

  // Closed, it is accepted.
  await page.getByTestId("orders-input").fill("turn\nstudy illu\nendturn");
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");
});

test("an item the catalogue does not know is a warning rather than an error", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // The shape is right, so this is not a refusal - the catalogue is scraped and may simply be
  // missing an entry. It is said out loud all the same, because it is usually a typo.
  await page.getByTestId("orders-input").fill("GIVE 4573 10 swordz");

  await expect(page.getByTestId("orders-diagnostics")).toContainText("swordz");
  const status = page.getByTestId("orders-status");
  await expect(status).toContainText("1 warning");
  await expect(status).toContainText("0 errors");
  await expect(page.getByTestId("orders-diagnostic")).toHaveAttribute("data-severity", "warning");
});

test("a foreign unit can be inspected but not ordered", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  await selectUnit(page, FOREIGN_UNIT);

  // Inspecting a neighbour is legitimate; ordering one is not.
  await expect(page.getByTestId("panel-unit")).toContainText("Elder Tree Forests");
  await expect(page.getByTestId("panel-unit")).toContainText("not your faction");

  const locked = page.getByTestId("orders-locked");
  await expect(locked).toHaveAttribute("data-lock", "foreign");
  await expect(locked).toContainText("Elder Tree Forests");
  await expect(page.getByTestId("orders-input")).toHaveCount(0);
});

/**
 * The table truncates Skills and Items to fit, so resting on a row spells out what was cut.
 *
 * It waits: a pointer crossing the table on its way to the map must not leave a trail of
 * tooltips behind it, so the summary is only worth showing once the user has stopped.
 */
test("resting on a unit row summarises it", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const row = page.getByTestId(`unit-row-${OWN_UNIT}`);
  await expect(row).toBeVisible();
  const tip = page.getByTestId("unit-tooltip");

  await row.hover();
  // A third of the wait, taken from the constant itself rather than written out: shortening the
  // delay must not quietly turn this into a check made after the tooltip was already due.
  await page.waitForTimeout(HOVER_DELAY_MS / 3);
  await expect(tip).toHaveCount(0);

  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Seven of Eight (18642)");
  // Every skill and every item, not the truncated summary the row has room for.
  await expect(tip).toContainText("manipulation MANI");
  await expect(tip).toContainText("stealth STEA");
  await expect(tip).toContainText("observation OBSE");
  await expect(tip).toContainText("leader LEAD");

  // It is on screen, which a tooltip placed off the edge of the window would not be.
  const box = (await tip.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);

  // Leaving the row takes it away at once.
  await page.getByTestId("panel-region").hover();
  await expect(tip).toHaveCount(0);
});

test("a hex with no units leaves the detail panel empty and orders refused", async ({ page }) => {
  await loadReport(page);

  // A hex known only from a neighbour's exits carries no units at all.
  await selectHex(page, "1:7,51");

  await expect(page.getByTestId("panel-unit")).toContainText("No unit selected");
  await expect(page.getByTestId("orders-locked")).toHaveAttribute("data-lock", "no-unit");
});

test("changing hex moves the selection to a unit in the new one", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");

  await selectHex(page, "1:26,52");

  // The old hex's unit is gone from the panel rather than lingering over a list it is not in.
  await expect(page.getByTestId("panel-unit")).not.toContainText("Seven of Eight");
  await expect(page.getByTestId("panel-unit")).not.toContainText("No unit selected");
});

test("editing orders changes only the selected unit's block", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  await page.getByTestId("orders-input").fill("@work");
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");

  // The other unit's block is untouched by that edit.
  await selectHex(page, "1:26,52");
  await selectUnit(page, "13401");
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

/**
 * The tallest a title bar can be.
 *
 * The bar is `h-7`, so 28px, and the frame adds a border above and below it. Bounded rather than
 * measured exactly: the rounding differs between the browsers this suite runs in, and what these
 * tests are about is a strip rather than a slab.
 */
const STRIP_HEIGHT = 40;

/** Folds a panel by its own toggle, which is the only expanded control in its header. */
async function foldPanel(page: Page, panel: string) {
  const section = page.getByTestId(`panel-${panel}`);
  await section.getByRole("button", { expanded: true }).click();
  await expect(section).toHaveAttribute("data-collapsed", "true");
}

/** Where a panel is on screen, having asserted it is on screen at all. */
async function boxOf(page: Page, panel: string) {
  const box = await page.getByTestId(`panel-${panel}`).boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test("a folded panel shrinks to its title bar", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const open = await boxOf(page, "region");
  expect(open.height).toBeGreaterThan(100);

  await foldPanel(page, "region");

  // Issue #60: the body used to go and the frame used to stay, leaving a full-height empty slab
  // over the map.
  const strip = await boxOf(page, "region");
  expect(strip.height).toBeLessThan(STRIP_HEIGHT);
  // Sideways it does not move, so re-opening it is a click in the same place.
  expect(strip.width).toBeCloseTo(open.width, 0);
  expect(strip.y).toBeCloseTo(open.y, 0);
});

test("the orders editor takes the space a folded unit panel leaves", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  const pinned = await boxOf(page, "orders");

  await foldPanel(page, "unit");

  expect((await boxOf(page, "unit")).height).toBeLessThan(STRIP_HEIGHT);

  // The space goes to the panel beside it rather than to the map: the editor grows, and it grows
  // upward into what the unit panel gave up rather than pushing the column off the floor.
  const grown = await boxOf(page, "orders");
  expect(grown.height).toBeGreaterThan(pinned.height);
  expect(grown.y).toBeLessThan(pinned.y);
});

test("the map under a folded panel can be clicked", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  // The whole right-hand column, so what is freed is a rectangle rather than a sliver: with all
  // three folded the column is three title bars and live map below them.
  const covered = await boxOf(page, "orders");
  await foldPanel(page, "unit");
  await foldPanel(page, "planner");
  await foldPanel(page, "orders");
  const strip = await boxOf(page, "orders");

  // The ground the column used to stand on and no longer does.
  const freed = {
    left: covered.x,
    right: covered.x + covered.width,
    top: strip.y + strip.height,
    bottom: covered.y + covered.height
  };

  // Which hex is under there depends on where the map framed itself, so it is asked for rather
  // than assumed. Any hex whose middle falls inside the freed rectangle will do, so long as it is
  // not the one already selected - that click would prove nothing.
  const target = await page.evaluate((rect) => {
    for (const hex of document.querySelectorAll<SVGPolygonElement>("polygon[data-region-id]")) {
      if (hex.getAttribute("aria-pressed") === "true") {
        continue;
      }
      const box = hex.getBoundingClientRect();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (x > rect.left && x < rect.right && y > rect.top && y < rect.bottom) {
        return { regionId: hex.getAttribute("data-region-id") ?? "", x, y };
      }
    }
    return null;
  }, freed);
  expect(target, "no hex sits under the folded panels").not.toBeNull();

  // `page.mouse` rather than `locator.click()`: before this was fixed the overlay swallowed the
  // click, and Playwright reports that as "element intercepts pointer events" - a murkier failure
  // than the selection simply not moving.
  await page.mouse.click(target!.x, target!.y);

  const [, coordinates] = target!.regionId.split(":");
  await expect(page.getByTestId("panel-units")).toContainText(`(${coordinates})`);
});

test("a folded panel is still folded after a reload", async ({ page }) => {
  await loadReport(page);

  const region = page.getByTestId("panel-region");
  await region.getByRole("button", { name: /Region/ }).click();
  await expect(region).toHaveAttribute("data-collapsed", "true");

  await page.reload();

  // The layout the user arranged outlives the reload, and since issue #34 so does the turn: the
  // game reopens on what was last worked on rather than on an empty workspace over a full database.
  await expect(page.getByTestId("panel-region")).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
});

test("layer toggles are operable and only trade routes is still inert", async ({ page }) => {
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

  // Asserting the count, not just that one row went: the table windows its rows, so a unit far
  // down the list is absent from the page whether it was filtered out or merely scrolled past.
  // Only "every row but one has gone" tells the two apart.
  const rows = page.locator("[data-testid^='unit-row-']");
  expect(await rows.count()).toBeGreaterThan(1);

  await page.getByLabel("Filter units").fill("Seven of Eight");

  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId(`unit-row-${OWN_UNIT}`)).toBeVisible();
  await expect(page.getByTestId(`unit-row-${FOREIGN_UNIT}`)).toHaveCount(0);
});

/**
 * Issue #8 asks that the interface stay interactive while the core works, and names a worker as the
 * way to get there. Measurement said otherwise, so this test is the evidence that stands in its
 * place.
 *
 * Parsing turn 71 - four thousand lines, eleven regions, some four hundred and fifty units - blocks
 * the main thread for about seventy milliseconds. A worker was built and measured before being
 * removed: it made the same load roughly five times slower and blocked the page for 755ms, because
 * the parsed model costs far more to clone across a thread boundary than it costs to parse.
 *
 * Remembering the turn used to cost more than parsing it, because committing the import parsed the
 * report a third time and round-tripped eleven regions through JSON. Issue #28 removed both: the
 * core remembers the parse it already made, and hands the region rows over already serialized.
 * Measured over three runs on one machine, the block fell from 1204-1945ms to 262-429ms.
 *
 * So the threshold is set against what remembering actually costs, and against a CI run rather
 * than a local one - a guard calibrated on the fastest machine available is a guard that fails
 * everywhere else. It is a regression guard, not a benchmark: it catches somebody reintroducing
 * work that stops the page, which is the failure that would matter.
 */
test("the interface is not blocked while the core reads a report", async ({ page }) => {
  // Load once and reload before measuring. The first load in a session pays for the dev server
  // transforming modules on demand, which is not the application's work and swamped the figure -
  // it was measured at 834ms cold against 70ms warm.
  await clearGames(page);
  await createGame(page, "Perf game");
  await page.setInputFiles('input[type="file"]', {
    name: "turn-71.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(REPORT, "utf8")
  });
  await expect(page.getByTestId("import-status")).toContainText("11 regions");

  await page.reload();
  await expect(page.getByTestId("app-header")).toBeVisible();

  // And wait for the reload's own work to finish before starting the clock. Since issue #34 a
  // reload reopens the stored turn, which parses the report - so without this wait that parse
  // lands inside the sampling window and is charged to the import being measured.
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");

  // Sample how long the main thread goes unresponsive, by watching a timer miss its deadline.
  await page.evaluate(() => {
    const state = window as unknown as { __gaps?: number[]; __sampler?: number };
    state.__gaps = [];
    let last = performance.now();
    state.__sampler = window.setInterval(() => {
      const now = performance.now();
      state.__gaps?.push(now - last);
      last = now;
    }, 4);
  });

  await page.setInputFiles('input[type="file"]', {
    name: "turn-71.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(REPORT, "utf8")
  });
  await expect(page.getByTestId("import-status")).toContainText("11 regions");

  const worstBlockMs = await page.evaluate(() => {
    const state = window as unknown as { __gaps?: number[]; __sampler?: number };
    window.clearInterval(state.__sampler);
    return Math.max(...(state.__gaps ?? [0]));
  });

  // Reported so the figure this threshold is calibrated against can be read off a CI run rather
  // than guessed at. A guard calibrated on the fastest machine available is a guard that fails
  // everywhere else, so the number below comes from CI: 400ms for the web project and 464ms for
  // the desktop shell. 900 sits about twice the slower of those, and below the 1204-1945ms this
  // same measurement gave before the change.
  console.log(`report load: worst main-thread block ${Math.round(worstBlockMs)}ms`);
  expect(worstBlockMs).toBeLessThan(900);

  // And it really is still interactive afterwards: a hex selects and the panels follow.
  await selectHex(page, "1:7,53");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");
});

/**
 * The turn is committed to the faction's project and read back, in a real browser, against real
 * IndexedDB. That path is what lets the map remember earlier turns; without it the map stops at
 * the fringe of the current report and no route can be longer than one step.
 *
 * What this cannot show is accumulation itself: the repository holds one report per faction, and
 * fabricating a second turn to demonstrate it would be inventing game data. The merging is covered
 * by unit tests in the core instead. What it does show is that committing and reading back works
 * where it actually has to - through the browser's storage rather than a fake.
 */
test("a loaded turn is remembered rather than only displayed", async ({ page }) => {
  await loadReport(page);

  // No warning means the project opened, the import committed and the sightings read back. The
  // status line is where remembering reports its failures.
  await expect(page.getByTestId("import-status")).not.toContainText("could not be remembered");

  // Loading the same turn again must refresh what is remembered rather than refuse it, and the map
  // must come back the same rather than doubled.
  await page.setInputFiles('input[type="file"]', {
    name: "turn-71.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(REPORT, "utf8")
  });
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
  await expect(page.getByTestId("import-status")).not.toContainText("could not be remembered");

  // The map is still the eleven regions the report describes, not twenty-two: a hex seen again
  // replaces the memory of it rather than accumulating a duplicate.
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
});

test("planning a move shows its cost and what stands in the way", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // "* Seven of Eight (18642)" is a walker with two movement points, in a mountain whose north
  // neighbour is another mountain.
  await page.getByTestId("planner-arm").click();
  await selectHex(page, "1:7,51");

  await expect(page.getByTestId("planner-route")).toBeVisible();
  await expect(page.getByTestId("planner-route")).toContainText("2 movement points");
  await expect(page.getByTestId("planner-route")).toContainText("this month");
  await expect(page.getByTestId("planner-order")).toHaveText("MOVE N");
  await expect(page.getByTestId("planner-risk")).toBeVisible();
});

test("an illegal move is refused with the reason", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // "  Northeast : ocean (8,52) in Atlantis Ocean." - a walker cannot go there.
  await page.getByTestId("planner-arm").click();
  await selectHex(page, "1:8,52");

  await expect(page.getByTestId("planner-problem")).toContainText("sea");
  await expect(page.getByTestId("planner-problem")).toContainText("(8,52)");
  await expect(page.getByTestId("planner-route")).toHaveCount(0);
});

test("a planned route can be written into the unit's orders", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  await page.getByTestId("planner-arm").click();
  await selectHex(page, "1:7,51");
  await expect(page.getByTestId("planner-order")).toHaveText("MOVE N");

  await page.getByTestId("planner-apply").click();
  await expect(page.getByTestId("orders-input")).toHaveValue(/MOVE N/);
});

test("only your own units can be planned for", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, FOREIGN_UNIT);

  await expect(page.getByTestId("planner-arm")).toBeDisabled();
});

/**
 * Issue #8's third vector: the map still pans and selects while the planner is working.
 *
 * The search itself is microseconds over the 57 hexes the faction knows. Planning hands the core
 * the report as text, and every plan used to re-parse four thousand lines and re-classify every
 * unit before searching; issue #28 made that text the key the core remembers its last parse under,
 * so a route over the turn already on screen parses nothing.
 *
 * Measured over three runs on one machine, the block here fell from 397-1391ms to ~150ms - but
 * that is mostly the load getting cheaper, since this window opens right after one and catches its
 * tail. Removing the planner's re-parse on its own does not move this figure.
 *
 * The threshold below is set against a CI run rather than a local one, because a
 * guard calibrated on the fastest machine available is a guard that fails everywhere else. It still
 * catches the thing worth catching: planning stopping the page for seconds.
 */
test("the map still answers while a route is being planned", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  await page.evaluate(() => {
    const state = window as unknown as { __gaps?: number[]; __sampler?: number };
    state.__gaps = [];
    let last = performance.now();
    state.__sampler = window.setInterval(() => {
      const now = performance.now();
      state.__gaps?.push(now - last);
      last = now;
    }, 4);
  });

  await page.getByTestId("planner-arm").click();
  await selectHex(page, "1:7,51");
  await expect(page.getByTestId("planner-route")).toBeVisible();

  const worstBlockMs = await page.evaluate(() => {
    const state = window as unknown as { __gaps?: number[]; __sampler?: number };
    window.clearInterval(state.__sampler);
    return Math.max(...(state.__gaps ?? [0]));
  });
  // This window is the noisy one on CI: two runs of the same commit gave 620ms and 640ms, then
  // 809ms and 824ms. So the guard sits at roughly twice the worst of those rather than just above
  // it, which is the difference between a guard and a flake. Locally it measures about 150ms.
  //
  // Note what the figure is and is not. Reverting the planner's cache does not move it at all
  // (152ms either way): the parse that saves is smaller than the largest gap this window already
  // contains, and the window opens right after a load and catches its tail, so what fell from
  // 397-1391ms was mostly the load getting cheaper. That the planner stopped re-parsing is pinned
  // by counting parses in `a_second_route_over_the_same_turn_parses_nothing`, not by this
  // stopwatch. What this guard is for is the page staying responsive, and that is all it claims.
  console.log(`route plan: worst main-thread block ${Math.round(worstBlockMs)}ms`);
  expect(worstBlockMs).toBeLessThan(1_500);

  // And the map is still a map: dragging pans it, and a hex still selects.
  const canvas = page.getByTestId("map-canvas");
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
  }

  await selectHex(page, "1:10,50");
  await expect(page.getByTestId("panel-region")).toContainText("Cebo");
});

/**
 * The movement chip was inert from #20 until now. Toggling it must change what is drawn without
 * disturbing the route itself, which lives in the planner panel rather than on the map.
 */
test("the movement layer controls the route overlay and nothing else", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  await page.getByTestId("planner-arm").click();
  await selectHex(page, "1:7,51");
  await expect(page.getByTestId("planner-route")).toBeVisible();

  const movement = page.getByTestId("layer-chips").getByLabel("movement");
  await movement.click();

  // The panel still knows the route; only the drawing follows the chip.
  await expect(page.getByTestId("planner-route")).toBeVisible();
  await expect(page.getByTestId("planner-order")).toHaveText("MOVE N");
});

/**
 * A report cannot be split into men and equipment on its own, so a unit's headcount is a guess
 * until it has been counted against the scraped item catalogue. Classification is what removes the
 * guess, and it has to run on the path that draws the table - not only inside the planner.
 *
 * It did not, briefly: every one of the 92 units in this hex rendered with a tilde, including the
 * single-race majority whose figure was exactly right. The cause was a callback closing over the
 * ruleset before it had loaded.
 */
test("men are counted rather than guessed once the ruleset is loaded", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  // The table windows its rows, so this sweeps what is on screen rather than all 92. The bug it
  // guards against tilde'd every unit in the hex, the first one included, so a screenful still
  // catches it — but it is a screenful, not the lot.
  const cells = await page.locator("[data-testid^='unit-row-'] td:nth-child(5)").allInnerTexts();
  expect(cells.length).toBeGreaterThan(5);
  expect(cells.length).toBeLessThan(50);
  expect(cells.filter((cell) => cell.startsWith("~"))).toEqual([]);

  // And a multi-race unit reads as its parts rather than as its largest group.
  await selectHex(page, "1:26,52");
  await selectUnit(page, "15807");
  await expect(page.getByTestId("panel-unit")).toContainText("99");
  await expect(page.getByTestId("panel-unit")).toContainText("gnolls");
});

/**
 * The same guarantee for units that reach the screen through storage rather than the live parse.
 *
 * A merged ally's units exist only as stored sightings, and those used to be built from the plain
 * parse - so every merged unit wore a tilde forever, however complete the catalogue, and a reload
 * changed nothing. The hex here is one only faction 73 stood in, so everything in it came through
 * the merge.
 */
test("a merged hex's men are counted rather than guessed", async ({ page }) => {
  await loadReport(page);
  await choose(page, "turn-71-f73.rep", ALLY_REPORT);
  await page.getByTestId("foreign-report-merge").click();
  await expect(page.getByTestId("import-status")).toContainText("merged");

  await selectHex(page, "1:9,53");
  const cells = await page.locator("[data-testid^='unit-row-'] td:nth-child(5)").allInnerTexts();
  expect(cells.length).toBeGreaterThan(0);
  expect(cells.filter((cell) => cell.startsWith("~"))).toEqual([]);

  // And still counted when the same units come back off disk rather than out of the merge.
  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await selectHex(page, "1:9,53");
  const restored = await page.locator("[data-testid^='unit-row-'] td:nth-child(5)").allInnerTexts();
  expect(restored.length).toBeGreaterThan(0);
  expect(restored.filter((cell) => cell.startsWith("~"))).toEqual([]);
});

/** The ocean hex the report gives three hundred and eleven units. */
const CROWDED_HEX = "1:26,52";

/**
 * Selecting this hex used to build 311 rows of eight cells each in one synchronous render
 * (issue #27's windowing was the first answer). Today the unit list limit caps the table well
 * before the windowing has to act, so what this pins is the cap and the row count the grid
 * claims; the windowing arithmetic itself is covered by unitTable's unit tests.
 */
test("a hex of three hundred units renders only the capped rows", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, CROWDED_HEX);

  await expect(page.getByTestId("panel-units")).toContainText("311 units");

  // The global unit list limit trims the table to its default of twelve rows before the
  // windowing ever has to: the header says what the hex really holds, and the filter still
  // reaches every unit the cap hides. The windowing arithmetic remains behind the cap for the
  // rows it is handed.
  const rows = page.locator("[data-testid^='unit-row-']");
  await expect(rows).toHaveCount(12);

  // The table claims exactly the capped rows to assistive technology, the header counting as one
  // of them. It is a grid rather than a table because its rows are selectable.
  await expect(page.getByTestId("panel-units").getByRole("grid")).toHaveAttribute(
    "aria-rowcount",
    "13"
  );
});

/**
 * Rows are stood in for by spacers of a fixed height, so a row that renders taller than the
 * constant would drift the list out of alignment — by a pixel a row, which over 311 rows puts the
 * bottom of the list out of reach.
 */
test("a row is exactly as tall as the windowing arithmetic assumes", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  // Every rendered row, not one of them: the drift this guards against would come from a cell
  // whose contents happen to be taller, so measuring only the player's own short row would miss
  // it. Sampling the whole window costs nothing and covers the claim the comment above makes.
  const heights = await page
    .locator("[data-testid^='unit-row-']")
    .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));

  expect(heights.length).toBeGreaterThan(5);
  for (const height of heights) {
    // Close-to rather than exact: the value is pinned by an inline style, so it is deterministic,
    // but a bounding box is a float and sub-pixel noise should not fail the suite. The tolerance
    // is far tighter than the one-pixel drift that would actually break the list.
    expect(height).toBeCloseTo(ROW_HEIGHT, 1);
  }
});

/**
 * Issue #20 asked for a sortable table and did not deliver one. Sorting must not bury the player's
 * own units, which is why ownership is compared before the column and never reversed.
 */
test("sorting by a column reorders the table, own units still first", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  // Position in the whole list, not position among the rendered rows: only a screenful is built,
  // so the first row in the page is whatever the window starts at. aria-rowindex counts the header
  // as row one, so the first unit is row two.
  const ownRow = page.getByTestId(`unit-row-${OWN_UNIT}`);
  await expect(ownRow).toHaveAttribute("aria-rowindex", "2");

  // Descending by men puts the biggest stack on top — of the foreign block. Inholm holds exactly
  // one unit of the player's, and it stays above all 91 others.
  //
  // Scoped to the panel: names match by substring, and the planner's "Movement" strip contains
  // "men" too.
  const men = page.getByTestId("panel-units").getByRole("button", { name: "Men" });
  await men.click();
  await men.click();

  await expect(
    page.getByTestId("panel-units").getByRole("columnheader", { name: "Men" })
  ).toHaveAttribute("aria-sort", "descending");
  await expect(ownRow).toHaveAttribute("aria-rowindex", "2");

  // The column really did reorder: every foreign row on screen runs biggest first.
  const counts = await page.locator("[data-testid^='unit-row-'] td:nth-child(5)").allInnerTexts();
  const foreign = counts.slice(1).map((cell) => Number(cell.replace(/[^0-9]/g, "")));
  expect(foreign.length).toBeGreaterThan(3);
  expect(foreign).toEqual([...foreign].sort((left, right) => right - left));
});

/**
 * The grouping is a default, not a cage: releasing it lets the biggest stack in the hex rise to the
 * top whoever it belongs to.
 */
test("the ownership toggle releases the own-units-first grouping", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const men = page.getByTestId("panel-units").getByRole("button", { name: "Men" });
  await men.click();
  await men.click();

  const ownRow = page.getByTestId(`unit-row-${OWN_UNIT}`);
  await expect(ownRow).toHaveAttribute("aria-rowindex", "2");

  const grouping = page.getByRole("button", { name: "Group own units first" });
  await expect(grouping).toHaveAttribute("aria-pressed", "true");
  await grouping.click();
  await expect(grouping).toHaveAttribute("aria-pressed", "false");

  // Released, the player's single unit sinks to wherever its headcount puts it among the other
  // ninety-one - past the unit list limit's twelve rows, so it leaves the table entirely. It is
  // still selected: the unit panel keeps showing it, and the filter finds it.
  await expect(ownRow).toHaveCount(0);
  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");
});

/**
 * Tab reaches the table once and the arrows take over from there, so a keyboard user is not made
 * to walk through every unit on screen to get past the dock.
 *
 * The last assertion is the one with history: arrowing past the end of the list selects the row
 * already selected, which re-renders nothing. An earlier version armed a pending focus before
 * asking for that no-op selection, and the focus was never spent — it was left owing, and landed
 * on whatever was selected next. Pressing End twice and then selecting a hex would drag focus out
 * of the map and into the table.
 */
test("the units table is navigable by keyboard", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const firstRow = page.getByTestId(`unit-row-${OWN_UNIT}`);
  await firstRow.focus();
  await expect(firstRow).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(firstRow).not.toBeFocused();
  await expect(page.locator("[data-testid^='unit-row-'][data-selected='true']")).toHaveAttribute(
    "aria-rowindex",
    "3"
  );

  await page.keyboard.press("ArrowUp");
  await expect(firstRow).toBeFocused();
  await expect(firstRow).toHaveAttribute("data-selected", "true");

  // End walks to the bottom of the list as capped by the unit list limit: twelve rows of the 92,
  // the header counting as row one.
  await page.keyboard.press("End");
  await expect(page.locator("[data-testid^='unit-row-'][data-selected='true']")).toHaveAttribute(
    "aria-rowindex",
    "13"
  );

  // Arrowing past the end is a no-op: same row, so nothing re-renders.
  await page.keyboard.press("End");

  // Which is where a focus owed from that no-op would be spent. Selecting with the mouse must not
  // haul focus onto a row: only the arrow keys move focus, because only they asked to.
  await page.locator("[data-testid^='unit-row-']").first().getByRole("button").click();
  await expect(page.locator("[data-testid^='unit-row-']:focus")).toHaveCount(0);
});

/** Filtering everything out used to leave bare column headings over an empty table. */
test("a filter that matches nothing says so", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  await page.getByLabel("Filter units").fill("no such unit");

  await expect(page.getByTestId("panel-units")).toContainText("No unit matches that filter.");
});

/**
 * The turn's own account of itself, which the header used to count and never show.
 *
 * Turn 71 is one error and several hundred events, so this also exercises the case the panel was
 * sized for: a list long enough to scroll, read once and dismissed.
 */
test("the header chip opens the turn's errors and events", async ({ page }) => {
  await loadReport(page);

  const chip = page.getByTestId("turn-messages-chip");
  await expect(chip).toContainText("1 error");
  await expect(chip).toContainText("events");

  await chip.click();

  // Opens on the errors, because this turn has one.
  const panel = page.getByTestId("turn-messages");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("turn-messages-tab-errors")).toHaveAttribute(
    "aria-selected",
    "true"
  );
  // The verb is set apart from the message it belongs to, rather than left buried at the front of
  // the sentence.
  await expect(panel).toContainText("DECLARE");
  await expect(panel).toContainText("Can't declare towards your own faction.");

  await panel.getByTestId("turn-messages-tab-events").click();
  await expect(panel).toContainText("Claims $50.");
});

test("a unit named in a turn message is a way back to it", async ({ page }) => {
  await loadReport(page);
  await page.getByTestId("turn-messages-chip").click();
  await page.getByTestId("turn-messages-tab-events").click();

  await page.getByTestId(`turn-messages-unit-${OWN_UNIT}`).first().click();

  // The panel has said what it had to say, and the workspace behind it is now describing the unit.
  await expect(page.getByTestId("turn-messages")).toHaveCount(0);
  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");
});

test("the turn messages panel closes on Escape", async ({ page }) => {
  await loadReport(page);

  await page.getByTestId("turn-messages-chip").click();
  await expect(page.getByTestId("turn-messages")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByTestId("turn-messages")).toHaveCount(0);
});

/*
 * The map itself.
 *
 * None of this could be asserted while the map was a canvas: a canvas is one opaque element, so
 * the suite could only check that the accessibility shim beside it existed. These read the drawing.
 */

test("terrain is drawn as itself rather than as a picture of itself", async ({ page }) => {
  await loadReport(page);

  // Inholm is mountain, and several of the hexes this turn describes are ocean. If the colour
  // classes were built from a template Tailwind would have tree-shaken them away and every hex
  // would render unstyled, which is exactly the failure this catches.
  await expect(page.locator("polygon.fill-terrain-mountain").first()).toBeAttached();
  await expect(page.locator("polygon.fill-terrain-ocean").first()).toBeAttached();
});

test("coordinate rulers stay pinned to the edges of the view", async ({ page }) => {
  await loadReport(page);

  const across = page.getByTestId("map-ruler-x");
  const down = page.getByTestId("map-ruler-y");
  await expect(across).toBeAttached();
  await expect(down).toBeAttached();

  // The numbers are the point: a ruler with no readable coordinate on it is decoration.
  await expect(across).toContainText(/\d/);
  await expect(down).toContainText(/\d/);
});

test("zooming in and back out returns the map to the scale it started at", async ({ page }) => {
  await loadReport(page);
  const map = page.locator("[data-testid='map-canvas'] svg");
  const scale = () =>
    map.evaluate((node) => getComputedStyle(node).getPropertyValue("--map-scale").trim());

  const before = await scale();
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  expect(await scale()).not.toBe(before);

  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }

  // The old renderer multiplied by 1.1 in and 0.9 out, so it never came back to where it started.
  expect(await scale()).toBe(before);
});

test("the map carries less detail the further out it is zoomed", async ({ page }) => {
  await loadReport(page);
  const map = page.locator("[data-testid='map-canvas'] svg");

  for (let step = 0; step < 8; step += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }
  await expect(map).toHaveClass(/map-far/);

  for (let step = 0; step < 12; step += 1) {
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  await expect(map).toHaveClass(/map-near/);
});

test("arrow keys walk from hex to neighbouring hex", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  // North of Inholm is (7,51), which this turn knows only from a neighbour's exits. Flat-top
  // geometry is what gives a hex a direct northern neighbour at all.
  await page.getByRole("button", { name: "hex 1:7,53" }).press("ArrowUp");
  await expect(page.locator("polygon:focus")).toHaveAttribute("aria-label", "hex 1:7,51");
  await page.locator("polygon:focus").press("ArrowDown");
  await expect(page.locator("polygon:focus")).toHaveAttribute("aria-label", "hex 1:7,53");

  // Left and right step to opposite corners of the hex, so one undoes the other. Two keys that
  // both led north would let focus drift with no way back.
  await page.locator("polygon:focus").press("ArrowRight");
  await expect(page.locator("polygon:focus")).toHaveAttribute("aria-label", "hex 1:8,52");
  await page.locator("polygon:focus").press("ArrowLeft");
  await expect(page.locator("polygon:focus")).toHaveAttribute("aria-label", "hex 1:7,53");
});

test("the cursor comes to rest rather than wandering off the map", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  // The cursor is free to leave the hexes the report describes — that is what makes crossing to
  // another island of known ground possible — but not free to keep going forever, or a held arrow
  // key strands the player in a void with no landmark to steer back by.
  await page.getByRole("button", { name: "hex 1:7,53" }).press("ArrowUp");
  for (let step = 0; step < 40; step += 1) {
    await page.locator("polygon:focus").press("ArrowUp");
  }
  const settled = await page.locator("polygon:focus").getAttribute("aria-label");

  // Still on something: focus never falls through to the body.
  expect(settled).toBeTruthy();

  // And pressing on does not move it any further.
  await page.locator("polygon:focus").press("ArrowUp");
  await expect(page.locator("polygon:focus")).toHaveAttribute("aria-label", settled ?? "");
});

test("the map is a single tab stop rather than one per hex", async ({ page }) => {
  await loadReport(page);

  // Every hex is focusable, but only one is in the tab order: tabbing through a few thousand
  // hexes to reach the panel beyond them would be worse than the shim this replaced.
  const inTabOrder = page.locator("polygon[role='button'][tabindex='0']");
  await expect(inTabOrder).toHaveCount(1);
  await expect(page.locator("polygon[role='button']").first()).toBeAttached();
});

/**
 * Finds a point on the map where a hex is genuinely the topmost element.
 *
 * The inspector panels float over the map, so a hex can be perfectly visible and still sit under
 * one. Probing for a clear point tests the pointer path itself rather than the panel layout.
 */
async function clearHexPoint(page: Page) {
  return page.evaluate(() => {
    const map = document.querySelector('[data-testid="map-canvas"]');
    const bounds = map!.getBoundingClientRect();
    for (let down = 0.3; down <= 0.7; down += 0.04) {
      for (let across = 0.2; across <= 0.8; across += 0.04) {
        const x = bounds.x + bounds.width * across;
        const y = bounds.y + bounds.height * down;
        const top = document.elementFromPoint(x, y);
        if (top?.tagName === "polygon" && top.getAttribute("role") === "button") {
          return { x, y, label: top.getAttribute("aria-label") ?? "" };
        }
      }
    }
    return null;
  });
}

/*
 * Clicking, specifically.
 *
 * Every other hex test here drives focus and Enter, which is the keyboard path. That left the
 * pointer path with no coverage at all, and it broke: capturing the pointer on the map root to
 * make dragging work retargets the click to the root, so no hex ever received one. The map panned
 * and zoomed and refused to select.
 */
test("clicking a hex selects it", async ({ page }) => {
  await loadReport(page);

  const point = await clearHexPoint(page);
  expect(point, "expected some hex to be clickable, not covered by a panel").not.toBeNull();

  await page.mouse.click(point!.x, point!.y);

  await expect(page.getByRole("button", { name: point!.label })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("clicking a hex also focuses it, so the arrow keys work straight away", async ({ page }) => {
  await loadReport(page);

  const point = await clearHexPoint(page);
  await page.mouse.click(point!.x, point!.y);

  // Without this a player has to tab in past the whole header before a single arrow key does
  // anything, which reads as the keyboard being dead.
  await expect(page.locator("polygon:focus")).toHaveAttribute("aria-label", point!.label);

  await page.locator("polygon:focus").press("ArrowUp");
  await expect(page.locator("polygon:focus")).not.toHaveAttribute("aria-label", point!.label);
});

test("a drag that ends over a hex pans without selecting it", async ({ page }) => {
  await loadReport(page);

  const point = await clearHexPoint(page);
  const before = await page
    .getByRole("button", { name: point!.label })
    .getAttribute("aria-pressed");

  await page.mouse.move(point!.x, point!.y);
  await page.mouse.down();
  await page.mouse.move(point!.x + 90, point!.y + 60, { steps: 8 });
  await page.mouse.up();

  // Panning and selecting share the same gesture up to the point where the pointer moves, so a
  // drag that happens to finish over a hex must not also pick it.
  await expect(page.getByRole("button", { name: point!.label })).toHaveAttribute(
    "aria-pressed",
    before ?? "false"
  );
});

/**
 * A pan is a hand on the map, not a selection gesture. The browser does not know that: a drag
 * whose pointer crosses a pane starts native text selection there, and by the end of the pan the
 * whole window read as selected and stayed that way until the next click.
 *
 * Only WebKit - the engine the desktop shell actually runs in - anchors a selection on the SVG
 * and exhibits the bug; this Chromium suite never selects, so the outcome assertion at the end is
 * vacuous here (it was verified red under a webkit-engine run before the fix). What keeps this
 * test honest in Chromium is the pair in the middle: selection is switched off for the document
 * exactly while the pointer is down, and switched back on the moment it is released.
 */
test("a drag that crosses a pane does not select its text", async ({ page }) => {
  await loadReport(page);

  const point = await clearHexPoint(page);
  const pane = await page.getByTestId("panel-region").boundingBox();
  expect(pane, "the region pane must be on screen to drag across").not.toBeNull();

  await page.mouse.move(point!.x, point!.y);
  await page.mouse.down();
  // Through the middle of the region pane's text, the way a real pan wanders over it.
  await page.mouse.move(pane!.x + pane!.width / 2, pane!.y + pane!.height / 2, { steps: 12 });
  expect(await page.evaluate(() => document.body.style.userSelect)).toBe("none");
  await page.mouse.up();
  expect(await page.evaluate(() => document.body.style.userSelect)).toBe("");

  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected).toBe("");
});

/**
 * The other direction of the same gesture: a selection that STARTS in a pane may sweep the whole
 * pane, but must stop at its edge - dragging on past it used to mark every pane and the map too,
 * because nothing told the browser the panes are islands.
 */
test("a selection dragged out of a pane stays inside it", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");

  const pane = await page.getByTestId("panel-region").boundingBox();
  const point = await clearHexPoint(page);

  // Anchor in the pane's text, then drag well past its edge onto open map.
  await page.mouse.move(pane!.x + 12, pane!.y + 40);
  await page.mouse.down();
  await page.mouse.move(point!.x, point!.y, { steps: 12 });
  await page.mouse.up();

  const verdict = await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return { selected: false, contained: true };
    }
    const paneNode = document.querySelector('[data-testid="panel-region"]');
    return {
      selected: selection.toString().length > 0,
      contained:
        paneNode !== null &&
        paneNode.contains(selection.anchorNode) &&
        paneNode.contains(selection.focusNode)
    };
  });
  // Marking the whole pane is fine; marking anything beyond it is the bug.
  expect(verdict.selected).toBe(true);
  expect(verdict.contained).toBe(true);
});

/** The control for the test above: killing selection during a pan must not kill it in the panes. */
test("text in a pane can still be selected by dragging inside it", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");

  const pane = await page.getByTestId("panel-region").boundingBox();
  await page.mouse.move(pane!.x + 12, pane!.y + 40);
  await page.mouse.down();
  await page.mouse.move(pane!.x + pane!.width - 12, pane!.y + pane!.height - 12, { steps: 8 });
  await page.mouse.up();

  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selected).not.toBe("");
});

test("the focus ring does not appear after a drag", async ({ page }) => {
  await loadReport(page);

  const point = await clearHexPoint(page);
  await page.mouse.move(point!.x, point!.y);
  await page.mouse.down();
  await page.mouse.move(point!.x + 90, point!.y + 60, { steps: 8 });
  await page.mouse.up();

  // Panning must not leave a focus ring on the hex the drag started from.
  await expect(page.getByTestId("map-focus-ring")).not.toBeAttached();
});

test("the focused hex is visibly marked, so arrowing about is not invisible", async ({ page }) => {
  await loadReport(page);

  const point = await clearHexPoint(page);
  await page.mouse.click(point!.x, point!.y);

  // Styling the hex with focus-visible was not enough: that pseudo-class does not apply after a
  // mouse click, so every arrow key moved a focus ring that was never drawn and the keyboard
  // looked dead.
  const ring = page.getByTestId("map-focus-ring");
  await expect(ring).toBeAttached();
  const before = await ring.getAttribute("transform");

  await page.locator("polygon:focus").press("ArrowUp");
  await expect(ring).not.toHaveAttribute("transform", before ?? "");
});

test("the keyboard cursor crosses unexplored ground between known hexes", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  // Unexplored hexes are one patterned rectangle, so there is no element out there to focus. The
  // cursor still has to cross them: two islands of visited ground with unvisited hexes between
  // them are otherwise unreachable from one another, and half the map cannot be walked at all.
  const seen: string[] = [];
  for (let step = 0; step < 6; step += 1) {
    await page.locator("polygon:focus").press("ArrowRight");
    seen.push((await page.locator("polygon:focus").getAttribute("aria-label")) ?? "");
  }

  // It leaves the hexes the report describes and keeps going.
  expect(seen.some((label) => label.startsWith("unexplored "))).toBe(true);
  // And it is still somewhere: focus never falls off the map onto the body.
  expect(seen[seen.length - 1]).not.toBe("");
});

test("standing on unexplored ground selects nothing, and the way back still works", async ({
  page
}) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await expect(page.getByRole("button", { name: "hex 1:7,53" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // North of Inholm twice is ground this turn says nothing about.
  await page.locator("polygon:focus").press("ArrowUp");
  await page.locator("polygon:focus").press("ArrowUp");
  const away = await page.locator("polygon:focus").getAttribute("aria-label");
  expect(away).toMatch(/^unexplored /);

  // Enter on empty ground is a no-op rather than an error: there is nothing there to inspect.
  await page.locator("polygon:focus").press("Enter");
  await expect(page.getByRole("button", { name: "hex 1:7,53" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // Down twice returns to where it started, because each arrow undoes its opposite.
  await page.locator("polygon:focus").press("ArrowDown");
  await page.locator("polygon:focus").press("ArrowDown");
  await expect(page.locator("polygon:focus")).toHaveAttribute("aria-label", "hex 1:7,53");
});

test("the unexplored lattice keeps a constant hairline at every zoom", async ({ page }) => {
  await loadReport(page);

  const measure = () =>
    page.evaluate(() => {
      const path = document.querySelector("#fog-lattice path")!;
      const svg = document.querySelector('[data-testid="map-canvas"] svg')!;
      const scale = Number(getComputedStyle(svg).getPropertyValue("--map-scale"));
      // The pattern is drawn under the world transform, so a stroke of 1/scale user units is
      // exactly one pixel on screen. Anything that fails to resolve falls back to 1 user unit and
      // the lattice thickens as the map is zoomed in.
      return parseFloat(getComputedStyle(path).strokeWidth) * scale;
    });

  const atRest = await measure();
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  const zoomedIn = await measure();
  for (let step = 0; step < 8; step += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }
  const zoomedOut = await measure();

  expect(atRest).toBeCloseTo(1, 3);
  expect(zoomedIn).toBeCloseTo(1, 3);
  expect(zoomedOut).toBeCloseTo(1, 3);
});
