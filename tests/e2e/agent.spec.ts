import { test, expect } from "@playwright/test";
test("agent persists approval handoff and shows only recorded execution evidence", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "AI provider", exact: true }).click();
  await page.getByLabel("Provider API key").fill("synthetic-agent-browser-key");
  await page.getByLabel("AI model", { exact: true }).fill("test-model");
  await page.getByRole("button", { name: "Save AI settings" }).click();
  await expect(page.getByLabel("Provider API key")).toHaveValue("");
  await nav.getByRole("button", { name: "Ask AXIS", exact: true }).click();
  const panel = page.getByRole("region", { name: "Agent tasks" });
  await panel.getByLabel("Agent goal").fill("Agent create a task");
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Start agent task" }).click();
  await expect(panel.getByRole("status")).toContainText(
    "waiting for approval",
    { timeout: 15000 },
  );
  const before = await page.request.get("/api/v1/tasks");
  expect(
    (await before.json()).items.some(
      (r: { title: string }) => r.title === "Agent browser task",
    ),
  ).toBe(false);
  await panel
    .getByRole("link", { name: "Review exact action in Approvals" })
    .click();
  const proposal = page
    .getByRole("article")
    .filter({ hasText: "Agent browser task" });
  await proposal.getByRole("button", { name: "Approve exact action" }).click();
  await proposal
    .getByRole("button", { name: "Execute approved action" })
    .click();
  await expect(proposal).toContainText("Executed");
  await nav.getByRole("button", { name: "Ask AXIS", exact: true }).click();
  await panel
    .getByRole("combobox", { name: "Agent run", exact: true })
    .selectOption({ label: "Agent create a task · completed" });
  await expect(panel.getByRole("status")).toContainText("completed", {
    timeout: 15000,
  });
  await panel.getByText("View returned data", { exact: true }).click();
  await expect(panel).toContainText('"status": "executed"');
  const tasks = await page.request.get("/api/v1/tasks");
  expect(
    (await tasks.json()).items.filter(
      (r: { title: string }) => r.title === "Agent browser task",
    ),
  ).toHaveLength(1);
});
