import { expect, test, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";
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

  // 20% transparency is the default (ah-v09e), so the panes start at four fifths opacity - enough
  // map underneath to navigate by, opaque enough that the text is not sitting on live terrain.
  expect(await paneAlpha(page)).toBeCloseTo(0.8, 2);

  await page.getByTestId("settings-indicator").click();
  const slider = page.getByTestId("pane-transparency");
  await expect(slider).toHaveValue("20");

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
  await page.getByTestId("pane-transparency").fill("20");
  expect(await paneAlpha(page)).toBeCloseTo(0.8, 2);
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
const REPORT = readReport("g7f95t71");

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

/**
 * ah-46p.2: the Interface size setting scales the panes' type (and, with it, the units dock's row
 * height) without ever touching the map - full-page zoom already scales both, and that unhelpful
 * trade is the reason this setting exists.
 */
test("the panes shrink and grow when the interface size does", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings game");
  await openReport(page);

  await page.getByRole("button", { name: "hex 1:7,53", exact: true }).click();

  const pane = page.getByTestId("app-header");
  // The ruler ticks, not `.region-name`: that class is hidden outright at a far zoom band
  // (`.map-far .region-name { display: none }` in theme.css), while the rulers render at every
  // zoom level and carry their own explicit `fontSize` attribute untouched by `--ui-scale`.
  const mapLabel = page.locator('[data-testid="map-ruler-x"] text').first();
  const row = page.locator('[data-testid^="unit-row-"]').first();
  // `boundingBox()` returns null for an element not yet rendered or off-screen; asserting
  // visibility first is what makes the non-null assertions below safe rather than merely hopeful.
  await expect(mapLabel).toBeVisible();
  await expect(row).toBeVisible();

  const paneSizeBefore = await pane.evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize)
  );
  const mapSizeBefore = await mapLabel.evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize)
  );
  const rowHeightBefore = (await row.boundingBox())!.height;

  await page.getByTestId("settings-indicator").click();
  const slider = page.getByTestId("settings-interface-size");
  await expect(slider).toHaveValue("100");
  await expect(slider).toHaveAttribute("min", "50");
  await expect(slider).toHaveAttribute("max", "200");
  await slider.fill("50");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);

  const paneSizeSmall = await pane.evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize)
  );
  const mapSizeSmall = await mapLabel.evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize)
  );
  const rowHeightSmall = (await row.boundingBox())!.height;
  expect(paneSizeSmall).toBeCloseTo(paneSizeBefore / 2, 1);
  expect(mapSizeSmall).toBeCloseTo(mapSizeBefore, 1);
  expect(rowHeightSmall).toBeCloseTo(rowHeightBefore / 2, 0);

  await page.reload();
  const rowAfterSmallReload = page.locator('[data-testid^="unit-row-"]').first();
  await expect(rowAfterSmallReload).toBeVisible();
  expect((await rowAfterSmallReload.boundingBox())!.height).toBeCloseTo(rowHeightBefore / 2, 0);

  await page.getByTestId("settings-indicator").click();
  await expect(page.getByTestId("settings-interface-size")).toHaveValue("50");
  await slider.fill("200");
  await page.keyboard.press("Escape");
  // Closing is a modal teardown; reading computed styles before it finishes can race the dialog's
  // own unmount, exactly as the other walks in this file wait for `settings-panel` to be gone.
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);

  const paneSizeAfter = await pane.evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize)
  );
  const mapSizeAfter = await mapLabel.evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize)
  );
  const rowHeightAfter = (await row.boundingBox())!.height;

  // The panes double...
  expect(paneSizeAfter).toBeCloseTo(paneSizeBefore * 2, 1);
  // ...the map does not move at all...
  expect(mapSizeAfter).toBeCloseTo(mapSizeBefore, 1);
  // ...and the units dock's rows grow with the type, so nothing there clips.
  expect(rowHeightAfter).toBeCloseTo(rowHeightBefore * 2, 0);
  const overflow = await row.evaluate(
    (element) => element.scrollHeight > element.clientHeight
  );
  expect(overflow).toBe(false);

  // A preference, not a session choice: it holds across a reload.
  await page.reload();
  const rowAfterReload = page.locator('[data-testid^="unit-row-"]').first();
  await expect(rowAfterReload).toBeVisible();
  const rowHeightAfterReload = (await rowAfterReload.boundingBox())!.height;
  expect(rowHeightAfterReload).toBeCloseTo(rowHeightBefore * 2, 0);

  // Back to the default, so later tests inherit the look they expect.
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-interface-size").fill("100");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-panel")).toHaveCount(0);
});

/**
 * ah-ziv: the setting reaches the boxes as well as the type. The multiplier sits on the root font
 * size, so the Settings dialog's own `w-[26rem]` grows with the reader's text instead of squeezing
 * it into two- and three-line rows - and the cap on a modal keeps it on screen while it does.
 */
