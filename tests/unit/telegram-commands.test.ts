import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  approvalDraftSchema,
  chatDraftSchema,
  approvalType,
} from "../../packages/shared/src/chat-actions.js";
import { messagingConfig } from "../../packages/domain/src/notification-provider.js";
import { parseTelegramCommand } from "../../packages/domain/src/telegram-commands.js";

test("Telegram internal edits are explicit, versioned and excluded from model drafts", () => {
  const draft = {
    kind: "task",
    title: "Updated",
    description: "",
    local_due: null,
    change: { id: randomUUID(), version: 1, operation: "rename" },
  };
  assert.equal(approvalType(approvalDraftSchema.parse(draft)), "task.rename");
  assert.equal(chatDraftSchema.safeParse(draft).success, false);
  assert.equal(
    approvalDraftSchema.safeParse({
      ...draft,
      change: { ...draft.change, operation: "delete" },
    }).success,
    false,
  );
  assert.equal(
    approvalDraftSchema.safeParse({
      ...draft,
      change: { ...draft.change, version: 0 },
    }).success,
    false,
  );
  assert.deepEqual(parseTelegramCommand("/TASK My report"), {
    command: "/task",
    argument: "My report",
  });
});
test("Telegram command configuration is opt-in and webhook secrets are validated", () => {
  assert.equal(
    messagingConfig({ NOTIFICATION_MODE: "live" }).telegramCommands,
    false,
  );
  assert.equal(
    messagingConfig({
      NOTIFICATION_MODE: "live",
      TELEGRAM_COMMANDS_ENABLED: "true",
      TELEGRAM_WEBHOOK_SECRET: "a".repeat(32),
    }).telegramCommands,
    true,
  );
  assert.throws(() =>
    messagingConfig({
      NOTIFICATION_MODE: "live",
      TELEGRAM_COMMANDS_ENABLED: "yes",
    }),
  );
  assert.throws(() =>
    messagingConfig({
      NOTIFICATION_MODE: "live",
      TELEGRAM_WEBHOOK_SECRET: "short",
    }),
  );
});
