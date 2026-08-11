import { expect, type Page } from "@playwright/test";

/**
 * Getting a walk to the point where there is a game to work in.
 *
 * A module of its own rather than exports from a spec: Playwright refuses to let one spec import
 * another, and every walk in this suite now starts by passing through the create screen.
 */

/**
 * Clears every game from the browser.
 *
 * The suite runs serially against one origin, so a game left by an earlier test would still be
 * there for the next one - and the gate, which several of these walks are about, only appears when
 * there are none.
 */
export async function clearGames(page: Page) {
  await page.goto("/");
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
