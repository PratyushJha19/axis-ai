import { test, expect } from "@playwright/test";
test("notification settings persist with consent and mock mode never enables a live test", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Alerts & channels", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Notification channels" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Simulation mode — no Telegram messages or emails are sent.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send email test", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Enable email to owner@example.invalid").check();
  await page.getByLabel("Fallback delay (seconds)").fill("120");
  await expect(
    page.getByRole("button", { name: "Save notification preferences" }),
  ).toBeDisabled();
  await page.getByLabel("I authorize AXIS to send my reminders").check();
  await page
    .getByRole("button", { name: "Save notification preferences" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Notification preferences saved.",
  );
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Alerts & channels", exact: true })
    .click();
  await expect(page.getByLabel("Fallback delay (seconds)")).toHaveValue("120");
  await expect(
    page.getByLabel("Enable email to owner@example.invalid"),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Send email test", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/m3-notifications-mobile.png",
    fullPage: true,
  });
});
