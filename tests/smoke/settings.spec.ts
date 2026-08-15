import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearGames, createGame } from "./gameSetup";

/**
 * The settings dialog, in both shells.
 *
 * What is asserted here is deliberately the part the two builds share: the cogwheel opens a
 * centered modal with several tabs, the theme choice restyles the app and survives a reload, and the
 * dialog goes away the way a modal should — close button, Escape, or a press on the backdrop. The
 * update control itself cannot be asserted in common, because it is the one thing that legitimately
 * differs - the web build has a service worker to ask and the desktop build has a releases page to
 * open, and under Playwright the desktop bundle runs in a plain browser with neither. That
 * difference is covered where it belongs: the web path in `tests/pwa`, the desktop path by hand.
 *
 * A ruleset *change* is not exercised here either: only one ruleset ships, so there is nothing to
 * change to. The write path is covered by Rust and adapter unit tests.
 */

test("settings are reachable before any game exists", async ({ page }) => {
  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();

  await page.getByTestId("settings-indicator").click();

  // The version is what the About tab is for on first run: it is the only way to tell one build
  // from another before there is anything else on screen. It sits behind a tab now, because the
  // dialog opens on Global.
  await page.getByTestId("settings-tab-about").click();
  await expect(page.getByTestId("app-version")).not.toBeEmpty();

  // No game yet, so the per-game tab has nothing to configure and says so.
  await page.getByTestId("settings-tab-game").click();
  await expect(page.getByTestId("settings-no-game")).toBeVisible();
});

test("the settings dialog closes from its close button", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();

  // The indicator no longer toggles the dialog closed: it sits under the modal backdrop, and a
  // dimmed control that still worked would undermine what the dimming says. The close button is
  // the affordance now.
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
});

test("the settings dialog goes away on Escape and on a press on the backdrop", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);

  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  // Off-centre, so the press lands on the backdrop itself rather than the panel over its middle.
  await page.getByTestId("settings-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
});

test("the settings dialog and the game picker are not open at once", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  await page.getByTestId("game-indicator").click();
  await expect(page.getByTestId("game-picker")).toBeVisible();

  // Opening the dialog dismisses the picker: the picker treats the press on the indicator as a
  // press outside itself, which is what makes independent header panels behave like one menu bar.
  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("game-picker")).toHaveCount(0);
  await expect(page.getByTestId("settings-panel")).toBeVisible();
});

test("the theme choice restyles the app and survives a reload", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  const header = page.getByTestId("app-header");
  const darkBackground = await header.evaluate((el) => getComputedStyle(el).backgroundColor);

  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("theme-light").click();

  // The attribute is the mechanism; the computed colour is the proof it reached the stylesheet.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const lightBackground = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(lightBackground).not.toBe(darkBackground);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // Back to dark, so later tests inherit the default look.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

/**
 * Which hex rendering the map draws with.
 *
 * The picker is populated from the theme registry rather than from a list of its own, which is what
 * makes adding a theme one module and one registry entry. The map is re-drawn in the chosen style
 * immediately - no reload - and the choice is a preference, so it survives one.
 */
test("the map theme picker offers the registered themes and reaches the map", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  await page.getByTestId("settings-indicator").click();
  const picker = page.getByTestId("settings-map-theme");
  await expect(picker).toBeVisible();

  // Populated from the registry: an empty picker would mean the registry never reached it.
  expect(await picker.locator("option").count()).toBeGreaterThan(1);
  await expect(picker).toHaveValue("cartographers-table");

  // Classic was retired once the designs had all landed, so the picker must not still offer it.
  await expect(picker.locator('option[value="classic"]')).toHaveCount(0);

  await page.keyboard.press("Escape");

  // The chosen theme is stamped on the map's root, which is what its stylesheet hangs off - the
  // proof the setting reached the renderer rather than merely the store.
  const map = page.getByTestId("map-canvas").locator("svg");
  await expect(map).toHaveClass(/map-theme-cartographers-table/);
});

