import { expect, test } from "@playwright/test";
import { expectOrders, expectOrdersNot, fillOrders, loadReport, selectHex, selectUnit, STANDARD_TURN } from "./gameSetup";

/**
 * "Put into my orders" (`ah-lyg6.4.2`): the study planner's own-faction orders written into the
 * document the player has been editing by hand.
 *
 * Every string and every splice is pinned in `studyOrdersWrite.test.ts`. What is here is what a
 * `renderToStaticMarkup` test in `packages/shared` cannot reach - that package has no jsdom by
 * decision (ah-nass): the click, the Escape layer over the planner, and the Undo.
 *
 * Asserted on the orders editor's own text rather than on the tab's `<pre>`: that block scrolls
 * sideways and WebKit's driver answers `""` for text it considers clipped.
 */

/** "Six of Seven", a mage of the player's faction, in ocean (26,52) aboard a ship. */
const MAGE = "881";
const MAGE_HEX = "1:26,52";

/** Opens the planner on a mage whose block already carries hand-written orders and a BUILD. */
async function openPlannerWithHandWrittenOrders(page: import("@playwright/test").Page) {
  await loadReport(page);
  await selectHex(page, MAGE_HEX);
  await selectUnit(page, MAGE);
  await fillOrders(page, "  claim 200\nbuild Tower\n  give 1250 20 silv");
  await expectOrders(page, /build Tower/u);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-schedule").click();
  const cell = page.getByTestId(`study-schedule-cell-${MAGE}-${STANDARD_TURN + 1}`);
  await cell.click();
  await expect(page.getByTestId("study-schedule-popover")).toBeVisible();
  await page.getByTestId("study-schedule-choice-FORC").click();
  await expect(page.getByTestId("study-schedule-popover")).toHaveCount(0);
  await page.getByTestId("study-planner-view-orders").click();
  await expect(page.getByTestId("study-planner-orders-95")).toBeVisible();
}

test("the Orders tab writes the plan into the document, and the write can be undone", async ({
  page
}) => {
  await openPlannerWithHandWrittenOrders(page);

  await page.getByTestId("study-planner-write").click();
  const prompt = page.getByTestId("study-orders-write-prompt");
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText(`Six of Seven (${MAGE})`);
  await expect(prompt).toContainText("STUDY FORC replaces build Tower");

  await page.getByTestId("study-orders-write-confirm").click();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByTestId("study-planner-write-notice")).toContainText(
    "Wrote study orders for 1 mage; 1 other order replaced."
  );

  // The planner stays open after a write; the editor behind it is what the write is judged on.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("study-planner-dialog")).toHaveCount(0);
  await expectOrders(page, /STUDY FORC/u);
  await expectOrders(page, /claim 200/u);
  await expectOrders(page, /give 1250 20 silv/u);
  await expectOrdersNot(page, /build Tower/u);

  // The undo dies with the dialog, so it is taken on the visit that made the write.
  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-orders").click();
  await page.getByTestId("study-planner-write").click();
  await page.getByTestId("study-orders-write-confirm").click();
  await expect(page.getByTestId("study-planner-write-undo")).toBeVisible();
  await page.getByTestId("study-planner-write-undo").click();
  await expect(page.getByTestId("study-planner-write-notice")).toContainText(
    "Put your orders back as they were."
  );

  await page.keyboard.press("Escape");
  await expectOrders(page, /STUDY FORC/u);
  await expectOrders(page, /claim 200/u);
});

test("Escape closes the write prompt and leaves the planner open", async ({ page }) => {
  await openPlannerWithHandWrittenOrders(page);

  await page.getByTestId("study-planner-write").click();
  await expect(page.getByTestId("study-orders-write-prompt")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("study-orders-write-prompt")).toHaveCount(0);
  await expect(page.getByTestId("study-planner-dialog")).toBeVisible();
});

