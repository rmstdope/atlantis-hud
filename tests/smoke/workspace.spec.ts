import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readReport } from "@atlantis/fixtures";
import {
  boxOf,
  clearGames,
  createGame,
  expectOrders,
  expectOrdersNot,
  fillOrders,
  loadReport,
  ordersInput,
  ordersText,
  selectHex,
  selectUnit,
  visibleStrip,
  waitForStableBox,
  waitForStableHeight
} from "./gameSetup";
// The real constant, not a copy of it: this test exists to catch the rendered height and the
// windowing arithmetic drifting apart, which a hard-coded 22 here would hide.
import { ROW_HEIGHT } from "../../packages/shared/src/unitTable";
// Likewise the hover delay: the test waits a fraction of it, so a copy here could outlive a change.
import { HOVER_DELAY_MS } from "../../packages/shared/src/unitTooltip";
// The seam itself, not a copy: the header budget below is only worth anything if it fails for the
// same arithmetic the orders drag actually uses (ah-csni).
import { railHasRoomToDrag, railRemFor } from "../../packages/shared/src/workspace/panelLayout";

/**
 * Walks the workspace on a real turn report, in whichever shell the project targets.
 *
 * The two shells render the same components, so the same walk has to hold for both. Anything that
 * passes here for the web and fails for the desktop is a divergence, which is exactly the failure
 * this suite exists to catch.
 */
const REPORT = readReport("g7f95t71");
/**
 * Another faction, and an older turn - gh-208: age outranks ownership, so this is now stored for
 * history rather than offered as a switch or a merge.
 */
const OTHER_FACTION_OLDER = readReport("g8f73t2");
/**
 * Another faction, same turn: the one case a merge is offered for, and (since it is not older) also
 * the fixture used to prove switching and cancelling still work on the foreign-report prompt.
 */
const ALLY_REPORT = readReport("g8f73t71");
/** The player's own faction, one turn back - gh-208's plain case: stored for history, not shown. */
const OWN_OLDER_REPORT = readReport("g7f95t70");

/**
 * Three real, consecutive turns of one faction (game 3, faction 42), used to prove a route can
 * cross ground only an earlier turn described. Faction 95's fixtures cannot show this: its land
 * holdings are ocean-separated islands, so every route over them stays one step regardless of what
 * is remembered - see `crates/core/tests/movement_plan.rs` for the reading that ruled it out.
 */
const F42_T40 = readReport("g3f42t40");
const F42_T41 = readReport("g3f42t41");
const F42_T42 = readReport("g3f42t42");
/**
 * The same faction forty turns on, used together with `F42_T42` for the Trade chip walk (ah-1j5.2):
 * the turn-71 fixture every other walk in this file uses has no trade routes at all, which is
 * exactly why the chip must still be visible at zero.
 */
const F42_T82 = readReport("g3f42t82");
/** Faction 21's turn 24: Raft [235] in the plain at (36,44), with a passenger aboard (ah-048). */
const F21_T24 = readReport("g5f21t24");

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
 * gh-208: an older report of the player's *own* faction is stored for history and never shown -
 * issue #47's confirm-and-switch dialog is gone.
 *
 * Kept on its own fixture rather than reusing faction 73's turn 2, which is also another faction
 * and proves the same rule applies there too, in the test below.
 */
test("an older own report is stored for history, not shown", async ({ page }) => {
  await loadReport(page);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);

  // No native dialog and no foreign-report prompt - either would mean the old behaviour survived.
  let dialogSeen = false;
  page.on("dialog", (dialog) => {
    dialogSeen = true;
    void dialog.dismiss();
  });

  await choose(page, "turn-70.rep", OWN_OLDER_REPORT);

  const status = page.getByTestId("import-status");
  await expect(status).toContainText("stored for history");
  // The status line earns its room back for a message worth reading - see "the header keeps quiet
  // about routine state" - and this one is worth reading precisely because nothing moved on screen.
  await expect.poll(async () => (await status.boundingBox())?.width ?? 0).toBeGreaterThan(1);
  expect(dialogSeen).toBe(false);
  await expect(page.getByTestId("foreign-report-prompt")).toHaveCount(0);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);
  await expect(page.getByTestId("app-header")).toContainText("Borg TNG (95)");

  // The one observable proof the commit really landed: turn 70 now shows up in the turn picker,
  // even though it never touched the screen.
  await page.getByTestId("turn-chip").click();
  await expect(page.getByTestId("turn-picker")).toBeVisible();
  await expect(page.getByTestId("turn-row-71")).toContainText("playing");
  await expect(page.getByTestId("turn-row-70")).toBeVisible();
});

/**
 * gh-208: age outranks ownership - an older report from *another* faction is stored the same way,
 * and never reaches the foreign-report prompt at all.
 */
test("an older foreign report is stored for history too, not shown", async ({ page }) => {
  await loadReport(page);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);

  await choose(page, "turn-2.rep", OTHER_FACTION_OLDER);

  await expect(page.getByTestId("import-status")).toContainText("stored for history");
  await expect(page.getByTestId("foreign-report-prompt")).toHaveCount(0);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);
  await expect(page.getByTestId("app-header")).toContainText("Borg TNG (95)");
});

test("a report from another faction can be turned away", async ({ page }) => {
  await loadReport(page);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);

  await choose(page, "turn-71-f73.rep", ALLY_REPORT);

  const prompt = page.getByTestId("foreign-report-prompt");
  await expect(prompt).toBeVisible();
  await expect(page.getByTestId("foreign-report-merge")).toBeVisible();

  await page.getByTestId("foreign-report-cancel").click();

  await expect(prompt).toHaveCount(0);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);
  await expect(page.getByTestId("app-header")).toContainText("Borg TNG (95)");
});

test("a report from another faction can take over the workspace", async ({ page }) => {
  await loadReport(page);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);

  await choose(page, "turn-71-f73.rep", ALLY_REPORT);
  await page.getByTestId("foreign-report-switch").click();

  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);
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
  // a merge is worth a glance: the line takes room, as stored-for-history does at :150
  await expect
    .poll(async () => (await page.getByTestId("import-status").boundingBox())?.width ?? 0)
    .toBeGreaterThan(1);

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

/**
 * gh-204 / ah-470: an orders file, recognised by its `#atlantis` header, imports through the same
 * Import target a report does - confirmed first, applied as a full overwrite, with a summary
 * dialog when the file leaves diagnostics behind.
 *
 * Faction 95's own template presets real orders on several units (`13401`'s `@prepare staf` among
 * them), so an import naming only `18642` always has something of substance to overwrite - the
 * confirm prompt's overwrite sentence is asserted for its presence, not for an exact count that
 * would make this test fragile to the fixture's own contents.
 */
const ORDERS_IMPORT_WITH_ERROR = [
  '#atlantis 95 "smoke"',
  "",
  "unit 18642",
  "@study obse",
  "WROK",
  "",
  "#end"
].join("\n");

const ORDERS_IMPORT_CLEAN = [
  '#atlantis 95 "smoke"',
  "",
  "unit 18642",
  "@study obse",
  "",
  "#end"
].join("\n");

/** Well-formed, but for a faction that is not the one loaded. */
const ORDERS_IMPORT_WRONG_FACTION = [
  '#atlantis 73 "smoke"',
  "",
  "unit 99999",
  "@work",
  "",
  "#end"
].join("\n");

test("an orders file imports through the confirm prompt", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  await choose(page, "orders-turn-71.txt", ORDERS_IMPORT_WITH_ERROR);

  const prompt = page.getByTestId("orders-import-prompt");
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("orders-turn-71.txt");
  await expect(prompt).toContainText("Orders for 1 unit of Borg TNG (95), turn 71.");
  await expect(prompt).toContainText("This replaces all current orders for this turn");

  await page.getByTestId("orders-import-replace").click();
  await expect(prompt).toHaveCount(0);

  // The deliberately broken line raises the summary dialog rather than the status line - closed
  // before touching anything else, since it sits over the whole workspace while it is up.
  const summary = page.getByTestId("orders-import-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("1 unit replaced");
  await expect(summary).toContainText("1 error");
  await expect(summary).toContainText("unit 18642: unknown order command: WROK");
  await page.getByTestId("orders-import-summary-close").click();
  await expect(summary).toHaveCount(0);

  // The editor shows what the file specified for the unit, through the same document the typing
  // path writes.
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await expectOrders(page, /@study obse/);
  await expectOrders(page, /WROK/);
});

test("cancel and a wrong faction change nothing, and a plain report still imports", async ({
  page
}) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "@study obse");

  // A file naming another faction is refused, both factions named, and nothing about the editor
  // moves.
  await choose(page, "orders-turn-71-wrong-faction.txt", ORDERS_IMPORT_WRONG_FACTION);
  await expect(page.getByTestId("orders-import-prompt")).toHaveCount(0);
  await expect(page.getByTestId("import-status")).toContainText("faction 73");
  await expect(page.getByTestId("import-status")).toContainText("Borg TNG (95)");
  await expectOrders(page, /@study obse/);

  // A well-formed file for the right faction asks first, and Cancel leaves the editor untouched.
  await choose(page, "orders-turn-71.txt", ORDERS_IMPORT_CLEAN);
  const prompt = page.getByTestId("orders-import-prompt");
  await expect(prompt).toBeVisible();
  await page.getByTestId("orders-import-cancel").click();
  await expect(prompt).toHaveCount(0);
  await expectOrders(page, /@study obse/);

  // The sniff must not eat a report: a foreign report still reaches the foreign-report prompt.
  // Same turn as what is loaded (gh-208 / ah-kc7 store an *older* one for history instead of
  // asking at all, which OTHER_FACTION_OLDER now would) - ALLY_REPORT is the fixture other tests
  // in this file already use for the plain foreign-report ask.
  await choose(page, "turn-71-f73.rep", ALLY_REPORT);
  await expect(page.getByTestId("foreign-report-prompt")).toBeVisible();
  await expect(page.getByTestId("orders-import-prompt")).toHaveCount(0);
});

/**
 * ah-vp3.2: everything the report says about the faction as a whole, read from the header.
 */
test("the faction chip opens the faction view", async ({ page }) => {
  await loadReport(page);

  const chip = page.getByTestId("faction-chip");
  await expect(chip).toContainText("Borg TNG (95)");
  await chip.click();

  const panel = page.getByTestId("faction-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Magic 5");
  await expect(panel).toContainText("6038");
  await expect(panel).toContainText(/Regions.*0.*\/.*0/u);
  await expect(panel).toContainText(/Mages.*6.*\/.*6/u);
  await expect(panel).toContainText(/Apprentices.*15.*\/.*15/u);
  await expect(panel).toContainText("default Unfriendly");
  await expect(panel).toContainText("Fon (8)");
});

test("the faction view closes on Escape", async ({ page }) => {
  await loadReport(page);

  await page.getByTestId("faction-chip").click();
  await expect(page.getByTestId("faction-panel")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByTestId("faction-panel")).toHaveCount(0);
});

test("the faction view closes on an outside press", async ({ page }) => {
  await loadReport(page);

  await page.getByTestId("faction-chip").click();
  await expect(page.getByTestId("faction-panel")).toBeVisible();

  await page.mouse.click(10, 10);

  await expect(page.getByTestId("faction-panel")).toHaveCount(0);
});

test("a merged ally is marked in the attitude list", async ({ page }) => {
  await loadReport(page);
  await choose(page, "turn-71-f73.rep", ALLY_REPORT);
  await page.getByTestId("foreign-report-merge").click();
  await expect(page.getByTestId("merged-factions-chip")).toContainText("+1 merged");

  await page.getByTestId("faction-chip").click();
  const panel = page.getByTestId("faction-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("faction-attitude-name-73")).toContainText("⌂");
});

test("the faction view survives a reload", async ({ page }) => {
  await loadReport(page);

  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");

  await page.getByTestId("faction-chip").click();
  const panel = page.getByTestId("faction-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("6038");
});

/**
 * The header says things once. The platform tag repeated what the About tab says, the routine
 * import status repeated what the Turn chip says, and the load button carried an ellipsis. The
 * status line stays in the page - tests and screen readers key on its text - but it only takes up
 * room when it has something to say: an import that failed, or one that worked with a warning.
 */
test("the header keeps quiet about routine state", async ({ page }) => {
  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();
  // The platform tag is the About tab's business, on the gate screen as in the workspace.
  await expect(page.locator("header")).not.toContainText(/web|desktop/u);

  await loadReport(page);
  await expect(page.getByTestId("app-header")).not.toContainText(/web|desktop/u);
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();

  // Loaded and well: the status is out of sight, its text still present for whoever asks.
  const status = page.getByTestId("import-status");
  await expect(status).toContainText("11 regions");
  const quiet = await status.boundingBox();
  expect(quiet === null || quiet.width <= 1).toBe(true);

  // Something going wrong is the moment the line earns its room back. Junk names no faction, so
  // it is refused outright (ah-brd) - a red status, and the loaded turn stays exactly as it was.
  await page.setInputFiles('input[type="file"]', {
    name: "junk.rep",
    mimeType: "text/plain",
    buffer: Buffer.from("this is not a report", "utf8")
  });
  await expect(status).toContainText("could not read junk.rep: the report does not name its faction");
  await expect.poll(async () => (await status.boundingBox())?.width ?? 0).toBeGreaterThan(1);

  // The turn that was on screen before the junk drop is still there - nothing was replaced.
  await expect(page.getByTestId("app-header")).toContainText("Borg TNG (95)");
  await expect(page.getByTestId("app-header")).toContainText("71");
});

/**
 * A whole run of turns, and an ally's account of them, in one action.
 *
 * The point of the batch: the files are handed over in the order a file dialog happens to list
 * them, and the application sorts them out from the turn in each header. Chosen deliberately
 * out of order here, and with the ally's turn 2 among them, so a shell that simply imported the
 * last file - which is what it used to do - could not pass.
 */
test("imports a run of turns and an ally's report in one action", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Batch game");
  await expect(page.getByTestId("app-header")).toBeVisible();

  await page.setInputFiles('input[type="file"]', [
    { name: "f73-t71.rep", mimeType: "text/plain", buffer: Buffer.from(ALLY_REPORT, "utf8") },
    { name: "f95-t71.rep", mimeType: "text/plain", buffer: Buffer.from(REPORT, "utf8") },
    { name: "f95-t70.rep", mimeType: "text/plain", buffer: Buffer.from(OWN_OLDER_REPORT, "utf8") }
  ]);

  // Neither question a report can raise: a batch of an obvious shape decides everything itself.
  await expect(page.getByTestId("foreign-report-prompt")).toHaveCount(0);
  await expect(page.getByTestId("viewer-faction-prompt")).toHaveCount(0);

  const dialog = page.getByTestId("import-summary");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Imported 2 turns for Borg TNG (95)");
  await expect(dialog).toContainText("merged 1 allied report");
  // Sorted by the turn in each header, not by the order they were handed over.
  await expect(dialog).toContainText("f95-t70.rep — imported as turn 70");
  await expect(dialog).toContainText("f95-t71.rep — imported as turn 71");
  await expect(dialog).toContainText("f73-t71.rep — merged into turn 71");

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  // The newest own turn is what is left on screen, and the ally of that turn is on the chip.
  await expect(page.getByTestId("app-header")).toContainText("Borg TNG (95)");
  await expect(page.getByTestId("app-header")).toContainText("71");
  await expect(page.getByTestId("merged-factions-chip")).toContainText("1 merged");

  /*
    The ally's units are still in a hex both factions stood in.

    (10,50) is the one region of turn 71 that appears in both reports, which makes it the only
    place a batch can lose a merge without losing the chip that claims it: putting the final turn
    on screen must not re-commit it, because committing rewrites that turn's sightings from the
    own report alone and an ally's contribution to a shared hex would go with them. A hex only the
    ally saw would survive that and prove nothing.
  */
  await selectHex(page, "1:10,50");
  // Through the filter rather than by reading the whole pane: the table is windowed, so a unit
  // only renders while it is scrolled into view, and whether the nineteenth row of this hex
  // happens to fit is a fact about the pane's height and row height, not about the merge. It did
  // fit until ah-v09e took the rows from 22px to 24px. Filtering asks the question the test means.
  const unitsFilter = page.getByTestId("panel-units").getByLabel("Filter units");
  for (const unit of ["Swamp Watch", "Tower Guard"]) {
    await unitsFilter.fill(unit);
    await expect(page.getByTestId("panel-units")).toContainText(unit);
  }
  await unitsFilter.fill("");
});

/** Two of your own turns stored, 71 left on screen as the working turn - ah-jg6.3's setup. */
async function loadTwoTurns(page: Page) {
  await clearGames(page);
  await createGame(page, "Compare game");
  await expect(page.getByTestId("app-header")).toBeVisible();

  await page.setInputFiles('input[type="file"]', [
    { name: "f95-t71.rep", mimeType: "text/plain", buffer: Buffer.from(REPORT, "utf8") },
    { name: "f95-t70.rep", mimeType: "text/plain", buffer: Buffer.from(OWN_OLDER_REPORT, "utf8") }
  ]);

  const dialog = page.getByTestId("import-summary");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);
}

