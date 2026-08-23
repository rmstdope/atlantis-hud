import { expect, test, type Page } from "@playwright/test";
import {
  clearGames,
  createGame,
  expectOrders,
  fillOrders,
  loadReport,
  mapTransform,
  ordersInput,
  selectHex,
  selectUnit
} from "./gameSetup";

/**
 * The global keyboard layer (#91): the command palette, faction-wide unit cycling, the
 * diagnostic walk, and the shortcut cheat sheet. Every walk here goes through real keydowns,
 * because the layer under test is precisely the one that turns keydowns into actions.
 */

/** "Seven of Eight", the player's unit in Inholm at (7,53). */
const OWN_UNIT = "18642";
/** Another of the player's units, in the mountain at (26,52). */
const OTHER_OWN_UNIT = "13401";

test("the palette opens on Mod+K, finds a unit, and Enter goes to it", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();

  await page.getByTestId("palette-input").fill("seven of eight (18642)");
  await expect(page.getByTestId("palette-item").first()).toContainText("Seven of Eight");
  await page.keyboard.press("Enter");

  await expect(palette).toHaveCount(0);
  await expect(page.getByTestId("panel-unit")).toContainText("Seven of Eight");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");
});

test("the palette goes to a structure's hex, and tells one from a dictionary page", async ({
  page
}) => {
  await loadReport(page);

  // A structure the player named, in the mountain at (7,53).
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("Cartographers HQ");
  await expect(page.getByTestId("palette-item").first()).toContainText("Cartographers HQ [1]");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("panel-region")).toContainText("Inholm");

  // "mine" names both a thing standing on the map and the dictionary's page about mines, and the
  // list has to say which is which (ah-wkwk).
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("mine");
  const items = page.getByTestId("palette-item");
  await expect(items.filter({ hasText: "structure" }).first()).toBeVisible();
  await expect(items.filter({ hasText: "building" }).first()).toBeVisible();
});

test("arrowing down a long list keeps the highlight on screen", async ({ page }) => {
  await loadReport(page);

  // "m" matches most of the palette, which used to be truncated to twelve rows with nothing on
  // screen to say so (ah-yk6b). Now the list scrolls and the highlight follows the arrows.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("m");
  const items = page.getByTestId("palette-item");
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeGreaterThan(12);

  // The dialog fits the window however many rows matched.
  const dialog = page.getByRole("dialog", { name: "Command palette", exact: true });
  const box = (await dialog.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);

  for (let at = 0; at < 25; at += 1) {
    await page.keyboard.press("ArrowDown");

  }
  await expect(items.nth(25)).toHaveAttribute("aria-selected", "true");
  await expect(items.nth(25)).toBeInViewport();

  // Clamping, not wrapping: holding Down settles on the last row rather than cycling.
  const total = await items.count();
  for (let at = 0; at < total + 5; at += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(items.nth(total - 1)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-testid="palette-item"][aria-selected="true"]')).toBeInViewport();
});

test("the palette goes to a region and runs an action", async ({ page }) => {
  await loadReport(page);

  // A region, by its map label.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("ocean (20,40)");
  await expect(page.getByTestId("palette-item").first()).toContainText("ocean (20,40)");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("panel-region")).toContainText("Atlantis Ocean");

  // An action, by name: the theme flips where the stylesheet can see it.
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? "dark");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("toggle theme");
  await expect(page.getByTestId("palette-item").first()).toContainText("Toggle theme");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .not.toBe(before);
});

test("the palette opens the game data dictionary on the thing it named", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("mining MINI");
  await expect(page.getByTestId("palette-item").first()).toContainText("mining");
  await page.keyboard.press("Enter");

  const dialog = page.getByTestId("game-data-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("game-data-detail")).toContainText("Study cost");
  await expect(page.getByTestId("game-data-tab-skill")).toHaveAttribute("aria-selected", "true");

  // A produced item is a way across to it, and Escape closes the whole dialog from there.
  await page.getByTestId("game-data-link-equipment:MITH").click();
  await expect(page.getByTestId("game-data-tab-equipment")).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByTestId("game-data-detail")).toContainText("mining");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

/**
 * ah-rpnb: a building entry names the skill that builds it, and that name is a way to reach it -
 * the same cross-reference rule ah-5jkt.1 set for a skill's produced items.
 */
test("following a building's build skill opens that skill's entry", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("mining MINI");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("game-data-dialog")).toBeVisible();

  await page.getByTestId("game-data-tab-building").click();
  await page.getByTestId("game-data-entry-building:MINE").click();
  await expect(page.getByTestId("game-data-detail")).toContainText("Built with");

  await page.getByTestId("game-data-link-skill:MINI").click();
  await expect(page.getByTestId("game-data-tab-skill")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("game-data-detail")).toContainText("Study cost");
});

