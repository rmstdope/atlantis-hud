import { expect, test, type Page } from "@playwright/test";

/**
 * Whether the built web application can be installed, and whether it survives losing the network.
 *
 * These are the two claims issue #10 makes about the web side, and neither can be checked anywhere
 * else in this repository: a manifest and a service worker exist only in a production build, and
 * until this suite existed nothing here ever ran `vite build` at all.
 */

/**
 * Waits until the worker is ready to serve the next navigation.
 *
 * `navigator.serviceWorker.ready` rather than polling the registration until its worker reports
 * `activated`, and the difference is not cosmetic: the polled version was measured to resolve
 * before the browser will route a navigation through the worker, so a reload issued on it comes off
 * the network and the page is left permanently uncontrolled. `ready` is the promise that means what
 * the poll looks like it means.
 */
async function waitUntilReady(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
}

/**
 * Waits for the worker to be the one answering this page's requests.
 *
 * Activated and controlling are not the same thing, and the difference is the whole of offline
 * support. `registerType: "prompt"` means no `clientsClaim`, deliberately - a worker that seizes
 * pages it did not load is how you get a half-updated application - so the first worker installs
 * behind a page that is still talking directly to the network. Only the next navigation is served
 * by it.
 */
async function waitForController(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000
  });
}

test("the manifest describes something a browser will install", async ({ page, request }) => {
  await page.goto("/");

  const href = await page.locator("link[rel=manifest]").getAttribute("href");
  expect(href).not.toBeNull();

  const response = await request.get(href!);
  expect(response.ok()).toBe(true);

  const manifest = (await response.json()) as {
    name?: string;
    start_url?: string;
    display?: string;
    icons?: { sizes?: string; purpose?: string }[];
  };

  expect(manifest.name).toBe("Atlantis HUD");
  expect(manifest.start_url).toBe("/");
  // Anything other than "standalone" or "fullscreen" and the browser offers a shortcut rather than
  // an installation, which is the difference between a PWA and a bookmark.
  expect(manifest.display).toBe("standalone");

  const sizes = manifest.icons?.map((icon) => icon.sizes) ?? [];
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
  // Without a maskable icon Android puts the square artwork inside its circular mask and crops the
  // corners off it.
  expect(manifest.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
});

test("the service worker registers and activates", async ({ page }) => {
  await page.goto("/");
  await waitUntilReady(page);

  const { scope, state } = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return { scope: registration.scope, state: registration.active?.state ?? null };
  });

  expect(state).toBe("activated");

  // Scoped to the origin root, so every path the application can reach is behind the cache.
  expect(scope).toBe("http://127.0.0.1:4175/");
});

test("the workspace still opens with the network cut", async ({ page, context }) => {
  await page.goto("/");
  await waitUntilReady(page);
  // The reload is not incidental. Until it happens the page is not controlled, and cutting the
  // network under an uncontrolled page tests nothing but that the network is cut.
  await page.reload();
  await waitForController(page);
  await expect(page.getByTestId("game-gate").or(page.getByTestId("app-header"))).toBeVisible();

  await context.setOffline(true);
  await page.reload();

  // The core is WebAssembly and the shell renders nothing until it has instantiated, so a header on
  // screen with no network is proof the 430 KB module came out of the cache. The error page the
  // shell falls back to is the failure this asserts against.
  await expect(page.getByTestId("game-gate").or(page.getByTestId("app-header"))).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // The ruleset is fetched separately at startup and is what keeps unit man-counts exact rather
  // than estimated. It is precached for that reason, so it should answer offline too.
  const rulesetOk = await page.evaluate(async () => {
    const response = await fetch("/ruleset.json");
    return response.ok;
  });
  expect(rulesetOk).toBe(true);
});
