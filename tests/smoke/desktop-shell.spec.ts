import { expect, test } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";
import {
  clearGames,
  createGame,
  importReport
} from "./gameSetup";

/**
 * The `desktop-shell` project's own tests (ah-9lv).
 *
 * Every other spec in this suite runs on both `web` and `desktop-shell`, and both drive the same
 * WASM core - the desktop bundle only differs from the web one when there is a Tauri runtime, and
 * neither project has one. That made `desktop-shell` a second web run: three desktop-only defects
 * (ah-7pa, ah-jfx, ah-6l2) reached the navigator with it green.
 *
 * This spec skips itself everywhere but `desktop-shell` and asserts the one thing that project can
 * check that `web` cannot: an export goes through `desktopPlugins.ts`'s save-dialog port with the
 * right file name and filter, writes what the dialog answered, and never falls back to a browser
 * download; and a cancelled dialog writes nothing and leaves the picker open. The stand-in is
 * installed by `page.addInitScript`, before the bundle's own scripts run, so `desktopPlugins()`
 * finds it the first time an export calls it.
 */
const TURN_70 = readReport("g7f95t70");
const TURN_71 = readReport("g7f95t71");

type DesktopCall = ["save", { defaultPath?: string; filters?: unknown }] | ["write", string, number];

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-shell",
    "desktop wiring: the port is only there in the desktop bundle"
  );

  await page.addInitScript(() => {
    const calls: unknown[][] = [];
    (window as unknown as { __ATLANTIS_DESKTOP_CALLS__: unknown[][] }).__ATLANTIS_DESKTOP_CALLS__ =
      calls;
    (
      window as unknown as {
        __ATLANTIS_DESKTOP_PLUGINS__: {
          save(options: { defaultPath?: string }): Promise<string | null>;
          writeTextFile(path: string, text: string): Promise<void>;
          httpRequest(
            request: {
              method: string;
              url: string;
              headers: Record<string, string>;
              body?: string;
            },
            signal: AbortSignal
          ): Promise<{ status: number; body: string }>;
        };
      }
    ).__ATLANTIS_DESKTOP_PLUGINS__ = {
      async save(options: { defaultPath?: string }) {
        calls.push(["save", options]);
        return (window as unknown as { __ATLANTIS_DESKTOP_CANCEL__?: boolean })
          .__ATLANTIS_DESKTOP_CANCEL__
          ? null
          : `/fake/${options.defaultPath ?? "file"}`;
      },
      async writeTextFile(path: string, text: string) {
        calls.push(["write", path, text.length]);
      },
      // Nothing in this suite sends orders yet (ah-etb0.2 adds the control). The stand-in records
      // the call and answers an acceptance, so a spec that starts sending has something to assert
      // against - and the recorded body length never carries the password anywhere.
      async httpRequest(
        request: { method: string; url: string; headers: Record<string, string>; body?: string },
        signal: AbortSignal
      ) {
        calls.push([
          "httpRequest",
          request.url,
          request.headers["Content-Type"] ?? "",
          request.body?.length ?? 0,
          signal.aborted
        ]);
        return { status: 200, body: "<pre>#end\nNo errors found.\n</pre>" };
      }
    };
  });
});

async function desktopCalls(page: import("@playwright/test").Page): Promise<DesktopCall[]> {
  return page.evaluate(
    () => (window as unknown as { __ATLANTIS_DESKTOP_CALLS__: DesktopCall[] }).__ATLANTIS_DESKTOP_CALLS__
  );
}


test("an orders export goes through the save dialog, with no browser download", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Desktop export game");
  await importReport(page, "turn-70.rep", TURN_70);
  await expect(page.getByTestId("import-status")).toContainText("1 region");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("import-status")).toContainText("11 regions");

  const downloadRace = page
    .waitForEvent("download", { timeout: 1_500 })
    .then(() => "download")
    .catch(() => "none");

  await page.getByTestId("export-menu").click();
  await page.getByTestId("export-orders").click();

  await expect.poll(() => desktopCalls(page)).toEqual([
    [
      "save",
      { defaultPath: "orders-turn-71.txt", filters: [{ name: "Text", extensions: ["txt"] }] }
    ],
    ["write", "/fake/orders-turn-71.txt", expect.any(Number)]
  ]);
  expect(await downloadRace).toBe("none");
});

test("a game backup export goes through the save dialog and closes the picker", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Desktop backup game");

  await page.getByTestId("game-indicator").click();
  await page.getByTestId("game-picker-tab-settings").click();
  await page.getByTestId("export-game").click();

  await expect.poll(() => desktopCalls(page)).toHaveLength(2);
  const calls = await desktopCalls(page);
  expect(calls[0]).toEqual([
    "save",
    expect.objectContaining({
      defaultPath: expect.stringMatching(/^Desktop backup game\.atlantis-hud-game\.json$/u)
    })
  ]);
  expect(calls[1][0]).toBe("write");
  await expect(page.getByTestId("game-picker")).not.toBeVisible();
});

test("a cancelled backup dialog writes nothing and leaves the picker open", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Desktop cancel game");
  await page.evaluate(() => {
    (window as unknown as { __ATLANTIS_DESKTOP_CANCEL__: boolean }).__ATLANTIS_DESKTOP_CANCEL__ =
      true;
  });

  await page.getByTestId("game-indicator").click();
  await page.getByTestId("game-picker-tab-settings").click();
  await page.getByTestId("export-game").click();

  await expect.poll(() => desktopCalls(page)).toEqual([
    ["save", expect.objectContaining({})]
  ]);
  await expect(page.getByTestId("game-picker")).toBeVisible();
});