test("Escape closes only the palette, not the dialog under it", async ({ page }) => {
  await loadReport(page);

  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
  await expect(page.getByTestId("settings-panel")).toBeVisible();
});

test("Alt+Arrows cycle the faction's units even while the editor is focused", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  await fillOrders(page, "@work\nTAX");
  await ordersInput(page).click();

  // The walk moves somewhere else entirely - and moves no line of text on its way out.
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByTestId("panel-orders")).not.toContainText(`unit ${OWN_UNIT}`);

  // And back, to the same unit with the same words in the same order.
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByTestId("panel-orders")).toContainText(`unit ${OWN_UNIT}`);
  await expectOrders(page, /^@work\nTAX\n?$/);
});

test("F8 walks to a problem in another unit's orders", async ({ page }) => {
  await loadReport(page);

  // Six of Two (13402), in the same hex as OTHER_OWN_UNIT below, is reported already at combat 5
  // and orders "@study comb" regardless of anything this test does - a genuine study-at-maximum
  // finding (ah-1uj) the walk below is not about, so it is turned off to keep this test isolated
  // to the one syntax problem it introduces. That hex also holds six Borg mages studying force or
  // pattern above level 2 aboard a Cloudship (magic-study-outside-building, ah-a2k.2), which the
  // walk would otherwise stop at first, so it goes off for the same reason. And the fixture's two
  // units with no orders at all - 14451 and 13432 - are `unit-does-nothing` findings (ah-dwk6)
  // that sort ahead of this one, so that check goes off for the third time for the same reason.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-tab-warnings").click();
  await page.getByTestId("settings-warning-study-at-maximum").uncheck();
  await page.getByTestId("settings-warning-magic-study-outside-building").uncheck();
  await page.getByTestId("settings-warning-unit-does-nothing").uncheck();
  await page.keyboard.press("Escape");

  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "@work\nWROK");
  await expect(page.getByTestId("orders-status")).toContainText("1 error");

  // From a different unit entirely: the walk crosses the faction, not one editor. Pressed
  // from that unit's editor - in the unit filter the chord belongs to the filter, by design.
  await selectHex(page, "1:26,52");
  await selectUnit(page, OTHER_OWN_UNIT);
  await ordersInput(page).click();

  await page.keyboard.press("F8");
  await expect(page.getByTestId("panel-unit")).toContainText(OWN_UNIT);
  // The offending word stands selected in the editor, ready to be typed over.
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("WROK");
});

test("Mod+/ shows how to get around, with the mouse as well as the keyboard", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("ControlOrMeta+/");
  const help = page.getByTestId("shortcut-help");
  await expect(help).toBeVisible();
  await expect(help).toContainText("command palette");
  await expect(help).toContainText("next unit");
  await expect(help).toContainText("F8");

  // The mouse half: the gestures the map answers to, which nothing else in the application says.
  await expect(help).toContainText("Drag");
  await expect(help).toContainText("wheel");
  await expect(help).toContainText("Shift+drag");
  await expect(help).toContainText("Bring a hex to the middle of the view");
  await expect(help).toContainText("Right-click it");

  // It holds more than a screenful now, so the body scrolls - and the switch and the close button
  // stay put outside it, where a reader who has scrolled to the bottom can still find them.
  const body = page.getByTestId("shortcut-help-body");
  await expect(body).toBeVisible();
  const scrollable = await body.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrollable).toBe(true);
  await expect(page.getByTestId("shortcut-help-at-startup")).toBeVisible();
  await expect(page.getByTestId("shortcut-help-close")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
});

/**
 * The gestures the overlay now advertises, done for real. A cheat sheet that describes a gesture
 * the application does not have is worse than no cheat sheet, and only this can tell.
 */
