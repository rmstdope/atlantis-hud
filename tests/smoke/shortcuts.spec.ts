import { expect, test, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";
import {
  clearGames,
  createGame,
  expectOrders,
  fillOrders,
  ordersInput,
  visibleCentre
} from "./gameSetup";

/**
 * The global keyboard layer (#91): the command palette, faction-wide unit cycling, the
 * diagnostic walk, and the shortcut cheat sheet. Every walk here goes through real keydowns,
 * because the layer under test is precisely the one that turns keydowns into actions.
 */

const REPORT = readReport("g7f95t71");

/** "Seven of Eight", the player's unit in Inholm at (7,53). */
const OWN_UNIT = "18642";
/** Another of the player's units, in the mountain at (26,52). */
const OTHER_OWN_UNIT = "13401";

async function selectHex(page: Page, regionId: string) {
  const hex = page.getByRole("button", { name: `hex ${regionId}` });
  await hex.focus();
  await hex.press("Enter");
}

async function selectUnit(page: Page, unitId: string) {
  const box = page.getByLabel("Filter units");
  await box.fill(unitId);
  const row = page.getByTestId(`unit-row-${unitId}`);
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  await row.getByRole("button").click();
  await box.clear();
}

async function loadReport(page: Page) {
  await clearGames(page);
  await createGame(page, "Shortcut smoke");
  await page.setInputFiles('input[type="file"]', {
    name: "turn-71.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(REPORT, "utf8")
  });
  await expect(page.getByTestId("import-status")).toContainText("11 regions");
}

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
  // to the one syntax problem it introduces.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("settings-tab-warnings").click();
  await page.getByTestId("settings-warning-study-at-maximum").uncheck();
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

/** Where the map is standing, read the same way `persistence.spec.ts` does. */
async function mapTransform(page: Page): Promise<string> {
  return (await page.getByTestId("map-world").getAttribute("transform")) ?? "";
}

test("right-click centres the view on a hex, without selecting it", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await expect(page.getByRole("button", { name: "hex 1:7,53" })).toHaveAttribute(
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
  await expect(page.getByRole("button", { name: "hex 1:7,53" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // Right-clicking the middle of the visible strip a second time is now a no-op: whatever hex is
  // already there is already centred, so asking again changes nothing.
  const centred = await mapTransform(page);
  const centre = await visibleCentre(page);
  await page.mouse.click(centre.x, centre.y, { button: "right" });
  await expect.poll(() => mapTransform(page)).toBe(centred);
  await page.mouse.click(centre.x, centre.y, { button: "right" });
  await expect.poll(() => mapTransform(page)).toBe(centred);
});