test("a second turn can be compared and dismissed", async ({ page }) => {
  await loadTwoTurns(page);

  await page.getByTestId("turn-chip").click();
  await expect(page.getByTestId("turn-picker")).toBeVisible();
  await expect(page.getByTestId("turn-row-71")).toContainText("playing");
  await expect(page.getByTestId("turn-row-70")).toBeVisible();

  await page.getByTestId("turn-row-70").click();

  await expect(page.getByTestId("app-header")).toContainText("⇄ 70");
  // The working turn is still 71, undisturbed: the faction and selection surfaces answer for it.
  await expect(page.getByTestId("app-header")).toContainText("Borg TNG (95)");
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");

  await page.getByRole("button", { name: "stop comparing" }).click();
  await expect(page.getByTestId("app-header")).not.toContainText("⇄");
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);
});

/**
 * ah-jg6.4's surface: what changed between the working turn and a compared one, from the
 * Changes chip that appears only once a comparison is on.
 */
test("the changes dialog reads a real pair", async ({ page }) => {
  await loadTwoTurns(page);

  await expect(page.getByTestId("changes-chip")).toHaveCount(0);

  await page.getByTestId("turn-chip").click();
  await page.getByTestId("turn-row-70").click();
  await expect(page.getByTestId("changes-chip")).toBeVisible();

  await page.getByTestId("changes-chip").click();
  const dialog = page.getByTestId("changes-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("70");
  await expect(dialog).toContainText("71");

  // The two fixtures genuinely differ, so the Units tab carries a non-zero count.
  const unitsTab = page.getByTestId("changes-tab-units");
  await expect(unitsTab).not.toContainText("· 0");
});

test("the changes dialog closes on Escape", async ({ page }) => {
  await loadTwoTurns(page);

  await page.getByTestId("turn-chip").click();
  await page.getByTestId("turn-row-70").click();
  await page.getByTestId("changes-chip").click();
  await expect(page.getByTestId("changes-dialog")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByTestId("changes-dialog")).toHaveCount(0);
});

test("clicking a changed unit selects it and closes the dialog", async ({ page }) => {
  await loadTwoTurns(page);

  await page.getByTestId("turn-chip").click();
  await page.getByTestId("turn-row-70").click();
  await page.getByTestId("changes-chip").click();
  await expect(page.getByTestId("changes-dialog")).toBeVisible();

  const firstUnitRow = page.locator('[data-testid^="changes-unit-"]').first();
  await expect(firstUnitRow).toBeVisible();
  await firstUnitRow.click();

  await expect(page.getByTestId("changes-dialog")).toHaveCount(0);
  await expect(page.getByTestId("panel-region")).toBeVisible();
});

test("comparing does not disturb the working turn's orders", async ({ page }) => {
  await loadTwoTurns(page);

  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "@work");
  await expectOrders(page, /^@work\n?$/u);
  await expect(page.getByTestId("orders-status")).toContainText(/saved \d/u, { timeout: 20_000 });

  await page.getByTestId("turn-chip").click();
  await page.getByTestId("turn-row-70").click();
  await expect(page.getByTestId("app-header")).toContainText("⇄ 70");
  await page.getByRole("button", { name: "stop comparing" }).click();

  await page.reload();
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await expectOrders(page, /^@work\n?$/u);
});

/**
 * Two of your turns and two of an ally's, with nothing on screen: the headers tie on every measure
 * there is, and guessing wrong would import the ally's turns as yours.
 */
test("asks which faction is yours when the batch cannot say", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Ambiguous game");
  await expect(page.getByTestId("app-header")).toBeVisible();

  await page.setInputFiles('input[type="file"]', [
    { name: "f73-t71.rep", mimeType: "text/plain", buffer: Buffer.from(ALLY_REPORT, "utf8") },
    { name: "f95-t71.rep", mimeType: "text/plain", buffer: Buffer.from(REPORT, "utf8") },
    { name: "f73-t2.rep", mimeType: "text/plain", buffer: Buffer.from(OTHER_FACTION_OLDER, "utf8") },
    { name: "f95-t70.rep", mimeType: "text/plain", buffer: Buffer.from(OWN_OLDER_REPORT, "utf8") }
  ]);

  const question = page.getByTestId("viewer-faction-prompt");
  await expect(question).toBeVisible();
  await expect(question).toContainText("equally well");
  // Nothing is written until it is answered: no summary, and no turn on the header.
  await expect(page.getByTestId("import-summary")).toHaveCount(0);

  await question.getByRole("button", { name: "Borg TNG (95)" }).click();

  const dialog = page.getByTestId("import-summary");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Imported 2 turns for Borg TNG (95)");
  await expect(dialog).toContainText("merged 2 allied reports");
  // An ally's account of a turn you never played still fills in ground you have not stood on.
  await expect(dialog).toContainText("f73-t2.rep — merged into turn 2");

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("app-header")).toContainText("Borg TNG (95)");
  await expect(page.getByTestId("app-header")).toContainText("71");
});

/** One file is still one file: the question that guards a change of faction has not moved. */
test("a single ally report still asks before it changes anything", async ({ page }) => {
  await loadReport(page);

  await choose(page, "ally.rep", ALLY_REPORT);

  await expect(page.getByTestId("foreign-report-prompt")).toBeVisible();
  await expect(page.getByTestId("import-summary")).toHaveCount(0);
});

/**
 * Three exports behind one button.
 *
 * They were two header buttons of their own, which spent a permanent quarter of the toolbar on a
 * pair of things a player does once a turn. One button that expands is the same three exports one
 * press further away, and the header keeps the room for what is read every minute.
 */
test("the export button expands into the orders and map exports", async ({ page }) => {
  await loadReport(page);

  // Nothing is on the header until it is asked for: the point of the menu.
  await expect(page.getByTestId("export-orders")).toHaveCount(0);
  await expect(page.getByTestId("export-orders-long")).toHaveCount(0);
  await expect(page.getByTestId("export-map")).toHaveCount(0);

  const trigger = page.getByTestId("export-menu");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();

  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("export-orders")).toBeVisible();
  await expect(page.getByTestId("export-orders-long")).toBeVisible();
  await expect(page.getByTestId("export-map")).toBeVisible();

  // Closes the way every other panel hanging off this header closes.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("export-map")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  await page.getByTestId("map-canvas").click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("export-map")).toHaveCount(0);
});

test("choosing an export from the menu closes it behind the choice", async ({ page }) => {
  await loadReport(page);

  await page.getByTestId("export-menu").click();
  await page.getByTestId("export-map").click();

  await expect(page.getByTestId("map-export-panel")).toBeVisible();
  // A menu left standing over the dialog it opened is a menu covering the thing it asked for.
  await expect(page.getByTestId("export-map")).toHaveCount(0);
});

test("the export menu offers nothing to press before a report is loaded", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Empty game");

  await page.getByTestId("export-menu").click();

  // All three exports need a turn: orders are written against one and a map describes one.
  await expect(page.getByTestId("export-orders")).toBeDisabled();
  await expect(page.getByTestId("export-orders-long")).toBeDisabled();
  await expect(page.getByTestId("export-map")).toBeDisabled();
});

/**
 * The unit descriptions the server wrote into the template, put back into the exported file.
 *
 * The plain export stays exactly what it always was - that is issue #37's whole point - so the
 * one thing worth proving end to end is that the second button adds them and the first still
 * does not.
 */
test("exports the orders with the unit descriptions", async ({ page }, testInfo) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "@study obse");
  await expectOrders(page, /^@study obse\n?$/u);

  await page.getByTestId("export-menu").click();
  const downloadingLong = page.waitForEvent("download");
  await page.getByTestId("export-orders-long").click();
  const long = await downloadingLong;
  const longPath = testInfo.outputPath("orders-long.txt");
  await long.saveAs(longPath);
  const longText = readFileSync(longPath, "utf8");

  // The one description line that matters, not the whole file - the export also carries the
  // faction password and this must never print or assert against it.
  expect(longText).toContain("Seven of Eight (18642)");

  await page.getByTestId("export-menu").click();
  const downloadingPlain = page.waitForEvent("download");
  await page.getByTestId("export-orders").click();
  const plain = await downloadingPlain;
  const plainPath = testInfo.outputPath("orders-plain.txt");
  await plain.saveAs(plainPath);
  const plainText = readFileSync(plainPath, "utf8");

  expect(plainText).not.toContain("Seven of Eight (18642)");
});

/** What merging must leave alone: the turn on screen has not changed, so nothing else may move. */
test("merging leaves the orders and the selection where they were", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");

  await fillOrders(page, "@study obse\n@work");
  // The trailing newline is optional on purpose: the editor appends one the moment an autosave
  // lands, and whether that has happened yet is a race this test has no business betting on.
  await expectOrders(page, /^@study obse\n@work\n?$/u);

  await choose(page, "turn-71-f73.rep", ALLY_REPORT);
  await page.getByTestId("foreign-report-merge").click();
  await expect(page.getByTestId("import-status")).toContainText("merged");

  // With the trailing newline the editor appends once a draft is saved - merging flushes the
  // draft on its way in, so the save has landed by the time the merge reports done. The words
  // themselves are what merging must not move.
  await expectOrders(page, /^@study obse\n@work\n$/u);
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

  await expect(page.getByTestId("orders-input")).toBeVisible();
  await expectOrders(page, /@study obse/);

  // The server's own description of the unit is not an order and does not belong in the editor.
  // The unit panel above already says all of it.
  await expectOrdersNot(page, /Seven of Eight/);
  await expectOrdersNot(page, /;/);
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

  const before = (await ordersText(page)).trimEnd();

  const orders = ordersInput(page);
  await orders.click();
  // The caret goes to the very end deterministically: select-all then ArrowRight collapses the
  // selection to the end of the document, the same way on every platform this suite runs on.
  await orders.press("ControlOrMeta+a");
  await orders.press("ArrowRight");
  await orders.press("Enter");
  await orders.pressSequentially("@work");

  await expect.poll(() => ordersText(page)).toBe(`${before}\n@work`);
});

test("a bad order names itself, and belongs to the unit that carries it", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  await fillOrders(page, "@study obse\nWROK");

  const problems = page.getByTestId("orders-diagnostics");
  await expect(problems).toContainText("unknown order command: WROK");
  // ah-uia: severity reads as a glyph now, not as the colour of the message alone.
  await expect(problems).toContainText("✕");
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

/**
 * The checks that read the report, end to end (#82).
 *
 * Worth a smoke test rather than leaving it to the Rust suite: this is the one place where the
 * shell, the wasm binding, the cached parse and the panels all have to agree about a finding that
 * has no line to sit on. A unit-level check would pass with the report never reaching the core.
 */
test("a unit told to spend silver it has not got is warned about, without blocking export", async ({
  page
}) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // Nine figures is beyond any holding or income in the game, so this is short whatever the
  // optimistic estimates allow. Unit 0 discards the gift rather than naming a real target (ah-djq's
  // "give-target-not-here" fires on a target the report cannot place, which this test is not about
  // and would otherwise add a second problem here).
  await fillOrders(page, "GIVE 0 999999999 SILV");

  // Every unit in this faction shares its purse, so the shortfall is the hex's rather than one
  // unit's - and the region panel is where a finding with no unit and no line belongs.
  const problems = page.getByTestId("region-problems");
  await expect(problems).toContainText("short");
  await expect(problems).toContainText("the units in this hex");

  // A warning, never an error: the server would accept this file, the turn would just go badly.
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");
  await page.getByTestId("export-menu").click();
  await expect(page.getByTestId("export-orders")).toBeEnabled();
  await page.keyboard.press("Escape");

  // And the whole map is counted, so the same problem is reachable from the header. The turn-71
  // report carries eight findings of its own throughout - Six of Two (13402) is already at combat
  // 5, the ruleset's maximum, and still orders "@study comb" (ah-1uj); four mages in a different
  // hex CAST an enchant with no plate armor on hand (ah-dbb.2); and six Borg mages study force or
  // pattern above level 2 aboard a Cloudship, which seats no mages (ah-a2k.2). Since ah-dwk6 there
  // are two more: units 14451 and 13432 are given no orders at all (unit-does-nothing), and this
  // test's own unit is a third, since a lone GIVE spends none of its month. Ten baseline plus the
  // two this test introduces on its own unit.
  const chip = page.getByTestId("problems-chip");
  await expect(chip).toContainText("12 problems");
  await chip.click();
  await expect(page.getByTestId("problems-panel")).toContainText("mountain (7,53)");
  await expect(page.getByTestId("problem-entry").first()).toContainText("⚠");

  // Corrected, this hex's problems go away - "@work" both covers the shortfall and spends the
  // month - leaving only the turn's ten baseline findings elsewhere.
  await fillOrders(page, "@work");
  await expect(page.getByTestId("region-problems")).toHaveCount(0);
  await expect(page.getByTestId("problems-chip")).toContainText("10 problems");
});

