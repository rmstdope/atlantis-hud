import { expect, test } from "@playwright/test";

test("desktop shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Atlantis HUD Desktop Shell" })).toBeVisible();
});

test("desktop order editor validates, autosaves, and restores drafts", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Order editor" })).toBeVisible();
  const panel = page.getByTestId("order-editor-panel");
  await panel.getByLabel("Database path").fill("/tmp/desktop-orders.sqlite");
  await panel.getByLabel("Project id").fill("faction-12");
  await panel.getByLabel("Faction id").fill("17");
  await panel.getByLabel("Turn number").fill("12");

  const editor = panel.getByTestId("order-editor-input");
  await panel.getByRole("button", { name: "Load invalid sample" }).click();
  await expect(panel.getByTestId("order-validation-summary")).toContainText("1 error(s)");
  await expect(panel.getByRole("button", { name: "Export orders" })).toBeDisabled();

  await panel.getByRole("button", { name: "Validate orders" }).click();
  await expect(panel.getByTestId("order-editor-status")).toContainText("manual validation");

  await panel.getByRole("button", { name: "Load valid sample" }).click();
  await expect(panel.getByTestId("order-validation-summary")).toContainText("0 error(s)");
  await expect(panel.getByRole("button", { name: "Export orders" })).toBeEnabled();

  await expect(panel.getByTestId("order-editor-status")).toContainText("sample saved");

  await page.reload();
  const reloadedPanel = page.getByTestId("order-editor-panel");
  await reloadedPanel.getByLabel("Database path").fill("/tmp/desktop-orders.sqlite");
  await reloadedPanel.getByLabel("Project id").fill("faction-12");
  await reloadedPanel.getByLabel("Faction id").fill("17");
  await reloadedPanel.getByLabel("Turn number").fill("12");
  await expect(reloadedPanel.getByTestId("order-editor-input")).toHaveValue("MOVE U100 R2");
});

test("desktop map workspace supports desktop and handheld region selection", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Map workspace" })).toBeVisible();
  await page.getByLabel("Map database path").fill("/tmp/desktop-map.sqlite");
  await page.getByLabel("Map project id").fill("faction-12");
  await page.getByLabel("Map faction id").fill("17");
  await page.getByLabel("Map turn number").fill("12");
  await page.getByRole("button", { name: "Seed sample map import" }).click();
  // The seed writes asynchronously, so loading before it commits would race.
  await expect(
    page.getByTestId("map-workspace-panel").getByRole("status")
  ).toContainText("seeded sample map import");
  await page.getByRole("button", { name: "Load map turn" }).click();

  await page.getByRole("button", { name: "hex A1" }).click();
  await expect(page.getByTestId("map-selected-region-id")).toContainText("A1");
  await expect(page.getByTestId("map-right-inspector")).toContainText("Coast of Dawn");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "hex B2" }).click();
  await expect(page.getByTestId("map-selected-region-id")).toContainText("B2");
  await expect(page.getByTestId("map-bottom-sheet")).toContainText("Forest of Whispers");
});