test("the map really answers the gestures the overlay describes", async ({ page }) => {
  await loadReport(page);
  // The turn-71 report carries one finding of its own (ah-1uj), so the header's problems chip is
  // never absent for this fixture - wait for it before measuring the map, or a late-mounting chip
  // can shift the layout under a corner coordinate captured too early.
  await expect(page.getByTestId("problems-chip")).toBeVisible();
  const map = page.getByTestId("map-canvas");
  const box = await map.boundingBox();
  if (!box) {
    throw new Error("the map has no box to gesture over");
  }
  // The map's top-left corner, which is the one part of the canvas no panel floats over: a press
  // anywhere else would be delivered to the panel rather than to the map. Where a drag ends does
  // not matter in the same way - it is followed on the window, so it may finish behind a panel.
  const open = { x: box.x + 30, y: box.y + 20 };
  const hex = () => page.getByRole("button", { name: /^hex / }).first().boundingBox();

  // "Drag" pans: the hexes move under a pointer that never lifts.
  const before = await hex();
  await page.mouse.move(open.x, open.y);
  await page.mouse.down();
  await page.mouse.move(open.x + 120, open.y + 70, { steps: 8 });
  await page.mouse.up();
  // A hex that has gone missing reads back as the value we started from rather than as undefined,
  // which "is not the old x" would have accepted: a map that emptied itself would have passed for
  // a map that panned.
  await expect.poll(async () => (await hex())?.x ?? before?.x).not.toBe(before?.x);

  // "Roll the wheel over the map" zooms. Back over the open corner first: the wheel turns wherever
  // the pointer was left, and the pan left it deep in panel country.
  const beforeZoom = await hex();
  await page.mouse.move(open.x, open.y);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await hex())?.width ?? beforeZoom?.width).not.toBe(
    beforeZoom?.width
  );

  // "Shift+drag" marks out an area to export, rather than panning.
  await page.keyboard.down("Shift");
  await page.mouse.move(open.x, open.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 30, box.y + box.height - 30, { steps: 8 });
  await expect(page.getByTestId("map-marquee")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("map-export-panel")).toBeVisible();
});

