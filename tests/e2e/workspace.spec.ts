import { test, expect } from "@playwright/test";

test("projects open their tasks; deadline reminders and editable canvases persist", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Projects", exact: true })
    .click();
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page.getByLabel("Project name").fill("Workspace fixture");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Project settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByLabel("Task title").fill("Prepare launch");
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).not.toHaveValue("");
  await page.getByLabel("Due time").fill("2035-04-20T15:00");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Prepare launch/ }),
  ).toBeVisible();
  const reminders = await (
    await page.request.get("/api/v1/reminders?view=active&limit=100")
  ).json();
  expect(
    reminders.items.filter(
      (r: { title: string }) => r.title === "Prepare launch",
    ),
  ).toHaveLength(2);
  await page
    .getByRole("tablist", { name: "Project sections" })
    .getByRole("tab", { name: "Canvas", exact: true })
    .click();
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await page.getByLabel("Canvas name").fill("Launch map");
  await page.getByLabel("Node type").selectOption("Idea");
  await page.getByLabel("Title", { exact: true }).fill("Launch checklist");
  await expect(
    page.locator(".canvas-workspace").getByRole("status"),
  ).toHaveText("Saved");
  await page
    .getByRole("button", { name: "Duplicate node", exact: true })
    .click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page.route("**/api/v1/canvases/*", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: { message: "Synthetic offline save" },
          }),
        })
      : route.continue(),
  );
  await page.getByLabel("Title", { exact: true }).fill("Preserved draft");
  await expect(page.getByRole("alert")).toContainText("Synthetic offline save");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Preserved draft",
  );
  await page.unroute("**/api/v1/canvases/*");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByRole("alert")).not.toBeVisible();
  await expect(
    page.locator(".canvas-workspace").getByRole("status"),
  ).toHaveText("Saved");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Launch checklist",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page.getByText("Preserved draft", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Convert to task…", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Task title").fill("Canonical canvas task");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.locator(".canvas-surface")).toContainText(
    "Canonical canvas task",
  );
  await expect(
    page.locator(".canvas-workspace").getByRole("status"),
  ).toHaveText("Saved");
  await page.getByRole("button", { name: "← Canvases", exact: true }).click();
  await page.getByRole("button", { name: /Launch map Open canvas/ }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page.screenshot({
    path: ".local/workspace-canvas.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
