import { test, expect } from "@playwright/test";
test("Calendar consent, refresh, real commitment display and disconnect use the authenticated UI", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  const session = await (await page.request.get("/api/v1/me")).json();
  await page.request.patch("/api/v1/me", {
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": session.csrfToken,
    },
    data: { display_name: "Alex", timezone: "UTC" },
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Planning", exact: true })
    .click();
  const calendar = page.getByRole("region", { name: "Google Calendar" });
  await expect(
    calendar.getByRole("button", {
      name: "Connect Google Calendar",
      exact: true,
    }),
  ).toBeDisabled();
  await calendar.getByRole("checkbox").check();
  await calendar
    .getByRole("button", { name: "Connect Google Calendar", exact: true })
    .click();
  await expect(page).toHaveURL(/calendar=connected/);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Planning", exact: true })
    .click();
  await calendar.getByRole("button", { name: /Refresh 14 days/ }).click();
  await expect(
    calendar.getByText("Synthetic Google commitment", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await calendar
    .getByRole("button", { name: "Disconnect Calendar", exact: true })
    .click();
  await expect(calendar.getByText(/Disconnected locally/)).toBeVisible();
  await expect(
    calendar.getByText("Synthetic Google commitment", { exact: true }),
  ).toHaveCount(0);
  const denied = await page.request.post("/api/v1/calendar/connect", {
    data: { consent: true },
  });
  expect(denied.status()).toBe(403);
  const status = await (
    await page.request.get("/api/v1/calendar/status")
  ).text();
  expect(status).not.toContain("synthetic-calendar-token");
});
