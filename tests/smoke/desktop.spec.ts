import { expect, test } from "@playwright/test";

test("desktop shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Atlantis HUD Desktop Shell" })).toBeVisible();
});
