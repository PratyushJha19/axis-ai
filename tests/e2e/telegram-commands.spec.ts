import { test, expect } from "@playwright/test";

test("safe change approval displays the target and executes through the existing inbox", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  const session = await (await page.request.get("/api/v1/me")).json();
  const headers = {
    Origin: new URL(page.url()).origin,
    "X-CSRF-Token": session.csrfToken,
  };
  const created = await page.request.post("/api/v1/tasks", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { title: "Telegram target" },
  });
  expect(created.status()).toBe(201);
  const task = await created.json();
  const proposed = await page.request.post("/api/v1/approvals", {
    headers,
    data: {
      idempotency_key: crypto.randomUUID(),
      action_type: "task.rename",
      payload: {
        kind: "task",
        title: "Reviewed rename",
        description: "",
        local_due: null,
        change: { id: task.id, version: task.version, operation: "rename" },
      },
    },
  });
  expect(proposed.status()).toBe(200);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Approvals", exact: true })
    .click();
  const card = page
    .getByRole("article")
    .filter({ hasText: "rename task: Reviewed rename" })
    .filter({ hasText: task.id });
  await expect(card).toContainText(task.id);
  await card.getByRole("button", { name: "Approve exact action" }).click();
  await card.getByRole("button", { name: "Execute approved action" }).click();
  await expect(card).toContainText("executed");
  const updated = await (
    await page.request.get(`/api/v1/tasks/${task.id}`)
  ).json();
  expect(updated.title).toBe("Reviewed rename");
});