test("the settings dialog grows with the interface size", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Settings scale game");
  await openReport(page);

  await page.getByTestId("settings-indicator").click();
  const panel = page.getByTestId("settings-panel");
  await expect(panel).toBeVisible();
  const widthBefore = (await panel.boundingBox())!.width;

  await page.getByTestId("settings-interface-size").fill("200");
  // The slider re-renders the panel it lives in; read the box only once the growth has landed.
  // `boundingBox()` is null while that re-render is mid-flight, so fall back to 0 and let `poll`
  // retry rather than throwing on a transient.
  await expect
    .poll(async () => (await panel.boundingBox())?.width ?? 0)
    .toBeGreaterThan(widthBefore * 1.5);

  // ...and it is still fully inside the window, Close button included (O1).
  const box = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  await expect(page.getByTestId("settings-close")).toBeVisible();

  // Back to the default, so later tests inherit the look they expect.
  await page.getByTestId("settings-interface-size").fill("100");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("the settings dialog has no units-in-hex row controls", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "No stepper game");

  await page.getByTestId("settings-indicator").click();

  await expect(page.getByTestId("unit-list-limit")).toHaveCount(0);
  await expect(page.getByTestId("settings-unit-list-fixed")).toHaveCount(0);
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

test("the About tab names the variants and offers somewhere to report a bug", async ({ page }) => {
  await clearGames(page);

  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-tab-about").click();

  // Read from the shipped rulesets rather than written into the prose, so this row grows on its own
  // the day a second variant lands.
  await expect(page.getByTestId("app-variants")).toHaveText("New Origins");

  // A button rather than an anchor: inside the Tauri webview a link has to be handed to the
  // operating system, and only the button-plus-port path does that. Asserting that a new tab opens
  // is not worth the machinery; that the call to action is there and reachable is.
  const issues = page.getByTestId("about-issues-link");
  await expect(issues).toBeVisible();
  await expect(issues).toHaveAccessibleName("project's issue page on GitHub");
});

/**
 * The map a game is played on, corrected in Settings and read back.
 *
 * A walk rather than a unit test because the defect it pins was entirely in the wiring: the width
 * was written to the manifest, the store was updated, and the dialog still showed the ruleset's
 * default, because the shell handed the dialog a hand-built record that left the map out. Every
 * unit test in the area passed throughout - they all called the pieces directly, and the piece
 * nobody called was the one that was wrong.
 */
test("a corrected map size is still there when settings are reopened", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Map size game");

  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-tab-game").click();

  // Created with the ruleset's declared map, so this game stated it: 72 x 96, east-west only.
  await expect(page.getByTestId("settings-map-stated")).toBeVisible();
  await expect(page.getByTestId("settings-map-width")).toHaveValue("72");

  // One field at a time, each committed by its own blur. The wait between them is not politeness:
  // a commit disables the fieldset for the length of the write, and text typed into a field while
  // that is happening never reaches the form at all.
  await page.getByTestId("settings-map-width").fill("40");
  await page.getByTestId("settings-map-width").blur();
  await expect(page.getByTestId("settings-map-width")).toBeEnabled();
  await expect(page.getByTestId("settings-map-width")).toHaveValue("40");

  await page.getByTestId("settings-map-height").fill("60");
  await page.getByTestId("settings-map-height").blur();
  await expect(page.getByTestId("settings-map-height")).toBeEnabled();
  // The height's own write must survive the width's write coming back changed.
  await expect(page.getByTestId("settings-map-height")).toHaveValue("60");

  await page.getByTestId("settings-close").click();
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-tab-game").click();

  await expect(page.getByTestId("settings-map-width")).toHaveValue("40");
  await expect(page.getByTestId("settings-map-height")).toHaveValue("60");
  await expect(page.getByTestId("settings-map-stated")).toBeVisible();

  // The same fields, in the narrower dialog: the fix for the create form's overflow was applied
  // to both, so both are asserted. Measured on the panel, which is what would scroll sideways.
  const overflow = await page
    .getByTestId("settings-panel")
    .evaluate((panel) => panel.scrollWidth - panel.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

/**
 * The create form's map fields fit the dialog they are in.
 *
 * A `flex-1` field whose input keeps its intrinsic width pushes its row wider than the panel, and
 * the panel then scrolls sideways - which is what a player saw. Asserted as "the form is no wider
 * than what contains it" rather than on any class, so the fix is free to be any fix.
 */
test("the create form's map fields do not overflow the gate", async ({ page }) => {
  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();

  const overflow = await page.getByTestId("game-form").evaluate((form) => {
    const parent = form.parentElement as HTMLElement;
    return {
      form: form.scrollWidth - form.clientWidth,
      parent: parent.scrollWidth - parent.clientWidth
    };
  });

  expect(overflow.form).toBeLessThanOrEqual(1);
  expect(overflow.parent).toBeLessThanOrEqual(1);
});
