import { expect, test } from "@playwright/test";
import { loadReport, selectHex, selectUnit } from "./gameSetup";

/**
 * The magic study tree (ah-gjbs.1): all seventy magic skills grouped into branch cards, opened
 * from F3, from the palette or from a mage's own pane.
 *
 * The two behaviours a `renderToStaticMarkup` test in `packages/shared` cannot reach are here on
 * purpose - that package has no jsdom by decision (ah-nass), so nothing there runs the effect that
 * scrolls a followed skill into view or the one that returns focus.
 */

/** "Six of Seven", a mage of the player's faction: force 4 (325) is their highest magic skill. */
const MAGE = "881";
/** The ocean hex the mage is sailing in. The units table lists the selected hex, so it comes first. */
const MAGE_HEX = "1:26,52";

test("F3 opens the tree, a chip walks it, and a name opens the dictionary", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F3");
  const dialog = page.getByTestId("magic-tree-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("magic-tree-branch-ARTI")).toBeVisible();
  await expect(page.getByTestId("magic-tree-branch-FOUND")).toBeVisible();
  await expect(page.getByTestId("magic-tree-cap")).toContainText("can never rise above");

  // Following a crossing prerequisite moves the view to the skill it names and picks it out.
  await page.getByTestId("magic-tree-chip-CRRI-INVI").click();
  const invisibility = page.getByTestId("magic-tree-skill-INVI");
  await expect(invisibility).toBeInViewport();
  await expect(invisibility).toHaveClass(/bg-panel/);

  // A skill's name is the other kind of door: it opens the dictionary, and the tree gets out of
  // the way rather than the two stacking.
  await page.getByTestId("magic-tree-skill-FORC").getByRole("button", { name: "force", exact: true }).click();
  await expect(page.getByTestId("game-data-dialog")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.keyboard.press("F3");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a mage's pane opens the tree on the skill they are furthest along in", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, MAGE_HEX);
  await selectUnit(page, MAGE);

  await page.getByTestId("unit-magic-tree").click();
  await expect(page.getByTestId("magic-tree-dialog")).toBeVisible();
  const force = page.getByTestId("magic-tree-skill-FORC");
  await expect(force).toBeInViewport();
  await expect(force).toHaveClass(/bg-panel/);
});

test("the palette offers the tree by name", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("Magic study tree");
  await expect(page.getByTestId("palette-item").first()).toContainText("Magic study tree");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("magic-tree-dialog")).toBeVisible();
  await expect(page.getByTestId("magic-tree-skill-MANI")).toBeAttached();
});
