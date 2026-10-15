import { test, expect } from "@playwright/test";
test("two Google sessions have separate private workspaces and independent logout", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  const me = await (await page.request.get("/api/v1/me")).json();
  const result = await page.request.post("/api/v1/tasks", {
    headers: {
      Origin: "http://localhost:33018",
      "X-CSRF-Token": me.csrfToken,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: { title: "Only Alex owns this task" },
  });
  expect(result.status()).toBe(201);
  const ownTask = await result.json();
  const context = await browser.newContext({
    baseURL: "http://localhost:33018",
  });
  try {
    const other = await context.newPage();
    await other.goto("/");
    // Emulate selecting the second identity at the synthetic provider. Start
    // through the real auth endpoint to obtain a session-bound OAuth challenge.
    const started = await other.request.get("/auth/google", {
      maxRedirects: 0,
    });
    expect(started.status()).toBe(302);
    const callback = new URL(started.headers().location!);
    callback.searchParams.set("code", "synthetic-b");
    await other.goto(callback.href);
    await expect(
      other.getByRole("heading", { name: "Welcome back, Blair." }),
    ).toBeVisible();
    const otherMe = await (await other.request.get("/api/v1/me")).json();
    expect(otherMe.user.id).not.toBe(me.user.id);
    expect(
      (await other.request.get(`/api/v1/tasks/${ownTask.id}`)).status(),
    ).toBe(404);
    await other
      .getByRole("navigation")
      .getByRole("button", { name: "Tasks" })
      .click();
    await expect(
      other.getByText("Only Alex owns this task", { exact: true }),
    ).toHaveCount(0);
    await other
      .getByRole("navigation")
      .getByRole("button", { name: "AI provider", exact: true })
      .click();
    await expect(
      other.getByText("No API key configured", { exact: true }),
    ).toBeVisible();
    await other.reload();
    expect((await other.request.get("/api/v1/me")).status()).toBe(200);
    await other.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      other.getByRole("link", { name: "Continue with Google" }),
    ).toBeVisible();
    expect(
      (await page.request.get(`/api/v1/tasks/${ownTask.id}`)).status(),
    ).toBe(200);
  } finally {
    await context.close();
  }
});
