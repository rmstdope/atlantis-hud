import { expect, test, type Page } from "@playwright/test";
import { readReport } from "@atlantis/fixtures";
import {
  clearGames,
  createGame,
  fillOrders,
  loadReport,
  ordersInput
} from "./gameSetup";

/**
 * Where the completion popup is allowed to be (ah-e4v).
 *
 * The orders editor is `overflow-hidden` - long order lines must scroll inside it, not escape -
 * so a popup rendered inside the editor's own element is cut off box and all wherever it is
 * wider than the pane, which is most of the ruleset's catalogue. These walks pin that the popup
 * escapes the editor instead, and that escaping does not let it leave the window.
 *
 * There is no unit test that can see this: `@atlantis/shared` runs vitest in Node, and the popup
 * needs a browser to have a bounding box at all.
 */

const REPORT = readReport("g7f95t71");

/** "Seven of Eight", the player's unit in Inholm at (7,53). */
const OWN_UNIT = "18642";

async function selectHex(page: Page, regionId: string) {
  const hex = page.getByRole("button", { name: `hex ${regionId}` });
  await hex.focus();
  await hex.press("Enter");
}

async function selectUnit(page: Page, unitId: string) {
  const box = page.getByLabel("Filter units");
  await box.fill(unitId);
  const row = page.getByTestId(`unit-row-${unitId}`);
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  // Named, not "the button in this row": a foreign unit's row also carries the faction name as a
  // control (ah-bu2c), so a bare role lookup is ambiguous there.
  await row.getByRole("button", { name: `unit ${unitId}` }).click();
  await box.clear();
}

/** A loaded game with OWN_UNIT selected and its orders on screen - where every walk here starts. */
async function openEditor(page: Page) {
  await loadReport(page, "Completion popup smoke");
  await selectHex(page, "1:7,53");
  await selectUnit(page, OWN_UNIT);
}

/**
 * Opens the skills list - the longest entries the popup ever shows, and the reason this defect
 * surfaced when the ruleset's own catalogue went behind completion (ah-bai.2).
 *
 * `CAST `, not `STUDY `: both list skills, but STUDY now narrows to the skills this unit can
 * actually study (ah-3ej, ah-6qp), and Seven of Eight is no mage - its list is short enough to fit
 * the pane, which would leave these walks passing with nothing to clip. CAST offers the whole
 * catalogue whoever is selected, which is what this file needs.
 */
async function openSkillCompletions(page: Page) {
  await expect(page.locator('[data-commands-ready="true"]')).toBeVisible();
  await fillOrders(page, "");
  await ordersInput(page).click();
  await page.keyboard.type("CAST ");
  await page.keyboard.press("Control+Space");

  const popup = page.locator(".cm-tooltip-autocomplete");
  await expect(popup).toBeVisible();
  return popup;
}

test("the completion popup is not clipped by the orders editor", async ({ page }) => {
  await openEditor(page);
  const popup = await openSkillCompletions(page);

  // The `overflow-hidden` container, not `ordersInput`'s inner `.cm-content`: the container is
  // what clips, and it is the wider of the two, so probing against the content box could land a
  // point that is past the text but still inside the clipping box.
  const editorBox = await page.getByTestId("orders-input").boundingBox();
  const popupBox = await popup.boundingBox();
  expect(editorBox).not.toBeNull();
  expect(popupBox).not.toBeNull();

  // The entries are at their full length rather than squeezed into the pane, and the popup
  // therefore reaches past the editor's right-hand edge. This much is true even while the defect
  // is present: an ancestor's `overflow-hidden` clips what is painted, not the element's own
  // bounding box, so these two say only that there is something to clip.
  expect(popupBox!.width).toBeGreaterThan(editorBox!.width);
  expect(popupBox!.x + popupBox!.width).toBeGreaterThan(editorBox!.x + editorBox!.width);

  // What the reader can actually see, which is the bead. Hit-testing a point inside the popup but
  // past the editor's right edge answers both ways the overhang can fail: clipped away by the
  // editor's `overflow-hidden` (nothing of the popup is there), or painted underneath the pane it
  // is meant to overhang (the pane answers instead). Either lands as "not the popup".
  const probeX = Math.min(popupBox!.x + popupBox!.width - 4, editorBox!.x + editorBox!.width + 8);
  expect(probeX).toBeGreaterThan(editorBox!.x + editorBox!.width);
  const probeY = popupBox!.y + popupBox!.height / 2;
  const hitsPopup = await page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x as number, y as number);
      return element !== null && element.closest(".cm-tooltip-autocomplete") !== null;
    },
    [probeX, probeY]
  );
  expect(hitsPopup).toBe(true);
});

test("the completion popup stays inside the window", async ({ page }) => {
  await openEditor(page);
  const popup = await openSkillCompletions(page);

  const popupBox = await popup.boundingBox();
  expect(popupBox).not.toBeNull();
  const viewportWidth = await page.evaluate(() => window.innerWidth);

  // Escaping the editor must not mean escaping the screen: near the right-hand edge CodeMirror
  // shifts the popup left rather than anchoring it to the caret and running off (the
  // navigator's R1).
  expect(popupBox!.x).toBeGreaterThanOrEqual(0);
  expect(popupBox!.x + popupBox!.width).toBeLessThanOrEqual(viewportWidth);
});