test("choosing another map theme redraws the open map, and the choice outlives a reload", async ({
  page
}) => {
  await clearGames(page);
  await createGame(page, "Settings game");
  // A real report, because the point of this test is that the theme *draws* - an empty map would
  // pass a class assertion while rendering nothing at all.
  await openReport(page);

  const map = page.getByTestId("map-canvas").locator("svg");
  await expect(map).toHaveClass(/map-theme-cartographers-table/);
  // The atlas draws a settlement as a keep, which the HUD replaces with a station readout.
  await expect(map.locator('[data-mark="settlement"]').first()).toBeAttached();

  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-map-theme").selectOption("tactical-hud");

  // Redrawn in place: no reload, and the dialog is still open over it.
  await expect(map).toHaveClass(/map-theme-tactical-hud/);
  await expect(map).not.toHaveClass(/map-theme-cartographers-table/);
  // Marks only the HUD draws, so this is the theme's own rendering and not just a class swap -
  // and the atlas's own mark is gone, so the two are not simply layered on top of each other.
  await expect(map.locator('[data-station="settlement"]').first()).toBeAttached();
  await expect(map.locator('[data-mark="settlement"]')).toHaveCount(0);

  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByTestId("map-canvas").locator("svg")).toHaveClass(/map-theme-tactical-hud/);

  // Back to the default, so later tests inherit the look they expect.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-map-theme").selectOption("cartographers-table");
  await expect(page.getByTestId("map-canvas").locator("svg")).toHaveClass(
    /map-theme-cartographers-table/
  );
});

/**
 * How see-through the panes over the map are, as painted. The slider is the mechanism; the
 * computed background alpha of a floating pane is the proof it reached the stylesheet, exactly as
 * the theme test reads a computed colour rather than trusting the attribute.
 */
async function paneAlpha(page: import("@playwright/test").Page): Promise<number> {
  return page.getByTestId("panel-region").evaluate((el) => {
    const painted = getComputedStyle(el).backgroundColor.trim();
    // The engine picks the serialization - rgba(r, g, b, a), color(srgb r g b / a),
    // oklab(l a b / alpha) - but every functional form writes the alpha last, after a slash or a
    // final comma, and omits it entirely when it is exactly 1.
    const slashed = /\/\s*([\d.]+%?)\s*\)$/u.exec(painted);
    const legacy = /^rgba\([^)]*,\s*([\d.]+)\s*\)$/u.exec(painted);
    const alpha = slashed?.[1] ?? legacy?.[1];
    if (alpha === undefined) {
      return 1;
    }
    return alpha.endsWith("%") ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
  });
}

test("the pane transparency slider repaints the panes and survives a reload", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  // 90% transparency is the default, so the panes start at a tenth opacity.
  expect(await paneAlpha(page)).toBeCloseTo(0.1, 2);

  await page.getByTestId("settings-indicator").click();
  const slider = page.getByTestId("pane-transparency");
  await expect(slider).toHaveValue("90");

  // Fully opaque at one end of the range...
  await slider.fill("0");
  expect(await paneAlpha(page)).toBeCloseTo(1, 2);

  // ...and never past 95 at the other, so a pane cannot be made invisible.
  await expect(slider).toHaveAttribute("min", "0");
  await expect(slider).toHaveAttribute("max", "95");
  await slider.fill("95");
  expect(await paneAlpha(page)).toBeCloseTo(0.05, 2);

  // A preference, not a session choice: it holds across a reload.
  await page.reload();
  expect(await paneAlpha(page)).toBeCloseTo(0.05, 2);

  // Back to the default, so later tests inherit the look they expect.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("pane-transparency").fill("90");
  expect(await paneAlpha(page)).toBeCloseTo(0.1, 2);
});