/**
 * The toggle from issue ah-f8u: a hex carrying several diagnostics pushes the region facts down
 * out of view, so a chip in the panel header hides the Problems section without losing track of
 * how many are put away.
 *
 * Two distinct hex-level findings on the same hex, so "several diagnostics" is genuine rather
 * than one message repeated: the shared-purse overspend from the test above, plus "nobody is
 * guarding this hex" - off by default, turned on here through Settings, and true of every hex the
 * faction stands in on the committed turn-71 report.
 */
async function warnAboutUnguardedHexes(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-tab-warnings").click();
  await page.getByTestId("settings-warning-hex-unguarded").check();
  await page.keyboard.press("Escape");
}

/**
 * Turns `unit-does-nothing` (ah-dwk6) off.
 *
 * It is on by default and is right about the fixtures below - a unit given a single GIVE, or a
 * line that does not parse, has no order that spends its month - but it is an extra finding in
 * tests that are counting a specific pair of them or reading one editor's diagnostics. The check
 * has its own coverage in the Rust suite and its own toggle test above.
 */
async function silenceIdleUnits(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-tab-warnings").click();
  await page.getByTestId("settings-warning-unit-does-nothing").uncheck();
  await page.keyboard.press("Escape");
}

test("hiding the problems brings the region facts to the top", async ({ page }) => {
  await loadReport(page);
  await silenceIdleUnits(page);
  await warnAboutUnguardedHexes(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "GIVE 0 999999999 SILV");

  const chip = page.getByTestId("region-problems-toggle");
  // The label the checkbox sits in, not the whole panel - other numbers live in the region facts.
  const chipLabel = page.locator("label", { has: chip });
  await expect(chip).toBeChecked();
  await expect(chipLabel).toContainText("2");
  await expect(page.getByTestId("region-problems")).toBeVisible();

  await chip.uncheck();

  await expect(page.getByTestId("region-problems")).toHaveCount(0);
  // Still there, and still saying how many are put away.
  await expect(chip).not.toBeChecked();
  await expect(chipLabel).toContainText("2");

  // The region facts moved up to the top of the body: "in Inhead" (the province Inholm sits in)
  // is the first line the Problems section used to sit above. Scoped to the body div rather than
  // the whole panel, whose header carries the chip and title above it.
  const bodyText = await page
    .getByTestId("panel-region")
    .locator("> div")
    .innerText();
  expect(bodyText.trimStart().startsWith("in Inhead")).toBe(true);
});

test("the hidden problems stay hidden across a reload", async ({ page }) => {
  await loadReport(page);
  await warnAboutUnguardedHexes(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "GIVE 0 999999999 SILV");

  await page.getByTestId("region-problems-toggle").uncheck();
  await expect(page.getByTestId("region-problems")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await selectHex(page, "1:7,53");

  await expect(page.getByTestId("region-problems-toggle")).not.toBeChecked();
  await expect(page.getByTestId("region-problems")).toHaveCount(0);
});

/**
 * The Warnings settings tab (ah-m9q.2): off means the core does not produce the finding at all, so
 * the chip and every panel agree the moment the toggle is flipped - not merely hidden client-side.
 * Reuses the shared-purse silver shortfall from above, which is exactly the kind of hex-level
 * finding a client-side filter could not be trusted to catch consistently.
 */
test("a silenced advisory check disappears everywhere at once", async ({ page }) => {
  await loadReport(page);
  await silenceIdleUnits(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "GIVE 0 999999999 SILV");

  // The turn-71 report carries eight findings of its own throughout (unit 13402's
  // study-at-maximum, ah-1uj; the enchant-armor not-enough-items in a different hex, ah-dbb.2;
  // and six magic-study-outside-building for the Borg mages aboard a Cloudship, ah-a2k.2), all
  // unaffected by the not-enough-silver toggle below - the chip counts them alongside the
  // shortfall this test introduces.
  await expect(page.getByTestId("region-problems")).toContainText("short");
  await expect(page.getByTestId("problems-chip")).toContainText("9 problems");

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-tab-warnings").click();
  await page.getByTestId("settings-warning-not-enough-silver").uncheck();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("region-problems")).toHaveCount(0);
  await expect(page.getByTestId("problems-chip")).toContainText("8 problems");

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-tab-warnings").click();
  await page.getByTestId("settings-warning-not-enough-silver").check();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("region-problems")).toContainText("short");
  await expect(page.getByTestId("problems-chip")).toContainText("9 problems");
});

/**
 * The Trade chip (ah-1j5.2) at zero: the turn-71 fixture every other walk in this file uses has no
 * trade routes at all (seven goods for sale, thirteen wanted, no overlap), which is precisely why
 * the chip is shown even then - unlike Problems and Battles, which vanish at zero.
 */
test("the trade chip is shown even with nothing to trade", async ({ page }) => {
  await loadReport(page);

  const chip = page.getByTestId("trade-chip");
  await expect(chip).toContainText("Trade 0");
  await chip.click();
  await expect(page.getByTestId("trade-panel")).toContainText("Nothing to trade yet");
});

/**
 * The Trade chip (ah-1j5.2) with something to trade: two real turns of the same faction give a
 * known map with routes on it - see `crates/core/src/trade.rs::the_whole_known_map_answers` for
 * the same six routes, and the same best one, pinned against the core directly.
 */
test("the trade chip lists routes and flies the map to one", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Trade game");
  await expect(page.getByTestId("app-header")).toBeVisible();

  await page.setInputFiles('input[type="file"]', {
    name: "f42-t42.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(F42_T42, "utf8")
  });
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*42\b/);

  await choose(page, "f42-t82.rep", F42_T82);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*82\b/);

  const chip = page.getByTestId("trade-chip");
  await expect(chip).toContainText("Trade 6");
  await chip.click();
  const panel = page.getByTestId("trade-panel");
  await expect(panel).toBeVisible();
  // The best route first: the reciprocal chocolate/perfume circuit between (36,4) and (0,48),
  // worth $15,598 - the same figure the core's own test pins.
  await expect(panel.getByTestId("trade-route-0")).toContainText("36,4");
  await expect(panel.getByTestId("trade-route-0")).toContainText("0,48");
  await expect(panel.getByTestId("trade-route-0")).toContainText("$15,598");

  await panel.getByTestId("trade-route-0").click();
  await expect(panel).toHaveCount(0);
  // The route starts from (36,4), so that hex - not (0,48) - is what selecting the row lands on.
  await expect(page.getByTestId("panel-region")).toContainText("(36,4)");
});

/**
 * Hovering a route draws it and frames it (ah-60m).
 *
 * The best route in this fixture runs (36,4) to (0,48), most of the way across the map, so one end
 * is always off screen: hovering the row must move the map to hold both, and looking away must put
 * it back exactly. `AppShell` has no unit test - this package's tests have no DOM - so this walk is
 * the only thing that proves the travel and the return.
 */
test("hovering a trade route draws it, frames it, and puts the map back", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Trade arrow game");
  await expect(page.getByTestId("app-header")).toBeVisible();

  await page.setInputFiles('input[type="file"]', {
    name: "f42-t42.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(F42_T42, "utf8")
  });
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*42\b/);
  await choose(page, "f42-t82.rep", F42_T82);
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*82\b/);

  await page.getByTestId("trade-chip").click();
  const panel = page.getByTestId("trade-panel");
  await expect(panel).toBeVisible();

  const world = page.getByTestId("map-world");
  const before = await world.getAttribute("transform");

  await panel.getByTestId("trade-route-0").hover();
  const arrow = page.getByTestId("trade-arrow");
  await expect(arrow).toHaveCount(1);
  // A circuit: chocolate out, perfume back, so the line carries a head at both ends.
  await expect(arrow.locator("line")).toHaveAttribute("marker-start", "url(#trade-arrowhead-start)");
  await expect(world).not.toHaveAttribute("transform", before ?? "");

  // Looking away undoes the whole gesture - the arrow and the view together.
  await page.getByTestId("trade-chip").hover();
  await expect(arrow).toHaveCount(0);
  await expect(world).toHaveAttribute("transform", before ?? "");

  // Dismissed from under the pointer - Escape with the cursor still on the row - the popover
  // unmounts without that row ever firing pointerleave. Reopening it must draw nothing until a row
  // is hovered again, so the route has to be forgotten rather than merely hidden (Copilot, #398).
  await panel.getByTestId("trade-route-0").hover();
  await expect(arrow).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(world).toHaveAttribute("transform", before ?? "");

  await page.getByTestId("trade-chip").click();
  await expect(panel).toBeVisible();
  await expect(arrow).toHaveCount(0);
  await expect(world).toHaveAttribute("transform", before ?? "");
});

test("an order with the wrong argument is caught, and the offending word quoted", async ({
  page
}) => {
  await loadReport(page);
  await silenceIdleUnits(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // GIVE takes a quantity before the item, and "swords" is not one. Only a parser that reads the
  // arguments finds this; checking the command name alone accepts it.
  await fillOrders(page, "GIVE 0 swords");

  const problems = page.getByTestId("orders-diagnostics");
  await expect(problems).toContainText("found \"swords\"");
  // The word itself, quoted out of the line by column, so the player is not left counting across.
  await expect(page.getByTestId("orders-diagnostic-token")).toHaveText("swords");
  await expect(page.getByTestId("orders-status")).toContainText("1 error");

  // Corrected, the syntax error goes.
  await fillOrders(page, "GIVE 0 10 swords");
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");

  // What is left is a different objection, and a true one (#82): Seven of Eight carries a leader
  // and nothing else, so there are no ten swords to give. Reading the arguments cannot find that -
  // it takes the report. Seven of Eight shares (ah-j2w), so the shortfall is judged against the
  // hex rather than counted against this unit's own orders - it shows in the region panel, not
  // here, and does not add to this unit's warning count.
  await expect(page.getByTestId("region-problems")).toContainText("sword");
  await expect(page.getByTestId("orders-diagnostic")).toHaveCount(0);
  await expect(page.getByTestId("orders-status")).toContainText("0 warnings");

  // An order the unit can actually carry out leaves nothing to say at all, region panel included.
  await fillOrders(page, "@work");
  await expect(page.getByTestId("orders-diagnostic")).toHaveCount(0);
  await expect(page.getByTestId("orders-status")).toContainText("0 warnings");
  await expect(page.getByTestId("region-problems")).not.toBeVisible();
});

test("a TURN block left open is reported against the unit that wrote it", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // The block is closed by ENDTURN, and is not. The core always found this, but filed it against
  // the line that discovered it - the *next* unit's line - which is outside this unit's block, so
  // the panel showed the unit that wrote it nothing at all.
  await fillOrders(page, "turn\nstudy illu");

  const problems = page.getByTestId("orders-diagnostics");
  await expect(problems).toContainText("never closed by ENDTURN");
  await expect(problems).toContainText("line 1");
  await expect(page.getByTestId("orders-status")).toContainText("1 error");

  // Closed, it is accepted.
  await fillOrders(page, "turn\nstudy illu\nendturn");
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");
});

test("an item the catalogue does not know is a warning rather than an error", async ({ page }) => {
  await loadReport(page);
  await silenceIdleUnits(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // The shape is right, so this is not a refusal - the catalogue is scraped and may simply be
  // missing an entry. It is said out loud all the same, because it is usually a typo.
  await fillOrders(page, "GIVE 0 10 swordz");

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

  await fillOrders(page, "@work");
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");

  // The other unit's block is untouched by that edit.
  await selectHex(page, "1:26,52");
  await selectUnit(page, "13401");
  await expectOrders(page, /@prepare staf/);
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

/** Turns the movement planner's feature flag on through the settings dialog, as a player would. */
async function enableMovementPlanner(page: Page) {
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-movement-planner").check();
  await page.keyboard.press("Escape");
}

/** Folds a panel by its own toggle, which is the only expanded control in its header. */
async function foldPanel(page: Page, panel: string) {
  const section = page.getByTestId(`panel-${panel}`);
  await section.getByRole("button", { expanded: true }).click();
  await expect(section).toHaveAttribute("data-collapsed", "true");
}

/** Unfolds a folded panel again, by the same toggle. */
async function unfoldPanel(page: Page, panel: string) {
  const section = page.getByTestId(`panel-${panel}`);
  await section.getByRole("button", { expanded: false }).click();
  await expect(section).toHaveAttribute("data-collapsed", "false");
}

/** Where the map is standing, read the same way `shortcuts.spec.ts` does. */
async function mapTransform(page: Page): Promise<string> {
  return (await page.getByTestId("map-world").getAttribute("transform")) ?? "";
}

test("a folded panel shrinks to its title bar", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  await waitForStableBox(page, "region");
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


/**
 * The tallest the header may be at the pinned viewport, in pixels.
 *
 * Measured, not chosen: on 2026-08-19 the header rendered at 73px in both projects, at the pinned
 * 1280x720 viewport with a 16px root font. The budget is ~125% of that - loose enough that an
 * ordinary change does not trip it, tight enough that one more chip or a step up in the type scale
 * does.
 *
 * Raising it is allowed and deliberate - a bead that genuinely needs a taller header changes this
 * number in the same commit as the header change, which is the whole point of ah-csni: the cost
 * lands on the change that caused it instead of on two unrelated drag tests a day later.
 */
const HEADER_BUDGET_PX = 91;

test("the header fits its budget, so a taller one fails here and not somewhere else", async ({
  page
}) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const header = (await page.getByTestId("app-header").boundingBox())!;
  const rootFontPx = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).fontSize)
  );
  const viewportPx = page.viewportSize()!.height;

  // The ceiling itself: a chip, a control moved in, or a step up in the type scale trips this.
  expect(header.height).toBeLessThanOrEqual(HEADER_BUDGET_PX);

  // And the part that earns its keep: the header has not eaten so much of the vertical budget that
  // the orders editor's pin is already at its ceiling. Without this, that shows up as a *drag* test
  // failing somewhere else entirely - four incidents in five days.
  expect(railHasRoomToDrag(railRemFor(viewportPx, header.height, rootFontPx))).toBe(true);
});

