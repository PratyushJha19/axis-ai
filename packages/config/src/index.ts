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
  HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  FREE_HOST_NOTIFICATIONS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  LOG_LEVEL: z
    .enum(["silent", "error", "warn", "info", "debug"])
    .default("info"),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.safeParse({
    ...env,
    PORT: env.PORT || undefined,
    HOST: env.HOST || undefined,
    TRUST_PROXY_HOPS: env.TRUST_PROXY_HOPS || undefined,
    DEMO_MODE: env.DEMO_MODE || undefined,
    FREE_HOST_NOTIFICATIONS: env.FREE_HOST_NOTIFICATIONS || undefined,
    LOG_LEVEL: env.LOG_LEVEL || undefined,
  });
  if (!parsed.success) {
    // Do not include input values or validation internals: URLs can contain secrets.
    throw new Error(
      "Invalid configuration. Check DATABASE_URL, PORT, HOST, TRUST_PROXY_HOPS, DEMO_MODE, FREE_HOST_NOTIFICATIONS and LOG_LEVEL.",
    );
  }
  return parsed.data;
}
