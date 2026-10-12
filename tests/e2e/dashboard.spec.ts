import { test, expect } from "@playwright/test";

test("owner can capture, correct, archive and delete through the real dashboard", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Alex." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  await page.getByLabel("IANA timezone").fill("Asia/Kolkata");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toContainText("Profile saved.");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Projects", exact: true })
    .click();
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page.getByLabel("Project name").fill("Personal website");
  await page
    .getByLabel("Description", { exact: true })
    .fill("A thoughtful home for ideas and selected work.");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Personal website" }),
  ).toBeVisible();
  for (const title of [
    "Outline the portfolio story",
    "Choose three featured projects",
    "Collect visual references",
  ]) {
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("Task title").fill(title);
    await page
      .getByRole("combobox", { name: "Project", exact: true })
      .selectOption({ label: "Personal website" });
    await page
      .getByRole("combobox", { name: "Priority", exact: true })
      .selectOption("high");
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Tasks" })
    .click();
  await page
    .getByRole("button", {
      name: "Complete Collect visual references",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Reopen Collect visual references",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Edit Outline the portfolio story",
      exact: true,
    })
    .click();
  await page.getByLabel("Task title").fill("Write the portfolio story");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome back, Alex." }),
  ).toBeVisible();
  await expect(
    page.getByText("Write the portfolio story", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Memory", exact: true })
    .click();
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await page
    .getByLabel("What would you like to remember?")
    .fill("Keep project summaries concise and include the next step.");
  await page.getByLabel("Privacy classification").selectOption("ordinary");
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByText(
      "Keep project summaries concise and include the next step.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await page
    .getByLabel("What would you like to remember?")
    .fill("Synthetic private memory to remove.");
  await page.getByLabel("Privacy classification").selectOption("sensitive");
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("I explicitly consent").check();
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByText("Synthetic private memory to remove.", { exact: true })
    .click();
  await page.getByLabel("Archive this memory").check();
  await page.getByLabel("I explicitly consent").check();
  await page.getByRole("button", { name: "Save memory", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByText("Synthetic private memory to remove.", { exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("Include archived").check();
  await page
    .getByText("Synthetic private memory to remove.", { exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Yes, delete memory", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByText("Synthetic private memory to remove.", { exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await expect(
    page.getByText("Write the portfolio story", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).not.toBeVisible({ timeout: 7000 });
  await page.screenshot({
    path: ".local/dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/dashboard-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Memory", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Memory", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await expect(
    page.getByLabel("What would you like to remember?"),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(errors).toEqual([]);
});
