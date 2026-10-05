import { expect, test, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";
import { clearGames, importReport, loadReport } from "./gameSetup";

/**
 * The check a report gets the first time it is opened (ah-fdmb): a New Origins report opened in a
 * game set up as New Age: Trident names things Trident does not define. Which names, and how they
 * are grouped and worded, is pinned by `reportRulesetCheck.test.ts`; these walks pin the dialog in
 * the running shell - when it opens, what its buttons do, where focus goes, and that a report is
 * checked once.
 */

const TURN_71 = readReport("g7f95t71");
const TURN_72 = readReport("g7f95t72");
/** Another faction's turn 71, which Trident defines every name of: it opens no check of its own. */
const ALLY_71 = readReport("g8f73t71");
const TURN_55 = readReport("g7f95t55");
const TURN_74 = readReport("g7f95t74");

async function createGameOn(page: Page, name: string, rulesetId: string) {
  await clearGames(page);
  await expect(page.getByTestId("game-gate")).toBeVisible();
  await page.getByTestId("game-name").fill(name);
  await page.getByTestId("game-ruleset").selectOption(rulesetId);
  await page.getByRole("button", { name: "Create game", exact: true }).click();
  await expect(page.getByTestId("game-indicator")).toContainText(name);
}

/** Records what the page asks to open and copy, instead of opening a browser or a clipboard. */
async function recordOutside(page: Page) {
  await page.evaluate(() => {
    const record = window as unknown as { opened: string[]; copied: string[] };
    record.opened = [];
    record.copied = [];
    window.open = (url?: string | URL) => {
      record.opened.push(String(url));
      return null;
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void record.copied.push(text) }
    });
  });
}

const recorded = (page: Page) =>
  page.evaluate(() => {
    const record = window as unknown as { opened: string[]; copied: string[] };
    return { opened: record.opened, copied: record.copied };
  });

test("a report the game's ruleset does not cover opens the check, and a change that covers it confirms", async ({ page }) => {
  await createGameOn(page, "Trident game", "newage-trident");
  await importReport(page, "turn-71.rep", TURN_71);

  const dialog = page.getByTestId("report-check");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("report-check-title")).toHaveText("⚠ Check this game’s ruleset");
  await expect(page.getByTestId("report-check-intro")).toContainText(
    /^The report turn-71\.rep names \d+ things the New Age: Trident ruleset doesn’t define\./u
  );
  await expect(dialog).toContainText("Not defined in New Age: Trident");
  const list = page.getByTestId("report-check-ruleset");
  await expect(list).toBeFocused();
  await expect(list).toHaveValue("newage-trident");
  await expect(page.getByTestId("report-check-change")).toBeDisabled();

  await list.selectOption("neworigins");
  await expect(page.getByTestId("report-check-change")).toBeEnabled();
  await page.getByTestId("report-check-change").click();

  await expect(page.getByTestId("report-check-confirmed")).toHaveText(
    "✓ Changed to New Origins. Everything in turn-71.rep is now defined."
  );
  await expect(page.getByTestId("report-check-close")).toBeFocused();
  await page.getByTestId("report-check-close").click();
  await expect(dialog).toHaveCount(0);

  // The change is the game's, like any other setting: it survives a reload.
  await page.reload();
  await page.getByTestId("settings-indicator").click();
  await page.getByTestId("settings-tab-game").click();
  await expect(page.getByTestId("settings-game-ruleset")).toHaveValue("neworigins");
});

test("a change that still leaves names undefined says how many it defined, on the new ruleset", async ({ page }) => {
  await createGameOn(page, "Trident game", "newage-trident");
  await importReport(page, "turn-72.rep", TURN_72);

  const list = page.getByTestId("report-check-ruleset");
  await list.selectOption("newage-arcanum");
  await page.getByTestId("report-check-change").click();

  await expect(page.getByTestId("report-check-still-missing")).toHaveText(
    /^Changed to New Age: Arcanum — \d+ of the \d+ names are now defined\.$/u
  );
  await expect(page.getByTestId("report-check")).toContainText("Not defined in New Age: Arcanum");
  await expect(list).toHaveValue("newage-arcanum");
  await expect(list).toBeFocused();
  await expect(page.getByTestId("report-check-change")).toBeDisabled();
});