/**
 * A window with room for the orders/unit split to actually move.
 *
 * At the pinned viewport the editor's pin can already sit at its own ceiling once the header is
 * full (ah-1uj, ah-csni), so a test *about the drag mechanism* needs headroom the default does not
 * promise. Declaring it here is the point: these tests were the only ones that noticed, and they
 * noticed by failing.
 */
async function withRoomToDrag(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Restores the default split, so later tests inherit the look they expect. */
async function resetSplit(page: Page) {
  await page.getByTestId("panel-splitter").dblclick();
}

test("the unit/orders split drags at the grip and survives a reload", async ({ page }) => {
  await loadReport(page);
  // The pinned window (1280x720, see playwright.config.ts) leaves the orders editor's pin already
  // at its own ceiling once
  // enough advisory-check chips share the header with it (ah-1uj is one of several) - dragging it
  // taller would then have nowhere to go, whatever the gesture. A taller window gives the split
  // room to move regardless of how many chips the header carries; this test is about the drag
  // mechanism, not about how little of it fits in the header's own default height.
  await withRoomToDrag(page);
  await selectHex(page, "1:7,53");
  // Selecting a hex opens the panels; measuring "before" while that settles - slower or busier on
  // CI than locally - would pin a mid-animation size rather than the resting one.
  await waitForStableHeight(page, "orders");

  const before = await boxOf(page, "orders");
  const grip = page.getByTestId("panel-splitter");
  const gripBox = (await grip.boundingBox())!;
  const start = { x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 120, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => (await boxOf(page, "orders")).height).toBeGreaterThan(
    before.height + 20
  );

  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await selectHex(page, "1:7,53");
  await expect.poll(async () => (await boxOf(page, "orders")).height).toBeGreaterThan(
    before.height + 20
  );

  await resetSplit(page);
  await expect.poll(async () => (await boxOf(page, "orders")).height).toBeCloseTo(
    before.height,
    0
  );
});

/** The left or right overlay pane's current width, in CSS pixels. */
async function overlayWidth(page: Page, edge: "left" | "right") {
  const box = await page.locator(`[data-map-overlay="${edge}"]`).boundingBox();
  expect(box).not.toBeNull();
  return box!.width;
}

test("a rail drags at its edge pill and survives a reload", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const before = await overlayWidth(page, "left");
  const grip = page.getByTestId("rail-splitter-left");
  const gripBox = (await grip.boundingBox())!;
  const start = { x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 };

  // The left rail grows when the pointer moves toward the map, i.e. to the right.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 100, start.y, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => overlayWidth(page, "left")).toBeGreaterThan(before + 80);

  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await selectHex(page, "1:7,53");
  await expect.poll(async () => overlayWidth(page, "left")).toBeGreaterThan(before + 80);

  await grip.dblclick();
  await expect.poll(async () => overlayWidth(page, "left")).toBeCloseTo(before, 0);
});

/** The units pane's outer height, as the player sees it. */
async function unitsPaneHeight(page: Page): Promise<number> {
  return (await boxOf(page, "units")).height;
}

test("the units pane drags at its grip and survives a reload", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const before = await unitsPaneHeight(page);
  const grip = page.getByTestId("units-splitter");
  const gripBox = (await grip.boundingBox())!;
  const start = { x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 120, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => unitsPaneHeight(page)).toBeGreaterThan(before + 80);

  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await selectHex(page, "1:7,53");
  await expect.poll(async () => unitsPaneHeight(page)).toBeGreaterThan(before + 80);

  await grip.dblclick();
  await expect.poll(async () => unitsPaneHeight(page)).toBeCloseTo(before, 0);
});

test("a dragged units pane keeps its height on a hex with fewer units and on an empty one", async ({
  page
}) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const grip = page.getByTestId("units-splitter");
  const gripBox = (await grip.boundingBox())!;
  const start = { x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 120, { steps: 5 });
  await page.mouse.up();
  const dragged = await unitsPaneHeight(page);

  // (1:7,51) is known only from a neighbour's exits and carries no units at all - the dragged
  // height must not shrink to fit it, which is the whole point of a dragged height being the
  // height rather than a ceiling (ah-2r3).
  await selectHex(page, "1:7,51");
  await expect(page.getByTestId("panel-units")).toContainText("No units reported in this hex.");
  expect(await unitsPaneHeight(page)).toBeCloseTo(dragged, 0);

  await selectHex(page, "1:7,53");
  expect(await unitsPaneHeight(page)).toBeCloseTo(dragged, 0);

  await grip.dblclick();
});

test("folding the units pane hides its grip", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  await expect(page.getByTestId("units-splitter")).toBeVisible();

  await foldPanel(page, "units");
  await expect(page.getByTestId("units-splitter")).toHaveCount(0);

  await unfoldPanel(page, "units");
  await expect(page.getByTestId("units-splitter")).toBeVisible();
});

