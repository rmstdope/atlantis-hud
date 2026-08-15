import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearGames, createGame } from "./gameSetup";

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
const TURN_70 = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-g7-f95-t70.rep"),
  "utf8"
);
const TURN_71 = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-g7-f95-t71.rep"),
  "utf8"
);

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
      }
    };
  });
});

async function desktopCalls(page: import("@playwright/test").Page): Promise<DesktopCall[]> {
  return page.evaluate(
    () => (window as unknown as { __ATLANTIS_DESKTOP_CALLS__: DesktopCall[] }).__ATLANTIS_DESKTOP_CALLS__
  );
}

async function importReport(
  page: import("@playwright/test").Page,
  name: string,
  report: string
) {
  await page.setInputFiles('input[type="file"]', {
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(report, "utf8")
  });
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
      defaultPath: expect.stringMatching(/\.atlantis-hud-game\.json$/u)
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
