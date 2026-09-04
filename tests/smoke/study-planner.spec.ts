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

/**
 * The Schedule view (ah-lyg6.2.3): the grid where a plan is actually written.
 *
 * Everything the projection says and every string it says it in is pinned in
 * `studySchedule.test.ts` and `studyCell.test.ts`. What is here is what needs a real browser: a
 * popover opening on a click, a plan surviving a reload, and the note reaching the other view.
 */
test("the Schedule plans a mage's studies, and the plan survives a reload", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  await expect(page.getByTestId("study-schedule")).toBeVisible();
  await expect(page.getByTestId("study-schedule-turn-72")).toContainText("72 · next");

  const cell = page.getByTestId(`study-schedule-cell-${MAGE}-72`);
  await cell.click();
  const popover = page.getByTestId("study-schedule-popover");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("From turn 72, Six of Seven studies");

  await page.getByTestId("study-schedule-choice-FORC").click();
  await page.getByTestId("study-schedule-level").selectOption("5");
  await page.getByTestId("study-schedule-set").click();
  // Waits for the popover to close rather than for the cell's text: the row is written
  // optimistically, so its text can be the new one before the write has landed.
  await expect(popover).toHaveCount(0);
  await expect(cell).toContainText("force");

  // The reload has to finish restoring the game before F4 means anything: the shortcut is
  // ignored while there is no report, exactly as `persistence.spec.ts` waits for this line.
  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  await expect(page.getByTestId(`study-schedule-cell-${MAGE}-72`)).toContainText("force");
});

test("a note written in All mages shows as a pencil in the Schedule", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await expect(page.getByTestId("study-planner-plan-line")).toBeVisible();
  const note = page.getByTestId("study-planner-note").locator("textarea");
  await note.fill("heading for Gate Lore");
  await note.press("ControlOrMeta+Enter");

  await page.getByTestId("study-planner-view-schedule").click();
  await expect(page.getByTestId("study-schedule-note-881")).toBeVisible();
});

test("the hover card follows the pointer and the focus", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  const card = page.getByTestId("study-schedule-hover");
  await expect(card).toHaveCount(0);

  await page.getByTestId(`study-schedule-cell-${MAGE}-72`).hover();
  await expect(card).toContainText("Six of Seven (881) — turn 72");

  // Reachable without a mouse: the arrow keys walk the grid and the card follows the focus.
  await page.getByTestId(`study-schedule-cell-${MAGE}-72`).focus();
  await page.keyboard.press("ArrowRight");
  await expect(card).toContainText("turn 73");
});

test("Escape closes the cell popover and leaves the pane open", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  await page.getByTestId(`study-schedule-cell-${MAGE}-72`).click();
  await expect(page.getByTestId("study-schedule-popover")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("study-schedule-popover")).toHaveCount(0);
  await expect(page.getByTestId("study-planner-dialog")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("study-planner-dialog")).toHaveCount(0);
});
