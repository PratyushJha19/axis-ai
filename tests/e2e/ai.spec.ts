import { test, expect } from "@playwright/test";
test("AI settings, safe key lifecycle, persisted chat and escaped output through dashboard", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("IANA timezone").fill("Asia/Kolkata");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toContainText("Profile saved.");
  await page.reload();
  const nav = page.getByRole("navigation");
  await nav.getByRole("button", { name: "AI provider", exact: true }).click();
  await page.getByLabel("Provider API key").fill("synthetic-browser-key");
  await page.getByRole("button", { name: "Load Groq models" }).click();
  await expect(page.getByRole("status")).toContainText("Model list loaded");
  await expect(page.locator("#groq-models option")).toHaveAttribute(
    "value",
    "openai/gpt-oss-20b",
  );
  await page.getByLabel("AI model", { exact: true }).fill("openai/gpt-oss-20b");
  await page.getByLabel("Allow a small test request").check();
  await page.getByRole("button", { name: "Test entered key" }).click();
  await expect(page.getByRole("status")).toContainText("Connection verified.");
  await page.getByRole("button", { name: "Save AI settings" }).click();
  await expect(page.getByLabel("Provider API key")).toHaveValue("");
  await page.getByRole("button", { name: "Test saved connection" }).click();
  await expect(page.getByRole("status")).toContainText("Connection verified.");
  const metadata = await page.request.get("/api/v1/ai/config");
  expect(await metadata.text()).not.toContain("synthetic-browser-key");
  await page.reload();
  await nav.getByRole("button", { name: "AI provider", exact: true }).click();
  await expect(page.getByText(/API key configured · groq/)).toBeVisible();
  await expect(page.getByLabel("Provider API key")).toHaveValue("");
  await nav.getByRole("button", { name: "Ask AXIS", exact: true }).click();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Create a task to read the report");
  await page.getByRole("button", { name: "Send to provider" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm create task" }),
  ).toBeVisible();
  await page.reload();
  await nav.getByRole("button", { name: "Ask AXIS", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Conversation", exact: true })
    .selectOption({ label: "Create a task to read the report" });
  await page.getByRole("button", { name: "Confirm create task" }).click();
  await expect(page.getByText(/Created · record/)).toBeVisible();
  const tasks = await page.request.get("/api/v1/tasks");
  expect(
    (await tasks.json()).items.some(
      (t: { title: string }) => t.title === "Read the report",
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Remind me on October 16 2099 at 9 am");
  await page.getByRole("button", { name: "Send to provider" }).click();
  await expect(
    page.getByRole("region", { name: "reminder proposal" }),
  ).toContainText("2099-10-16 09:00 · Asia/Kolkata");
  await nav.getByRole("button", { name: "Approvals", exact: true }).click();
  const approval = page
    .getByRole("article")
    .filter({ hasText: "Create reminder: Review report" });
  await expect(approval).toContainText("2099-10-16T09:00");
  await approval.getByRole("button", { name: "Approve exact action" }).click();
  await expect(approval).toContainText("approved");
  await page.reload();
  await nav.getByRole("button", { name: "Approvals", exact: true }).click();
  await approval
    .getByRole("button", { name: "Execute approved action" })
    .click();
  await expect(approval).toContainText("executed");
  await approval.getByRole("button", { name: "View audit history" }).click();
  await expect(approval).toContainText("action_executed");
  await nav.getByRole("button", { name: "Ask AXIS", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Conversation", exact: true })
    .selectOption({ label: "Remind me on October 16 2099 at 9 am" });
  await expect(page.getByText(/Created · record/)).toBeVisible();
  const reminders = await page.request.get("/api/v1/reminders");
  expect(
    (await reminders.json()).items.some(
      (r: { title: string }) => r.title === "Review report",
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Explain a focused morning");
  await page.getByRole("button", { name: "Send to provider" }).click();
  await expect(
    page.getByText(
      "Synthetic browser response. No real provider was contacted.",
    ),
  ).toBeVisible();
  await page.reload();
  await nav.getByRole("button", { name: "Ask AXIS", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Conversation", exact: true })
    .selectOption({ label: "Explain a focused morning" });
  await expect(
    page.getByText(
      "Synthetic browser response. No real provider was contacted.",
    ),
  ).toBeVisible();
  await page.screenshot({ path: ".local/m1-5-chat.png", fullPage: true });
  await expect(page.locator(".ai-message img")).toHaveCount(0);
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page.getByLabel("Message", { exact: true }).fill("fixture rate limit");
  await page.getByRole("button", { name: "Send to provider" }).click();
  await page
    .getByRole("button", {
      name: "Retry failed request (uses quota)",
      exact: true,
    })
    .click();
  await expect(page.locator(".ai-message.user")).toHaveCount(1);
  await expect(page.locator(".ai-message.assistant")).toHaveCount(1);
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page.getByLabel("Message", { exact: true }).fill("fixture unknown");
  await page.getByRole("button", { name: "Send to provider" }).click();
  await expect(
    page.getByRole("button", { name: "Check request status" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Refresh history" }).click();
  await expect(page.getByLabel("Message", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Dismiss request" }).click();
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await nav.getByRole("button", { name: "AI provider", exact: true }).click();
  await page.getByLabel("Provider API key").fill("synthetic-invalid-key");
  await page.getByRole("button", { name: "Save AI settings" }).click();
  await expect(page.getByLabel("Provider API key")).toHaveValue("");
  await page.getByLabel("Allow a small test request").check();
  await page.getByRole("button", { name: "Test saved connection" }).click();
  await expect(page.getByRole("status")).toContainText(
    "provider rejected this key",
  );
  await page.getByRole("button", { name: "Delete stored key" }).click();
  await expect(
    page.getByText("No API key configured", { exact: true }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Ask AXIS", exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("No credentials");
  await page.getByRole("button", { name: "Send to provider" }).click();
  await expect(page.getByRole("alert")).toContainText("Configure a provider");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  expect(failures).toEqual([]);
});
