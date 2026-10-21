import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import request from "supertest";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";
import {
  createAuth,
  type IdentityProvider,
} from "../../services/api/src/auth.js";
import { createApp } from "../../services/api/src/app.js";
import { KeyVault } from "../../packages/domain/src/ai-crypto.js";
import { createLogger } from "../../packages/observability/src/index.js";

export async function multiUserScenarios(
  t: TestContext,
  db: Kysely<Database>,
  connectionString: string,
) {
  const origin = "http://localhost:3000";
  let changedEmail = false;
  const provider: IdentityProvider = {
    async begin() {
      const state = randomUUID();
      return {
        url: `${origin}/synthetic?state=${state}`,
        challenge: { state, nonce: randomUUID(), verifier: randomUUID() },
      };
    },
    async verify(url) {
      const code = url.searchParams.get("code")!;
      return {
        subject: `multi-${code}`,
        email:
          code === "a" && changedEmail
            ? "renamed@example.invalid"
            : `${code}@example.invalid`,
        verified: code !== "unverified",
        name: code,
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
  let calls: string[] = [],
    logs = "";
  const app = createApp({
    db,
    auth,
    checkReady: async () => undefined,
    logger: createLogger("info", {
      write(chunk: string) {
        logs += chunk;
      },
    }),
    ai: {
      vault: new KeyVault(new Map([["test", randomBytes(32)]]), "test"),
      rate: 20,
      adapter: {
        async generate(config, messages) {
          calls.push(config.apiKey);
          if (messages.at(-1)?.content === "Create a fixture task")
            return {
              content: JSON.stringify({
                reply: "Draft",
                proposal: { kind: "task", title: "Private draft task" },
              }),
              usage: null,
            };
          return { content: "Synthetic private response", usage: null };
        },
      },
    },
  });
  const a = request.agent(app),
    b = request.agent(app);
  const login = async (client: typeof a, code: string) => {
    const start = await client.get("/auth/google").expect(302);
    const state = new URL(start.headers.location!).searchParams.get("state");
    return client.get(`/auth/google/callback?state=${state}&code=${code}`);
  };
  let headersA: Record<string, string>,
    headersB: Record<string, string>,
    idA: string,
    idB: string;
  try {
    await t.test(
      "HTTPS proxy login keeps secure cookies, owner sessions and CSRF; default does not trust forwarding headers",
      async () => {
        const secureAuth = createAuth(
          db,
          connectionString,
          {
            origin: "https://axis-demo.example",
            secret: randomBytes(48).toString("hex"),
            clientId: "synthetic",
            clientSecret: "synthetic",
          },
          provider,
        );
        try {
          const deps = {
            db,
            auth: secureAuth,
            logger: createLogger("silent"),
            checkReady: async () => undefined,
          };
          const direct = await request(createApp(deps))
            .get("/auth/google")
            .set("X-Forwarded-Proto", "https")
            .expect(302);
          assert.equal(direct.headers["set-cookie"], undefined);
          const proxied = createApp({ ...deps, trustProxyHops: 1 });
          const start = await request(proxied)
            .get("/auth/google")
            .set("X-Forwarded-Proto", "https")
            .expect(302);
          const cookie = start.headers["set-cookie"]?.[0];
          assert.ok(cookie);
          assert.match(cookie, /;\s*Secure/);
          assert.match(cookie, /HttpOnly/);
          assert.match(cookie, /SameSite=Lax/);
          const state = new URL(start.headers.location!).searchParams.get(
            "state",
          );
          const callback = await request(proxied)
            .get(`/auth/google/callback?state=${state}&code=proxy`)
            .set("Cookie", cookie.split(";")[0]!)
            .set("X-Forwarded-Proto", "https")
            .expect(302);
          const callbackCookie = callback.headers["set-cookie"]?.[0];
          assert.ok(callbackCookie);
          const sessionCookie = callbackCookie.split(";")[0]!;
          const me = await request(proxied)
            .get("/api/v1/me")
            .set("Cookie", sessionCookie)
            .set("X-Forwarded-Proto", "https")
            .expect(200);
          assert.equal(me.body.user.email, "proxy@example.invalid");
          await request(proxied)
            .post("/api/v1/logout")
            .set("Cookie", sessionCookie)
            .set("Origin", "https://foreign.example")
            .set("X-CSRF-Token", me.body.csrfToken)
            .expect(403);
          await request(proxied)
            .post("/api/v1/logout")
            .set("Cookie", sessionCookie)
            .set("Origin", "https://axis-demo.example")
            .set("X-CSRF-Token", me.body.csrfToken)
            .expect(204);
        } finally {
          await secureAuth.close();
        }
      },
    );
    await t.test(
      "demo rejects delegated runs after authentication while ordinary owned records remain available",
      async () => {
        const demo = request.agent(
          createApp({
            db,
            auth,
            demoMode: true,
            freeHostNotifications: true,
            logger: createLogger("silent"),
            checkReady: async () => undefined,
          }),
        );
        await demo.post("/api/v1/agent/runs").send({}).expect(401);
        await login(demo, "demo");
        const me = await demo.get("/api/v1/me").expect(200);
        const denied = await demo
          .post("/api/v1/agent/runs")
          .set("Origin", origin)
          .set("X-CSRF-Token", me.body.csrfToken)
          .send({})
          .expect(503);
        assert.equal(denied.body.error.code, "DEMO_UNAVAILABLE");
        await demo.get("/api/v1/tasks").expect(200);
      },
    );
    await t.test(
      "multi-user verified Google enrollment and concurrent same-subject signup",
      async () => {
        await Promise.all([login(a, "a"), login(b, "b")]);
        const ma = await a.get("/api/v1/me").expect(200),
          mb = await b.get("/api/v1/me").expect(200);
        idA = ma.body.user.id;
        idB = mb.body.user.id;
        assert.notEqual(idA, idB);
        headersA = { Origin: origin, "X-CSRF-Token": ma.body.csrfToken };
        headersB = { Origin: origin, "X-CSRF-Token": mb.body.csrfToken };
        const one = request.agent(app),
          two = request.agent(app);
        await Promise.all([login(one, "same"), login(two, "same")]);
        const first = await one.get("/api/v1/me").expect(200),
          second = await two.get("/api/v1/me").expect(200);
        assert.equal(first.body.user.id, second.body.user.id);
        assert.equal(
          (
            await sql<{
              n: number;
            }>`select count(*)::int n from users where google_subject='multi-same'`.execute(
              db,
            )
          ).rows[0]!.n,
          1,
        );
        assert.equal(
          (await login(request.agent(app), "unverified")).headers.location,
          "/?login=failed",
        );
      },
    );
    await t.test(
      "Calendar API enforces sessions, CSRF, owner isolation, read-only routes and recovery quarantine",
      async () => {
        await sql`insert into calendar_connections(user_id,revision,subject,scopes,status,events) values(${idA},${randomUUID()},'fixture',array[]::text[],'connected','[{"id":"private-calendar-event","title":"Private owner commitment","start":"2026-10-20T09:00:00Z","end":"2026-10-20T10:00:00Z","timezone":"UTC","all_day":false,"busy":true}]'::jsonb)`.execute(
          db,
        );
        await request(app).get("/api/v1/calendar/status").expect(401);
        const own = await a.get("/api/v1/calendar/status").expect(200),
          foreign = await b.get("/api/v1/calendar/status").expect(200);
        assert.equal(own.body.events.length, 1);
        assert.equal(foreign.body.events.length, 0);
        assert.ok(!("credential" in own.body));
        await a
          .post("/api/v1/calendar/connect")
          .send({ consent: true })
          .expect(403);
        await a
          .post("/api/v1/calendar/connect")
          .set(headersA)
          .send({ consent: true, user_id: idB })
          .expect(400);
        await a
          .post("/api/v1/calendar/events")
          .set(headersA)
          .send({ title: "Write forbidden" })
          .expect(401);
        await a
          .post("/api/v1/calendar/sync")
          .set(headersA)
          .send({ date: "2026-10-20", days: 32 })
          .expect(400);
        await b
          .post("/api/v1/calendar/disconnect")
          .set(headersB)
          .send({ confirmed: true })
          .expect(200);
        assert.equal(
          (await a.get("/api/v1/calendar/status")).body.events.length,
          1,
        );
        await sql`update recovery_control set quarantined=true where id=1`.execute(
          db,
        );
        try {
          await a
            .post("/api/v1/tasks")
            .set(headersA)
            .send({ title: "Held" })
            .expect(503);
        } finally {
          await sql`update recovery_control set quarantined=false where id=1`.execute(
            db,
          );
        }
      },
    );
    await t.test(
      "two sessions cannot read, modify, link or delete each other’s core records",
      async () => {
        const key = randomUUID();
        for (const [route, payload] of [
          ["projects", { name: "Private project A" }],
          ["tasks", { title: "Private task A" }],
          [
            "memories",
            {
              content: "Private memory A",
              kind: "fact",
              scope: "global",
              truth_status: "confirmed",
              sensitivity: "ordinary",
            },
          ],
        ] as const) {
          const created = await a
            .post(`/api/v1/${route}`)
            .set(headersA)
            .set("Idempotency-Key", route === "projects" ? key : randomUUID())
            .send(payload)
            .expect(201);
          const id = created.body.id;
          await b.get(`/api/v1/${route}/${id}`).expect(404);
          await b
            .patch(`/api/v1/${route}/${id}`)
            .set(headersB)
            .set("If-Match", "1")
            .send(payload)
            .expect(404);
          await b
            .delete(`/api/v1/${route}/${id}`)
            .set(headersB)
            .set("If-Match", "1")
            .expect(404);
          assert.equal(
            (await b.get(`/api/v1/${route}`).expect(200)).body.items.length,
            0,
          );
          if (route === "projects")
            await b
              .post("/api/v1/tasks")
              .set(headersB)
              .set("Idempotency-Key", randomUUID())
              .send({ title: "Attempt cross link", project_id: id })
              .expect(404);
          await a.get(`/api/v1/${route}/${id}`).expect(200);
        }
        // Same idempotency UUID is valid independently for another user.
        await b
          .post("/api/v1/projects")
          .set(headersB)
          .set("Idempotency-Key", key)
          .send({ name: "Private project B" })
          .expect(201);
        assert.equal(
          (await b.get("/api/v1/summary").expect(200)).body.active_tasks,
          0,
        );
        await b
          .patch("/api/v1/me")
          .set(headersA)
          .send({ display_name: "attack", timezone: "UTC" })
          .expect(403);
        await a
          .patch("/api/v1/me")
          .set(headersA)
          .send({ display_name: "Custom A", timezone: "Asia/Kolkata" })
          .expect(200);
        await b
          .patch("/api/v1/me")
          .set(headersB)
          .send({ display_name: "Custom B", timezone: "America/New_York" })
          .expect(200);
        assert.equal(
          (await a.get("/api/v1/me")).body.user.timezone,
          "Asia/Kolkata",
        );
      },
    );
    await t.test(
      "two sessions keep reminder settings, attempts and schedules private",
      async () => {
        const input = {
          title: "Private reminder A",
          body: "Only A",
          local_due: "2099-01-01T10:00",
          timezone: "Asia/Kolkata",
          disambiguation: "reject",
          recurrence: "none",
          task_id: null,
          project_id: null,
          confirmed: true,
        };
        const reminder = await a
          .post("/api/v1/reminders")
          .set(headersA)
          .set("Idempotency-Key", randomUUID())
          .send(input)
          .expect(201);
        await b.get(`/api/v1/reminders/${reminder.body.id}`).expect(404);
        await b
          .get(`/api/v1/reminders/${reminder.body.id}/attempts`)
          .expect(404);
        await b
          .post(`/api/v1/reminders/${reminder.body.id}/cancel`)
          .set(headersB)
          .set("If-Match", "1")
          .send({})
          .expect(404);
        assert.equal(
          (await b.get("/api/v1/reminders").expect(200)).body.items.length,
          0,
        );
        const prefs = (await a.get("/api/v1/reminder-preferences").expect(200))
          .body;
        await a
          .put("/api/v1/reminder-preferences")
          .set(headersA)
          .set("If-Match", String(prefs.version))
          .send({ quiet_start: "22:00", quiet_end: "07:00", focus_blocks: [] })
          .expect(200);
        assert.equal(
          (await b.get("/api/v1/reminder-preferences").expect(200)).body
            .quiet_start,
          null,
        );
        await a
          .post(`/api/v1/reminders/${reminder.body.id}/cancel`)
          .set(headersA)
          .set("If-Match", "1")
          .send({})
          .expect(200);
        assert.ok(
          (
            await a.get("/api/v1/reminders?view=archive").expect(200)
          ).body.items.some((r: { id: string }) => r.id === reminder.body.id),
        );
        assert.equal(
          (await b.get("/api/v1/reminders?view=archive").expect(200)).body.items
            .length,
          0,
        );
        assert.ok(
          !(await a.get("/api/v1/reminders").expect(200)).body.items.some(
            (r: { id: string }) => r.id === reminder.body.id,
          ),
        );
      },
    );
    await t.test(
      "two sessions use only their own encrypted BYOK keys and conversations",
      async () => {
        const config = { provider: "groq", model: "llama-3.1-8b-instant" };
        await a
          .put("/api/v1/ai/config")
          .set(headersA)
          .send({ ...config, apiKey: "synthetic-multi-key-A" })
          .expect(200);
        assert.equal(
          (await b.get("/api/v1/ai/config").expect(200)).body.config,
          null,
        );
        await b
          .put("/api/v1/ai/config")
          .set(headersB)
          .send({ ...config, apiKey: "synthetic-multi-key-B" })
          .expect(200);
        const configA = (await a.get("/api/v1/ai/config")).body.config;
        await b
          .put("/api/v1/ai/config")
          .set(headersB)
          .send({ ...config, user_id: idA })
          .expect(400);
        calls = [];
        const key = randomUUID();
        const chat = await a
          .post("/api/v1/ai/chat")
          .set(headersA)
          .send({
            request_id: key,
            message: "Private conversation A",
            consent: true,
          })
          .expect(200);
        const id = chat.body.conversation_id;
        await b.get(`/api/v1/ai/conversations/${id}`).expect(404);
        await b.get(`/api/v1/ai/requests/${key}`).expect(404);
        await b
          .post("/api/v1/ai/chat")
          .set(headersB)
          .send({
            request_id: randomUUID(),
            conversation_id: id,
            message: "attack",
            consent: true,
          })
          .expect(404);
        await b
          .post("/api/v1/ai/chat")
          .set(headersB)
          .send({
            request_id: key,
            message: "Private conversation B",
            consent: true,
          })
          .expect(200);
        assert.deepEqual(calls, [
          "synthetic-multi-key-A",
          "synthetic-multi-key-B",
        ]);
        assert.equal(
          (await b.get("/api/v1/ai/conversations")).body.items.length,
          1,
        );
        await b.delete("/api/v1/ai/config").set(headersB).expect(204);
        assert.deepEqual(
          (await a.get("/api/v1/ai/config")).body.config,
          configA,
        );
        assert.ok(!logs.includes("synthetic-multi-key-A"));
        assert.ok(!logs.includes("synthetic-multi-key-B"));
        // Leave no foreign test-vault rows for the later rotation CLI scenario.
        await a.delete("/api/v1/ai/config").set(headersA).expect(204);
      },
    );
    await t.test(
      "chat action API requires session, CSRF, exact payload and owning account",
      async () => {
        await a
          .put("/api/v1/ai/config")
          .set(headersA)
          .send({
            provider: "groq",
            model: "test-model",
            apiKey: "synthetic-action-key",
          })
          .expect(200);
        const response = await a
          .post("/api/v1/ai/chat")
          .set(headersA)
          .send({
            request_id: randomUUID(),
            message: "Create a fixture task",
            consent: true,
          })
          .expect(200);
        const action = response.body.actions[0];
        const path = `/api/v1/ai/actions/${action.id}/decide`,
          body = { decision: "confirm", payload_hash: action.payload_hash };
        await request(app).post(path).send(body).expect(401);
        await a.post(path).send(body).expect(403);
        await b.post(path).set(headersB).send(body).expect(404);
        await a
          .post(path)
          .set(headersA)
          .send({ ...body, payload: { title: "Altered" } })
          .expect(400);
        const approvalPath = `/api/v1/approvals/${action.id}`;
        const exact = { payload_hash: action.payload_hash };
        await request(app)
          .post(approvalPath + "/execute")
          .send(exact)
          .expect(401);
        await a
          .post(approvalPath + "/approve")
          .send(exact)
          .expect(403);
        await b
          .post(approvalPath + "/approve")
          .set(headersB)
          .send(exact)
          .expect(404);
        await b.get(approvalPath + "/events").expect(404);
        assert.ok(
          !(await b.get("/api/v1/approvals")).body.items.some(
            (item: { id: string }) => item.id === action.id,
          ),
        );
        const denied = await a
          .post(approvalPath + "/execute")
          .set(headersA)
          .send(exact)
          .expect(403);
        assert.equal(denied.body.error.code, "APPROVAL_REQUIRED");
        await a
          .post(approvalPath + "/approve")
          .set(headersA)
          .send({ ...exact, approved: true, user_id: idB })
          .expect(400);
        await a
          .post(approvalPath + "/approve")
          .set(headersA)
          .send(exact)
          .expect(200);
        const first = await a.post(path).set(headersA).send(body).expect(200);
        const replay = await a.post(path).set(headersA).send(body).expect(200);
        assert.equal(first.body.entity_id, replay.body.entity_id);
        await b.get(`/api/v1/tasks/${first.body.entity_id}`).expect(404);
        assert.ok(!logs.includes("Private draft task"));
        await a.delete("/api/v1/ai/config").set(headersA).expect(204);
      },
    );
    await t.test(
      "agent APIs enforce owner, CSRF, strict inputs and cancellation",
      async () => {
        const input = {
          idempotency_key: randomUUID(),
          goal: "Read my tasks",
          consent: true,
        };
        await request(app).post("/api/v1/agent/runs").send(input).expect(401);
        await a.post("/api/v1/agent/runs").send(input).expect(403);
        await a
          .post("/api/v1/agent/runs")
          .set(headersA)
          .send({ ...input, user_id: idB })
          .expect(400);
        const run = await a
          .post("/api/v1/agent/runs")
          .set(headersA)
          .send(input)
          .expect(202);
        const path = `/api/v1/agent/runs/${run.body.id}`;
        await b.get(path).expect(404);
        await b
          .post(path + "/cancel")
          .set(headersB)
          .send({})
          .expect(404);
        assert.ok(
          !(await b.get("/api/v1/agent/runs")).body.items.some(
            (r: { id: string }) => r.id === run.body.id,
          ),
        );
        await a
          .post(path + "/clarify")
          .set(headersA)
          .send({ message: "ok", tool_result: { approved: true } })
          .expect(400);
        await a
          .post(path + "/cancel")
          .set(headersA)
          .send({})
          .expect(200);
        assert.equal((await a.get(path)).body.run.status, "cancelled");
      },
    );
    await t.test(
      "planning APIs enforce session, CSRF, owner scopes and strict plan authority",
      async () => {
        await request(app).get("/api/v1/intelligence/briefing").expect(401);
        await a.post("/api/v1/plans/generate").send({}).expect(403);
        const data = {
          idempotency_key: randomUUID(),
          date: "2099-10-19",
          kind: "daily",
          mode: "priority",
          task_ids: [],
        };
        await a
          .post("/api/v1/plans/generate")
          .set(headersA)
          .send({ ...data, user_id: idB })
          .expect(400);
        const created = await a
          .post("/api/v1/plans/generate")
          .set(headersA)
          .send(data)
          .expect(201);
        await b.get(`/api/v1/plans/${created.body.id}`).expect(404);
        await b
          .post(`/api/v1/plans/${created.body.id}`)
          .set(headersB)
          .send({ version: 1, operation: "accept" })
          .expect(404);
        assert.ok(
          !(await b.get("/api/v1/plans").expect(200)).body.items.some(
            (p: { id: string }) => p.id === created.body.id,
          ),
        );
        await a
          .post(`/api/v1/plans/${created.body.id}`)
          .set(headersA)
          .send({ version: 1, operation: "accept", approved: true })
          .expect(400);
        await a
          .post(`/api/v1/plans/${created.body.id}`)
          .set(headersA)
          .send({ version: 1, operation: "discard" })
          .expect(200);
        await a.get("/api/v1/intelligence/briefing").expect(200);
      },
    );
    await t.test(
      "Google email changes preserve account identity; logout affects only its session",
      async () => {
        changedEmail = true;
        await login(a, "a");
        const me = await a.get("/api/v1/me").expect(200);
        assert.equal(me.body.user.id, idA);
        assert.equal(me.body.user.email, "renamed@example.invalid");
        assert.equal(me.body.user.display_name, "Custom A");
        await a
          .post("/api/v1/logout")
          .set({ Origin: origin, "X-CSRF-Token": me.body.csrfToken })
          .expect(204);
        await a.get("/api/v1/me").expect(401);
        assert.equal((await b.get("/api/v1/me").expect(200)).body.user.id, idB);
      },
    );
  } finally {
    await auth.close();
  }
}
