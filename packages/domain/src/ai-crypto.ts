import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { DomainError } from "./errors.js";
const envelopeSchema = z
  .object({
    version: z.string(),
    iv: z.string(),
    tag: z.string(),
    ciphertext: z.string(),
  })
  .strict();
export type Envelope = z.infer<typeof envelopeSchema>;
export function readKey(value: string) {
  if (
    !/^[A-Za-z0-9+/]{43}=$/.test(value) ||
    Buffer.from(value, "base64").length !== 32
  )
    throw new Error("Invalid AI encryption configuration.");
  return Buffer.from(value, "base64");
}
export class KeyVault {
  constructor(
    private keys: Map<string, Buffer>,
    readonly version: string,
  ) {
    if (!keys.has(version))
      throw new Error("Missing AI encryption configuration.");
  }
  encrypt(secret: string, owner: string, provider: string): Envelope {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.keys.get(this.version)!,
      iv,
    );
    cipher.setAAD(Buffer.from(JSON.stringify([owner, provider, this.version])));
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    return {
      version: this.version,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }
  decrypt(raw: unknown, owner: string, provider: string) {
    try {
      const data = envelopeSchema.parse(raw),
        key = this.keys.get(data.version);
      if (!key) throw new Error();
      const iv = Buffer.from(data.iv, "base64"),
        tag = Buffer.from(data.tag, "base64");
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const cipher = createDecipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(
        Buffer.from(JSON.stringify([owner, provider, data.version])),
      );
      cipher.setAuthTag(tag);
      return Buffer.concat([
        cipher.update(Buffer.from(data.ciphertext, "base64")),
        cipher.final(),
      ]).toString("utf8");
    } catch {
      throw new DomainError(
        "AI_ENCRYPTION",
        503,
        "Stored AI credentials cannot be unlocked. Check server key configuration or replace the saved key.",
      );
    }
  }
}
export function readAIConfig(env: NodeJS.ProcessEnv = process.env) {
  if (!env.AI_CREDENTIALS_ENCRYPTION_KEY) return undefined;
  const version = env.AI_CREDENTIALS_KEY_VERSION || "v1";
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(version))
    throw new Error("Invalid AI key version.");
  const previous = z
    .record(z.string(), z.string())
    .parse(JSON.parse(env.AI_CREDENTIALS_PREVIOUS_KEYS || "{}"));
  if (Object.hasOwn(previous, version))
    throw new Error(
      "Current AI key version must not also be a previous version.",
    );
  const keys = new Map(
    Object.entries(previous).map(([v, k]) => [v, readKey(k)]),
  );
  keys.set(version, readKey(env.AI_CREDENTIALS_ENCRYPTION_KEY));
  const timeout = z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .parse(env.AI_REQUEST_TIMEOUT_MS || 20000);
  const rate = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(env.AI_REQUESTS_PER_MINUTE || 20);
  const maxTokens = z.coerce
    .number()
    .int()
    .min(64)
    .max(4096)
    .parse(env.AI_MAX_OUTPUT_TOKENS || 1024);
  return { vault: new KeyVault(keys, version), timeout, rate, maxTokens };
}
