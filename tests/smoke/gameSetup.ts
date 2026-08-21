import { expect, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";

/**
 * Getting a walk to the point where there is a game to work in.
 *
 * A module of its own rather than exports from a spec: Playwright refuses to let one spec import
 * another, and every walk in this suite now starts by passing through the create screen.
 */

/**
 * Clears every game from the browser, and stands the startup greeting down.
 *
 * The suite runs serially against one origin, so a game left by an earlier test would still be
 * there for the next one - and the gate, which several of these walks are about, only appears when
 * there are none.
 *
 * The greeting is the shortcuts overlay, which shows itself on a first launch and covers the whole
 * window while it does. Every walk here starts from a fresh context, so every walk is a first
 * launch, and the very first click of each would land on the overlay's backdrop rather than on the
 * thing it was aiming at. Turned off here in the one place they all pass through; the walk that is
 * *about* the greeting clears the preference again with [`forgetSettings`] and gets the first-run
 * behaviour a player gets.
 */
export async function clearGames(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const stored = localStorage.getItem("atlantis-hud-settings");
    const blob = stored ? (JSON.parse(stored) as { state?: Record<string, unknown> }) : {};
    localStorage.setItem(
      "atlantis-hud-settings",
      JSON.stringify({ ...blob, state: { ...blob.state, showShortcutsAtStartup: false } })
    );
  });
  await page.evaluate(async () => {
    const databases = (await indexedDB.databases?.()) ?? [];
    const named = databases
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === "string");
    // Firefox does not implement `databases()`. Naming the registry covers it for this suite: with
    // the registry gone the app has no games, whatever per-game databases linger unreferenced.
    const targets = named.length > 0 ? named : ["atlantis-hud"];

    await Promise.all(
      targets.map(
        (name) =>
          new Promise<void>((resolve) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
            request.onblocked = () => resolve();
          })
      )
    );
  });
  await page.reload();
}

/**
 * Forgets every remembered preference, so the next load is a player's first ever.
 *
 * Only the walk about the startup greeting wants this: everything else is better off with the
 * greeting stood down, which is what `clearGames` arranges.
 */
export async function forgetSettings(page: Page) {
  await page.evaluate(() => localStorage.removeItem("atlantis-hud-settings"));
}

/** Creates a game from whichever form is on screen, and waits for the workspace to follow. */
export async function createGame(page: Page, name: string) {
  await page.getByTestId("game-name").fill(name);
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByTestId("game-indicator")).toContainText(name);
}

/**
 * Hands a report to the file input, as a player dropping one in would.
 *
 * Says nothing about what the import produced: three specs carried a copy of this, and only
 * `map-export.spec.ts` also asserted on the import status - that assertion stays at its call
 * sites, where it is about that walk rather than about handing over a file.
 */
export async function importReport(page: Page, name: string, report: string) {
  await page.setInputFiles('input[type="file"]', {
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(report, "utf8")
  });
}

/** The turn every walk that just needs "a game with a map in it" loads. */
const TURN_71 = readReport("g7f95t71");

/**
 * A fresh game with the standard turn loaded: the start of most walks in this suite.
 *
 * Four specs carried a copy of this. They differed in the game's name - which nothing asserts on,
 * so one name serves all of them - and in how carefully they waited: only `workspace.spec.ts`
 * checked that the gate appeared before creating and that the header appeared after. That is the
 * version kept, because it is the correct one: both hold in every walk, since every walk starts
 * from `clearGames`, and both are waits rather than claims about the walk under test.
 */
export async function loadReport(page: Page, gameName = "Smoke game", report = TURN_71) {
  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();
  await createGame(page, gameName);
  await expect(page.getByTestId("app-header")).toBeVisible();

  await importReport(page, "turn-71.rep", report);

  await expect(page.getByTestId("import-status")).toContainText("11 regions");
}

/**
 * The strip of the map the player can actually see: the map's own host, shrunk by the insets
 * `MapCanvas` fits and recentres against - not the geometric middle of the canvas, which the side
 * rails alone push well away from where a point actually lands on the map.
 *
 * Read from `data-map-insets`, the value the map itself measured and fitted against (see
 * `useOverlayInsets.ts`), rather than re-derived from the `[data-map-overlay]` boxes: two smoke
 * specs used to carry their own copy of that arithmetic, and a bug in the real one could pass here
 * by agreeing with itself. Polls for the attribute because it is absent until the first measurement
 * lands.
 */
