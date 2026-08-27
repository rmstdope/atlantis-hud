import { expect, test } from "@playwright/test";
import { loadReport, selectHex, selectUnit } from "./gameSetup";

/**
 * The study tree tinted for one of your own mages (ah-67h8): every skill says whether he knows it
 * and can still raise it, knows it and is stuck, has it at the game's maximum, may begin it now,
 * or cannot begin it at all.
 *
 * Here rather than in `packages/shared` because every step below is an effect or a click that a
 * `renderToStaticMarkup` test cannot run: that package has no jsdom by decision (ah-nass). The
 * arithmetic itself is covered exhaustively by `magicStanding.test.ts`.
 */

/** "Six of Seven", the faction's strongest mage: force 4, and nine skills he cannot raise. */
const MAGE = "881";
/** The ocean hex the mage is sailing in. The units table lists the selected hex, so it comes first. */
const MAGE_HEX = "1:26,52";
/** "One of Eight", an apprentice: manipulation 3, and 66 of the 70 skills locked. */
const APPRENTICE = "18636";

test("the tree opens tinted for the selected mage and says where he stands", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, MAGE_HEX);
  await selectUnit(page, MAGE);

  await page.keyboard.press("F3");
  await expect(page.getByTestId("magic-tree-dialog")).toBeVisible();
  await expect(page.getByTestId("magic-tree-mage-picker")).toContainText("Six of Seven (881)");

  // Every state he is actually in, and none he is not.
  const tally = page.getByTestId("magic-tree-tally");
  await expect(tally).toContainText("8 known · 9 at ceiling · 21 can study · 32 locked");
  await expect(tally).not.toContainText("at maximum");

  // Illusion is held at 3 by pattern, which he also holds at 3: "known at 3" and "stuck at 3" are
  // different statements, and this is the one the tree has to make.
  await expect(page.getByTestId("magic-tree-standing-ILLU")).toContainText("at 3, held by pattern");
  await expect(page.getByTestId("magic-tree-standing-DRAG")).toContainText(
    "at 3, held by bird lore and wolf lore"
  );
  await expect(page.getByTestId("magic-tree-standing-INVI")).toContainText("can study");
  // A skill he cannot begin takes no chip at all: what is missing is the reason to show the row.
  await expect(page.getByTestId("magic-tree-standing-CRRI")).toHaveCount(0);
  await expect(page.getByTestId("magic-tree-skill-CRRI")).toHaveClass(/text-ink-dim/);
});

test("the picker folds the apprentices away, and Escape closes it before the dialog", async ({
  page
}) => {
  await loadReport(page);
  await selectHex(page, MAGE_HEX);
  await selectUnit(page, MAGE);
  await page.keyboard.press("F3");

  await page.getByTestId("magic-tree-mage-picker").click();
  await expect(page.getByTestId("magic-tree-mage-menu")).toBeVisible();
  const fold = page.getByTestId("magic-tree-mage-apprentices");
  await expect(fold).toBeVisible();
  await expect(page.getByTestId(`magic-tree-mage-${APPRENTICE}`)).toHaveCount(0);

  await fold.click();
  await expect(page.getByTestId(`magic-tree-mage-${APPRENTICE}`)).toBeVisible();
  await page.getByTestId(`magic-tree-mage-${APPRENTICE}`).click();

  await expect(page.getByTestId("magic-tree-tally")).toContainText(
    "1 known · 3 can study · 66 locked"
  );

  // The one thing worth a browser: the menu's dismiss layer is pushed after the dialog's, so it is
  // topmost and Escape is its own. The dialog must survive the first press.
  await page.getByTestId("magic-tree-mage-picker").click();
  await expect(page.getByTestId("magic-tree-mage-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("magic-tree-mage-menu")).toHaveCount(0);
  await expect(page.getByTestId("magic-tree-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("magic-tree-dialog")).toHaveCount(0);

  // The picked mage is remembered for the session, so reopening does not undo the choice.
  await page.keyboard.press("F3");
  await expect(page.getByTestId("magic-tree-mage-picker")).toContainText("One of Eight (18636)");

  // The fold starts closed on every open: a fold that outlived its own menu would be state nobody
  // asked for.
  await page.getByTestId("magic-tree-mage-picker").click();
  await expect(page.getByTestId("magic-tree-mage-apprentices")).toBeVisible();
});

test("the graph carries the same tint, and the level mark arrives with the names", async ({
  page
}) => {
  await loadReport(page);
  await selectHex(page, MAGE_HEX);
  await selectUnit(page, MAGE);
  await page.keyboard.press("F3");
  await page.getByTestId("magic-tree-view-graph").click();

  await expect(page.getByTestId("magic-graph-skill-FORC")).toBeVisible();
  // The bar is drawn at every zoom; the mark is not, because at the opening zoom it would be about
  // six pixels. Zooming in is what brings it.
  // Counted and read by its class rather than asserted visible: a vertical `<line>` has a
  // zero-width bounding box, which Playwright reports as hidden however plainly it is drawn.
  const bar = page.getByTestId("magic-graph-bar-FORC");
  await expect(bar).toHaveCount(1);
  await expect(bar).toHaveClass(/stroke-ok/);
  const mark = page.getByTestId("magic-graph-mark-FORC");
  for (let step = 0; step < 6 && (await mark.count()) === 0; step += 1) {
    await page.getByTestId("magic-tree-zoom-in").click();
  }
  await expect(mark).toContainText("4→5");

  // Locked takes no bar in the graph either, the same rule the branch cards keep.
  await expect(page.getByTestId("magic-graph-bar-CRRI")).toHaveCount(0);
});

test("the unit pane says how much is open to a mage", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, MAGE_HEX);
  await selectUnit(page, MAGE);

  await expect(page.getByTestId("unit-magic-tree")).toBeVisible();
  await expect(page.getByTestId("panel-unit")).toContainText("Mage — 21 magic skills open");
});