test("the per-game tab shows the open game's ruleset", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");

  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-tab-game").click();

  const ruleset = page.getByTestId("settings-game-ruleset");
  await expect(ruleset).toBeVisible();
  await expect(ruleset).toBeEnabled();
  await expect(ruleset).toHaveValue("neworigins");
});

/** The turn-71 fixture; Inholm at (7,53) holds 92 units, so every cap the slider offers bites. */
const REPORT = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-g7-f95-t71.rep"),
  "utf8"
);

/** Same idiom as persistence.spec.ts: the button leaving "Importing…" says the import is over. */
async function openReport(page: Page) {
  const load = page.getByRole("button", { name: "Import", exact: true });
  await expect(load).toBeEnabled();

  await page.setInputFiles('input[type="file"]', {
    name: "turn-71.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(REPORT, "utf8")
  });

  await expect(page.getByTestId("import-status")).toContainText("11 regions");
  await expect(load).toBeEnabled();
}

async function selectHex(page: Page, regionId: string) {
  const hex = page.getByRole("button", { name: `hex ${regionId}` });
  await hex.focus();
  await hex.press("Enter");
}

/** The units pane's outer height, as the player sees it. */
async function unitsPaneHeight(page: Page): Promise<number> {
  const box = await page.getByTestId("panel-units").boundingBox();
  if (!box) {
    throw new Error("the units pane is not on screen to measure");
  }
  return box.height;
}

test("the unit list limit sizes the pane while the whole list stays scrollable", async ({
  page
}) => {
  await clearGames(page);
  await createGame(page, "Limit game");
  await openReport(page);
  await selectHex(page, "1:7,53");

  // The limit sizes the pane rather than trimming the list: all 92 units stay reachable, and the
  // header never claims fewer.
  await expect(page.getByTestId("panel-units")).toContainText("92 units");
  await expect(page.getByTestId("panel-units")).not.toContainText("shown");
  const atTwelve = await unitsPaneHeight(page);

  await page.getByTestId("settings-indicator").click();
  const limit = page.getByTestId("unit-list-limit");
  await expect(limit).toHaveValue("12");
  // Never fewer than one row on screen, never more than sixteen.
  await expect(limit).toHaveAttribute("min", "1");
  await expect(limit).toHaveAttribute("max", "16");

  // Applies as it is dragged - the pane is on screen behind the dialog, its own preview. Taken to
  // the floor, because one row is where a ceiling on the pane is least like a cut in the list:
  // ninety-two units, one of them on screen, and the End below still reaches the last of them.
  await limit.fill("1");
  await expect.poll(() => unitsPaneHeight(page)).toBeLessThan(atTwelve);

  // The rest of the hex is a scroll away, not gone: End walks the selection to the last of all
  // 92 rows, the scroller following - the same journey a mouse wheel makes.
  await page.keyboard.press("Escape");
  const ownRow = page.getByTestId("unit-row-18642");
  await ownRow.focus();
  await page.keyboard.press("End");
  await expect(page.locator("[data-testid^='unit-row-'][data-selected='true']")).toHaveAttribute(
    "aria-rowindex",
    "93"
  );

  // A preference, not a session choice: it holds across a reload.
  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await selectHex(page, "1:7,53");
  await expect.poll(() => unitsPaneHeight(page)).toBeLessThan(atTwelve);

  // Back to the default, so later tests inherit the look they expect.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("unit-list-limit").fill("12");
  await expect.poll(() => unitsPaneHeight(page)).toBeGreaterThanOrEqual(atTwelve - 1);
});