test("right-click centres the view on a hex, without selecting it", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await expect(page.getByRole("button", { name: "hex 1:7,53", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  const map = page.getByTestId("map-canvas");
  const box = await map.boundingBox();
  if (!box) {
    throw new Error("the map has no box to gesture over");
  }
  // The same open corner the other gestures use - the only part of the canvas no panel floats
  // over.
  const open = { x: box.x + 30, y: box.y + 20 };

  // A witness independent of the handler under test: if `onContextMenu` ever forgot its
  // `preventDefault()`, the browser's own menu would still be asked for even though the map also
  // recentred, and this is what would catch that. Registered on `window` in the bubble phase
  // (the default), which is what makes it see the event *after* React's own handling has had its
  // chance to call `preventDefault()` - a capture-phase listener would run first and always read
  // `defaultPrevented: false`, telling this nothing.
  await page.evaluate(() => {
    (window as unknown as { __contextMenuPrevented?: boolean }).__contextMenuPrevented = false;
    window.addEventListener("contextmenu", (event) => {
      (window as unknown as { __contextMenuPrevented?: boolean }).__contextMenuPrevented =
        event.defaultPrevented;
    });
  });

  const before = await mapTransform(page);
  await page.mouse.click(open.x, open.y, { button: "right" });
  await expect.poll(() => mapTransform(page)).not.toBe(before);
  expect(
    await page.evaluate(
      () => (window as unknown as { __contextMenuPrevented?: boolean }).__contextMenuPrevented
    )
  ).toBe(true);

  // Centring, not selecting: the hex chosen earlier keeps the ring.
  await expect(page.getByRole("button", { name: "hex 1:7,53", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // The idempotence claim - centring on the hex already in the middle changes nothing - lives in
  // `packages/shared/src/workspace/mapViewport.test.ts` against the pure `centreOn` and
  // `coordinateAt`. It is deliberately not asserted here: comparing transform strings in the
  // browser raced the strip measurement and cost six beads a re-run each (ah-d00t). Do not
  // restore it. What this spec keeps is only what needs a browser.
});

/**
 * The turn's problems walked one at a time, by mouse as well as by key (ah-dlao).
 *
 * The two units with no orders at all - 14451 and 13432 - are `unit-does-nothing` findings
 * (ah-dwk6) standing first in document order, so with the fixture's other standing warnings off
 * they are the whole list and the walk's stops are known. They are also the shape that has no
 * offending word to select, which is what the landing below is about.
 */
async function onlyTheUnitsWithNoOrders(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-tab-warnings").click();
  await page.getByTestId("settings-warning-study-at-maximum").uncheck();
  await page.getByTestId("settings-warning-magic-study-outside-building").uncheck();
  await page.getByTestId("settings-warning-unit-does-nothing").check();
  await page.keyboard.press("Escape");
}

/** The first unit with no orders, and the walk's first stop. */
const IDLE_UNIT = "14451";
/** The second, and its second stop. */
const OTHER_IDLE_UNIT = "13432";

test("a problem with no offending word lands the cursor at the end of the orders", async ({
  page
}) => {
  await loadReport(page);
  await onlyTheUnitsWithNoOrders(page);

  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  // A unit told only to avoid combat has been given no order that spends its month, which is a
  // `unit-does-nothing` finding (ah-dwk6) - the shape that names a line but no columns, because
  // there is no wrong word in the orders to point at. The order that is *missing* is what the
  // player has to type, so the cursor belongs after what is already there.
  await fillOrders(page, "AVOID 1");
  // Validation is debounced, so the walk has nothing to step until the count has landed.
  await expect(page.getByTestId("problems-chip")).toContainText(/[1-9]\d* problems?/);

  await selectHex(page, "1:26,52");
  await selectUnit(page, OTHER_OWN_UNIT);
  await ordersInput(page).click();

  // The walk crosses the whole faction and the fixture has other idle units in it, so step until
  // it reaches this one rather than assuming it is first.
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press("F8");
    if ((await page.getByTestId("panel-unit").textContent())?.includes(OWN_UNIT)) {
      break;
    }
  }
  await expect(page.getByTestId("panel-unit")).toContainText(OWN_UNIT);

  // Nothing stands selected - there is no wrong word to type over - and what is typed joins the
  // orders rather than replacing them.
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe("");
  await page.keyboard.type("\nWORK");
  await expectOrders(page, /^AVOID 1\nWORK\n?$/);
});

test("the walk buttons step to the next problem and back, and wrap at the end", async ({ page }) => {
  await loadReport(page);
  await onlyTheUnitsWithNoOrders(page);

  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  // Writing this unit's orders is what puts an orders document there to validate at all.
  await fillOrders(page, "@work\nTAX");
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");
  // Validation is debounced, so the walk has nothing to step until the count has landed - waiting
  // on the chip is what stops a click racing an empty list.
  await expect(page.getByTestId("problems-chip")).toContainText(/[1-9]\d* problems?/);

  const next = page.getByTestId("walk-problem-next");
  const prev = page.getByTestId("walk-problem-prev");
  const position = page.getByTestId("walk-position");
  const unitPane = page.getByTestId("panel-unit");

  // The counter is the walk's own barrier: one attribute that changes exactly once per click, so
  // nothing here waits on how much prose the unit pane happens to render (ah-9ess).
  await next.click();
  await expect(position).toHaveAttribute("data-position", /^1\/\d+$/);
  // It moved the view, not only the counter.
  await expect(unitPane).toContainText(/\(\d+\)/);

  await next.click();
  await expect(position).toHaveAttribute("data-position", /^2\/\d+$/);

  await prev.click();
  await expect(position).toHaveAttribute("data-position", /^1\/\d+$/);

  // Past the last problem the walk comes round again rather than stopping: step the whole list and
  // the counter is back at the top.
  const total = Number(
    ((await position.getAttribute("data-position")) ?? "1/1").split("/")[1]
  );
  expect(total).toBeGreaterThan(0);
  for (let step = 0; step < total; step += 1) {
    await next.click();
  }
  await expect(position).toHaveAttribute("data-position", `1/${total}`);
});

test("the walk keeps its place when validation re-runs under it", async ({ page }) => {
  await loadReport(page);
  await onlyTheUnitsWithNoOrders(page);

  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "@work\nTAX");
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");
  await expect(page.getByTestId("problems-chip")).toContainText(/[1-9]\d* problems?/);

  const next = page.getByTestId("walk-problem-next");
  const position = page.getByTestId("walk-position");

  await next.click();
  await next.click();
  await expect(position).toHaveAttribute("data-position", /^2\/\d+$/);

  // Typing re-validates, which used to send the walk silently back to problem 1 - the defect three
  // CI failures were actually about (ah-9ess).
  await fillOrders(page, "@work\nTAX\n");
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");
  await expect(position).toHaveAttribute("data-position", /^2\/\d+$/);
});

test("the walk buttons stay enabled with no problems at all", async ({ page }) => {
  await loadReport(page);
  await onlyTheUnitsWithNoOrders(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-tab-warnings").click();
  await page.getByTestId("settings-warning-unit-does-nothing").uncheck();
  await page.keyboard.press("Escape");

  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
  await fillOrders(page, "@work\nTAX");
  await expect(page.getByTestId("orders-status")).toContainText("0 errors");
  const next = page.getByTestId("walk-problem-next");
  await expect(next).toBeEnabled();
  await next.click();

  // Nothing to walk to, so nothing moves - and the button is still there to be pressed.
  await expect(page.getByTestId("panel-unit")).toContainText(OWN_UNIT);
  await expect(next).toBeEnabled();
});

/**
 * ah-vwdi: the dictionary's left-hand list has far more in it than fits, and the keyboard must be
 * able to drive the selection the whole way down - the list scrolling with it. The selection itself
 * always moved (`paletteKeyReduce` was wired from the start); it was the view that did not follow.
 * This cannot be a unit test: there is no jsdom here, so anything measuring scroll is Playwright's.
 */
test("arrowing past the fold keeps the selected entry in view", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("mining MINI");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("game-data-dialog")).toBeVisible();

  const list = page.getByTestId("game-data-list");
  const selected = page.locator('[data-testid^="game-data-entry-"][aria-selected="true"]');

  const visible = async () => {
    const row = await selected.boundingBox();
    const box = await list.boundingBox();
    if (row === null || box === null) {
      return false;
    }
    return row.y >= box.y - 1 && row.y + row.height <= box.y + box.height + 1;
  };

  // Far past the fold, one row at a time.
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await expect.poll(visible).toBe(true);

  // A screenful at a time, and back again.
  await page.keyboard.press("PageDown");
  await expect.poll(visible).toBe(true);
  await page.keyboard.press("PageUp");
  await expect.poll(visible).toBe(true);

  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press("ArrowUp");
  }
  // ...and on the way back up, still in view. (Not asserting the list is scrolled fully to the top:
  // rapid synthetic keypresses can outrun a re-render, so how far forty of them travel is not
  // something to pin. What must hold is that wherever the selection is, it is on screen.)
  await expect.poll(visible).toBe(true);
});

/**
 * ah-vwdi: the palette's `byKeyboard` guard is deliberately not copied here - following a
 * cross-reference selects an entry that may be far off screen, and scrolling to it is exactly what
 * a reader wants. Clicking a row already on screen must still not jog the list, which is what
 * `block: "nearest"` buys.
 */
test("following a cross-reference scrolls to it, and clicking a visible row does not jump", async ({
  page
}) => {
  await loadReport(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("mining MINI");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("game-data-dialog")).toBeVisible();

  const list = page.getByTestId("game-data-list");
  const selected = page.locator('[data-testid^="game-data-entry-"][aria-selected="true"]');

  await page.getByTestId("game-data-link-equipment:MITH").click();
  await expect(page.getByTestId("game-data-tab-equipment")).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect.poll(async () => {
    const row = await selected.boundingBox();
    const box = await list.boundingBox();
    if (row === null || box === null) {
      return false;
    }
    return row.y >= box.y - 1 && row.y + row.height <= box.y + box.height + 1;
  }).toBe(true);

  // A row already on screen, and NOT the selected one - so the selection really changes and the
  // scroll effect really runs. The list must stay exactly where it is anyway.
  const before = await list.evaluate((node) => node.scrollTop);
  const rows = page.locator('[data-testid^="game-data-entry-"][aria-selected="false"]');
  const box = await list.boundingBox();
  expect(box).not.toBeNull();
  const count = await rows.count();
  let clicked = false;
  for (let at = 0; at < count; at += 1) {
    const candidate = rows.nth(at);
    const row = await candidate.boundingBox();
    if (row !== null && box !== null && row.y >= box.y && row.y + row.height <= box.y + box.height) {
      // Pin it by test id before clicking: the `aria-selected="false"` locator is dynamic, and
      // the row leaves that set the moment it becomes the selection.
      const id = await candidate.getAttribute("data-testid");
      await candidate.click();
      await expect(page.getByTestId(id ?? "")).toHaveAttribute("aria-selected", "true");
      clicked = true;
      break;
    }
  }
  expect(clicked, "no visible unselected row to click").toBe(true);
  expect(await list.evaluate((node) => node.scrollTop)).toBe(before);
});

/**
 * ah-u44o: the game data had no door of its own - both routes to it started from a thing you
 * already had to name. F2 and a palette action open it cold, on Skills with the first entry
 * showing, which is what `openGameDataDialog(index, null)` has always done for a caller that
 * never existed.
 */
test("F2 opens the game data cold, on Skills with its first entry showing", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F2");

  await expect(page.getByTestId("game-data-dialog")).toBeVisible();
  await expect(page.getByTestId("game-data-tab-skill")).toHaveAttribute("aria-selected", "true");
  // Not an empty pane: the first skill is showing, which is what a cold open lands on.
  await expect(page.getByTestId("game-data-detail")).toContainText("Study cost");
});

