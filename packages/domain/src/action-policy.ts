import { DomainError } from "./errors.js";

export const ACTION_POLICY_VERSION = "m4-internal-v1";
const registry = {
  "task.rename": {
    name: "Rename task",
    resource: "tasks",
    permission: "tasks:update",
    risk: "B",
  },
  "task.complete": {
    name: "Complete task",
    resource: "tasks",
    permission: "tasks:update",
    risk: "B",
  },
  "reminder.cancel": {
    name: "Cancel reminder",
    resource: "reminders",
    permission: "reminders:update",
    risk: "B",
  },
  "reminder.reschedule": {
    name: "Reschedule reminder",
    resource: "reminders",
    permission: "reminders:update",
    risk: "B",
  },
  "task.create": {
    name: "Create task",
    resource: "tasks",
    permission: "tasks:create",
    risk: "B",
  },
  "reminder.create": {
    name: "Create reminder",
    resource: "reminders",
    permission: "reminders:create",
    risk: "B",
  },
} as const;

// Policy is server-owned. Unsupported external/high-risk operations fail closed.
export function actionPolicy(type: string, version = ACTION_POLICY_VERSION) {
  if (version !== ACTION_POLICY_VERSION)
    throw new DomainError(
      "POLICY_CHANGED",
      409,
      "Policy changed. Request a new proposal.",
    );
  if (!Object.hasOwn(registry, type))
    throw new DomainError(
      "ACTION_NOT_SUPPORTED",
      403,
      "This action is not supported. External and high-risk actions are disabled.",
    );
  return {
    ...registry[type as keyof typeof registry],
    type,
    version,
    application: "axis",
    requiresApproval: true,
    readOnly: false,
  };
}