test("folding the unit panel hides the grip and hands the column to the editor", async ({
  page
}) => {
  await loadReport(page);
  // See "the unit/orders split drags..." above: at the default window height the editor's pin can
  // already sit at its own ceiling once enough advisory-check chips share the header with it, and
  // this test drags it taller twice over.
  await withRoomToDrag(page);
  await selectHex(page, "1:7,53");
  // Selecting a hex opens the panels; measuring "before" while that settles - slower or busier on
  // CI than locally - would pin a mid-animation size rather than the resting one.
  await waitForStableHeight(page, "orders");

  const before = await boxOf(page, "orders");
  const grip = page.getByTestId("panel-splitter");
  const gripBox = (await grip.boundingBox())!;
  const start = { x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 60, { steps: 5 });
  await page.mouse.up();
  // Polled, not a single read: the resize can still be settling (a CSS transition) the instant
  // after the pointer lifts, slower or busier on CI than locally.
  await expect
    .poll(async () => (await boxOf(page, "orders")).height)
    .toBeGreaterThan(before.height);
  const dragged = await boxOf(page, "orders");

  await foldPanel(page, "unit");
  await expect(grip).not.toBeVisible();
  await expect
    .poll(async () => (await boxOf(page, "orders")).height)
    .toBeGreaterThan(dragged.height);

  await unfoldPanel(page, "unit");
  await expect(grip).toBeVisible();
  await expect.poll(async () => (await boxOf(page, "orders")).height).toBeCloseTo(
    dragged.height,
    0
  );

  await resetSplit(page);
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

/** Any hex, not the pressed one, whose middle falls inside `rect` - or null if none does. */
async function hexUnder(
  page: Page,
  rect: { left: number; right: number; top: number; bottom: number }
) {
  return page.evaluate((r) => {
    for (const hex of document.querySelectorAll<SVGPolygonElement>("polygon[data-region-id]")) {
      if (hex.getAttribute("aria-pressed") === "true") {
        continue;
      }
      const box = hex.getBoundingClientRect();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (x > r.left && x < r.right && y > r.top && y < r.bottom) {
        return { regionId: hex.getAttribute("data-region-id") ?? "", x, y };
      }
    }
    return null;
  }, rect);
}

test("the map under a folded panel can be clicked", async ({ page }) => {
  await loadReport(page);
  await enableMovementPlanner(page);
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
  // than assumed. The units pane's own default height (ah-2r3) leaves less of the window for the
  // map than the old row-hugging pane did, so the fit taken before anything was selected now
  // sits further in and no hex reaches this corner unaided - so any hex is dragged there instead
  // of hoping one already sits under it. A pan moves the whole world by exactly the pointer's own
  // travel, so aiming at any hex's own centre and asking for the freed rectangle's centre lands it
  // there regardless of where the fit happened to leave it.
  let target = await hexUnder(page, freed);
  if (!target) {
    const anyHex = await page.evaluate(() => {
      for (const hex of document.querySelectorAll<SVGPolygonElement>("polygon[data-region-id]")) {
        if (hex.getAttribute("aria-pressed") === "true") {
          continue;
        }
        const box = hex.getBoundingClientRect();
        return { regionId: hex.getAttribute("data-region-id") ?? "", x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      return null;
    });
    if (anyHex) {
      const destX = (freed.left + freed.right) / 2;
      const destY = (freed.top + freed.bottom) / 2;
      await page.mouse.move(anyHex.x, anyHex.y);
      await page.mouse.down();
      await page.mouse.move(destX, destY, { steps: 10 });
      await page.mouse.up();
      target = await hexUnder(page, freed);
    }
  }
  expect(target, "no hex sits under the folded panels, even panned").not.toBeNull();

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

test("every control that acts on the map view sits in one strip", async ({ page }) => {
  await loadReport(page);

  // ah-ljil: the zoom buttons moved up from the map's own top-right corner into the strip that
  // holds the Badges chip, so the two halves of one job are no longer in two corners.
  const chips = page.getByTestId("layer-chips");
  await expect(chips.getByRole("button", { name: "Badges" })).toBeVisible();
  await expect(chips.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(chips.getByRole("button", { name: "Zoom out" })).toBeVisible();
  await expect(chips.getByRole("button", { name: "Zoom to fit" })).toBeVisible();

  // Exactly one element marked as covering the top edge, which is what zoom-to-fit measures: two
  // would ask `useOverlayInsets` to union a pair on one edge, and none would let the fit frame the
  // world under the controls.
  await expect(page.locator('[data-map-overlay="top"]')).toHaveCount(1);

  // The strip lives inside the top forty-eight pixels of the map, which is the only band the
  // inspector panels' full-bleed overlay leaves clickable.
  const box = await chips.boundingBox();
  const map = await page.getByTestId("map-canvas").boundingBox();
  expect(box && map && box.y + box.height - map.y).toBeLessThanOrEqual(48);
});

/**
 * ah-v09e, both halves. The strip carries a `backdrop-blur`, which opens a stacking context, so an
 * open menu's own z-order can never lift it over the panel column on its own: the strip is lifted
 * instead, and only while a menu is open. Lifted always, it swallows clicks meant for whatever sits
 * under it. ah-ljil moved the zoom buttons into this strip, and this is what must have survived.
 */
test("the badge menu's lower rows take clicks, and give the map back when it closes", async ({
  page
}) => {
  await loadReport(page);

  const trigger = page.getByTestId("layer-chips").getByRole("button", { name: "Badges" });
  await trigger.click();
  const menu = page.getByTestId("badge-menu");
  const lowest = menu.getByRole("checkbox").last();
  const wasChecked = await lowest.isChecked();
  await lowest.click();
  expect(await lowest.isChecked()).toBe(!wasChecked);

  // Closed, the strip must stop claiming that area: whatever the menu covered takes clicks again.
  const where = await lowest.boundingBox();
  // Asserted rather than defaulted: a null box would otherwise send `elementFromPoint` to the
  // window's top-left corner, where it finds no strip and the test passes having checked nothing.
  expect(where).not.toBeNull();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  const under = await page.evaluate(
    (point) =>
      document
        .elementFromPoint(point.x, point.y)
        ?.closest("[data-testid='layer-chips']") === null,
    { x: where!.x + 4, y: where!.y + 4 }
  );
  expect(under).toBe(true);
});

test("the layer toggles live in settings, not over the map", async ({ page }) => {
  await loadReport(page);

  // ah-l9mp: staleness and movement moved into Settings > Global and gave the band back to the
  // map. The strip survives with the badge chip alone.
  const chips = page.getByTestId("layer-chips");
  await expect(chips.getByRole("checkbox")).toHaveCount(0);
  await expect(chips.getByRole("button", { name: "Badges" })).toBeVisible();

  await page.getByTestId("settings-indicator").click();
  const staleness = page.getByTestId("settings-layer-staleness");
  await expect(staleness).toBeChecked();
  await staleness.uncheck();
  await expect(staleness).not.toBeChecked();
  await expect(page.getByTestId("settings-layer-movement")).toBeChecked();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("map-canvas")).toBeVisible();

  // The choice is the workspace store's, and it was already persisted - a reload must not undo it.
  await page.reload();
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-layer-staleness")).not.toBeChecked();
  await page.keyboard.press("Escape");
});

/**
 * ah-4b4: the nexus used to be filed on the surface at (0,0), sharing the surface origin's
 * identity. A fresh faction's very first turn is nothing but the nexus, so it is the one report
 * that exercises this without any other setup.
 */
test("a first turn opens on the nexus, on a level of its own", async ({ page }) => {
  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();
  await createGame(page, "Nexus game");
  await expect(page.getByTestId("app-header")).toBeVisible();

  await page.setInputFiles('input[type="file"]', {
    name: "turn-0.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(readReport("g2f42t0"), "utf8")
  });

  await expect(page.getByTestId("import-status")).toContainText("1 region ·");

  // ah-l9mp: the level reads from the top bar now, and a single level is text rather than a
  // dead select.
  const header = page.getByTestId("app-header");
  await expect(header).toContainText("nexus");
  await expect(header.getByLabel("Map level")).toHaveCount(0);

  await selectHex(page, "0:0,0");
  await expect(page.getByTestId("panel-region")).toContainText("nexus (0,0)");
});

/**
 * ah-l9mp: the level moved out of the strip over the map and into the top bar, where it is
 * glanceable. A game that knows more than one level gets a real control there, and changing it
 * changes the level the map is drawn for.
 */
test("the level selector in the header changes level", async ({ page }) => {
  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();
  await createGame(page, "Two levels");
  await expect(page.getByTestId("app-header")).toBeVisible();

  // Turn 0 is the nexus alone; turn 23 is the surface. Together the game knows two levels, which
  // is what puts a real control in the header rather than a word.
  await page.setInputFiles('input[type="file"]', {
    name: "turn-0.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(readReport("g5f21t0"), "utf8")
  });
  await expect(page.getByTestId("import-status")).toContainText("region");
  await page.setInputFiles('input[type="file"]', {
    name: "turn-23.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(readReport("g5f21t23"), "utf8")
  });
  await expect(page.getByTestId("import-status")).toContainText("region");

  const selector = page.getByTestId("app-header").getByLabel("Map level");
  await expect(selector).toBeVisible();
  const values = await selector.locator("option").evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value)
  );
  expect(values.length).toBeGreaterThan(1);

  // The nexus hex, which exists on the nexus level and nowhere else - so it is the map's own
  // answer to which level is being drawn, rather than the selector repeating itself back.
  const nexusHex = page.getByRole("button", { name: "hex 0:0,0" });

  const current = await selector.inputValue();
  const other = values.find((value) => value !== current) ?? current;
  await selector.selectOption(other);
  await expect(selector).toHaveValue(other);
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  await expect(nexusHex).toHaveCount(other === "0" ? 1 : 0);

  await selector.selectOption(current);
  await expect(nexusHex).toHaveCount(current === "0" ? 1 : 0);
});

/**
 * The badges are what a hex says over its terrain, and a busy level says a great deal at once.
 * Each kind is switchable on its own - turning off the settlement names used to mean turning off
 * nothing, because the only controls were "units" and "structures" over nine kinds of mark - and
 * the set a player settles on is a preference, so it outlives a reload.
 */
test("each badge can be turned off on its own, and the set survives a reload", async ({ page }) => {
  await loadReport(page);

  const map = page.getByTestId("map-canvas");
  // The units pane's own default height (ah-2r3) leaves less of the window for the map than the
  // old row-hugging pane did, so the initial fit now lands a touch further out than the tier
  // that draws building glyphs at all - a couple of zoom-in steps is what every other test that
  // cares about mark detail already does (see "the map carries less detail the further out it is
  // zoomed").
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  // The atlas draws a settlement as a keep; the committed turn 71 has towns on it.
  const settlements = map.locator('[data-mark="settlement"]');
  const units = map.locator('[data-shield="own"]');
  await expect(settlements.first()).toBeVisible();

  const trigger = page.getByTestId("layer-chips").getByRole("button", { name: "Badges" });
  await expect(trigger).toHaveAttribute("data-badges-all", "true");

  await trigger.click();
  const badges = page.getByTestId("badge-menu");
  await expect(badges.getByRole("checkbox", { name: "Settlements" })).toBeChecked();

  await badges.getByRole("checkbox", { name: "Settlements" }).uncheck();
  // The chip itself says the map is showing less than everything, without the panel being open.
  await expect(trigger).toHaveAttribute("data-badges-all", "false");
  await expect(settlements).toHaveCount(0);
  // Only its own: the player's own units in those hexes are still drawn. The own shield
  // specifically, rather than any unit mark - a hex whose only remaining mark was a monster's
  // would otherwise satisfy this.
  await expect(units.first()).toBeVisible();

  await page.reload();
  // The unit marks first: a map that has not finished restoring turn 71 draws no settlement mark
  // either, so "no keeps" only means the badge survived once there is something on the map to miss.
  await expect(
    page.getByTestId("map-canvas").locator('[data-shield="own"]').first()
  ).toBeVisible();
  await expect(page.getByTestId("map-canvas").locator('[data-mark="settlement"]')).toHaveCount(0);
  await page.getByTestId("layer-chips").getByRole("button", { name: "Badges" }).click();
  await expect(
    page.getByTestId("badge-menu").getByRole("checkbox", { name: "Settlements" })
  ).not.toBeChecked();

  // And All brings the whole set back, which is the way out of a map cleared down to its terrain.
  await page.getByTestId("badge-menu").getByRole("button", { name: "All" }).click();
  await expect(
    page.getByTestId("map-canvas").locator('[data-mark="settlement"]').first()
  ).toBeVisible();
});

/**
 * Region decorations are on by default, like every other badge, so a player who has never opened
 * the Badges menu already sees province names on the map. Turning the badge off is the one
 * documented way to lose them, and the choice is a preference like the rest of the set.
 */
test("region decorations can be turned off from the Badges menu, and the choice survives a reload", async ({
  page
}) => {
  await loadReport(page);

  const decorations = page.getByTestId("map-canvas").getByTestId("region-decorations");
  await expect(decorations).toBeVisible();

  await page.getByTestId("layer-chips").getByRole("button", { name: "Badges" }).click();
  const badges = page.getByTestId("badge-menu");
  await expect(badges.getByRole("checkbox", { name: "Regions" })).toBeChecked();

  await badges.getByRole("checkbox", { name: "Regions" }).uncheck();
  await expect(decorations).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("map-canvas").getByTestId("region-decorations")).toHaveCount(0);
  await page.getByTestId("layer-chips").getByRole("button", { name: "Badges" }).click();
  await expect(
    page.getByTestId("badge-menu").getByRole("checkbox", { name: "Regions" })
  ).not.toBeChecked();
});

/**
 * The movement planner is behind a feature flag, and the flag starts off: the pane is the one
 * piece of the workspace still finding its shape, and a player who has not asked for it should
 * not have to scroll past it. The flag is a preference, so turning it on holds across a reload.
 */
test("the movement pane stays hidden until its flag is turned on", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await expect(page.getByTestId("panel-unit")).toBeVisible();
  await expect(page.getByTestId("panel-planner")).toHaveCount(0);

  await enableMovementPlanner(page);
  await expect(page.getByTestId("panel-planner")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await expect(page.getByTestId("panel-planner")).toBeVisible();
});

/**
 * The region panel writes everything out. It used to preview six market or structure lines and
 * offer the rest as "+ N more" that nothing could expand, so the only way to the full list was
 * the raw report; the pane scrolls, and scrolling is better than not knowing. Exits use the
 * compass shorthand MOVE orders are written in rather than the report's long names.
 */
test("the region panel writes every line out and abbreviates the exits", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const region = page.getByTestId("panel-region");
  // Inholm wants nine things; truffles are the ninth, which the six-line preview cut.
  await expect(region).toContainText("truffles");
  await expect(region).not.toContainText("more");
  // The sixth exit, in shorthand - and no long name anywhere in the list.
  await expect(region).toContainText("SE — ocean (8,54)");
  await expect(region).not.toContainText("Southeast");
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
 * IndexedDB. That path is what lets the map remember earlier turns; without it a small report
 * stops at its own fringe and a hex named only in passing brings none of its exits back.
 *
 * The walk further down this file ("a route crosses ground only an earlier turn described")
 * covers accumulation itself, on real turns of faction 42 (game 3). This test stays about the
 * storage round trip - importing the same turn twice and getting the same map back - which is
 * orthogonal to whether an earlier turn is remembered alongside the current one.
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
  await enableMovementPlanner(page);
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
  await enableMovementPlanner(page);
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
  await enableMovementPlanner(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  await page.getByTestId("planner-arm").click();
  await selectHex(page, "1:7,51");
  await expect(page.getByTestId("planner-order")).toHaveText("MOVE N");

  await page.getByTestId("planner-apply").click();
  await expectOrders(page, /MOVE N/);
});

/**
 * The multi-step, real-data case ah-5jm exists for: three real turns imported in one batch, a
 * route planned across a hex only the oldest of them describes, and the stale banner on that hex.
 *
 * `tundra (41,3)` is a region t40 visited and neither t41 nor t42 describes; t42 knows it only as
 * an exit of `forest (40,2)`, which has no exits of its own until t40 is remembered alongside it.
 * `Woodsmen (10293)` rides two tundra steps to `(42,2)` at four movement points, all in one month -
 * see `crates/core/tests/movement_plan.rs` for the same route pinned against the core directly.
 */
test("a route crosses ground only an earlier turn described", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Multi-step game");
  await expect(page.getByTestId("app-header")).toBeVisible();

  await page.setInputFiles('input[type="file"]', [
    { name: "f42-t42.rep", mimeType: "text/plain", buffer: Buffer.from(F42_T42, "utf8") },
    { name: "f42-t40.rep", mimeType: "text/plain", buffer: Buffer.from(F42_T40, "utf8") },
    { name: "f42-t41.rep", mimeType: "text/plain", buffer: Buffer.from(F42_T41, "utf8") }
  ]);

  const dialog = page.getByTestId("import-summary");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Imported 3 turns for The Disinherited Knights (42)");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  await enableMovementPlanner(page);
  await selectHex(page, "1:40,2");
  await selectUnit(page, "10293");

  await page.getByTestId("planner-arm").click();
  await selectHex(page, "1:42,2");

  await expect(page.getByTestId("planner-route")).toBeVisible();
  await expect(page.getByTestId("planner-route")).toContainText("4 movement points");
  await expect(page.getByTestId("planner-order")).toHaveText("MOVE SE NE");

  // (41,3) is the remembered hex the route crosses: last stood in at t40, two turns before the t42
  // now on screen.
  await selectHex(page, "1:41,3");
  await expect(page.getByTestId("panel-region")).toContainText("Last seen turn 40");
  await expect(page.getByTestId("panel-region")).toContainText("2 turns ago");

  // Whatever stood here at t40 may have moved, disbanded or died since - the units pane must not
  // show it as though it were still there (ah-o86).
  await expect(page.getByTestId("panel-units")).toContainText("Not seen since turn 40");
  await expect(page.getByTestId("panel-units").locator('[data-testid^="unit-row-"]')).toHaveCount(0);
});

test("only your own units can be planned for", async ({ page }) => {
  await loadReport(page);
  await enableMovementPlanner(page);
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
  await enableMovementPlanner(page);
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
  await enableMovementPlanner(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  await page.getByTestId("planner-arm").click();
  await selectHex(page, "1:7,51");
  await expect(page.getByTestId("planner-route")).toBeVisible();

  // The toggle starts on since #83, so this click turns the drawing OFF. It lives in
  // Settings > Global since ah-l9mp rather than in the strip over the map.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-layer-movement").uncheck();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("route-line-solid")).toHaveCount(0);

  // The panel still knows the route; only the drawing follows the chip.
  await expect(page.getByTestId("planner-route")).toBeVisible();
  await expect(page.getByTestId("planner-order")).toHaveText("MOVE N");
});

/**
 * Issue #83: a unit's written MOVE order is drawn on the map - solid through what the coming month
 * covers, dotted for the rest - and it follows the editor as the player types.
 *
 * "* Seven of Eight (18642)" is a walker with two movement points in the mountain at (7,53). Its
 * north neighbour (7,51) is another mountain at two points, so MOVE N N N is one hex a month:
 * one solid step, then a dotted tail extrapolated into country nobody has described.
 */
test("a written move order is drawn solid for next turn and dotted beyond", async ({ page }) => {
  await loadReport(page);
  await enableMovementPlanner(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // The movement layer is on by default, so typing an order is all it takes to draw it.
  await fillOrders(page, "MOVE N N N");

  // Asserted by count and points rather than visibility: a due-north path is a straight vertical
  // line, whose zero-width bounding box Playwright counts as hidden.
  await expect(page.getByTestId("route-line-solid")).toHaveCount(1);
  await expect(page.getByTestId("route-line-solid")).toHaveAttribute("points", /.+ .+/);
  await expect(page.getByTestId("route-line-dotted")).toHaveCount(1);
  await expect(page.getByTestId("route-line-dotted")).toHaveAttribute("points", /.+ .+ .+/);

  // Cutting the order down to what one month affords leaves nothing for the dotted tail.
  await fillOrders(page, "MOVE N");
  await expect(page.getByTestId("route-line-dotted")).toHaveCount(0);
  await expect(page.getByTestId("route-line-solid")).toHaveCount(1);

  // "  Northeast : ocean (8,52)" - a walker's order to sea is drawn, but as doubt: nothing is
  // solid, however cheap the month arithmetic says the crossing is.
  await fillOrders(page, "MOVE NE");
  await expect(page.getByTestId("route-line-dotted")).toHaveCount(1);
  await expect(page.getByTestId("route-line-solid")).toHaveCount(0);

  // Arming the planner is a gesture about a different journey, so the order path steps aside.
  await page.getByTestId("planner-arm").click();
  await expect(page.getByTestId("route-line-solid")).toHaveCount(0);
  await expect(page.getByTestId("route-line-dotted")).toHaveCount(0);
});

/**
 * ah-048: a unit standing aboard a sailing ship writes no order of its own, and the map used to
 * draw it nothing - though the units pane beside it already said "aboard Raft [235]", departing.
 *
 * Raft [235] sits in the plain at (36,44) of faction 21's turn 24, with Drones (10575) able to sail
 * it and Drones (10594) simply aboard. The captain's SAIL SE is written, and then the passenger is
 * selected: the map draws the passenger the same voyage, because it is the same voyage.
 */
test("selecting a passenger draws the fleet's voyage", async ({ page }) => {
  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();
  await createGame(page, "Passenger game");
  await expect(page.getByTestId("app-header")).toBeVisible();
  await choose(page, "turn-24.rep", F21_T24);
  await expect(page.getByTestId("import-status")).toContainText("regions");

  await selectHex(page, "1:36,44");
  await selectUnit(page, "10575");
  await fillOrders(page, "sail se");

  // The captain's own voyage first, so the passenger's can be compared against something drawn.
  await expect(page.getByTestId("route-line-solid")).toHaveCount(1);
  const captain = await page.getByTestId("route-line-solid").getAttribute("points");

  // The passenger wrote nothing, so its own block is empty - and the map draws the hull's route.
  await selectUnit(page, "10594");
  await expect(page.getByTestId("route-line-solid")).toHaveCount(1);
  await expect(page.getByTestId("route-line-solid")).toHaveAttribute("points", captain ?? "");
});

/**
 * ah-0fa: the same voyage, seen from the other end. Standing in the destination hex, the units table
 * already lists the units arriving there this month - but selecting one used to find nothing at all,
 * because the shell looked for the selected unit in the report's units for the hex and an arriving
 * unit is only in the preview. No trace was asked for and the pane stayed empty.
 *
 * Raft [235] sails SE out of the plain at (36,44) into the ocean at (37,45), so selecting its
 * captain in (37,45) - where it has not arrived yet - draws the path that is bringing it there.
 */
test("selecting an arriving unit in its destination hex draws its route", async ({ page }) => {
  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();
  await createGame(page, "Arriving game");
  await expect(page.getByTestId("app-header")).toBeVisible();
  await choose(page, "turn-24.rep", F21_T24);
  await expect(page.getByTestId("import-status")).toContainText("regions");

  await selectHex(page, "1:36,44");
  await selectUnit(page, "10575");
  await fillOrders(page, "sail se");

  // The voyage as its origin hex draws it, to compare the destination's drawing against.
  await expect(page.getByTestId("route-line-solid")).toHaveCount(1);
  const fromOrigin = await page.getByTestId("route-line-solid").getAttribute("points");

  // Now the destination, where the unit is listed as arriving rather than standing.
  await selectHex(page, "1:37,45");
  await selectUnit(page, "10575");

  // The pane fills - selecting something and getting nothing reads as broken - and the same voyage
  // is drawn, because the trace starts from the unit's own hex however the hex was reached.
  await expect(page.getByTestId("panel-unit")).toContainText("10575");
  await expect(page.getByTestId("route-line-solid")).toHaveCount(1);
  await expect(page.getByTestId("route-line-solid")).toHaveAttribute("points", fromOrigin ?? "");
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

/**
 * The units table's resizable columns, and the bound that is the whole point of them (ah-1owr.2).
 *
 * PR #421 sized the columns in pixels; the table is `w-full table-fixed` inside a scroller that
 * hides horizontal overflow, so widening a rail past the point where the pixel total no longer fit
 * laid the rightmost columns out past the right edge, where nothing scrolled them back. Widths are
 * shares now, so the columns always add up to exactly the table - which is what this pins.
 */
test("column widths are dragged, survive a reload, and can never push a column off the edge", async ({
  page
}) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const table = page.locator("[data-testid='panel-units'] table");
  const nameHeader = page.getByRole("columnheader", { name: /Unit/ }).first();
  const handle = page.getByTestId("column-splitter-name-faction");
  const widthOf = async (nth: number) =>
    (await page.locator(`[data-testid^='unit-row-'] td:nth-child(${nth})`).first().boundingBox())
      ?.width ?? 0;

  await expect(nameHeader).toBeVisible();
  const tableWidthBefore = (await table.boundingBox())?.width ?? 0;
  const nameBefore = await widthOf(3);
  const factionBefore = await widthOf(4);

  // Drag the Unit/Faction boundary to the right: Unit grows by exactly what Faction gives up.
  const grip = await handle.boundingBox();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip!.x + grip!.width / 2 + 60, grip!.y + grip!.height / 2, { steps: 6 });
  await page.mouse.up();

  const nameAfter = await widthOf(3);
  const factionAfter = await widthOf(4);
  expect(nameAfter).toBeGreaterThan(nameBefore + 20);
  expect(factionAfter).toBeLessThan(factionBefore - 20);
  // The table itself did not move, which is the invariant the shares model exists to hold.
  expect((await table.boundingBox())?.width ?? 0).toBeCloseTo(tableWidthBefore, 0);

  // Now what lost a column on PR #421: make the table far narrower than the pixel total the old
  // model stored. Every column must still be on screen, narrower but present.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 900, height: viewport.height });
  await expect
    .poll(async () => (await table.boundingBox())?.width ?? 0)
    .toBeLessThan(tableWidthBefore - 100);
  const lastCell = page.locator("[data-testid^='unit-row-'] td:last-child").first();
  const lastBox = await lastCell.boundingBox();
  const tableBox = await table.boundingBox();
  expect(lastBox!.x + lastBox!.width).toBeLessThanOrEqual(tableBox!.x + tableBox!.width + 1);
  expect(lastBox!.width).toBeGreaterThan(0);

  await page.setViewportSize(viewport);

  // The shape survives a reload...
  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored");
  await selectHex(page, "1:7,53");
  const ratioAfterReload = (await widthOf(3)) / ((await table.boundingBox())?.width ?? 1);
  expect(ratioAfterReload).toBeGreaterThan(nameAfter / tableWidthBefore - 0.02);

  // ...and Settings puts it back.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-reset-column-widths").click();
  await page.keyboard.press("Escape");
  const nameReset = (await widthOf(3)) / ((await table.boundingBox())?.width ?? 1);
  expect(nameReset).toBeLessThan(ratioAfterReload - 0.01);
});

/**
 * The units table's reorderable columns, and the feedback that is the whole point of them
 * (ah-1owr.3).
 *
 * PR #421 built the drag and showed nothing until the pointer came up: the prospective order was
 * computed on every move and never drawn, so a player was dragging blind. What this pins is that
 * the drop line and the chip are on screen *during* the gesture, that the column lands where the
 * line said, and that the order survives a reload and can be put back from Settings.
 *
 * It restores the shipped order before it ends: the assertions elsewhere in this file address
 * columns as `td:nth-child(5)`, which only holds while nothing has been reordered.
 */
test("a column is dragged to a new place, shows where it will land, and survives a reload", async ({
  page
}) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const headers = () => page.locator("[data-testid='panel-units'] thead th");
  const headerOrder = async () =>
    (await page.locator("[data-testid^='column-reorder-']").evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.testid ?? "")
    )).map((testid) => testid.replace("column-reorder-", ""));

  await expect(headers().first()).toBeVisible();
  const before = await headerOrder();
  expect(before[1]).toBe("name");

  // Drag the Unit column rightwards, past the whole of Faction.
  const grip = await page.getByTestId("column-reorder-name").boundingBox();
  const factionCell = await page
    .locator("[data-testid^='unit-row-'] td:nth-child(4)")
    .first()
    .boundingBox();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    grip!.x + grip!.width / 2 + factionCell!.width + 20,
    grip!.y + grip!.height / 2,
    { steps: 8 }
  );

  // The defect, as an assertion: both must be on screen while the pointer is still down.
  await expect(page.getByTestId("column-drop-line")).toBeVisible();
  await expect(page.getByTestId("column-drag-chip")).toBeVisible();
  await expect(page.getByTestId("column-drag-chip")).toHaveText("Unit");
  const lineBox = await page.getByTestId("column-drop-line").boundingBox();

  await page.mouse.up();

  // Gone the moment the gesture ends, and the column landed where the line was standing.
  await expect(page.getByTestId("column-drop-line")).toHaveCount(0);
  await expect(page.getByTestId("column-drag-chip")).toHaveCount(0);
  const after = await headerOrder();
  expect(after.indexOf("name")).toBeGreaterThan(before.indexOf("name"));
  // The line marks a gap in the table *as it was drawn during the drag* - the table deliberately
  // does not reorder under the pointer - so the column comes to rest in that gap, not at that same
  // pixel: everything to the right of the column's old slot shifts left by its width when the drag
  // commits. What must hold is the slot, so assert the neighbour the line stood beside (ah-gfzu).
  // Dragged past the whole of Faction, so the gap is Faction's right edge in the drag-time layout,
  // and Faction is what the column now sits after.
  expect(lineBox!.x).toBeCloseTo(factionCell!.x + factionCell!.width, 0);
  expect(after[after.indexOf("name") - 1]).toBe("faction");

  // The order survives a reload...
  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored");
  await selectHex(page, "1:7,53");
  expect(await headerOrder()).toEqual(after);

  // ...and Settings puts it back, without disturbing the widths.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-reset-column-order").click();
  await page.keyboard.press("Escape");
  expect(await headerOrder()).toEqual(before);
});

