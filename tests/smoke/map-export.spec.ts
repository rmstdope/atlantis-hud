import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readReport } from "@atlantis/fixtures";
import {
  clearGames,
  createGame,
  importReport
} from "./gameSetup";

/**
 * Exporting part of the map as a file an ally can read.
 *
 * The walk that matters end to end: the file only exists once the core, both adapters, the dialog
 * and the download have all agreed, and nothing below the shell can tell whether the browser ever
 * received one. The Shift+drag is here for the same reason - a pointer gesture is the one part of
 * the feature no unit test in this repository can reach.
 */

const TURN_71 = readReport("g7f95t71");


/**
 * Drags an export rectangle across the open map.
 *
 * It starts near the top of the canvas because the panels float over the lower half, and a press
 * that landed under one would be delivered to the panel rather than to the map. Where it ends does
 * not matter in the same way: the drag is followed on the window, so it can finish behind a panel.
 *
 * The span reaches most of the way across, which is what puts known hexes inside it - the view
 * opens framed on everything the faction has seen, so a small rectangle in one corner of it can
 * easily hold nothing but unexplored ground.
 */
async function dragRectangle(page: Page) {
  const canvas = await page.getByTestId("map-canvas").boundingBox();
  expect(canvas).not.toBeNull();
  const from = { x: canvas!.x + 30, y: canvas!.y + 20 };
  const to = { x: canvas!.x + canvas!.width - 30, y: canvas!.y + canvas!.height - 30 };

  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(page.getByTestId("map-marquee")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

/** Opens the map export from the header, which is one press inside the Export menu. */
async function openMapExport(page: Page) {
  await page.getByTestId("export-menu").click();
  await page.getByTestId("export-map").click();
}

/** Saves whatever the export downloads and hands back its text. */
async function exportAndRead(page: Page, testInfo: { outputPath: (name: string) => string }) {
  const downloading = page.waitForEvent("download");
  await page.getByTestId("map-export-confirm").click();
  const download = await downloading;
  const path = testInfo.outputPath("map-export.txt");
  await download.saveAs(path);
  return { text: readFileSync(path, "utf8"), name: download.suggestedFilename() };
}

test("exports the whole known map when nothing was selected", async ({ page }, testInfo) => {
  await clearGames(page);
  await createGame(page, "Export game");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("import-status")).toContainText("region");

  await openMapExport(page);
  await expect(page.getByTestId("map-export-panel")).toBeVisible();
  // Said in words rather than as four coordinates the player would have to read back.
  await expect(page.getByTestId("map-export-area")).toHaveText(
    "The entire known map on this level."
  );
  await expect(page.getByTestId("map-export-summary")).toContainText("regions will be exported");

  const { text, name } = await exportAndRead(page, testInfo);

  expect(name).toBe("map-turn-71-level-1.txt");
  expect(text).toContain("Atlantis Report For:");
  expect(text).toContain("Borg TNG (95)");
  expect(text).toContain("mountain (7,53) in Inhead");
  expect(text).toContain("North : mountain (7,51) in Inhead.");

  // The dialog closes behind the export rather than being replaced by another one.
  await expect(page.getByTestId("map-export-panel")).toHaveCount(0);
});

test("exports only the area a shift-drag selected", async ({ page }, testInfo) => {
  await clearGames(page);
  await createGame(page, "Export game");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("import-status")).toContainText("region");

  await dragRectangle(page);
  await expect(page.getByTestId("map-export-panel")).toBeVisible();

  const area = await page.getByTestId("map-export-area").textContent();
  const corners = [...(area ?? "").matchAll(/\((-?\d+),(-?\d+)\)/g)].map((match) => [
    Number(match[1]),
    Number(match[2])
  ]);
  expect(corners).toHaveLength(2);
  // An area, not a hex: the drag crossed several columns and rows, and it is stated the way the
  // game writes a coordinate rather than as four editable numbers.
  expect(corners[1][0]).toBeGreaterThan(corners[0][0]);
  expect(corners[1][1]).toBeGreaterThan(corners[0][1]);

  const { text } = await exportAndRead(page, testInfo);
  expect(text).toContain(
    `; level 1, hexes (${corners[0][0]},${corners[0][1]}) to (${corners[1][0]},${corners[1][1]})`
  );
});

test("leaves out the content the player unticks", async ({ page }, testInfo) => {
  await clearGames(page);
  await createGame(page, "Export game");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("import-status")).toContainText("region");

  await openMapExport(page);
  await page.getByTestId("map-export-units").uncheck();
  await page.getByTestId("map-export-structures").uncheck();

  const { text } = await exportAndRead(page, testInfo);

  expect(text).toContain("; structures: no, units: no, advanced resources: yes");
  expect(text).toContain("mountain (7,53) in Inhead");
  // The hex holds both in the fixture, so their absence is the toggles working rather than an
  // empty region.
  expect(text).not.toContain("Cartographers HQ");
  expect(text).not.toContain("(18642)");
  expect(text).toContain("Products:");
});

/**
 * The round trip, through the application's own front door.
 *
 * The one test that catches a marker the shell does not recognise: a map export that is not
 * recognised parses perfectly well as a report, so it takes the report path and replaces the turn
 * on screen with a file that has no orders template, no faction status and no events. Nothing else
 * in this repository compares the Rust `MAP_EXPORT_MARKER` with the TypeScript one - they are two
 * string literals in two languages - so this walk is the check between them.
 */
test("re-imports its own export as a map, and leaves the turn alone", async ({ page }, testInfo) => {
  await clearGames(page);
  await createGame(page, "Export game");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("import-status")).toContainText("region");

  await openMapExport(page);
  const { text, name } = await exportAndRead(page, testInfo);

  await importReport(page, name, text);

  // A prompt, never a load: the file is a map and the player is asked before anything is written.
  const prompt = page.getByTestId("map-export-prompt");
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("is a map export from your own faction");
  await expect(page.getByTestId("map-export-add")).toBeFocused();

  await page.getByTestId("map-export-add").click();

  // Every hex of it came out of the map it is being added back to, so nothing is new.
  await expect(page.getByTestId("import-status")).toContainText(
    "nothing added — your map already had all of it"
  );
  await expect(page.getByTestId("map-export-prompt")).toHaveCount(0);

  // The turn on screen survived, faction and all - which is the whole point of the bead.
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);
  await expect(page.getByTestId("app-header")).toContainText("Borg TNG (95)");
});

test("cancels a map export without writing anything", async ({ page }, testInfo) => {
  await clearGames(page);
  await createGame(page, "Export game");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("import-status")).toContainText("region");

  await openMapExport(page);
  const { text, name } = await exportAndRead(page, testInfo);

  await importReport(page, name, text);
  await expect(page.getByTestId("map-export-prompt")).toBeVisible();

  await page.getByTestId("map-export-cancel").click();

  await expect(page.getByTestId("map-export-prompt")).toHaveCount(0);
  await expect(page.getByTestId("import-status")).not.toContainText("added to your map");
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/);
});