// ah-9qdz.4: a planned cast reaches the orders behind "Also write the casts", ticked as it opens.
// Six of Seven knows fire (`data/FIRE`: combat), so his line is `COMBAT FIRE` (`rules/combat`).
// The tick, the click and the write into the editor are what `packages/shared` cannot reach.
test("a planned cast is written beside the study, and unticking the box leaves it out", async ({
  page
}) => {
  await openPlannerWithHandWrittenOrders(page);
  await page.getByTestId("study-planner-view-schedule").click();
  await page.getByTestId(`study-schedule-cast-${MAGE}-${STANDARD_TURN + 1}`).click();
  await page.getByTestId("study-schedule-cast-choice-FIRE").click();
  await expect(page.getByTestId("study-schedule-cast-popover")).toHaveCount(0);
  await page.getByTestId("study-planner-view-orders").click();

  const box = page.getByTestId("study-planner-write-casts-95");
  const summary = page.getByTestId("study-planner-summary");
  await expect(box).toBeChecked();
  await expect(summary).toContainText(", 1 casting");

  // The section's text is exactly what Copy and Save… carry. Only its absence is asserted there:
  // WebKit's driver answers "" for text it considers clipped (see the file note), so a presence
  // check on the scrolling `<pre>` would not hold in every browser; the summary stands in for it.
  const section = page.getByTestId("study-planner-orders-95");
  await box.uncheck();
  await expect(summary).not.toContainText("casting");
  await expect(section).not.toContainText("COMBAT FIRE");
  await box.check();
  await expect(summary).toContainText(", 1 casting");

  await page.getByTestId("study-planner-write").click();
  const prompt = page.getByTestId("study-orders-write-prompt");
  await expect(page.getByTestId(`study-orders-write-cast-${MAGE}`)).toContainText("COMBAT FIRE");
  await expect(prompt).toContainText(
    "Casts are written without a target. Add one by hand where the spell needs it."
  );
  await expect(box).toBeDisabled();

  await page.getByTestId("study-orders-write-confirm").click();
  await expect(page.getByTestId("study-planner-write-notice")).toContainText(
    "Wrote study orders and 1 cast for 1 mage; 1 other order replaced."
  );
  await page.keyboard.press("Escape");
  await expectOrders(page, /STUDY FORC/u);
  await expectOrders(page, /COMBAT FIRE/u);
  await expectOrders(page, /claim 200/u);
});

// ah-n3j1q: Undo answers for the mages it wrote. The planner stays over the editor, and the editor's
// own text is changed underneath it - by `fill` when focus does not matter, and by changing a line in
// place when Undo must keep the focus, which is what a write arriving unattended looks like.

/** One of the player's units, away from the mage, that the study write does not touch. */
const BYSTANDER = { hex: "1:7,53", unit: "18642" };
const MAGE_AT = { hex: MAGE_HEX, unit: MAGE };

/** The player has a mage planned, and the editor open on `unitId`, when the planner writes. */
async function writePlanWithEditorOn(
  page: import("@playwright/test").Page,
  at: { hex: string; unit: string }
) {
  await openPlannerWithHandWrittenOrders(page);
  await page.keyboard.press("Escape");
  await selectHex(page, at.hex);
  await selectUnit(page, at.unit);
  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-orders").click();
  await page.getByTestId("study-planner-write").click();
  await page.getByTestId("study-orders-write-confirm").click();
  await expect(page.getByTestId("study-planner-write-notice")).toContainText("Wrote study orders");
}

/** Types into the editor's first line without moving focus, as an assistant's write does. */
async function changeEditorInPlace(page: import("@playwright/test").Page) {
  await page.getByTestId("orders-input").evaluate((root) => {
    const line = root.querySelector(".cm-line");
    if (line === null) {
      throw new Error("the orders editor has no line");
    }
    line.textContent = `${line.textContent ?? ""} ; later`;
  });
}

test("a later change to another unit survives Undo, and the line says so", async ({ page }) => {
  await writePlanWithEditorOn(page, BYSTANDER);

  await fillOrders(page, "tax");
  const detail = page.getByTestId("study-planner-write-notice-detail");
  await expect(detail).toHaveText("Your orders have changed since. Undo takes back only these mages.");

  await page.getByTestId("study-planner-write-undo").click();
  await expect(page.getByTestId("study-planner-write-notice")).toHaveText(
    "Took back the study orders for 1 mage. Your later changes are still there."
  );

  await page.keyboard.press("Escape");
  await expectOrders(page, /tax/u);
  await selectHex(page, MAGE_HEX);
  await selectUnit(page, MAGE);
  await expectOrders(page, /build Tower/u);
  await expectOrdersNot(page, /STUDY FORC/u);
});

test("a change to the written mage withdraws Undo and says why", async ({ page }) => {
  await writePlanWithEditorOn(page, MAGE_AT);

  await fillOrders(page, "STUDY PATT");
  await expect(page.getByTestId("study-planner-write-notice-detail")).toHaveText(
    "1 mage has changed since, so there is nothing left to undo."
  );
  await expect(page.getByTestId("study-planner-write-undo")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expectOrders(page, /STUDY PATT/u);
});

test("pressing Undo from the keyboard leaves focus on the line", async ({ page }) => {
  await writePlanWithEditorOn(page, BYSTANDER);

  await page.getByTestId("study-planner-write-undo").focus();
  await page.keyboard.press("Enter");
  const notice = page.getByTestId("study-planner-write-notice");
  await expect(notice).toHaveText("Put your orders back as they were.");
  await expect(notice).toBeFocused();
});

test("focus moves to the line when the last mage changes while Undo holds it", async ({ page }) => {
  await writePlanWithEditorOn(page, MAGE_AT);

  await page.getByTestId("study-planner-write-undo").focus();
  await changeEditorInPlace(page);

  const notice = page.getByTestId("study-planner-write-notice");
  await expect(page.getByTestId("study-planner-write-undo")).toHaveCount(0);
  await expect(notice).toBeFocused();
});
