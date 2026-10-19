import { z } from "zod";

export const providers = [
  {
    id: "groq",
    name: "Groq",
    models: [],
  },
] as const;
export const modelId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  .refine((v) => !v.includes("://") && !v.includes(".."));
export function modelRestriction(id: string): string | null {
  if (
    /^(whisper-|distil-whisper-|playai-tts|canopylabs\/orpheus|.*\/.*tts)/i.test(
      id,
    )
  )
    return "Audio model — this interface supports text chat only.";
  if (/^(groq\/compound|compound-)/i.test(id))
    return "Agent system — built-in external tools are not enabled in AXIS.";
  return null;
}
export type GroqModel = { id: string; restriction: string | null };
export const selection = z.object({
  provider: z.literal("groq"),
  model: modelId.refine(
    (id) => !modelRestriction(id),
    "Choose a text-chat model; audio and autonomous agent systems are not supported.",
  ),
});
export type Selection = z.infer<typeof selection>;
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type Completion = {
  content: string;
  usage: { input: number; output: number } | null;
};
export interface AIAdapter {
  agentProtocol?: "json-text";
  listModels?(apiKey: string): Promise<GroqModel[]>;
  generate(
    config: Selection & { apiKey: string },
    messages: ChatMessage[],
    maxTokens?: number,
  ): Promise<Completion>;
}
export class AIError extends Error {
  constructor(
    public code: string,
    public uncertain = false,
  ) {
    super(code);
  }
}
export const errorMessages: Record<string, string> = {
  credentials: "The provider rejected this key. Replace it in AI Settings.",
  quota: "Provider quota is exhausted. Check your provider account.",
  rate_limit: "The provider is rate limiting requests. Wait before retrying.",
  model:
    "Groq cannot serve this model for your key. Load the current model list and check your Groq project model permissions; the model may be retired or restricted.",
  output_limit:
    "The model reached the output limit before producing a text answer. Increase the server AI output-token limit or choose another model.",
  rejected:
    "The provider rejected this request. Review its length and your settings.",
  outage:
    "Provider unavailable; the outcome may be unknown. No automatic retry was made.",
  timeout:
    "The provider timed out. It may have processed the request; no retry was made.",
  network:
    "Connection interrupted. The provider outcome is unknown; no retry was made.",
  malformed: "The provider returned an unusable response. No retry was made.",
};
const reply = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().min(1).max(32000),
          tool_calls: z.unknown().optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});
async function boundedBody(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new AIError("malformed", true);
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function groqAdapter(
  timeoutMs = 20000,
  fetcher: typeof fetch = fetch,
): AIAdapter {
  return {
    agentProtocol: "json-text",
    async listModels(apiKey) {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetcher(
          "https://api.groq.com/openai/v1/models",
          {
            method: "GET",
            redirect: "error",
            signal,
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new AIError(
            response.status === 401 || response.status === 403
              ? "credentials"
              : response.status === 429
                ? "rate_limit"
                : "outage",
          );
        }
        const catalog = z
          .object({
            data: z
              .array(z.object({ id: modelId, active: z.boolean().optional() }))
              .max(1000),
          })
          .parse(JSON.parse(await boundedBody(response, 256000)));
        return [
          ...new Set(
            catalog.data
              .filter((m) => m.active !== false && !m.id.includes(apiKey))
              .map((m) => m.id),
          ),
        ]
          .sort()
          .map((id) => ({ id, restriction: modelRestriction(id) }));
      } catch (error) {
        if (error instanceof AIError) throw error;
        throw new AIError(signal.aborted ? "timeout" : "malformed");
      }
    },
    async generate(config, messages, maxTokens = 1024) {
      selection.parse(config);
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetcher(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            redirect: "error",
            signal,
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: config.model,
              messages,
              stream: false,
              max_completion_tokens: maxTokens,
              ...(/^openai\/gpt-oss-(20b|120b)$/.test(config.model)
                ? { reasoning_effort: "low" }
                : {}),
            }),
          },
        );
        if (!response.ok) {
          let code =
            response.status === 401 || response.status === 403
              ? "credentials"
              : response.status === 402
                ? "quota"
                : response.status === 429
                  ? "rate_limit"
                  : response.status === 404
                    ? "model"
                    : response.status >= 500
                      ? "outage"
                      : "rejected";
          // Inspect only bounded, allowlisted error codes; never return raw messages.
          try {
            const body = JSON.parse(await boundedBody(response, 8192));
            if (
              [
                "model_not_found",
                "model_decommissioned",
                "model_not_available",
                "model_permission_blocked",
                "model_not_allowed",
              ].includes(body?.error?.code)
            )
              code = "model";
            if (
              [body?.error?.code, body?.error?.type].some((value) =>
                [
                  "insufficient_quota",
                  "quota_exceeded",
                  "billing_hard_limit_reached",
                ].includes(value),
              )
            )
              code = "quota";
          } catch {
            /* HTTP status remains the safe fallback. */
          }
          throw new AIError(
            code,
            response.status >= 500 || response.status === 408,
          );
        }
        // Bound response bytes before parsing, including a dishonest Content-Length.
        const body = await boundedBody(response, 128000);
        try {
          const parsed = JSON.parse(body);
          if (
            parsed?.choices?.[0]?.finish_reason === "length" &&
            !parsed.choices[0].message?.content
          )
            throw new AIError("output_limit");
        } catch (error) {
          if (error instanceof AIError) throw error;
        }
        let value: z.infer<typeof reply>;
        try {
          value = reply.parse(JSON.parse(body));
        } catch {
          throw new AIError("malformed", true);
        }
        if (value.choices[0]!.message.tool_calls)
          throw new AIError("malformed", true);
        return {
          content: value.choices[0]!.message.content.replaceAll(
            config.apiKey,
            "[redacted]",
          ),
          usage: value.usage
            ? {
                input: value.usage.prompt_tokens,
                output: value.usage.completion_tokens,
              }
            : null,
        };
      } catch (error) {
        if (error instanceof AIError) throw error;
        throw new AIError(signal.aborted ? "timeout" : "network", true);
      }
    },
  };
}
