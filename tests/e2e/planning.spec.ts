import { test, expect } from "@playwright/test";
test("planning uses real records, persists reviewed plans and previews reminder-aware recovery", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  const session = await (await page.request.get("/api/v1/me")).json();
  const headers = {
    Origin: "http://localhost:3100",
    "X-CSRF-Token": session.csrfToken,
  };
  // Browser test server uses the same origin policy as this page.
  headers.Origin = new URL(page.url()).origin;
  await page.request.patch("/api/v1/me", {
    headers,
    data: { display_name: "Alex", timezone: "UTC" },
  });
  const taskResponse = await page.request.post("/api/v1/tasks", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      title: "Planning browser fixture",
      priority: "high",
      estimated_minutes: 30,
      due_at: "2099-10-20T18:00:00Z",
      due_timezone: "UTC",
    },
  });
  expect(taskResponse.status()).toBe(201);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Planning", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Prioritised inbox" }),
  ).toBeVisible();
  await page
    .getByLabel("Select Planning browser fixture", { exact: true })
    .check();
  await page.getByLabel("Plan date", { exact: true }).fill("2099-10-19");
  await page.getByRole("button", { name: "Generate draft plan" }).click();
  const editor = page.getByRole("region", { name: "Plan editor" });
  await expect(editor).toContainText("Planning browser fixture");
  await expect(editor).toContainText("no time reserved");
  await editor.getByRole("button", { name: "Accept reviewed plan" }).click();
  await expect(editor).toContainText("accepted");
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Planning", exact: true })
    .click();
  await page
    .getByRole("button", { name: "daily · 2099-10-19 · accepted", exact: true })
    .click();
  await expect(editor).toContainText("accepted");
  const before = await (await page.request.get("/api/v1/tasks")).json();
  expect(
    before.items.find(
      (t: { title: string }) => t.title === "Planning browser fixture",
    ).status,
  ).toBe("inbox");
  await editor.getByRole("button", { name: "Discard plan" }).click();
  await expect(editor).toContainText("discarded");
  const recoveryTask = await (
    await page.request.post("/api/v1/tasks", {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {
        title: "Browser missed task",
        due_at: "2001-01-01T12:00:00Z",
        due_timezone: "UTC",
      },
    })
  ).json();
  const linked = await page.request.post("/api/v1/reminders", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      title: "Browser linked reminder",
      task_id: recoveryTask.id,
      local_due: "2099-10-19T10:00",
      timezone: "UTC",
      confirmed: true,
    },
  });
  expect(linked.status()).toBe(201);
  await page
    .getByRole("button", { name: "Refresh facts", exact: true })
    .click();
  await page
    .getByRole("article")
    .filter({ hasText: "Select Browser missed task" })
    .getByRole("button", { name: "Review rescheduling" })
    .click();
  const recovery = page.getByRole("region", { name: "Rescheduling review" });
  await expect(recovery).toContainText("Browser linked reminder");
  await recovery
    .getByLabel("New due time (UTC)", { exact: true })
    .fill("2099-10-20T12:00");
  await recovery.getByRole("checkbox").check();
  await recovery.getByRole("button", { name: "Confirm rescheduling" }).click();
  await expect(recovery).not.toBeVisible();
  const changed = await (
    await page.request.get(`/api/v1/tasks/${recoveryTask.id}`)
  ).json();
  expect(changed.due_at).toBe("2099-10-20T12:00:00.000Z");
  const reminder = await linked.json();
  expect(
    (await (await page.request.get(`/api/v1/reminders/${reminder.id}`)).json())
      .status,
  ).toBe("cancelled");
});