test("the units pane's own + and - set the maximum, and it survives a reload", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Stepper game");
  await openReport(page);
  await selectHex(page, "1:7,53");

  const value = page.getByTestId("unit-list-limit-value");
  await expect(value).toHaveText("max 12");
  const atTwelve = await unitsPaneHeight(page);

  // A row at a time, and the pane follows immediately - no dialog in the way.
  await page.getByTestId("unit-list-limit-less").click();
  await page.getByTestId("unit-list-limit-less").click();
  await expect(value).toHaveText("max 10");
  await expect.poll(() => unitsPaneHeight(page)).toBeLessThan(atTwelve);

  await page.getByTestId("unit-list-limit-more").click();
  await expect(value).toHaveText("max 11");

  // The same preference the dialog's slider drives, not a second one beside it.
  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("unit-list-limit")).toHaveValue("11");
  await page.keyboard.press("Escape");

  // A preference, not a session choice: it holds across a reload.
  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await selectHex(page, "1:7,53");
  await expect(page.getByTestId("unit-list-limit-value")).toHaveText("max 11");

  // Back to the default, so later tests inherit the look they expect.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("unit-list-limit").fill("12");
  await page.keyboard.press("Escape");
  await expect(value).toHaveText("max 12");
});

test("fixed pane size holds the pane's height on hexes with few units, and survives a reload", async ({
  page
}) => {
  await clearGames(page);
  await createGame(page, "Fixed pane game");
  await openReport(page);

  // A hex with 92 units, capped at the default 12 rows: the tallest the pane ever stands at that
  // limit, whether the option is on or off.
  await selectHex(page, "1:7,53");
  const atCeiling = await unitsPaneHeight(page);

  // A hex known only from a neighbour's exits, carrying no units at all - the shortest the pane
  // ever stands with the option off.
  await selectHex(page, "1:7,51");
  const atEmpty = await unitsPaneHeight(page);
  expect(atEmpty).toBeLessThan(atCeiling);

  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-unit-list-fixed").click();
  await page.keyboard.press("Escape");

  // The empty hex now reserves the full twelve rows, the same height a full one is capped at.
  await expect.poll(() => unitsPaneHeight(page)).toBeGreaterThanOrEqual(atCeiling - 1);
  await expect(page.getByTestId("unit-list-limit-value")).toHaveText("12");

  // A preference, not a session choice: it holds across a reload, on the same empty hex.
  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await selectHex(page, "1:7,51");
  await expect.poll(() => unitsPaneHeight(page)).toBeGreaterThanOrEqual(atCeiling - 1);
  await expect(page.getByTestId("unit-list-limit-value")).toHaveText("12");

  // Turned off again, the pane hugs the empty hex's short list as it always did.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-unit-list-fixed").click();
  await page.keyboard.press("Escape");
  await expect.poll(() => unitsPaneHeight(page)).toBeLessThan(atCeiling);
  await expect(page.getByTestId("unit-list-limit-value")).toHaveText("max 12");
});

test("a snippet is created in settings, refuses duplicates, and survives a reload", async ({
  page
}) => {
  await clearGames(page);
  await createGame(page, "Snippet game");

  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-tab-snippets").click();

  await page.getByTestId("snippet-name").fill("patrol");
  await page.getByTestId("snippet-body").fill("MOVE ${dir}\nGUARD 1");
  await page.getByTestId("snippet-add").click();
  await expect(page.getByTestId("snippet-row")).toHaveCount(1);
  await expect(page.getByTestId("snippet-row")).toContainText("patrol");

  // A second snippet by the same name, in any case, is refused with a visible reason.
  await page.getByTestId("snippet-name").fill("PATROL");
  await page.getByTestId("snippet-body").fill("@work");
  await page.getByTestId("snippet-add").click();
  await expect(page.getByTestId("snippet-error")).toBeVisible();
  await expect(page.getByTestId("snippet-row")).toHaveCount(1);

  await page.reload();
  await expect(page.getByTestId("game-indicator")).toContainText("Snippet game");
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-tab-snippets").click();
  await expect(page.getByTestId("snippet-row")).toHaveCount(1);
  await expect(page.getByTestId("snippet-row")).toContainText("patrol");

  // Deleting empties the library again.
  await page.getByTestId("snippet-delete").click();
  await expect(page.getByTestId("snippet-row")).toHaveCount(0);
});
