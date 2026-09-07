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

test("All mages shows the points behind each level, three lists abreast", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  const detail = page.getByTestId("study-planner-detail");
  // A level alone hid the whole month a mage may be from the next one.
  await expect(page.getByTestId("study-planner-knows-FORC")).toContainText(/force 4 \(\d+\)/);

  // Side by side rather than stacked: the three answer one question between them, so `Can study
  // now` and `Held back` start no lower down the pane than `Knows` does.
  const knows = await detail.getByText("Knows", { exact: true }).boundingBox();
  const canStudy = await page.getByTestId("study-planner-can-study-heading").boundingBox();
  const heldBack = await detail.getByText("Held back", { exact: true }).boundingBox();
  expect(knows?.y).toBe(canStudy?.y);
  expect(knows?.y).toBe(heldBack?.y);
  expect(canStudy?.x ?? 0).toBeGreaterThan(knows?.x ?? 0);
  expect(heldBack?.x ?? 0).toBeGreaterThan(canStudy?.x ?? 0);
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

  // Every row says both ends of the month, level and points, so the choice is made against how far
  // he has actually got rather than against a level alone.
  await expect(page.getByTestId("study-schedule-choice-FORC")).toContainText(
    /\d \(\d+\) → \d \(\d+\)/
  );

  // One click is one choice: no Set, and nothing to its right moves.
  await page.getByTestId("study-schedule-choice-FORC").click();
  // Waits for the popover to close rather than for the cell's text: the row is written
  // optimistically, so its text can be the new one before the write has landed.
  await expect(popover).toHaveCount(0);
  // The report's own notation for a skill - `[FORC] 4 (355)` - so the cell carries the points too.
  await expect(cell).toContainText(/FORC \d \(\d+\)/);
  await expect(neighbour).toContainText("—");

  // Opening it again shows the choice that is stored, and `— nothing` empties that cell alone.
  await cell.click();
  const chosen = page.getByTestId("study-schedule-choice-FORC");
  await expect(chosen).toHaveAttribute("aria-pressed", "true");
  // Shown, not merely stated: the row carries a tick, and the list opens scrolled to it rather
  // than to its top - force is far enough down the magic tree to be off the end of it.
  await expect(chosen).toContainText("✓");
  await expect(chosen).toBeInViewport();
  await expect(chosen).toBeFocused();
  await page.getByTestId("study-schedule-choice-nothing").click();
  await expect(popover).toHaveCount(0);
  await expect(cell).toContainText("—");
  await expect(neighbour).toContainText("—");

  // The dropdown opens with a row focused, so the `↑↓ to move · ↵ to choose` its foot promises
  // works from the keyboard alone - which nothing in `packages/shared` can reach (ah-nass).
  await cell.click();
  // The cell is empty, so `— nothing` is the pressed row and focus starts there. Walked down to
  // a named skill rather than pressing Enter on whatever row 1 happens to be: `Teaches…` is
  // between them for a mage with somebody teachable, and a test that plans a skill only when the
  // fixture has nobody teachable is one that passes for a reason it does not state.
  await expect(page.locator("[data-row]:focus")).toHaveCount(1);
  const force = page.getByTestId("study-schedule-choice-FORC");
  const rows = await page.locator("[data-row]").count();
  for (let step = 0; step < rows; step += 1) {
    if (await force.evaluate((node) => node === document.activeElement)) {
      break;
    }
    await page.keyboard.press("ArrowDown");
  }
  await expect(force).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(popover).toHaveCount(0);
  await expect(cell).toContainText("FORC");

  await cell.click();
  await page.getByTestId("study-schedule-choice-nothing").click();
  await expect(popover).toHaveCount(0);

  // Two turns apart, and the gap between them stays empty. Deliberately without waiting for the
  // first write to land between the clicks: a plan is one row whose goals are written whole, so
  // this is the window in which a second choice built from a stale row would overwrite the first
  // (`studyPlansStore.save` applies each edit inside its queued write). The reload below is what
  // asserts both survived.
  await cell.click();
  await page.getByTestId("study-schedule-choice-FORC").click();
  await expect(popover).toHaveCount(0);
  await page.getByTestId(`study-schedule-cell-${MAGE}-74`).click();
  await page.getByTestId("study-schedule-choice-FORC").click();
  await expect(popover).toHaveCount(0);
  await expect(neighbour).toContainText("—");
  // Both cells before the reload, and this is a *durability* wait rather than a paint one: the
  // store writes first and updates the cache only when the write resolves, so a cell showing
  // `force` is a write that has landed. Reloading without it kills a transaction still in flight.
  // It does not hide the case above - the two clicks are still not gated on each other, which is
  // the window - and `studyPlansStore.test.ts` pins the payload rule directly.
  await expect(cell).toContainText("FORC");
  await expect(page.getByTestId(`study-schedule-cell-${MAGE}-74`)).toContainText("FORC");

  // The reload has to finish restoring the game before F4 means anything: the shortcut is
  // ignored while there is no report, exactly as `persistence.spec.ts` waits for this line.
  await page.reload();
  await expect(page.getByTestId("import-status")).toContainText("restored turn 71");
  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  await expect(page.getByTestId(`study-schedule-cell-${MAGE}-72`)).toContainText("FORC");
  await expect(page.getByTestId(`study-schedule-cell-${MAGE}-74`)).toContainText("FORC");
  await expect(page.getByTestId(`study-schedule-cell-${MAGE}-73`)).toContainText("—");
});

