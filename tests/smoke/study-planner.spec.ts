import { expect, test } from "@playwright/test";
import { loadReport } from "./gameSetup";

/**
 * The study planner (ah-lyg6.2.2): every mage the player can see, opened with F4.
 *
 * The five behaviours here are the ones a `renderToStaticMarkup` test in `packages/shared` cannot
 * reach - that package has no jsdom by decision (ah-nass), so nothing there runs the effect that
 * takes focus, the arrow keys, or the scroll-into-view. The wording and the grouping are asserted
 * in `studyPlanner.test.ts` instead.
 */

/** "Six of Seven", a mage of the player's faction: force 4 (325) is their highest magic skill. */
const MAGE = "881";

test("F4 opens the planner, arrows walk it, and Escape closes it", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  const dialog = page.getByTestId("study-planner-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId(`study-planner-mage-95/${MAGE}`)).toBeVisible();
  await expect(page.getByTestId("study-planner-group-95")).toContainText(
    "Borg TNG (95) — your faction, turn 71"
  );

  // `aria-modal="true"` is only honest if focus is actually inside.
  await expect(page.getByTestId("study-planner-list")).toBeFocused();

  // The detail follows the selection.
  const selected = page.locator('[data-testid^="study-planner-mage-"][aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  const before = await selected.getAttribute("data-testid");
  await page.keyboard.press("ArrowDown");
  await expect(selected).not.toHaveAttribute("data-testid", before ?? "");
  await expect(page.getByTestId("study-planner-detail")).toContainText("Can study now");

  // F4 toggles it shut from inside itself, and Escape closes it too.
  await page.keyboard.press("F4");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("F4");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("the palette offers the planner with its key beside it", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("Study planner");
  await expect(page.getByTestId("palette-item").first()).toContainText("Study planner");
  await expect(page.getByTestId("palette-item").first()).toContainText("F4");
});
