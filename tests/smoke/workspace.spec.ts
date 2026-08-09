import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { clearGames, createGame } from "./gameSetup";
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
/**
 * Clicks a unit in the table.
 *
 * Scoped to its row rather than found by accessible name: Playwright matches names by substring,
 * and the orders panel header also reads "unit 18642" once that unit is selected.
 */
async function selectUnit(page: Page, unitId: string) {
  await page.getByTestId(`unit-row-${unitId}`).getByRole("button").click();
}

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
  await expect(page.getByTestId("orders-status")).toContainText("1 in document");
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

  const cells = await page.locator("[data-testid^='unit-row-'] td:nth-child(5)").allInnerTexts();
  expect(cells.length).toBeGreaterThan(50);
  expect(cells.filter((cell) => cell.startsWith("~"))).toEqual([]);

  // And a multi-race unit reads as its parts rather than as its largest group.
  await selectHex(page, "1:26,52");
  await selectUnit(page, "15807");
  await expect(page.getByTestId("panel-unit")).toContainText("99");
  await expect(page.getByTestId("panel-unit")).toContainText("gnolls");
});
