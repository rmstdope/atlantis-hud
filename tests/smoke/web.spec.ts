import { expect, test } from "@playwright/test";

test("web shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Atlantis HUD Web Shell" })).toBeVisible();
});

test("web order editor validates, autosaves, and restores drafts", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Order editor" })).toBeVisible();
  const panel = page.getByTestId("order-editor-panel");
  await panel.getByLabel("Database path").fill("/tmp/web-orders.sqlite");
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
  await reloadedPanel.getByLabel("Database path").fill("/tmp/web-orders.sqlite");
  await reloadedPanel.getByLabel("Project id").fill("faction-12");
  await reloadedPanel.getByLabel("Faction id").fill("17");
  await reloadedPanel.getByLabel("Turn number").fill("12");
  await expect(reloadedPanel.getByTestId("order-editor-input")).toHaveValue("MOVE U100 R2");
});
