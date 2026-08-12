import { expect, type Page } from "@playwright/test";

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