/** The ocean hex the report gives three hundred and eleven units. */
const CROWDED_HEX = "1:26,52";

/**
 * The point of issue #27. Selecting this hex used to build 311 rows of eight cells each in one
 * synchronous render; now it builds what fits on screen and stands in for the rest.
 */
test("a hex of three hundred units renders only the rows that fit", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, CROWDED_HEX);

  await expect(page.getByTestId("panel-units")).toContainText("311 units");

  const rows = page.locator("[data-testid^='unit-row-']");
  const count = await rows.count();
  expect(count).toBeGreaterThan(5);
  expect(count).toBeLessThan(50);

  // The whole list is still there to scroll through: the table claims all 311 rows to assistive
  // technology, the header counting as one of them. It is a grid rather than a table because its
  // rows are selectable.
  await expect(page.getByTestId("panel-units").getByRole("grid")).toHaveAttribute(
    "aria-rowcount",
    "312"
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
  // `exact`, because every header now also carries a reorder grip whose accessible name is
  // "Move the Men column" - a substring match resolves to both (ah-1owr.3).
  const men = page.getByTestId("panel-units").getByRole("button", { name: "Men", exact: true });
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

  // `exact`, because every header now also carries a reorder grip whose accessible name is
  // "Move the Men column" - a substring match resolves to both (ah-1owr.3).
  const men = page.getByTestId("panel-units").getByRole("button", { name: "Men", exact: true });
  await men.click();
  await men.click();

  const ownRow = page.getByTestId(`unit-row-${OWN_UNIT}`);
  await expect(ownRow).toHaveAttribute("aria-rowindex", "2");

  const grouping = page.getByRole("button", { name: "Group own units first" });
  await expect(grouping).toHaveAttribute("aria-pressed", "true");
  await grouping.click();
  await expect(grouping).toHaveAttribute("aria-pressed", "false");

  // Released, the player's single unit sinks to wherever its headcount puts it among the other
  // ninety-one. Visibility asserted first: a negated attribute check alone would also pass if the
  // row vanished from the table, which is the regression the pane-height limit exists to avoid.
  await expect(ownRow).toBeVisible();
  await expect(ownRow).not.toHaveAttribute("aria-rowindex", "2");
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

  // End walks to the bottom of all 92, which is well outside the window it started in - the unit
  // list limit sizes the pane, never the list.
  await page.keyboard.press("End");
  await expect(page.locator("[data-testid^='unit-row-'][data-selected='true']")).toHaveAttribute(
    "aria-rowindex",
    "93"
  );

  // Arrowing past the end is a no-op: same row, so nothing re-renders.
  await page.keyboard.press("End");

  // Which is where a focus owed from that no-op would be spent. Selecting with the mouse must not
  // haul focus onto a row: only the arrow keys move focus, because only they asked to.
  await page
    .locator("[data-testid^='unit-row-']")
    .first()
    .getByRole("button", { name: /^unit / })
    .click();
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

/**
 * ah-87he: the unit numbers in a problem list are inert - you read which unit has the problem and
 * then go and find it yourself. These two cover the click, there being no jsdom for the unit tests.
 */
test("a unit named in the problems panel is a way to go there", async ({ page }) => {
  await loadReport(page);

  // Somewhere else first, so the jump has a hex to move away from - the whole point of the
  // top-bar case is that the unit is not in the hex on screen.
  await selectHex(page, "1:7,53");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");

  await page.getByTestId("problems-chip").click();
  // Scoped to the panel: the region pane behind it carries links of its own, and this test is
  // about the top-bar one. Six of Two (13402) is one of the turn's own baseline findings - it is
  // already at the ruleset's maximum combat and still orders "@study comb" - and it stands in a
  // hex that is not Inholm, which is what makes the jump worth testing.
  const jump = page.getByTestId("problems-panel").getByTestId("problem-unit-13402").first();
  await expect(jump).toBeVisible();
  await jump.click();

  // The panel got out of the way, and the workspace behind it followed the unit to its own hex.
  await expect(page.getByTestId("problems-panel")).toHaveCount(0);
  await expect(page.getByTestId("panel-unit")).toContainText("13402");
  await expect(page.getByTestId("panel-region")).not.toContainText("Inholm");
});

test("a unit named in the region pane's problems is a way to select it", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "give 1 1 silv");

  const jump = page.getByTestId("region-problems").getByTestId(`problem-unit-${OWN_UNIT}`).first();
  await expect(jump).toBeVisible();
  await jump.click();

  // Selected, and the region pane is not a popover - it stays exactly where it was.
  await expect(page.getByTestId("panel-unit")).toContainText(OWN_UNIT);
  await expect(page.getByTestId("region-problems")).toBeVisible();
});

test("the turn messages panel closes on Escape", async ({ page }) => {
  await loadReport(page);

  await page.getByTestId("turn-messages-chip").click();
  await expect(page.getByTestId("turn-messages")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByTestId("turn-messages")).toHaveCount(0);
});

/**
 * The turn's battles, in full - opened from the header chip rather than a hex, since a battle's
 * location is not necessarily one the player has ever selected.
 */
test("the battles chip opens the turn's fighting, battle by battle", async ({ page }) => {
  await loadReport(page);

  const chip = page.getByTestId("battles-chip");
  await expect(chip).toContainText("2 battles");
  await chip.click();

  const dialog = page.getByTestId("battles-dialog");
  await expect(dialog).toBeVisible();

  // Opening the chip selects the first battle, so the detail is never empty.
  const detail = page.getByTestId("battle-detail");
  await expect(detail).toContainText("Pirates (14789)");
  await expect(detail).toContainText("Attackers");
  await expect(detail).toContainText("Defenders");
  await expect(detail).toContainText("Spoils");
  await expect(detail).toContainText("2531 silver");

  // The second battle, by clicking its row in the list rail.
  await page.getByTestId("battle-row-1").click();
  await expect(detail).toContainText("Sail (16352)");
  await expect(detail).toContainText("Looter (16779)");
  await expect(detail).toContainText("271 silver");

  // The battle statistics are folded away until asked for, and say how much they hold.
  const battleStatistics = page.getByTestId("battle-statistics");
  await expect(battleStatistics.locator("summary")).toContainText(/statistics \(\d+ lines?\)/);
  await expect(battleStatistics.getByText("successful attacks").first()).not.toBeVisible();
  await battleStatistics.locator("summary").click();
  await expect(battleStatistics.getByText("successful attacks").first()).toBeVisible();

  // The location links back to the map.
  await page.getByTestId("battles-show-on-map").click();
  await expect(page.getByTestId("battles-dialog")).toHaveCount(0);
  await expect(page.getByTestId("panel-region")).toContainText("(26,52)");
});

test("the battles dialog closes on Escape", async ({ page }) => {
  await loadReport(page);

  await page.getByTestId("battles-chip").click();
  await expect(page.getByTestId("battles-dialog")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByTestId("battles-dialog")).toHaveCount(0);
});

/*
 * The map itself.
 *
 * None of this could be asserted while the map was a canvas: a canvas is one opaque element, so
 * the suite could only check that the accessibility shim beside it existed. These read the drawing.
 */

