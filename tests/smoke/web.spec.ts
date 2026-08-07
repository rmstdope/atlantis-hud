import { expect, test } from "@playwright/test";

test("web shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Atlantis HUD Web Shell" })).toBeVisible();
});
