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

/**
 * "Two of Seven", a mage of the same faction in the same hex. He can begin gate lore and holds
 * none of it; Six of Seven holds gate lore 1, which is the strictly greater level
 * `rules/skills_teaching` requires of a teacher.
 */
const STUDENT = "12878";

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
 * dropdown opening on a click, one cell changing and its neighbours not, a plan surviving a
 * reload, and the note reaching the other view.
 */
test("the Schedule plans a mage's studies, and the plan survives a reload", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  await expect(page.getByTestId("study-schedule")).toBeVisible();
  await expect(page.getByTestId("study-schedule-turn-72")).toContainText("72 · next");

  const cell = page.getByTestId(`study-schedule-cell-${MAGE}-72`);
  const neighbour = page.getByTestId(`study-schedule-cell-${MAGE}-73`);
  await expect(cell).toContainText("—");
  await cell.click();
  const popover = page.getByTestId("study-schedule-popover");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Six of Seven — turn 72");

  // One click is one choice: no Set, and nothing to its right moves.
  await page.getByTestId("study-schedule-choice-FORC").click();
  // Waits for the popover to close rather than for the cell's text: the row is written
  // optimistically, so its text can be the new one before the write has landed.
  await expect(popover).toHaveCount(0);
  await expect(cell).toContainText("force");
  await expect(neighbour).toContainText("—");

  // Opening it again shows the choice that is stored, and `— nothing` empties that cell alone.
  await cell.click();
  await expect(page.getByTestId("study-schedule-choice-FORC")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByTestId("study-schedule-choice-nothing").click();
  await expect(popover).toHaveCount(0);
  await expect(cell).toContainText("—");
  await expect(neighbour).toContainText("—");

  // The dropdown opens with a row focused, so the `↑↓ to move · ↵ to choose` its foot promises
  // works from the keyboard alone - which nothing in `packages/shared` can reach (ah-nass).
  await cell.click();
  await expect(page.locator("[data-row]:focus")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(popover).toHaveCount(0);
  await expect(cell).not.toContainText("—");
  await cell.click();
  await page.getByTestId("study-schedule-choice-nothing").click();
  await expect(popover).toHaveCount(0);

  // Two turns apart, and the gap between them stays empty.
  await cell.click();
  await page.getByTestId("study-schedule-choice-FORC").click();
  await expect(popover).toHaveCount(0);
  await page.getByTestId(`study-schedule-cell-${MAGE}-74`).click();
  await page.getByTestId("study-schedule-choice-FORC").click();
  await expect(popover).toHaveCount(0);
  await expect(neighbour).toContainText("—");

  // The reload has to finish restoring the game before F4 means anything: the shortcut is
  // ignored while there is no report, exactly as `persistence.spec.ts` waits for this line.
  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  await expect(page.getByTestId(`study-schedule-cell-${MAGE}-72`)).toContainText("force");
  await expect(page.getByTestId(`study-schedule-cell-${MAGE}-74`)).toContainText("force");
  await expect(page.getByTestId(`study-schedule-cell-${MAGE}-73`)).toContainText("—");
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
  const cell = page.getByTestId(`study-schedule-cell-${MAGE}-72`);
  await cell.click();
  await expect(page.getByTestId("study-schedule-popover")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("study-schedule-popover")).toHaveCount(0);
  await expect(page.getByTestId("study-planner-dialog")).toBeVisible();
  // Nothing was chosen, so the cell is exactly as it was.
  await expect(cell).toContainText("—");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("study-planner-dialog")).toHaveCount(0);
});

/**
 * Teaching, and the warnings strip (ah-lyg6.3).
 *
 * Everything asserted here is a click, a focus move or a reload - the three things a
 * `renderToStaticMarkup` test in `packages/shared` cannot reach. The wording of every notice and
 * every teaching rule is pinned in `studyTeaching.test.ts` instead.
 */
test("a teach month is planned in the popover, warned about in the strip, and survives a reload", async ({
  page
}) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();

  // The student first: `rules/skills_teaching` teaches "whatever skill they are studying that
  // month", so a mage with nothing planned is nobody's student - and the teacher must hold that
  // skill at a strictly greater level, which is why the student studies gate lore.
  const studentCell = page.getByTestId(`study-schedule-cell-${STUDENT}-72`);
  await studentCell.click();
  await page.getByTestId("study-schedule-choice-GATE").click();
  await expect(page.getByTestId("study-schedule-popover")).toHaveCount(0);
  await expect(studentCell).toContainText("gate lore");

  const cell = page.getByTestId(`study-schedule-cell-${MAGE}-72`);
  await cell.click();
  const popover = page.getByTestId("study-schedule-popover");
  await expect(popover).toBeVisible();

  // `Teaches…` is one row of the dropdown, and it opens the student list; Escape from that step
  // goes back to the dropdown rather than out.
  await page.getByTestId("study-schedule-choice-teach").click();
  await expect(popover).toContainText("Six of Seven teaches on turn 72");
  await page.keyboard.press("Escape");
  await expect(popover).toContainText("Six of Seven — turn 72");

  await page.getByTestId("study-schedule-choice-teach").click();
  await page.getByTestId(`study-schedule-teach-${STUDENT}`).click();
  await page.getByTestId("study-schedule-set").click();
  await expect(popover).toHaveCount(0);
  await expect(cell).toContainText("TEACH");
  // And the month he is taught is worth two (`rules/skills_teaching`).
  await expect(studentCell).toContainText("×2");

  // Nothing in this plan is wrong, and the strip says so rather than disappearing - the pane must
  // not change height as the plan is edited. The warning path is the case below.
  await expect(page.getByTestId("study-planner-warnings-none")).toContainText(
    "Nothing to warn about in this plan."
  );

  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  await expect(page.getByTestId(`study-schedule-cell-${MAGE}-72`)).toContainText("TEACH");
});

/**
 * The warnings strip, on a plan that is actually wrong (ah-lyg6.3).
 *
 * One write, so nothing here depends on two saves landing in order: Six of Seven is force 4 and
 * stands in no building, and `rules/magic_skills` cuts a study above level 2 in half without one.
 * The click and the focus move are the two things `renderToStaticMarkup` cannot reach.
 */
test("the strip counts a warning, opens on a click, and focuses the cell it names", async ({
  page
}) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();

  await page.getByTestId(`study-schedule-cell-${MAGE}-72`).click();
  await page.getByTestId("study-schedule-choice-FORC").click();
  await expect(page.getByTestId("study-schedule-popover")).toHaveCount(0);
  await expect(page.getByTestId(`study-schedule-cell-${MAGE}-72`)).toContainText("×½");

  const toggle = page.getByTestId("study-planner-warnings-toggle");
  await expect(toggle).toContainText("warning");
  await toggle.click();
  await expect(page.getByTestId("study-planner-warnings")).toBeVisible();
  await page.getByTestId("study-planner-warning-0").click();
  await expect(page.locator("[data-cell]:focus")).toHaveCount(1);
});
