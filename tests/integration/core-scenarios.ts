import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import request from "supertest";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";
import {
  getRecord,
  saveRecord,
  listRecords,
} from "../../packages/domain/src/records.js";
import { listSchema } from "../../packages/shared/src/contracts.js";
import { saveReminder } from "../../packages/domain/src/reminders.js";
import {
  createAuth,
  type IdentityProvider,
} from "../../services/api/src/auth.js";
import { createApp } from "../../services/api/src/app.js";
import { createLogger } from "../../packages/observability/src/index.js";
import { KeyVault } from "../../packages/domain/src/ai-crypto.js";

export async function coreScenarios(
  db: Kysely<Database>,
  connectionString: string,
) {
  const origin = "http://localhost:3000";
  const legacyOwner = randomUUID();
  await sql`insert into users(id,google_subject,email,display_name) values(${legacyOwner},'synthetic-owner','owner@example.invalid','Alex')`.execute(
    db,
  );
  await sql`insert into owner_binding(user_id) values(${legacyOwner})`.execute(
    db,
  );
  const provider: IdentityProvider = {
    async begin() {
      const state = randomUUID();
      return {
        url: `${origin}/fake-consent?state=${state}`,
        challenge: { state, nonce: randomUUID(), verifier: randomUUID() },
      };
    },
    async verify(url) {
      return {
        subject:
          url.searchParams.get("code") === "changed-subject"
            ? "changed"
            : "synthetic-owner",
        email:
          url.searchParams.get("code") === "outsider"
            ? "outsider@example.invalid"
            : "owner@example.invalid",
        verified: url.searchParams.get("code") !== "unverified",
        name: "Alex",
      };
    },
  };
  const auth = createAuth(
    db,
    connectionString,
    {
      origin,
      secret: randomBytes(48).toString("hex"),
      clientId: "synthetic",
      clientSecret: "synthetic",
    },
    provider,
  );
  let logs = "";
  const logger = createLogger("info", {
    write: (chunk: string) => {
      logs += chunk;
    },
  });
  const makeApp = () =>
    createApp({
      db,
      auth,
      logger,
      checkReady: async () => undefined,
      ai: {
        vault: new KeyVault(new Map([["test", randomBytes(32)]]), "test"),
        rate: 20,
        adapter: {
          async generate() {
            return { content: "Synthetic API answer", usage: null };
          },
        },
      },
    });
  const app = makeApp();
  const agent = request.agent(app);
  const login = async (code: string, client = agent) => {
    const started = await client.get("/auth/google").expect(302);
    const state = new URL(started.headers.location!).searchParams.get("state");
    return client.get(`/auth/google/callback?state=${state}&code=${code}`);
  };
  try {
    await request(app).get("/api/v1/tasks").expect(401);
    await request(app)
      .get("/api/v1/me")
      .set("Cookie", "axis.sid=forged")
      .expect(401);
    assert.equal(
      (await login("unverified")).headers.location,
      "/?login=failed",
    );
    await agent.get("/api/v1/me").expect(401);
    const started = await agent.get("/auth/google").expect(302);
    const state = new URL(started.headers.location!).searchParams.get("state");
    await agent
      .get("/auth/google/callback?state=wrong&code=owner")
      .expect("Location", "/?login=failed");
    const callback = `/auth/google/callback?state=${state}&code=owner`;
    const signedIn = await agent.get(callback).expect("Location", "/");
    const setCookie = String(signedIn.headers["set-cookie"]);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    await agent.get(callback).expect("Location", "/?login=failed");
    const me = await agent.get("/api/v1/me").expect(200);
    const ownerId = me.body.user.id as string,
      csrf = me.body.csrfToken as string;
    assert.equal(
      ownerId,
      legacyOwner,
      "Existing owner keeps the same identity and data",
    );
    const headers = { Origin: origin, "X-CSRF-Token": csrf };
    await request(app).get("/api/v1/ai/config").expect(401);
    await request(app).post("/api/v1/ai/chat").send({}).expect(401);
    await agent.put("/api/v1/ai/config").send({}).expect(403);
    const syntheticKey = "synthetic-api-private-key";
    const aiConfig = {
      provider: "groq",
      model: "llama-3.1-8b-instant",
      apiKey: syntheticKey,
    };
    await agent
      .put("/api/v1/ai/config")
      .set(headers)
      .send({ ...aiConfig, user_id: randomUUID() })
      .expect(400);
    const savedAI = await agent
      .put("/api/v1/ai/config")
      .set(headers)
      .send(aiConfig)
      .expect(200);
    assert.ok(!JSON.stringify(savedAI.body).includes(syntheticKey));
    await agent
      .post("/api/v1/ai/test")
      .set(headers)
      .send({ consent: true })
      .expect(200);
    await agent
      .post("/api/v1/ai/test")
      .set(headers)
      .send({ consent: false })
      .expect(400);
    const aiChat = await agent
      .post("/api/v1/ai/chat")
      .set(headers)
      .send({ request_id: randomUUID(), message: "hello", consent: true })
      .expect(200);
    assert.equal(aiChat.body.messages.length, 2);
    await agent.get(`/api/v1/ai/conversations/${randomUUID()}`).expect(404);
    await agent.delete("/api/v1/ai/config").set(headers).expect(204);
    await agent
      .post("/api/v1/ai/chat")
      .set(headers)
      .send({ request_id: randomUUID(), message: "no key", consent: true })
      .expect(503);
    assert.ok(!logs.includes(syntheticKey));
    await agent
      .post("/api/v1/projects")
      .send({ name: "Forbidden" })
      .expect(403);
    await agent
      .post("/api/v1/projects")
      .set({ ...headers, Origin: "https://evil.invalid" })
      .send({ name: "Forbidden" })
      .expect(403);
    await agent
      .post("/api/v1/projects")
      .set(headers)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Bad", user_id: randomUUID() })
      .expect(400);
    const projectKey = randomUUID();
    const project = await agent
      .post("/api/v1/projects")
      .set(headers)
      .set("Idempotency-Key", projectKey)
      .send({
        name: "Synthetic launch",
        description: "synthetic-private-project",
      })
      .expect(201);
    const replay = await agent
      .post("/api/v1/projects")
      .set(headers)
      .set("Idempotency-Key", projectKey)
      .send({
        name: "Synthetic launch",
        description: "synthetic-private-project",
      })
      .expect(201);
    assert.equal(replay.body.id, project.body.id);
    await agent
      .post("/api/v1/projects")
      .set(headers)
      .set("Idempotency-Key", projectKey)
      .send({ name: "Changed" })
      .expect(409);
    const taskInput = {
      title: "Synthetic task",
      description: "synthetic-private-task",
      project_id: project.body.id,
    };
    const key = randomUUID();
    const [a, b] = await Promise.all([
      agent
        .post("/api/v1/tasks")
        .set(headers)
        .set("Idempotency-Key", key)
        .send(taskInput),
      agent
        .post("/api/v1/tasks")
        .set(headers)
        .set("Idempotency-Key", key)
        .send(taskInput),
    ]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(a.body.id, b.body.id);
    const task = a.body;
    const completed = await agent
      .patch(`/api/v1/tasks/${task.id}`)
      .set(headers)
      .set("If-Match", "1")
      .send({ ...taskInput, status: "completed" })
      .expect(200);
    assert.ok(completed.body.completion_at);
    await agent
      .patch(`/api/v1/tasks/${task.id}`)
      .set(headers)
      .set("If-Match", "1")
      .send({ ...taskInput, status: "deferred" })
      .expect(409);
    await agent
      .patch(`/api/v1/tasks/${task.id}`)
      .set(headers)
      .set("If-Match", "2")
      .send({ ...taskInput, status: "deferred" })
      .expect(409);
    const events = await agent
      .get(`/api/v1/tasks/${task.id}/events`)
      .expect(200);
    assert.equal(events.body.items.length, 2);
    const otherId = randomUUID();
    await sql`insert into users(id,google_subject,email,display_name) values (${otherId},'synthetic-other','other@example.invalid','Other')`.execute(
      db,
    );
    await assert.rejects(getRecord(db, "tasks", otherId, task.id), {
      code: "NOT_FOUND",
    });
    const otherList = await listRecords(
      db,
      "tasks",
      otherId,
      listSchema.parse({}),
    );
    assert.equal(otherList.items.length, 0);
    await assert.rejects(
      saveRecord(
        db,
        "tasks",
        otherId,
        { title: "Cross user", project_id: project.body.id },
        randomUUID(),
        { key: randomUUID() },
      ),
      { code: "NOT_FOUND" },
    );
    await assert.rejects(
      sql`insert into tasks(id,user_id,project_id,title) values (${randomUUID()},${otherId},${project.body.id},'Cross user')`.execute(
        db,
      ),
    );
    const otherProject = await saveRecord(
      db,
      "projects",
      otherId,
      { name: "Other private project" },
      randomUUID(),
      { key: randomUUID() },
    );
    await agent.get(`/api/v1/projects/${otherProject.id}`).expect(404);
    await agent
      .patch(`/api/v1/projects/${otherProject.id}`)
      .set(headers)
      .set("If-Match", "1")
      .send({ name: "Tamper" })
      .expect(404);
    await agent
      .delete(`/api/v1/projects/${otherProject.id}`)
      .set(headers)
      .set("If-Match", "1")
      .expect(404);
    const createMemory = (data: object) =>
      agent
        .post("/api/v1/memories")
        .set(headers)
        .set("Idempotency-Key", randomUUID())
        .send(data);
    await createMemory({
      content: "Synthetic personal fact",
      sensitivity: "sensitive",
    }).expect(422);
    await createMemory({
      content: "My medical diagnosis",
      sensitivity: "ordinary",
    }).expect(422);
    await createMemory({
      content: "password: synthetic-only",
      sensitivity: "sensitive",
      consent: true,
    }).expect(422);
    const memoryInput = {
      content: "Synthetic woodland preference",
      sensitivity: "sensitive",
      consent: true,
      truth_status: "assumed",
      scope: "project",
      project_id: project.body.id,
    };
    const memory = await createMemory(memoryInput).expect(201);
    assert.ok(memory.body.save_consent_at);
    assert.equal(memory.body.truth_status, "assumed");
    assert.equal(memory.body.source_type, "user");
    assert.equal(
      (await agent.get("/api/v1/memories?q=woodland").expect(200)).body.items
        .length,
      1,
    );
    const corrected = await agent
      .patch(`/api/v1/memories/${memory.body.id}`)
      .set(headers)
      .set("If-Match", "1")
      .send({
        ...memoryInput,
        content: "Synthetic mountains preference",
        truth_status: "confirmed",
        archived: true,
      })
      .expect(200);
    assert.equal(corrected.body.truth_status, "confirmed");
    assert.equal(
      (await agent.get("/api/v1/memories?q=woodland&archived=all")).body.items
        .length,
      0,
    );
    assert.equal(
      (await agent.get("/api/v1/memories?q=mountains")).body.items.length,
      0,
    );
    assert.equal(
      (await agent.get("/api/v1/memories?q=mountains&archived=all")).body.items
        .length,
      1,
    );
    await agent
      .delete(`/api/v1/memories/${memory.body.id}`)
      .set(headers)
      .set("If-Match", "2")
      .expect(204);
    assert.equal(
      (await agent.get("/api/v1/memories?q=mountains&archived=all")).body.items
        .length,
      0,
    );
    assert.equal(
      (
        await sql`select id from memory_items where id=${memory.body.id}`.execute(
          db,
        )
      ).rows.length,
      0,
    );
    await agent
      .delete(`/api/v1/projects/${project.body.id}`)
      .set(headers)
      .set("If-Match", "1")
      .expect(409);
    await agent.get("/api/v1/tasks?limit=101").expect(400);
    await agent
      .patch("/api/v1/me")
      .set(headers)
      .send({ display_name: "Alex", timezone: "Invalid/Zone" })
      .expect(400);
    await agent
      .patch("/api/v1/me")
      .set(headers)
      .send({ display_name: "Alex", timezone: "Asia/Kolkata" })
      .expect(200);
    await agent
      .post("/api/v1/actions/example/execute")
      .set(headers)
      .send({ approved: true })
      .expect(401);
    const summary = await agent.get("/api/v1/summary").expect(200);
    assert.equal(summary.body.completed_tasks, 1);
    assert.equal(summary.body.projects, 1);
    const differentSubject = request.agent(app);
    assert.equal(
      (await login("changed-subject", differentSubject)).headers.location,
      "/",
    );
    assert.notEqual(
      (await differentSubject.get("/api/v1/me").expect(200)).body.user.id,
      ownerId,
    );
    assert.equal(
      (await differentSubject.get("/api/v1/tasks").expect(200)).body.items
        .length,
      0,
      "Same email never links another Google subject to the original workspace",
    );
    // A fresh app instance can use the database-backed session, without an in-memory identity.
    const cookie = String(
      (signedIn.headers["set-cookie"] as unknown as string[])[0],
    ).split(";")[0]!;
    await request(makeApp())
      .get("/api/v1/tasks")
      .set("Cookie", cookie)
      .expect(200);
    await assert.rejects(
      sql`update audit_events set event_type='tampered' where user_id=${ownerId}`.execute(
        db,
      ),
    );
    assert.ok(!logs.includes("synthetic-private"));
    await request(app).get("/api/v1/reminders").expect(401);
    await request(app).get("/api/v1/system/status").expect(401);
    const reminderInput = {
      title: "synthetic-private-reminder",
      body: "synthetic-private-body",
      local_due: "2099-10-11T09:00",
      timezone: "Asia/Kolkata",
      confirmed: true,
    };
    await agent.post("/api/v1/reminders").send(reminderInput).expect(403);
    await agent
      .post("/api/v1/reminders")
      .set(headers)
      .set("Idempotency-Key", randomUUID())
      .send({ ...reminderInput, user_id: ownerId })
      .expect(400);
    await agent
      .post("/api/v1/reminders")
      .set(headers)
      .set("Idempotency-Key", randomUUID())
      .send({ ...reminderInput, confirmed: false })
      .expect(400);
    const reminderKey = randomUUID();
    await sql`update users set timezone='UTC' where id=${otherId}`.execute(db);
    const privateReminder = await saveReminder(
      db,
      otherId,
      { ...reminderInput, timezone: "UTC" },
      randomUUID(),
      { key: randomUUID() },
    );
    await agent.get(`/api/v1/reminders/${privateReminder.id}`).expect(404);
    await agent
      .get(`/api/v1/reminders/${privateReminder.id}/attempts`)
      .expect(404);
    await agent
      .post(`/api/v1/reminders/${privateReminder.id}/cancel`)
      .set(headers)
      .set("If-Match", "1")
      .send({})
      .expect(404);
    await agent
      .post("/api/v1/reminders")
      .set(headers)
      .set("Idempotency-Key", randomUUID())
      .send({ ...reminderInput, project_id: otherProject.id })
      .expect(404);
    const listed = await agent.get("/api/v1/reminders").expect(200);
    assert.ok(
      !listed.body.items.some(
        (r: { id: string }) => r.id === privateReminder.id,
      ),
    );
    const reminder = await agent
      .post("/api/v1/reminders")
      .set(headers)
      .set("Idempotency-Key", reminderKey)
      .send(reminderInput)
      .expect(201);
    const replayReminder = await agent
      .post("/api/v1/reminders")
      .set(headers)
      .set("Idempotency-Key", reminderKey)
      .send(reminderInput)
      .expect(201);
    assert.equal(reminder.body.id, replayReminder.body.id);
    assert.equal(reminder.body.due_at, "2099-10-11T03:30:00.000Z");
    await agent.get(`/api/v1/reminders/${randomUUID()}/attempts`).expect(404);
    await agent.get("/api/v1/reminders?limit=101").expect(400);
    await agent
      .get(`/api/v1/reminders/${reminder.body.id}/attempts`)
      .expect(200);
    await request(makeApp())
      .get(`/api/v1/reminders/${reminder.body.id}`)
      .set("Cookie", cookie)
      .expect(200);
    await agent
      .patch(`/api/v1/reminders/${reminder.body.id}`)
      .set(headers)
      .set("If-Match", "99")
      .send(reminderInput)
      .expect(409);
    const snoozed = await agent
      .post(`/api/v1/reminders/${reminder.body.id}/snooze`)
      .set(headers)
      .set("If-Match", "1")
      .send({ local_due: "2099-10-12T09:00", timezone: "Asia/Kolkata" })
      .expect(200);
    assert.equal(snoozed.body.status, "snoozed");
    await agent
      .post(`/api/v1/reminders/${reminder.body.id}/cancel`)
      .set(headers)
      .set("If-Match", String(snoozed.body.version))
      .send({})
      .expect(200);
    const prefs = await agent.get("/api/v1/reminder-preferences").expect(200);
    await agent
      .put("/api/v1/reminder-preferences")
      .set(headers)
      .set("If-Match", String(prefs.body.version))
      .send({ quiet_start: "22:00", quiet_end: "07:00", focus_blocks: [] })
      .expect(200);
    await agent
      .put("/api/v1/reminder-preferences")
      .set(headers)
      .set("If-Match", String(prefs.body.version))
      .send({ quiet_start: null, quiet_end: null, focus_blocks: [] })
      .expect(409);
    await agent.get("/api/v1/system/status").expect(200);
    assert.ok(!logs.includes("synthetic-private"));
    await agent.post("/api/v1/logout").set(headers).expect(204);
    await request(makeApp())
      .get("/api/v1/me")
      .set("Cookie", cookie)
      .expect(401);
    assert.equal((await login("owner")).headers.location, "/");
    await sql`update sessions set sess=jsonb_set(sess::jsonb,'{authExpiresAt}','0'::jsonb)::json where sess::jsonb ? 'userId'`.execute(
      db,
    );
    await agent.get("/api/v1/me").expect(401);
    console.log(
      "PASS: legacy owner preservation, subject isolation, auth replay/expiry/logout, CSRF, ownership, idempotency, privacy consent, search/correction/delete, optimistic concurrency, audit immutability.",
    );
  } finally {
    await auth.close();
  }
}
