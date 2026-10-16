import { expect, test, type Page } from "@playwright/test";
import { loadReport, selectHex } from "./gameSetup";

/**
 * ah-mlls.5: the notes a player wrote - on a hex, or on a mage in the study planner - found by a
 * word in the command palette, and what choosing one shows.
 *
 * What the palette lists and how a row reads are pinned in `commandPalette.test.ts` and
 * `CommandPalette.test.tsx`; this walks what `packages/shared` cannot run (ah-nass): the scroll,
 * the outline's timer, and where the focus lands.
 */

/** Six of Seven, a mage of the player's faction (95) in the standard turn. */
const MAGE = "881";

async function writeHexNote(page: Page, text: string) {
  await page.getByTestId("region-note-add").click();
  await page.getByTestId("region-note-editor").locator("textarea").fill(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  // The editor closing is what proves the write landed (see workspace.spec.ts).
  await expect(page.getByTestId("region-note-editor")).toHaveCount(0);
}

async function search(page: Page, query: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill(query);
}

test("a hex note is found by a word on its second line, and choosing it outlines it on its hex", async ({
  page
}) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await writeHexNote(page, "Scouted the pass.\nA seam of quartzite under the ridge.");
  await writeHexNote(page, "Watch for patrols from the north.");

  // Away from the hex, so choosing the note is what brings the map back.
  await selectHex(page, "1:8,54");

  await search(page, "quartz");
  const row = page.getByTestId("palette-item").filter({ hasText: "hex note" });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("palette-note-line")).toHaveText("A seam of quartzite under the ridge.");
  await expect(row.locator("b")).toHaveText("quartz");
  await expect(row.getByTestId("palette-note-place")).toContainText("(7,53)");
  await expect(row.getByTestId("palette-note-place")).toContainText("· turn 72");

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "hex 1:7,53", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  const chosen = page.getByTestId("region-note").filter({ hasText: "quartzite" });
  await expect(chosen).toHaveAttribute("data-flash", "true");
  await expect(chosen).toBeInViewport();
  // Only the note chosen, and never opened for editing.
  await expect(page.locator('[data-testid="region-note"][data-flash]')).toHaveCount(1);
  await expect(page.getByTestId("region-note-editor")).toHaveCount(0);
  // Then back to normal, after about two seconds.
  await expect(chosen).not.toHaveAttribute("data-flash", /.*/, { timeout: 5000 });
});

test("notes are listed only once something is typed, and never for a typo", async ({ page }) => {
  await loadReport(page);
  await selectHex(page, "1:7,53");
  await writeHexNote(page, "A seam of quartzite under the ridge.");

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette-item").first()).toBeVisible();
  await expect(page.getByTestId("palette-item").filter({ hasText: "hex note" })).toHaveCount(0);

  await page.getByTestId("palette-input").fill("qartz");
  await expect(page.getByTestId("palette-item").filter({ hasText: "hex note" })).toHaveCount(0);

  await page.getByTestId("palette-input").fill("quartz");
  await expect(page.getByTestId("palette-item").filter({ hasText: "hex note" })).toHaveCount(1);
});

test("a mage note opens the planner on All mages with that mage picked and his note outlined", async ({
  page
}) => {
  await loadReport(page);

  await page.keyboard.press("F4");
  await page.getByTestId("study-planner-view-all").click();
  await page.getByTestId(`study-planner-mage-95/${MAGE}`).click();
  const note = page.getByTestId("study-planner-note").locator("textarea");
  await note.fill("Gate Lore before the siege, then quartzite wards.");
  // Closing flushes the note's autosave.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("study-planner-dialog")).toBeHidden();

  await search(page, "quartzite");
  const row = page.getByTestId("palette-item").filter({ hasText: "mage note" });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("palette-note-place")).toHaveText(
    `Six of Seven (${MAGE}) · study planner`
  );
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("study-planner-view-all")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId(`study-planner-mage-95/${MAGE}`)).toHaveAttribute(
    "aria-selected",
    "true"
  );
  // The keyboard is on the mage list, never in the note - which saves as it is typed.
  await expect(page.getByTestId("study-planner-list")).toBeFocused();
  await expect(note).toHaveAttribute("data-flash", "true");
  await expect(note).toHaveValue("Gate Lore before the siege, then quartzite wards.");
  await expect(note).not.toHaveAttribute("data-flash", /.*/, { timeout: 5000 });

  // Leaving All mages and coming back does not outline it again.
  await page.getByTestId("study-planner-view-schedule").click();
  await page.getByTestId("study-planner-view-all").click();
  await expect(note).not.toHaveAttribute("data-flash", /.*/);

  // A second mage note chosen with the planner still open lands on that mage.
  await page.getByTestId("study-planner-mage-95/12878").click();
  await note.fill("Two of Seven wants quartzite too.");
  await page.getByTestId(`study-planner-mage-95/${MAGE}`).click();
  await search(page, "wants quartzite");
  await page.getByTestId("palette-item").filter({ hasText: "mage note" }).click();
  await expect(page.getByTestId("study-planner-mage-95/12878")).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(note).toHaveAttribute("data-flash", "true");
  await expect(note).toHaveValue("Two of Seven wants quartzite too.");

  // Opening it the ordinary way afterwards still lands on the Planner.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("study-planner-dialog")).toBeHidden();
  await page.keyboard.press("F4");
  await expect(page.getByTestId("study-planner-view-schedule")).toHaveAttribute(
    "aria-selected",
    "true"
  );
});