test("the reporting step copies the list, opens a prefilled issue and the world's Discord, and Escape closes it", async ({ page }) => {
  await createGameOn(page, "Trident game", "newage-trident");
  await recordOutside(page);
  await importReport(page, "turn-71.rep", TURN_71);

  await page.getByTestId("report-check-right").click();
  await expect(page.getByTestId("report-check-title")).toHaveText("⚠ Report a missing name");
  await expect(page.getByTestId("report-check-intro")).toContainText(
    /^If New Age: Trident really is this game’s ruleset, the app is missing these \d+ names\./u
  );
  await expect(page.getByTestId("report-check-github")).toBeFocused();

  await page.getByTestId("report-check-copy").click();
  await expect(page.getByTestId("report-check-copy")).toHaveText("Copied");
  await expect(page.getByTestId("report-check-copy")).toHaveText("Copy the list", { timeout: 5000 });

  await page.getByTestId("report-check-github").click();
  await expect(page.getByTestId("report-check-discord")).toHaveText("Open the New Age Discord");
  await page.getByTestId("report-check-discord").click();

  const { opened, copied } = await recorded(page);
  expect(copied[0]).toMatch(/^A report names things the New Age: Trident ruleset does not define\./u);
  expect(copied[0]).toContain("Report turn: 71");
  const issue = new URL(opened[0]);
  expect(`${issue.origin}${issue.pathname}`).toBe("https://github.com/rmstdope/atlantis-hud/issues/new");
  expect(issue.searchParams.get("title")).toBe("Names missing from the New Age: Trident ruleset");
  expect(issue.searchParams.get("body")).toBe(copied[0]);
  expect(opened[1]).toBe("https://discord.gg/Nd835Zj54");
  // The dialog stays open after each of these.
  await expect(page.getByTestId("report-check")).toBeVisible();

  await page.getByTestId("report-check-back").click();
  await expect(page.getByTestId("report-check-ruleset")).toBeFocused();
  await page.getByTestId("report-check-right").click();

  // Escape closes from screen 2 too, rather than going back.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("report-check")).toHaveCount(0);
});

test("a report is checked once: opening it again, after a reload, never warns again", async ({ page }) => {
  await createGameOn(page, "Trident game", "newage-trident");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("report-check")).toBeVisible();
  await page.getByTestId("report-check-x").click();
  await expect(page.getByTestId("report-check")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("app-header")).toContainText(/Turn\s*71\b/u);
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("import-status")).toContainText("regions");
  await expect(page.getByTestId("report-check")).toHaveCount(0);
});

test("a batch import gives one check for every affected report, before the Import summary", async ({ page }) => {
  await createGameOn(page, "Trident game", "newage-trident");
  await page.setInputFiles('input[type="file"]', [
    { name: "turn-71.rep", mimeType: "text/plain", buffer: Buffer.from(TURN_71, "utf8") },
    { name: "turn-72.rep", mimeType: "text/plain", buffer: Buffer.from(TURN_72, "utf8") }
  ]);

  const dialog = page.getByTestId("report-check");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("import-summary")).toHaveCount(0);
  await expect(page.getByTestId("report-check-intro")).toContainText(
    /^2 of the 2 reports you imported name \d+ things the New Age: Trident ruleset doesn’t define\./u
  );
  await expect(page.getByTestId("report-check-names")).toContainText("turn-71.rep, turn-72.rep");

  await page.getByTestId("report-check-close").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("import-summary")).toBeVisible();
});

test("reports opened one after another while the check is up join it, as one import would", async ({ page }) => {
  await createGameOn(page, "Trident game", "newage-trident");
  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("report-check")).toBeVisible();

  // What a New Age history fetch does: one report after another, each through the single path.
  await importReport(page, "turn-72.rep", TURN_72);
  await expect(page.getByTestId("report-check-intro")).toContainText(
    /^2 of the 2 reports you imported name \d+ things the New Age: Trident ruleset doesn’t define\./u
  );
  await expect(page.getByTestId("report-check-names")).toContainText("turn-71.rep, turn-72.rep");

  // And a change checks both of them again, not only the last. Arcanum, because both still name
  // something it lacks (the gnoll race), so a check of the last alone would read as one report;
  // under New Origins both now read cleanly (ah-n30q) and could not tell the two apart.
  await page.getByTestId("report-check-ruleset").selectOption("newage-arcanum");
  await page.getByTestId("report-check-change").click();
  await expect(page.getByTestId("report-check-still-missing")).toHaveText(
    /^Changed to New Age: Arcanum — \d+ of the \d+ names are now defined\.$/u
  );
  await expect(page.getByTestId("report-check-intro")).toContainText(/^2 of the 2 reports you imported /u);
});

