import { test, expect } from "@playwright/test";

test("free demo prominently explains unavailable background features", async ({
  page,
}) => {
  await page.route("**/auth/status", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), demoMode: true },
    });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Free demo:" }),
  ).toContainText("delegated agent runs do not run");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Tasks/ })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Free demo:" }),
  ).toBeVisible();
});