test("the palette's Browse game data opens the same dialog, in the same cold state", async ({
  page
}) => {
  await loadReport(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("browse game data");
  await expect(page.getByTestId("palette-item").first()).toContainText("Browse game data");
  // The chord is listed beside it because the action reads its binding from SHORTCUTS.
  await expect(page.getByTestId("palette-item").first()).toContainText("F2");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("game-data-dialog")).toBeVisible();
  await expect(page.getByTestId("game-data-tab-skill")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("game-data-detail")).toContainText("Study cost");
});

test("F2 closes an open dialog, and opens it cold again afterwards", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F2");
  const dialog = page.getByTestId("game-data-dialog");
  await expect(dialog).toBeVisible();

  // Move away from Skills, so the second open has something to be cold about.
  await page.getByTestId("game-data-tab-building").click();
  await expect(page.getByTestId("game-data-tab-building")).toHaveAttribute(
    "aria-selected",
    "true"
  );

  await page.keyboard.press("F2");
  await expect(dialog).toHaveCount(0);

  await page.keyboard.press("F2");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("game-data-tab-skill")).toHaveAttribute("aria-selected", "true");
});

test("F2 fires from the orders editor and from the unit filter", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);

  await ordersInput(page).click();
  await page.keyboard.press("F2");
  await expect(page.getByTestId("game-data-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("game-data-dialog")).toHaveCount(0);

  await page.getByLabel("Filter units").click();
  await page.keyboard.press("F2");
  await expect(page.getByTestId("game-data-dialog")).toBeVisible();
});