export async function visibleStrip(
  page: Page
): Promise<{ x: number; y: number; width: number; height: number }> {
  const map = page.getByTestId("map-canvas");
  await expect.poll(() => map.getAttribute("data-map-insets")).not.toBeNull();
  const raw = await map.getAttribute("data-map-insets");
  const insets = JSON.parse(raw as string) as {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  const box = await map.boundingBox();
  if (!box) {
    throw new Error("the map has no box to measure the visible strip against");
  }
  return {
    x: box.x + insets.left,
    y: box.y + insets.top,
    width: box.width - insets.left - insets.right,
    height: box.height - insets.top - insets.bottom
  };
}

/** The middle of the strip the panes leave visible - see `visibleStrip`. */
export async function visibleCentre(page: Page): Promise<{ x: number; y: number }> {
  const strip = await visibleStrip(page);
  return { x: strip.x + strip.width / 2, y: strip.y + strip.height / 2 };
}

/**
 * The orders editor's editable surface.
 *
 * The editor is CodeMirror, so `data-testid="orders-input"` sits on its root and the text lives in
 * a contenteditable `.cm-content` inside it. Playwright's `fill` speaks contenteditable, so writing
 * goes through here; reading does not, because `textContent` joins the line elements without
 * newlines - use `ordersText` for that.
 */
export function ordersInput(page: Page) {
  return page.getByTestId("orders-input").locator(".cm-content");
}

/** Replaces the whole draft, as `orders.fill(...)` did when the editor was a textarea. */
export async function fillOrders(page: Page, text: string) {
  await ordersInput(page).fill(text);
}

/**
 * The draft as a string with its newlines back, read line element by line element.
 *
 * Reads only the rendered lines, and CodeMirror virtualizes tall documents - fine for unit
 * blocks a few lines long, wrong the day a spec asserts on hundreds of lines at once.
 */
export async function ordersText(page: Page): Promise<string> {
  return page.getByTestId("orders-input").evaluate((root) => {
    const lines = root.querySelectorAll(".cm-line");
    return Array.from(lines)
      .map((line) => line.textContent ?? "")
      .join("\n");
  });
}

/** Asserts on the draft, polling because edits land through CodeMirror asynchronously. */
export async function expectOrders(page: Page, pattern: RegExp) {
  await expect.poll(() => ordersText(page)).toMatch(pattern);
}

/** The negative twin of `expectOrders`, for "this text must not be in the draft". */
export async function expectOrdersNot(page: Page, pattern: RegExp) {
  await expect.poll(() => ordersText(page)).not.toMatch(pattern);
}

/** Where a panel is on screen, having asserted it is on screen at all. */
export async function boxOf(page: Page, panel: string) {
  const box = await page.getByTestId(`panel-${panel}`).boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

/**
 * Waits for a panel's height to stop changing before it is measured as a "before" baseline.
 * Selecting a hex opens the panels, and reading a size while that settles - slower or busier on
 * CI than locally - pins a mid-animation size rather than the resting one.
 */
export async function waitForStableHeight(page: Page, panel: string) {
  let last: number | null = null;
  await expect
    .poll(async () => {
      const height = (await boxOf(page, panel)).height;
      const stable = last !== null && height === last;
      last = height;
      return stable;
    })
    .toBe(true);
}

/**
 * Waits for a panel to stop *moving* as well as stop resizing, before its position is measured.
 *
 * The header gains a row once the loaded report's counts render, and everything below it - the
 * map, and the panel column over it - drops by that row. On a slow runner that lands after the
 * first geometry read, so a baseline taken straight after `selectHex` is a position nothing ever
 * comes back to: `a folded panel shrinks to its title bar` failed in CI with `y` 36px out, exactly
 * one header row, while passing everywhere locally. Poll the whole box, not only the height.
 */
export async function waitForStableBox(page: Page, panel: string) {
  let last: string | null = null;
  await expect
    .poll(async () => {
      const box = await boxOf(page, panel);
      const now = `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}`;
      const stable = last !== null && now === last;
      last = now;
      return stable;
    })
    .toBe(true);
}
