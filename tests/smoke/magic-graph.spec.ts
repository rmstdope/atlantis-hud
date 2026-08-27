import { expect, test } from "@playwright/test";
import { loadReport } from "./gameSetup";

/**
 * The whole magic prerequisite graph (ah-gjbs.2): the second view of the study tree, the toggle
 * that reaches it, and what a click in it does.
 *
 * Everything here is an effect, a listener or a measurement - the mount-time fit, the pan, the
 * keyboard, the remembered view choice - and `packages/shared` renders with no DOM by decision
 * (ah-nass), so this suite is the only place any of it can be seen at all.
 */

/** The worked example: create ring of invisibility, seven skills back to the foundations. */
const CRRI = "magic-graph-skill-CRRI";

test("the toggle opens the graph, and a click lights a skill's whole lineage", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F3");
  const dialog = page.getByTestId("magic-tree-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("magic-tree-branch-ARTI")).toBeVisible();
  const branchBox = await dialog.boundingBox();

  await page.getByTestId("magic-tree-view-graph").click();
  await expect(page.getByTestId("magic-graph")).toBeVisible();
  await expect(page.getByTestId("magic-tree-branch-ARTI")).toHaveCount(0);
  // The box grows for the graph, which cannot reflow - frame C, decided with the navigator knowing
  // that the resize is visible. Nothing else asserts it.
  const graphBox = await dialog.boundingBox();
  expect(graphBox!.width).toBeGreaterThan(branchBox!.width);

  await expect(page.getByTestId("magic-graph-tier-0")).toContainText("Foundations");
  await expect(page.getByTestId("magic-graph-tier-4")).toContainText("Four steps");
  await expect(page.getByTestId("magic-graph-skill-MANI")).toBeVisible();

  // A first click lights the skill and every path back to a root, and dims everything else.
  await page.getByTestId(CRRI).click();
  await expect(page.getByTestId("magic-tree-lit")).toContainText("create ring of invisibility");
  await expect(page.getByTestId("magic-tree-lit")).toContainText(
    "click again to open in the dictionary"
  );
  await expect(page.getByTestId("magic-graph-skill-ARTI")).toHaveCSS("opacity", "1");
  await expect(page.getByTestId("magic-graph-skill-FIRE")).toHaveCSS("opacity", "0.22");

  // A second click on the same skill is the door into the dictionary, and the tree gets out of the
  // way rather than the two stacking.
  await page.getByTestId(CRRI).click();
  await expect(page.getByTestId("game-data-dialog")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The view choice outlives the dialog; the light does not.
  await page.keyboard.press("F3");
  await expect(page.getByTestId("magic-graph")).toBeVisible();
  await expect(page.getByTestId("magic-tree-lit")).toHaveCount(0);

  // Show all puts the graph back, without closing anything.
  await page.getByTestId(CRRI).click();
  await expect(page.getByTestId("magic-graph-skill-FIRE")).toHaveCSS("opacity", "0.22");
  await page.getByTestId("magic-tree-show-all").click();
  await expect(page.getByTestId("magic-tree-lit")).toHaveCount(0);
  await expect(page.getByTestId("magic-graph-skill-FIRE")).toHaveCSS("opacity", "1");
});

test("the two views share one current skill", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F3");
  await page.getByTestId("magic-tree-view-graph").click();
  await page.getByTestId(CRRI).click();

  await page.getByTestId("magic-tree-view-branches").click();
  const row = page.getByTestId("magic-tree-skill-CRRI");
  await expect(row).toBeInViewport();
  await expect(row).toHaveClass(/bg-panel/);
});

test("the graph pans by keyboard and fits back", async ({ page }) => {
  await loadReport(page);

  await page.keyboard.press("F3");
  await page.getByTestId("magic-tree-view-graph").click();
  const world = page.getByTestId("magic-graph-world");
  await expect(world).toBeVisible();

  // It opened fitted rather than at 1:1 - the whole 1366-unit-wide drawing on screen at once, which
  // is what the mount-time measurement is for and the only assertion that covers it.
  const fitted = await world.getAttribute("transform");
  const scale = Number(/scale\(([0-9.]+)\)/u.exec(fitted ?? "")?.[1]);
  expect(scale).toBeGreaterThan(0);
  expect(scale).toBeLessThan(1);

  await page.getByTestId("magic-graph").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const panned = await world.getAttribute("transform");
  expect(panned).not.toBe(fitted);

  // Fitting comes back to a whole zoom step, so it is a view the reader can always return to.
  await page.keyboard.press("0");
  const refitted = await world.getAttribute("transform");
  expect(refitted).not.toBe(panned);
  await page.keyboard.press("0");
  expect(await world.getAttribute("transform")).toBe(refitted);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("magic-tree-dialog")).toHaveCount(0);
});
