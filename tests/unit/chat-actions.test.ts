import assert from "node:assert/strict";
import test from "node:test";
import {
  parseChatReply,
  payloadHash,
} from "../../packages/domain/src/chat-actions.js";
const now = new Date("2026-10-15T10:00:00Z");
const reply = (proposal: unknown) =>
  JSON.stringify({ reply: "Done!", proposal });
test("chat drafts validate timezone and reject past, missing, ambiguous and unauthorized arguments", () => {
  const reminder = {
    kind: "reminder",
    title: "Call",
    local_due: "2026-10-16T09:00",
  };
  const result = parseChatReply(reply(reminder), "Asia/Kolkata", now);
  assert.equal(result.payload?.due_at, "2026-10-16T03:30:00.000Z");
  assert.match(result.reply, /Nothing has been created yet/);
  assert.equal(parseChatReply(reply(reminder), null, now).payload, undefined);
  for (const bad of [
    { ...reminder, confirmed: true },
    { ...reminder, user_id: "other" },
    { ...reminder, recipient: "someone" },
    { ...reminder, local_due: "2026-10-14T09:00" },
    { ...reminder, local_due: "2026-02-30T09:00" },
    { kind: "shell", title: "run" },
  ])
    assert.equal(
      parseChatReply(reply(bad), "Asia/Kolkata", now).payload,
      undefined,
    );
  assert.equal(
    parseChatReply(
      reply({ ...reminder, local_due: "2026-11-01T01:30" }),
      "America/New_York",
      now,
    ).payload,
    undefined,
  );
  assert.equal(
    parseChatReply(reply({ kind: "task", title: "Read" }), null, now).payload
      ?.due_at,
    null,
  );
  assert.equal(
    parseChatReply("ordinary reply", null, now).reply,
    "ordinary reply",
  );
  assert.equal(parseChatReply('{"proposal":', null, now).payload, undefined);
  const p = result.payload!;
  assert.equal(payloadHash(p), payloadHash({ ...p, title: p.title }));
});