test("with no ruleset there is no door: F2 does nothing and the palette does not offer one", async ({
  page
}) => {
  // A game with a ruleset that will not load - which is the state the palette already answers
  // with no game data at all, and both doors must answer the same way.
  await page.route("**/ruleset.json", (route) => route.fulfill({ status: 404, body: "" }));
  // Without the rules the load says so rather than counting the turn (ah-6yj2), so that - not the
  // counts - is what tells this walk the turn is on screen.
  await loadReport(page, "Smoke game", undefined, "The rules could not be loaded");

  await page.keyboard.press("F2");
  await expect(page.getByTestId("game-data-dialog")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("browse game data");
  await expect(page.getByTestId("palette-item")).toHaveCount(0);
});

/**
 * ah-vwdi: the dialog must stop short of the bottom of the screen. The arithmetic (a `pt-[10vh]`
 * backdrop plus a `max-h-[80vh]` dialog) reads correct, and verification still found the dialog
 * touching the bottom edge - so the check that matters is a measured one, in a real browser, on
 * more than one window height.
 */
test("the game data dialog stops short of the bottom edge", async ({ page }) => {
  await loadReport(page);

  const dialog = page.getByTestId("game-data-dialog");

  for (const size of [
    { width: 1280, height: 900 },
    { width: 1280, height: 560 }
  ]) {
    await page.setViewportSize(size);

    if ((await dialog.count()) === 0) {
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByTestId("palette-input").fill("mining MINI");
      await page.keyboard.press("Enter");
    }
    await expect(dialog).toBeVisible();

    // A real margin below, not a rounding sliver: at least 5% of the window, whatever its height.
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox();
        return box === null ? -1 : Math.round(size.height - (box.y + box.height));
      })
      .toBeGreaterThanOrEqual(Math.round(size.height * 0.05));
  }
});