test("a dropdown moved to a second cell keeps focus inside itself", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();

  const popover = page.getByTestId("study-schedule-popover");
  await page.getByTestId(`study-schedule-cell-${MAGE}-72`).click();
  await expect(popover).toBeVisible();

  // Shift+Tab walks backwards through the dropdown's own rows before it leaves them, so it is
  // pressed until focus is on a grid cell rather than exactly once. There is no focus trap -
  // `dismissLayer.ts` handles Escape alone - which is what makes this route reachable at all.
  const focused = page.locator("[data-cell]:focus");
  const rows = await page.locator("[data-row]").count();
  for (let step = 0; step < rows + 2; step += 1) {
    if ((await focused.count()) === 1) {
      break;
    }
    await page.keyboard.press("Shift+Tab");
  }
  await expect(focused).toHaveCount(1);

  // Enter on a grid cell moves the open dropdown rather than remounting it, and focus goes with
  // it: the focus effect is keyed on the cell as well as the step for exactly this, or the
  // return-to-the-previous-cell cleanup would leave focus on the grid.
  await page.keyboard.press("Enter");
  await expect(focused).toHaveCount(0);
  await expect(
    page.locator('[data-testid="study-schedule-popover"] [data-row]:focus')
  ).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
});

/**
 * The row a choice would land on is filled, and one highlight follows both the arrows and the
 * pointer.
 *
 * Asserted on the computed background rather than on a class, because what failed here was
 * visible-to-a-person: the browser's focus ring is a hairline, and it is not drawn at all for the
 * script-moved focus this menu runs on, so the arrows appeared to do nothing.
 */
test("the dropdown fills the row the arrows and the pointer land on", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  await page.getByTestId(`study-schedule-cell-${MAGE}-72`).click();
  await expect(page.getByTestId("study-schedule-popover")).toBeVisible();

  const row = (at: number) => page.locator(`[data-testid="study-schedule-popover"] [data-row="${at}"]`);
  const fill = (at: number) =>
    row(at).evaluate((element) => getComputedStyle(element).backgroundColor);
  const CLEAR = "rgba(0, 0, 0, 0)";

  // The menu opens on a marked row, so there is never a moment where nothing is marked.
  expect(await fill(0)).not.toBe(CLEAR);

  await page.keyboard.press("ArrowDown");
  expect(await fill(0)).toBe(CLEAR);
  expect(await fill(1)).not.toBe(CLEAR);

  // And the pointer moves that same mark rather than lighting a second one.
  await row(3).hover();
  await expect(row(3)).toBeFocused();
  expect(await fill(1)).toBe(CLEAR);
  expect(await fill(3)).not.toBe(CLEAR);
});

test("no row of the dropdown wraps onto a second line", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  await page.getByTestId(`study-schedule-cell-${MAGE}-72`).click();
  await expect(page.getByTestId("study-schedule-popover")).toBeVisible();

  // Measured rather than pinned to a width: a wrapped row is two lines tall, whatever the font,
  // the cap and the longest skill in the ruleset happen to be. `create phantasmal beasts 0 → 1
  // (30 of 30)` is the row this used to break on.
  const heights = await page
    .locator('[data-testid="study-schedule-popover"] [data-row]')
    .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));

  expect(heights.length).toBeGreaterThan(10);
  expect(Math.max(...heights)).toBeLessThan(Math.min(...heights) * 1.5);
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

test("the mage pane follows the pointer and the focus, and keeps what it last showed", async ({
  page
}) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  const pane = page.getByTestId("study-schedule-mage-pane");
  // It is a pane rather than a card: it stands there from the start, saying what it is for.
  await expect(pane).toBeVisible();
  await expect(pane).toContainText("Point at a mage");

  await page.getByTestId(`study-schedule-cell-${MAGE}-72`).hover();
  await expect(pane).toContainText("Six of Seven (881) — turn 72");
  await expect(pane).toContainText("Knows");
  await expect(pane).toContainText("Can study on turn 72 —");

  // The name reads him as he stands now, which no column can show: every column is a month that
  // has already happened.
  await page.getByTestId(`study-schedule-name-${MAGE}`).hover();
  await expect(pane).toContainText("Six of Seven (881) — now");
  await expect(pane).toContainText("Can study now —");

  // Reachable without a mouse: the arrow keys walk the grid and the pane follows the focus.
  await page.getByTestId(`study-schedule-cell-${MAGE}-72`).focus();
  await page.keyboard.press("ArrowRight");
  await expect(pane).toContainText("turn 73");

  // And it keeps its mage when the pointer leaves the table, so the pane can be read without
  // holding the mouse still on a row.
  await page.getByTestId("study-planner-view-schedule").hover();
  await expect(pane).toContainText("Six of Seven (881) — turn 73");
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
  await expect(studentCell).toContainText("GATE");

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
