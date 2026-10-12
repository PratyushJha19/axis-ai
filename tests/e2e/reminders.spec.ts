import { test, expect } from "@playwright/test";

test("owner previews, saves, edits, snoozes and cancels a persisted reminder", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("IANA timezone").fill("Asia/Kolkata");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toContainText("Profile saved.");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Reminders", exact: true })
    .click();
  await page.getByRole("button", { name: "Add reminder", exact: true }).click();
  await page.getByLabel("Reminder title").fill("Synthetic future reminder");
  await page.getByLabel("Notification body").fill("Review the draft.");
  await page
    .getByLabel("Reminder time (Asia/Kolkata)")
    .fill("2099-10-11T09:00");
  await page
    .getByRole("combobox", { name: "Repeat", exact: true })
    .selectOption("weekly");
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await expect(page.getByText("UTC: 2099-10-11T03:30:00.000Z")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm reminder", exact: true })
    .click();
  const reminder = page.getByRole("region", {
    name: "Reminder Synthetic future reminder",
    exact: true,
  });
  await expect(reminder).toContainText("scheduled");
  await reminder.getByRole("button", { name: "Edit / reschedule" }).click();
  await page.getByLabel("Notification body").fill("");
  await page
    .getByLabel("Reminder time (Asia/Kolkata)")
    .fill("2099-10-12T09:00");
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await page
    .getByRole("button", { name: "Confirm reminder", exact: true })
    .click();
  await expect(reminder).not.toContainText("Review the draft.");
  await reminder.getByRole("button", { name: "Snooze", exact: true }).click();
  await page.getByLabel("Snooze until (Asia/Kolkata)").fill("2099-10-13T10:00");
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await page.getByRole("button", { name: "Confirm snooze" }).click();
  await expect(reminder).toContainText("snoozed");
  await reminder
    .getByRole("button", { name: "View / refresh delivery attempts" })
    .click();
  await expect(reminder).toContainText("No delivery attempts yet.");
  await page.getByLabel("Quiet hours start").fill("22:00");
  await page.getByLabel("Quiet hours end").fill("07:00");
  await page.getByLabel("New focus start").fill("2099-10-14T09:00");
  await page.getByLabel("New focus end").fill("2099-10-14T10:00");
  await page.getByRole("button", { name: "Save reminder preferences" }).click();
  await expect(
    page.getByText("Reminder preferences saved.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove focus block" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Reminders", exact: true })
    .click();
  await expect(reminder).toContainText("snoozed");
  page.once("dialog", (dialog) => dialog.accept());
  await reminder
    .getByRole("button", { name: "Cancel reminder", exact: true })
    .click();
  await expect(reminder).toContainText("cancelled");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(reminder).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/m2-reminders-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: ".local/m2-reminders-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("dashboard displays persisted mock delivery and attempt receipt from independent worker", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Reminders", exact: true })
    .click();
  await page.getByLabel("Quiet hours start").fill("");
  await page.getByLabel("Quiet hours end").fill("");
  await page.getByRole("button", { name: "Save reminder preferences" }).click();
  await expect(
    page.getByText("Reminder preferences saved.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add reminder", exact: true }).click();
  await page.getByLabel("Reminder title").fill("Synthetic worker delivery");
  await page
    .getByLabel("Reminder time (Asia/Kolkata)")
    .fill("2026-01-01T09:00");
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await page
    .getByRole("button", { name: "Confirm reminder", exact: true })
    .click();
  const reminder = page.getByRole("region", {
    name: "Reminder Synthetic worker delivery",
    exact: true,
  });
  await expect
    .poll(async () => {
      await page.getByRole("button", { name: "Refresh reminders" }).click();
      return reminder.textContent();
    })
    .toContain("delivered (simulated)");
  await reminder
    .getByRole("button", { name: "View / refresh delivery attempts" })
    .click();
  await expect(reminder).toContainText("Mock receipt");
  await expect(reminder).toContainText("delivered (mock)");
});