test("terrain is drawn as itself rather than as a picture of itself", async ({ page }) => {
  await loadReport(page);

  // Inholm is mountain, and several of the hexes this turn describes are ocean. Drawn in the
  // default theme's own palette: a theme whose stylesheet nobody imported renders every hex
  // unstyled, which is exactly the failure this catches.
  const mountain = page.locator("polygon.ct-terrain-mountain").first();
  const ocean = page.locator("polygon.ct-terrain-ocean").first();
  await expect(mountain).toBeAttached();
  await expect(ocean).toBeAttached();

  // The class alone proves nothing - the component writes it whether or not any stylesheet
  // loaded - so the paint itself is read. With the biome textures on, a hex's fill is an inline
  // `url(#biome-texture-...)`, which differs by terrain even under no stylesheet at all and would
  // make this vacuous; turning them off puts the fill back where the theme's rules decide it.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-biome-textures").uncheck();
  await page.keyboard.press("Escape");

  const fillOf = (polygon: typeof mountain) =>
    polygon.evaluate((node) => getComputedStyle(node).fill);
  const [mountainFill, oceanFill] = await Promise.all([fillOf(mountain), fillOf(ocean)]);

  // Terrain is data, so two terrains must not paint the same - and neither may fall back to the
  // SVG default, which is what an unstyled map looks like.
  expect(mountainFill).not.toBe(oceanFill);
  for (const fill of [mountainFill, oceanFill]) {
    expect(fill).not.toBe("none");
    expect(fill).not.toBe("rgb(0, 0, 0)");
  }

  // Back on, so later tests inherit the map they expect.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-biome-textures").check();
  await page.keyboard.press("Escape");
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

test("fitting the map puts every hex clear of the panes drawn over it", async ({ page }) => {
  await loadReport(page);

  await page.getByRole("button", { name: "Zoom to fit" }).click();

  // The panes float over the canvas rather than beside it, so fitting to the canvas centred the
  // world underneath them: the hexes were on screen and behind a panel, which is not "fitted" to
  // anyone looking at it. `visibleStrip` is the same value the map itself measured and fitted
  // against - not a second copy of the arithmetic re-derived from the pane boxes.
  const strip = await visibleStrip(page);
  const overflowing = await page.evaluate((visible) => {
    // Every known hex on this level, which is exactly the set the fit is computed from.
    return Array.from(document.querySelectorAll("polygon[data-region-id]"))
      .map((hex) => hex.getBoundingClientRect())
      .filter(
        (box) =>
          box.left < visible.x ||
          box.right > visible.x + visible.width ||
          box.top < visible.y ||
          box.bottom > visible.y + visible.height
      ).length;
  }, strip);

  expect(overflowing).toBe(0);
});

/**
 * The strip the fit is computed against is exposed, and the fit stays one-shot per level once a
 * pane's footprint changes underneath it (ah-lfo). Two facts pinned in one walk: `data-map-insets`
 * reads true against the layout the panes actually leave, and a pane folding after the first fit
 * moves nothing - the whole point of measuring the strip rather than re-fitting continuously.
 */
test("the first fit is against the strip the panes leave, and a later fold moves nothing", async ({
  page
}) => {
  await loadReport(page);

  // Every pane is open on a first load, so every inset is non-zero.
  const strip = await visibleStrip(page);
  expect(strip.width).toBeGreaterThan(0);
  expect(strip.height).toBeGreaterThan(0);

  const map = page.getByTestId("map-canvas");
  const before = await map.getAttribute("data-map-insets");
  const beforeInsets = JSON.parse(before as string) as { bottom: number };
  const transformBefore = await mapTransform(page);

  await foldPanel(page, "units");

  // The measured strip changes - the bottom inset shrinks once the units pane's footprint does -
  // but the map itself does not re-fit: the fit is one-shot per level (ah-ppd/ah-ian), and this
  // bead only makes the strip it used a measured, exposed value rather than a continuous one.
  await expect
    .poll(async () => {
      const raw = await map.getAttribute("data-map-insets");
      return raw ? (JSON.parse(raw) as { bottom: number }).bottom : null;
    })
    .toBeLessThan(beforeInsets.bottom);
  expect(await mapTransform(page)).toBe(transformBefore);
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

test("the cursor may wander as far into the unexplored as it likes", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  // Coordinates an ally names can lie a long way outside anything the faction has seen, so the
  // cursor is not fenced in. The view follows it, and focus never falls through to the body.
  await page.getByRole("button", { name: "hex 1:7,53" }).press("ArrowUp");
  for (let step = 0; step < 40; step += 1) {
    await page.locator("polygon:focus").press("ArrowUp");
  }

  await expect(page.locator("polygon:focus")).toHaveAttribute("aria-label", "unexplored 1:7,-29");
  await expect(page.getByTestId("map-focus-ring")).toBeVisible();
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

  await waitForStableBox(page, "region");
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

test("the selected hex is marked by the double ring", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  // Presence and placement only - not the pulse animation, which WebKit timing makes flaky to
  // assert directly.
  const ring = page.getByTestId("map-selection-ring");
  await expect(ring).toBeAttached();
  const hexButton = page.getByRole("button", { name: "hex 1:7,53" });
  await expect(hexButton).toHaveAttribute("transform", /.+/);
  const hexTransform = await hexButton.getAttribute("transform");
  await expect(ring).toHaveAttribute("transform", hexTransform ?? "");

  // The ring is theme-independent: it stays attached with the same placement in the light theme.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("theme-light").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await expect(ring).toBeAttached();
  await expect(ring).toHaveAttribute("transform", hexTransform ?? "");

  // Back to dark, so later tests inherit the default look. The dialog is still open from above.
  await page.getByTestId("theme-dark").click();
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

test("unexplored ground can be selected from the keyboard, and the way back still works", async ({
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
  expect(away).toBe("unexplored 1:7,49");

  // Coordinates a friend gave you are the whole reason to stand here, so Enter selects it and the
  // panel says which hex it is.
  await page.locator("polygon:focus").press("Enter");
  await expect(page.getByTestId("panel-region")).toContainText("unexplored (7,49)");
  await expect(page.getByTestId("panel-region")).toContainText("Nothing is known");
  await expect(page.getByRole("button", { name: "hex 1:7,53" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );

  // Down twice returns to where it started, because each arrow undoes its opposite.
  await page.locator("polygon:focus").press("ArrowDown");
  await page.locator("polygon:focus").press("ArrowDown");
  await expect(page.locator("polygon:focus")).toHaveAttribute("aria-label", "hex 1:7,53");
});

test("clicking empty ground names the hex that was clicked", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  // Inholm sits under the region panel, and a panel takes its own clicks. Folding it leaves the
  // map beneath live, which is where the hex being aimed at is.
  await waitForStableBox(page, "region");
  await foldPanel(page, "region");

  // One hex further north than Inholm's northern neighbour, stepped out in pixels from the two of
  // them: unexplored ground is one patterned rectangle, so there is no element out there to click
  // by name.
  const centre = (regionId: string) =>
    page.locator(`polygon[data-region-id="${regionId}"]`).evaluate((hex) => {
      const box = hex.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
  const here = await centre("1:7,53");
  const north = await centre("1:7,51");
  await page.mouse.click(north.x + (north.x - here.x), north.y + (north.y - here.y));

  await unfoldPanel(page, "region");

  await expect(page.getByTestId("panel-region")).toContainText("unexplored (7,49)");
  await expect(page.getByRole("button", { name: "hex 1:7,53" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});

test("a move can be planned into unexplored country, and says it is a guess", async ({ page }) => {
  await loadReport(page);
  await enableMovementPlanner(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // (7,51) is a mountain the report names; (7,49) beyond it is unexplored, and a friend's
  // coordinates are exactly the case this exists for.
  await page.getByTestId("planner-arm").click();
  await page.getByRole("button", { name: "hex 1:7,51" }).focus();
  await page.locator("polygon:focus").press("ArrowUp");
  await page.locator("polygon:focus").press("Enter");

  await expect(page.getByTestId("planner-route")).toBeVisible();
  await expect(page.getByTestId("planner-order")).toHaveText("MOVE N N");
  await expect(page.getByTestId("planner-estimate")).toContainText("unexplored");
  await expect(page.getByTestId("planner-route")).toContainText("estimated");
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

/**
 * Ground a neighbour merely named, which the map must say two things about at once.
 *
 * The fade over it is deliberately light, so the terrain the report gives is legible; what says
 * nobody has surveyed it is the rim. That division of labour only works if the rim outlives the
 * far zoom band - the band that hides every label precisely because labels stop fitting - so this
 * checks it where it would fail: zoomed all the way out, with nothing else left on the hex.
 */
test("unsurveyed ground is rimmed as such, and stays rimmed at the furthest zoom", async ({
  page
}) => {
  await loadReport(page);

  const rims = page.getByTestId("map-canvas").locator('[data-rim="unsurveyed"]');
  // Turn 71 names hexes it never visited, by way of its neighbours' exits.
  await expect(rims.first()).toBeAttached();
  const atRest = await rims.count();

  for (let step = 0; step < 8; step += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }

  // Still *visible*, not merely present. The map draws every hex on the level whatever the zoom
  // and the bands are pure CSS, so a count would be constant by construction - and a theme rule
  // hiding the rim in the far band, which is exactly the failure this guards, would slip past it.
  await expect(rims.first()).toBeVisible();
  expect(await rims.count()).toBe(atRest);
});

/**
 * The mirror of the lattice test above, and the point of ah-ebv.
 *
 * The lattice is a hairline the map holds at one screen pixel however far it is zoomed. A road is
 * the opposite kind of mark: it belongs to its hex, its spoke reaches to that hex's edge, and its
 * width has to fall with the map or it ends up wider than the hex it is drawn in - which at the
 * furthest zoom is exactly where the zoom band leaves roads as the last thing on screen. So the
 * invariant is a width constant in *user* units, and a screen width that shrinks with the scale.
 * The route is drawn over the roads and measured the same way, so a path and the road under it
 * keep their relationship at every zoom.
 */
test("a road and the route over it keep their proportion to the hex at every zoom", async ({
  page
}) => {
  await loadReport(page);
  await enableMovementPlanner(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "MOVE N");
  await expect(page.getByTestId("route-line-solid")).toHaveCount(1);

  const measure = () =>
    page.evaluate(() => {
      const svg = document.querySelector('[data-testid="map-canvas"] svg')!;
      const road = document.querySelector(".ct-road")!;
      const route = document.querySelector('[data-testid="route-line-solid"]')!;
      // The width alone cannot tell the two behaviours apart: `non-scaling-stroke` is a paint
      // effect, so the computed stroke-width reads the same 4 user units either way while the
      // browser draws 4 screen pixels. What the mark is measured in is the vector-effect.
      return {
        scale: Number(getComputedStyle(svg).getPropertyValue("--map-scale")),
        road: parseFloat(getComputedStyle(road).strokeWidth),
        roadEffect: getComputedStyle(road).vectorEffect,
        route: parseFloat(getComputedStyle(route).strokeWidth),
        routeEffect: getComputedStyle(route).vectorEffect
      };
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

  // The scales really did move, or the rest of this proves nothing.
  expect(zoomedIn.scale).toBeGreaterThan(atRest.scale);
  expect(zoomedOut.scale).toBeLessThan(atRest.scale);

  // Measured in the world, not on the screen - at every zoom, since a stroke could in principle be
  // opted out of the transform only in one band.
  for (const sample of [atRest, zoomedIn, zoomedOut]) {
    expect(sample.roadEffect).toBe("none");
    expect(sample.routeEffect).toBe("none");
  }

  // Constant in user units: the same fraction of a hex, whatever the map is doing.
  expect(zoomedIn.road).toBeCloseTo(atRest.road, 3);
  expect(zoomedOut.road).toBeCloseTo(atRest.road, 3);
  expect(zoomedIn.route).toBeCloseTo(atRest.route, 3);
  expect(zoomedOut.route).toBeCloseTo(atRest.route, 3);

  // Which is to say: narrower on screen the further out the map goes.
  expect(zoomedOut.road * zoomedOut.scale).toBeLessThan(atRest.road * atRest.scale);
  expect(zoomedOut.route * zoomedOut.scale).toBeLessThan(atRest.route * atRest.scale);

  // A road is a line inside its hex rather than a mark across it - and because both are now in the
  // same units, holding at one zoom is holding at all of them. The hex is 2 * HEX_RADIUS = 36 units
  // wide; the bug this pins was a road wider than that once the map had shrunk it.
  expect(zoomedOut.road).toBeLessThan(36 / 4);
});

/**
 * Issue #81: the units table and the unit panel show the coming month as the player types orders.
 *
 * A renamed unit's row carries the new name styled as predicted, with the report's name in the
 * cell's hover text; GUARD raises the badge; a MOVE dims the row and says where the unit is bound.
 * All of it follows the editor on the same debounce as validation, so typing is all it takes.
 */
test("orders change the units table to show the coming month", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  const row = page.getByTestId(`unit-row-${OWN_UNIT}`);
  await expect(row).toContainText("Seven of Eight");

  await fillOrders(page, 'NAME UNIT "Nine of Eight"\nGUARD 1');

  await expect(row).toContainText("Nine of Eight");
  await expect(row.locator('[data-predicted="true"]').first()).toHaveAttribute(
    "title",
    "was: Seven of Eight"
  );
  await expect(row).toContainText("on guard");

  // AVOID is a flag the table has no column for; the unit panel's flag list shows the coming
  // month instead - the report's "avoiding" gone, the rest still standing.
  await fillOrders(page, "AVOID 0");
  const flags = page.getByTestId("panel-unit").locator('[data-predicted="true"]');
  await expect(flags).toContainText("behind");
  await expect(flags).not.toContainText("avoiding");

  // A move dims the row into a departure that names where the unit ends the month, and the
  // destination hex's table gains the arriving row.
  await fillOrders(page, "MOVE N");
  await expect(row).toHaveAttribute("data-preview-status", "departing");
  await expect(row).toContainText("→ 1:7,51");
  await selectHex(page, "1:7,51");
  await expect(page.getByTestId(`unit-row-${OWN_UNIT}`)).toHaveAttribute(
    "data-preview-status",
    "arriving"
  );

  // Blanking the orders puts the report back on screen.
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "");
  await expect(row).toContainText("Seven of Eight");
  await expect(row).not.toHaveAttribute("data-preview-status", /.+/);
});

/**
 * ah-cp8: a narrow window used to clip the right-hand end of the header (Export, the settings
 * gear) instead of adapting. The header now wraps into two groups, with the actions group
 * dropping to its own right-aligned row when the game-state group has already taken the width.
 */
test("a narrow window wraps the header instead of clipping it", async ({ page }) => {
  await loadReport(page);
  await page.setViewportSize({ width: 520, height: 720 });

  const exportMenu = page.getByTestId("export-menu");
  const settings = page.getByTestId("settings-indicator");
  await expect(exportMenu).toBeVisible();
  await expect(settings).toBeVisible();

  const exportBox = (await exportMenu.boundingBox())!;
  const settingsBox = (await settings.boundingBox())!;
  const view = page.viewportSize()!;
  expect(exportBox.x + exportBox.width).toBeLessThanOrEqual(view.width);
  expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(view.width);

  // Taller than one row proves the actions group wrapped rather than merely shrinking in place.
  const headerBox = (await page.getByTestId("app-header").boundingBox())!;
  expect(headerBox.height).toBeGreaterThan(40);
});

/**
 * ah-cp8: the faction view's body was capped at 40vh regardless of how much room the window had,
 * so a faction with many declared attitudes always scrolled even with space to spare below it.
 * The clamp now follows the viewport, so at the default 720px-tall window the last attitude row
 * is on screen without scrolling.
 */
test("the faction view uses the window before it scrolls", async ({ page }) => {
  await loadReport(page);
  await page.getByTestId("faction-chip").click();

  const panel = page.getByTestId("faction-panel");
  await expect(panel).toBeVisible();

  const lastAttitudeRow = panel.locator('[data-testid^="faction-attitude-"]').last();
  await expect(lastAttitudeRow).toBeInViewport();

  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(720);
});

/**
 * ah-o1t.2: manual hex notes, written from the region panel's Notes section. A note survives a
 * reload and can be removed through the in-row confirmation.
 */
test("a note written on a hex is still there after a reload", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  await page.getByTestId("region-note-add").click();
  await page.getByTestId("region-note-editor").locator("textarea").fill("Build a castle here");
  await page.keyboard.press("ControlOrMeta+Enter");

  const note = page.getByTestId("region-note").filter({ hasText: "Build a castle here" });
  await expect(note).toContainText("turn 71");
  // The row above appears optimistically, before the store's `add()` has awaited the actual
  // storage write; the editor closing is what proves that write landed. Reloading before this
  // is a real race - the note is durable in memory a tick before it is durable on disk.
  await expect(page.getByTestId("region-note-editor")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await selectHex(page, "1:7,53");
  await expect(page.getByTestId("region-note").filter({ hasText: "Build a castle here" })).toBeVisible();

  await note.getByTestId("region-note-remove").click();
  await expect(note).toContainText("Remove this note?");
  await note.getByTestId("region-note-remove").click();
  await expect(page.getByText("No notes on this hex.")).toBeVisible();
});

/** ah-o1t.2: the palette's "Add note to this hex" opens the editor, focused, for the selected hex. */
test("the palette can open the note editor for the selected hex", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("Add note");
  await expect(page.getByTestId("palette-item").first()).toContainText("Add note to this hex");
  await page.keyboard.press("Enter");

  const editor = page.getByTestId("region-note-editor").locator("textarea");
  await expect(editor).toBeFocused();
});

/**
 * ah-o1t.3: the map-owned pin for a map-visible note, and its tag stack - opening, closing, and
 * the Badges menu's `Notes` entry that hides the whole layer.
 */
test("a note pinned on the map opens its tags and selects the hex", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  // The pin is hidden at the far band, and a freshly imported report frames every explored hex -
  // usually far. Right-click recentres on the selected hex (the map's own gesture), then zoom in
  // about the viewport centre keeps it in view while the band changes.
  await page.getByRole("button", { name: "hex 1:7,53" }).click({ button: "right" });
  const map = page.locator("[data-testid='map-canvas'] svg");
  for (let step = 0; step < 12; step += 1) {
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  await expect(map).not.toHaveClass(/map-far/);

  await page.getByTestId("region-note-add").click();
  await page.getByTestId("region-note-editor").locator("textarea").fill("Allies mass here");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("region-note-editor")).toHaveCount(0);

  // Select another hex first, so the pin's own click is what selects 1:7,53 back.
  await selectHex(page, "1:8,54");

  const pin = page.getByTestId("map-note-pin");
  await expect(pin).toHaveAttribute("aria-label", "notes on hex 1:7,53");

  await pin.click();
  const tags = page.getByTestId("map-note-tags");
  await expect(tags).toBeVisible();
  await expect(tags).toContainText("Allies mass here");
  await expect(tags).toContainText("turn 71");
  await expect(
    page.getByRole("button", { name: "hex 1:7,53", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  // The pin also moves keyboard focus to the hex it selected, like a hex's own click handler
  // does - otherwise the arrow keys would carry on from wherever focus was before the pin click.
  await expect(page.locator("polygon:focus")).toHaveAttribute("aria-label", "hex 1:7,53");

  await page.keyboard.press("Escape");
  await expect(tags).toHaveCount(0);

  await pin.click();
  await expect(page.getByTestId("map-note-tags")).toBeVisible();

  // A press on empty page background - nothing to do with the pin or the tags - closes it too.
  await page.mouse.click(10, 10);
  await expect(page.getByTestId("map-note-tags")).toHaveCount(0);

  await page.getByTestId("layer-chips").getByRole("button", { name: "Badges" }).click();
  const badges = page.getByTestId("badge-menu");
  const notesCheckbox = badges.getByRole("checkbox", { name: "Notes" });
  await expect(notesCheckbox).toBeChecked();
  // Toggled by keyboard rather than a pointer click: this fixture's own always-on finding
  // (ah-1uj) grows the header by a chip's width, which pushes this popover's anchor - and with it
  // a list long enough to reach the units pane splitter below - just far enough that a real
  // pointer click here can land on the splitter instead. The checkbox itself is unaffected; only
  // where a mouse can safely land on it is.
  await notesCheckbox.focus();
  await page.keyboard.press("Space");
  await expect(notesCheckbox).not.toBeChecked();
  await expect(page.getByTestId("map-note-pin")).toHaveCount(0);

  // The menu stays open across a toggle - unchecking it does not dismiss the popover.
  await page.keyboard.press("Space");
  await expect(notesCheckbox).toBeChecked();
  await expect(page.getByTestId("map-note-pin")).toBeVisible();
});

/**
 * ah-46p.1: the panes' type used to be set in absolute `px`, which ignores the reader's own
 * font-size preference outright. The three `--text-pane*` tokens are `rem`, so raising the root
 * font size (what a reader's preference actually changes) must reach the panes - and the region
 * panel must still fit inside its rail once it does.
 */
test("the panes grow when the reader's text size does", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");

  const header = page.getByTestId("app-header");
  const defaultSize = await header.evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize)
  );

  await page.addStyleTag({ content: "html { font-size: 20px }" });

  const grownSize = await header.evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize)
  );
  expect(grownSize).toBeGreaterThan(defaultSize);

  const rail = page.locator('[data-map-overlay="left"]');
  const railBox = (await rail.boundingBox())!;
  const view = page.viewportSize()!;
  expect(railBox.x).toBeGreaterThanOrEqual(0);
  expect(railBox.x + railBox.width).toBeLessThanOrEqual(view.width);
  expect(railBox.y + railBox.height).toBeLessThanOrEqual(view.height);
});

test("the web build offers no Send button, because it could never read the reply", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "web",
    "the desktop bundle passes an uploader, so it has the control this pins the absence of"
  );

  await loadReport(page);

  // The game server sends no CORS headers, so the web shell passes no uploader and the control is
  // absent rather than disabled - the decision recorded on ah-etb0.2.
  await expect(page.getByTestId("send-orders")).toHaveCount(0);
});

test("a skill named in the unit panel opens its game data entry", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  // The whole point of ah-5jkt.2: the names the panes already show are the way into the
  // dictionary, so nobody has to know the tag or find the palette first.
  const skill = page
    .getByTestId("panel-unit")
    .locator("[data-game-data-entry^='skill:']")
    .first();
  const name = (await skill.textContent())?.trim() ?? "";
  expect(name).not.toBe("");
  await skill.click();

  await expect(page.getByTestId("game-data-dialog")).toBeVisible();
  await expect(page.getByTestId("game-data-tab-skill")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("game-data-detail")).toContainText(name);
});

/**
 * ah-bu2c: a faction's name is a way into everything the turn knows about that faction.
 *
 * The hex is `1:10,50`, which holds several units of Elder Tree Forests (32), a faction the
 * attitudes block declares Ally toward and whose units are spread across three hexes - so the
 * dossier has an attitude, several hexes and a long unit list to show.
 */
const DOSSIER_HEX = "1:10,50";
const DOSSIER_FACTION = "32";

test("a faction name in the units table opens its dossier", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, DOSSIER_HEX);

  // Which row is selected before the name is clicked, so the click can be shown to have opened a
  // dossier and nothing else: the row is itself a click target that selects the unit, and a button
  // inside it would otherwise do both at once (Copilot, #478).
  const selectedBefore = await page
    .locator("tr[data-selected='true']")
    .first()
    .getAttribute("data-testid");

  await page.getByTestId(`open-faction-dossier-${DOSSIER_FACTION}`).first().click();

  await expect(page.locator("tr[data-selected='true']").first()).toHaveAttribute(
    "data-testid",
    selectedBefore ?? ""
  );

  const dossier = page.getByTestId("faction-dossier");
  await expect(dossier).toBeVisible();
  await expect(dossier).toContainText("Elder Tree Forests");
  await expect(dossier).toContainText("Ally");
  // Their units stand in three hexes, each counted - so "seen in" is a real list, not one row.
  await expect(dossier).toContainText("swamp (10,50)");
  await expect(dossier).toContainText("8 units");
  await expect(dossier).toContainText(
    "Where their units are this turn. Earlier turns are not remembered."
  );
  await expect(dossier).toContainText("A unit hiding its faction is not counted here.");
  // The map is still there to draw a highlight on, which is the whole reason this is a popover
  // rather than a dialog: a modal would dim the very hex the ring goes on.
  await expect(page.getByTestId("panel-region")).toContainText("(10,50)");
});

test("a faction name in the attitudes list opens its dossier", async ({ page }) => {
  await loadReport(page);

  await page.getByTestId("faction-chip").click();
  await page.getByTestId("open-faction-dossier-2").click();

  const dossier = page.getByTestId("faction-dossier");
  await expect(dossier).toBeVisible();
  await expect(dossier).toContainText("Creatures");
  await expect(dossier).toContainText("Hostile");

  // The attitudes list cannot hold a nested popover - its body scrolls - so the dossier takes its
  // place, and there has to be a way back to where the reader came from.
  await expect(page.getByTestId("faction-panel")).toHaveCount(0);
  await page.getByTestId("dossier-back").click();
  await expect(page.getByTestId("faction-panel")).toBeVisible();
});

test("tabbing to a hex row rings it on the map", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, DOSSIER_HEX);
  await page.getByTestId(`open-faction-dossier-${DOSSIER_FACTION}`).first().click();

  const row = page.getByTestId(`dossier-hex-${DOSSIER_HEX}`);
  await expect(row).toBeVisible();
  // The panel opens beside the name clicked, so it lands under the pointer and whichever row is
  // beneath it is genuinely hovered. Move away first, or "no ring yet" is not the state we are in.
  await page.mouse.move(4, 4);
  await expect(page.getByTestId("map-highlight-ring")).toHaveCount(0);

  // Focus, not hover: a hover-only implementation shows a keyboard reader nothing at all, and
  // every other test here would still pass.
  await row.focus();
  await expect(page.getByTestId("map-highlight-ring")).toHaveCount(1);

  await row.blur();
  await expect(page.getByTestId("map-highlight-ring")).toHaveCount(0);
});

test("a focused dossier row moves the map and leaves it there", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, DOSSIER_HEX);
  await page.getByTestId(`open-faction-dossier-${DOSSIER_FACTION}`).first().click();

  const row = page.getByTestId(`dossier-hex-${DOSSIER_HEX}`);
  await expect(row).toBeVisible();
  // The panel opens beside the name clicked, over the map - so the ringed hex is underneath it,
  // which is the case that was reported (ah-mwqa): the highlight existed and could not be seen.
  await page.mouse.move(4, 4);
  const before = await mapTransform(page);

  await row.focus();
  await expect.poll(() => mapTransform(page)).not.toBe(before);
  const moved = await mapTransform(page);

  // Focus is navigation, not a peek: tabbing away must NOT put the map back. This is the decision
  // most likely to be "fixed" into a regression later - see the bead's user-facing decisions.
  await row.blur();
  await expect(page.getByTestId("map-highlight-ring")).toHaveCount(0);
  expect(await mapTransform(page)).toBe(moved);
});

test("a hovered dossier row peeks at its hex and the map comes back", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, DOSSIER_HEX);
  await page.getByTestId(`open-faction-dossier-${DOSSIER_FACTION}`).first().click();

  const row = page.getByTestId(`dossier-hex-${DOSSIER_HEX}`);
  await expect(row).toBeVisible();
  await page.mouse.move(4, 4);
  const before = await mapTransform(page);

  await row.hover();
  await expect.poll(() => mapTransform(page)).not.toBe(before);

  // Leaving the row puts the view back exactly, and at once - a delayed restore reads as the map
  // drifting by itself.
  await page.mouse.move(4, 4);
  await expect.poll(() => mapTransform(page)).toBe(before);
});

test("reopening after dismissal draws no ring", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, DOSSIER_HEX);
  await page.getByTestId(`open-faction-dossier-${DOSSIER_FACTION}`).first().click();

  await page.mouse.move(4, 4);
  await page.getByTestId(`dossier-hex-${DOSSIER_HEX}`).focus();
  await expect(page.getByTestId("map-highlight-ring")).toHaveCount(1);

  // Escape rather than the close button: clicking ✕ blurs the row, which clears the hover on the
  // way out and cannot reproduce the scar at all. Escape closes the panel with the row still
  // focused, so the row never fires blur or pointerleave and the last hover survives the
  // unmount - which is exactly how reopening drew a ring with the pointer nowhere near it
  // (Copilot, #398). Verified by mutation: deleting the forgetting effect fails this.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("faction-dossier")).toHaveCount(0);

  // Reopened from the keyboard, with the pointer parked far away: a mouse click would put the
  // pointer over the reopened panel, hover whichever row landed under it, and draw a ring for a
  // reason that has nothing to do with the scar - and moving the pointer off afterwards would
  // clear the stale hover too, hiding the very thing this test exists for. Verified by mutation:
  // deleting AppShell's forgetting effect fails this.
  const trigger = page.getByTestId(`open-faction-dossier-${DOSSIER_FACTION}`).first();
  await trigger.focus();
  await trigger.press("Enter");
  await expect(page.getByTestId("faction-dossier")).toBeVisible();
  await expect(page.getByTestId("map-highlight-ring")).toHaveCount(0);
});

test("clicking a hex row selects that hex, and a unit row selects that unit", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, DOSSIER_HEX);
  await page.getByTestId(`open-faction-dossier-${DOSSIER_FACTION}`).first().click();

  // A unit of theirs standing in a DIFFERENT hex, so the assertion cannot pass by the selection
  // simply staying where it already was.
  const unitRow = page.getByTestId("dossier-unit-1962");
  await expect(unitRow).toBeVisible();
  await unitRow.click();
  await expect(page.getByTestId("faction-dossier")).toHaveCount(0);
  await expect(page.getByTestId("panel-region")).toContainText("(26,52)");

  await page.getByTestId(`open-faction-dossier-${DOSSIER_FACTION}`).first().click();
  await page.getByTestId(`dossier-hex-${DOSSIER_HEX}`).click();
  await expect(page.getByTestId("faction-dossier")).toHaveCount(0);
  await expect(page.getByTestId("panel-region")).toContainText("(10,50)");
});