test("a report joining the check leaves the player where they were in it", async ({ page }) => {
  await createGameOn(page, "Trident game", "newage-trident");
  await importReport(page, "turn-71.rep", TURN_71);
  await page.getByTestId("report-check-right").click();
  await expect(page.getByTestId("report-check-title")).toHaveText("⚠ Report a missing name");

  await importReport(page, "turn-72.rep", TURN_72);
  await expect(page.getByTestId("report-check-names")).toContainText("turn-71.rep, turn-72.rep");
  await expect(page.getByTestId("report-check-title")).toHaveText("⚠ Report a missing name");
});

test("two batches meeting under one check each keep their Import summary", async ({ page }) => {
  await createGameOn(page, "Trident game", "newage-trident");
  const batch = (...files: [string, string][]) =>
    page.setInputFiles(
      'input[type="file"]',
      files.map(([name, text]) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text, "utf8") }))
    );

  await batch(["turn-71.rep", TURN_71], ["turn-72.rep", TURN_72]);
  await expect(page.getByTestId("report-check")).toBeVisible();
  await batch(["turn-55.rep", TURN_55], ["turn-74.rep", TURN_74]);
  await expect(page.getByTestId("report-check-intro")).toContainText(/^4 of the 4 reports you imported/u);

  await page.getByTestId("report-check-close").click();
  const summary = page.getByTestId("import-summary");
  await expect(summary).toContainText("turn-71.rep");
  await expect(summary).not.toContainText("turn-55.rep");
  await page.getByTestId("import-summary-close").click();
  // The second batch's account follows the first.
  await expect(summary).toContainText("turn-55.rep");
  await expect(summary).not.toContainText("turn-71.rep");
  await page.getByTestId("import-summary-close").click();
  await expect(summary).toHaveCount(0);
});

test("a batch with nothing new to check waits behind an open check for its Import summary", async ({ page }) => {
  await createGameOn(page, "Trident game", "newage-trident");
  const both = [
    { name: "turn-71.rep", mimeType: "text/plain", buffer: Buffer.from(TURN_71, "utf8") },
    { name: "turn-72.rep", mimeType: "text/plain", buffer: Buffer.from(TURN_72, "utf8") }
  ];
  await page.setInputFiles('input[type="file"]', both);
  await expect(page.getByTestId("report-check")).toBeVisible();

  // The same two again: both already checked, so nothing joins - but its summary must not be lost.
  await page.setInputFiles('input[type="file"]', both);
  await expect(page.getByTestId("import-summary")).toHaveCount(0);

  await page.getByTestId("report-check-close").click();
  const summary = page.getByTestId("import-summary");
  await expect(summary).toBeVisible();
  await page.getByTestId("import-summary-close").click();
  await expect(summary).toBeVisible();
  await page.getByTestId("import-summary-close").click();
  await expect(summary).toHaveCount(0);
});

test("an older turn, kept for history rather than shown, is checked too", async ({ page }) => {
  await createGameOn(page, "Trident game", "newage-trident");
  await importReport(page, "turn-72.rep", TURN_72);
  await page.getByTestId("report-check-close").click();
  await expect(page.getByTestId("report-check")).toHaveCount(0);

  await importReport(page, "turn-71.rep", TURN_71);
  await expect(page.getByTestId("report-check-intro")).toContainText(/^The report turn-71\.rep names /u);
});

for (const answer of ["foreign-report-switch", "foreign-report-merge"] as const) {
  test(`another faction's report is checked once the foreign-report question is answered (${answer})`, async ({ page }) => {
    await createGameOn(page, "Trident game", "newage-trident");
    await importReport(page, "ally-71.rep", ALLY_71);
    await expect(page.getByTestId("import-status")).toContainText("region");
    await expect(page.getByTestId("report-check")).toHaveCount(0);

    await importReport(page, "turn-71.rep", TURN_71);
    await expect(page.getByTestId("foreign-report-prompt")).toBeVisible();
    await expect(page.getByTestId("report-check")).toHaveCount(0);
    await page.getByTestId(answer).click();

    await expect(page.getByTestId("report-check-intro")).toContainText(/^The report turn-71\.rep names /u);
  });
}

test("a report its ruleset fully defines opens no check", async ({ page }) => {
  await loadReport(page);
  await expect(page.getByTestId("report-check")).toHaveCount(0);
});
