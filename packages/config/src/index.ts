import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return ["postgres:", "postgresql:"].includes(url.protocol);
    }),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["silent", "error", "warn", "info", "debug"])
    .default("info"),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.safeParse({
    ...env,
    PORT: env.PORT || undefined,
    LOG_LEVEL: env.LOG_LEVEL || undefined,
  });
  if (!parsed.success) {
    // Do not include input values or validation internals: URLs can contain secrets.
    throw new Error(
      "Invalid configuration. Check DATABASE_URL, PORT and LOG_LEVEL.",
    );
  }
  return parsed.data;
}
