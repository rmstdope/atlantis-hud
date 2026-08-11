import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearGames, createGame } from "./gameSetup";

/**
 * Exporting part of the map as a file an ally can read.
 *
 * The walk that matters end to end: the file only exists once the core, both adapters, the dialog
 * and the download have all agreed, and nothing below the shell can tell whether the browser ever
 * received one. The Shift+drag is here for the same reason - a pointer gesture is the one part of
 * the feature no unit test in this repository can reach.
 */

const TURN_71 = readFileSync(
  join(__dirname, "..", "fixtures", "reports", "neworigins-3.0.0-f95-t71.rep"),
  "utf8"
);

async function importReport(page: Page, report: string) {
  await page.setInputFiles('input[type="file"]', {
    name: "turn-71.rep",
    mimeType: "text/plain",
    buffer: Buffer.from(report, "utf8")
  });
  await expect(page.getByTestId("import-status")).toContainText("region");
}

async function setRectangle(page: Page, box: { fromX: number; fromY: number; toX: number; toY: number }) {
  for (const [key, value] of Object.entries(box)) {
    await page.getByTestId(`map-export-${key}`).fill(String(value));
  }
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

test("exports a chosen area of the map as a report-shaped file", async ({ page }, testInfo) => {
  await clearGames(page);
  await createGame(page, "Export game");
  await importReport(page, TURN_71);

  await page.getByTestId("export-map").click();
  await expect(page.getByTestId("map-export-panel")).toBeVisible();

  await setRectangle(page, { fromX: 7, fromY: 53, toX: 7, toY: 53 });
  await expect(page.getByTestId("map-export-summary")).toContainText("1 region will be exported");

  const { text, name } = await exportAndRead(page, testInfo);

  expect(name).toBe("map-turn-71-level-1.txt");
  expect(text).toContain("Atlantis Report For:");
  expect(text).toContain("Borg TNG (95)");
  expect(text).toContain("; level 1, hexes (7,53) to (7,53), 1 region");
  expect(text).toContain("mountain (7,53) in Inhead");
  // The neighbours are named as exits, as a report names them, but they get no blocks of their own.
  expect(text).toContain("North : mountain (7,51) in Inhead.");
  expect(text).not.toContain("\nocean (8,52) in Atlantis Ocean");
});

test("leaves out the content the player unticks", async ({ page }, testInfo) => {
  await clearGames(page);
  await createGame(page, "Export game");
  await importReport(page, TURN_71);

  await page.getByTestId("export-map").click();
  await setRectangle(page, { fromX: 7, fromY: 53, toX: 7, toY: 53 });
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

test("a shift-drag on the map opens the dialog on the hexes it covered", async ({ page }) => {
  await clearGames(page);
  await createGame(page, "Export game");
  await importReport(page, TURN_71);

  // Points on the open map rather than particular hexes: the panels float over the lower half of
  // the canvas, and a drag that started under one would be delivered to the panel instead.
  const canvas = await page.getByTestId("map-canvas").boundingBox();
  expect(canvas).not.toBeNull();
  const from = { x: canvas!.x + 200, y: canvas!.y + 40 };
  const to = { x: from.x + 220, y: from.y + 160 };

  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  // The band is painted by hand onto its own element while the drag runs; seeing it proves the
  // gesture was read as a marquee rather than as a pan.
  await expect(page.getByTestId("map-marquee")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await expect(page.getByTestId("map-export-panel")).toBeVisible();

  const corner = async (name: string) =>
    Number(await page.getByTestId(`map-export-${name}`).inputValue());
  const [fromX, toX, fromY, toY] = await Promise.all([
    corner("fromX"),
    corner("toX"),
    corner("fromY"),
    corner("toY")
  ]);

  // An area, not a hex: the drag crossed several columns and rows, and the corners came back
  // normalised whichever way it was dragged.
  expect(toX).toBeGreaterThan(fromX);
  expect(toY).toBeGreaterThan(fromY);
});
