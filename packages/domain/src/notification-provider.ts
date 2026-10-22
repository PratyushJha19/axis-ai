import { z } from "zod";
import type {
  Channel,
  DeliveryStatus,
} from "../../shared/src/notifications.js";

export interface DeliveryResult {
  status:
    | "accepted"
    | "sent"
    | "delivered"
    | "read"
    | "failed"
    | "undelivered"
    | "unknown";
  messageId?: string;
  category?: "permanent" | "configuration" | "rate_limit" | "unknown";
  retryAfterMs?: number;
}
export interface OutboundNotification {
  botId?: string | null;
  key: string;
  jobId: string;
  destination: string;
  title: string;
  body: string;
  due: string;
  timezone: string;
  reminderId: string | null;
  windowUntil: string | null;
}
export interface ChannelAdapter {
  send(
    input: OutboundNotification,
    signal: AbortSignal,
  ): Promise<DeliveryResult>;
  reconcile(id: string, signal: AbortSignal): Promise<DeliveryResult>;
}
export interface MessagingConfig {
  telegramCommands?: boolean;
  telegramWebhookSecret?: string;
  telegram?: { token: string; botId: string; username: string };
  mode: "mock" | "live";
  sandbox: boolean;
  publicOrigin?: string;
  twilio?: {
    account: string;
    token: string;
    from: string;
    contentSid?: string;
  };
  email?: { key: string; from: string; webhookSecret: string };
}
const httpsOrigin = z.url().refine((v) => {
  const u = new URL(v);
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    u.pathname === "/" &&
    !u.search &&
    !u.hash
  );
});
export function messagingConfig(
  env: NodeJS.ProcessEnv = process.env,
): MessagingConfig {
  const mode = z.enum(["mock", "live"]).parse(env.NOTIFICATION_MODE || "mock");
  const sandbox =
    z.enum(["true", "false"]).parse(env.WHATSAPP_SANDBOX_MODE || "true") ===
    "true";
  const config: MessagingConfig = { mode, sandbox };
  if (mode === "mock") return config;
  config.telegramCommands =
    z
      .enum(["true", "false"])
      .parse(env.TELEGRAM_COMMANDS_ENABLED || "false") === "true";
  if (env.TELEGRAM_WEBHOOK_SECRET)
    config.telegramWebhookSecret = z
      .string()
      .regex(/^[A-Za-z0-9_-]{32,256}$/)
      .parse(env.TELEGRAM_WEBHOOK_SECRET);
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME) {
    const token = z
      .string()
      .regex(/^[1-9]\d{4,19}:[A-Za-z0-9_-]{20,}$/)
      .parse(env.TELEGRAM_BOT_TOKEN);
    config.telegram = {
      token,
      botId: token.split(":")[0]!,
      username: z
        .string()
        .regex(/^[A-Za-z0-9_]{5,32}$/)
        .parse(env.TELEGRAM_BOT_USERNAME.replace(/^@/, "")),
    };
  }
  if (env.NOTIFICATION_PUBLIC_ORIGIN)
    config.publicOrigin = httpsOrigin
      .parse(env.NOTIFICATION_PUBLIC_ORIGIN)
      .replace(/\/$/, "");
  // Twilio credentials are intentionally ignored after the Telegram migration.
  if (env.RESEND_API_KEY && env.EMAIL_FROM && env.RESEND_WEBHOOK_SECRET)
    config.email = {
      key: z.string().min(10).parse(env.RESEND_API_KEY),
      from: z.email().parse(env.EMAIL_FROM),
      webhookSecret: z
        .string()
        .startsWith("whsec_")
        .parse(env.RESEND_WEBHOOK_SECRET),
    };
  return config;
}
export function twilioStatus(value: unknown): DeliveryResult["status"] {
  if (
    value === "delivered" ||
    value === "read" ||
    value === "sent" ||
    value === "failed" ||
    value === "undelivered"
  )
    return value;
  return ["accepted", "queued", "sending", "scheduled"].includes(String(value))
    ? "accepted"
    : "unknown";
}
export function emailStatus(value: unknown): DeliveryResult["status"] {
  if (value === "delivered" || value === "opened" || value === "clicked")
    return "delivered";
  if (["bounced", "failed", "suppressed", "complained"].includes(String(value)))
    return "failed";
  if (value === "sent") return "sent";
  return "unknown";
}
export function advanceStatus(
  current: DeliveryStatus,
  next: DeliveryResult["status"],
): DeliveryStatus {
  if (current === "read") return current;
  if (current === "delivered") return next === "read" ? next : current;
  if (next === "delivered" || next === "read") return next;
  if (["failed", "undelivered", "suppressed", "blocked"].includes(current))
    return current;
  if (current === "sent" && next === "accepted") return current;
  return next;
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function notificationContent(
  input: OutboundNotification,
  origin?: string,
) {
  const due = new Intl.DateTimeFormat("en", {
    timeZone: input.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(input.due));
  const link = origin
    ? `${origin}/?view=reminders${input.reminderId ? `&reminder=${encodeURIComponent(input.reminderId)}` : ""}`
    : "";
  const text = `AXIS reminder: ${input.title}\nDue ${due} (${input.timezone})${input.body ? `\n${input.body}` : ""}${link ? `\nOpen AXIS: ${link}` : ""}`;
  return {
    text,
    html: `<html lang="en"><body><h1>AXIS reminder</h1><h2>${escape(input.title)}</h2><p>Due ${escape(due)} (${escape(input.timezone)})</p><p>${escape(input.body).replaceAll("\n", "<br>")}</p>${link ? `<p><a href="${escape(link)}">Open reminder in AXIS</a></p>` : ""}</body></html>`,
  };
}
export async function responseJson(
  response: Response,
  maxBytes = 65536,
): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing response");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new Error("Response too large");
      chunks.push(part.value);
    }
    return z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
function rejection(response: Response): DeliveryResult {
  if (response.status === 429) {
    const value = response.headers.get("retry-after") || "";
    const delay = /^\d+$/.test(value)
      ? Number(value) * 1000
      : Date.parse(value) - Date.now();
    return {
      status: "failed",
      category: "rate_limit",
      retryAfterMs: Number.isFinite(delay)
        ? Math.min(86400000, Math.max(0, delay))
        : 30000,
    };
  }
  if ([400, 401, 403, 404, 422].includes(response.status))
    return {
      status: "failed",
      category: [401, 403].includes(response.status)
        ? "configuration"
        : "permanent",
    };
  return { status: "unknown", category: "unknown" };
}
export function channelAdapters(
  config: MessagingConfig,
  fetcher: typeof fetch = fetch,
): Record<Channel, ChannelAdapter> {
  const missing: DeliveryResult = {
    status: "failed",
    category: "configuration",
  };
  const tw = config.twilio;
  const twUrl = tw
    ? `https://api.twilio.com/2010-04-01/Accounts/${tw.account}/Messages`
    : "";
  const twHeaders: Record<string, string> = tw
    ? {
        Authorization: `Basic ${Buffer.from(`${tw.account}:${tw.token}`).toString("base64")}`,
      }
    : {};
  return {
    telegram: {
      async send(input, signal) {
        const bot = config.telegram;
        if (config.mode !== "live" || !bot || input.botId !== bot.botId)
          return missing;
        if (!/^[1-9]\d{0,15}$/.test(input.destination)) return missing;
        const response = await fetcher(
          `https://api.telegram.org/bot${bot.token}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            redirect: "error",
            body: JSON.stringify({
              chat_id: input.destination,
              text: Array.from(
                notificationContent(input, config.publicOrigin).text,
              )
                .slice(0, 4096)
                .join(""),
              allow_paid_broadcast: false,
              link_preview_options: { is_disabled: true },
            }),
          },
        );
        const data = await responseJson(response);
        if (
          response.status === 429 &&
          data.ok === false &&
          data.error_code === 429
        ) {
          const retry = z
            .object({ retry_after: z.number().int().min(0).max(86400) })
            .safeParse(data.parameters);
          return {
            status: "failed",
            category: "rate_limit",
            retryAfterMs: retry.success ? retry.data.retry_after * 1000 : 30000,
          };
        }
        if (!response.ok || data.ok !== true) return rejection(response);
        const result = z
          .object({
            message_id: z.number().int().positive().safe(),
            chat: z.object({
              id: z.number().int().positive().safe(),
              type: z.literal("private"),
            }),
          })
          .parse(data.result);
        if (String(result.chat.id) !== input.destination)
          return { status: "unknown", category: "unknown" };
        return {
          status: "sent",
          messageId: `${bot.botId}:${input.destination}:${result.message_id}`,
        };
      },
      async reconcile() {
        return { status: "unknown", category: "unknown" };
      },
    },
    whatsapp: {
      async send(input, signal) {
        if (config.mode !== "live" || !tw || !config.publicOrigin)
          return missing;
        const form = new URLSearchParams({
          To: `whatsapp:${input.destination}`,
          From: tw.from,
          StatusCallback: `${config.publicOrigin}/webhooks/twilio/status/${input.jobId}`,
        });
        if (tw.contentSid) {
          form.set("ContentSid", tw.contentSid);
          // An approved reminder template must have one text variable {{1}}.
          form.set(
            "ContentVariables",
            JSON.stringify({
              "1": notificationContent(input, config.publicOrigin)
                .text.replace(/\s+/g, " ")
                .trim(),
            }),
          );
        } else if (
          input.windowUntil &&
          new Date(input.windowUntil).getTime() > Date.now() + 60000
        )
          form.set(
            "Body",
            notificationContent(input, config.publicOrigin).text,
          );
        else return missing;
        const response = await fetcher(`${twUrl}.json`, {
          method: "POST",
          headers: twHeaders,
          body: form,
          signal,
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          return rejection(response);
        }
        const data = await responseJson(response);
        const id = z
          .string()
          .regex(/^SM[0-9a-f]{32}$/i)
          .parse(data.sid);
        if (data.account_sid !== tw.account)
          return { status: "unknown", category: "unknown" };
        return { status: twilioStatus(data.status), messageId: id };
      },
      async reconcile(id, signal) {
        if (!tw || !/^SM[0-9a-f]{32}$/i.test(id))
          return { status: "unknown", category: "unknown" };
        const response = await fetcher(`${twUrl}/${id}.json`, {
          headers: twHeaders,
          signal,
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          return { status: "unknown", category: "unknown" };
        }
        const data = await responseJson(response);
        return data.sid === id && data.account_sid === tw.account
          ? { status: twilioStatus(data.status), messageId: id }
          : { status: "unknown", category: "unknown" };
      },
    },
    email: {
      async send(input, signal) {
        if (config.mode !== "live" || !config.email || !config.publicOrigin)
          return missing;
        const content = notificationContent(input, config.publicOrigin);
        const response = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.email.key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": input.key,
          },
          body: JSON.stringify({
            from: config.email.from,
            to: [input.destination],
            subject: "AXIS reminder",
            ...content,
            tags: [{ name: "axis_job", value: input.jobId }],
          }),
          signal,
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          return rejection(response);
        }
        const data = await responseJson(response);
        return { status: "accepted", messageId: z.uuid().parse(data.id) };
      },
      async reconcile(id, signal) {
        if (!config.email || !z.uuid().safeParse(id).success)
          return { status: "unknown", category: "unknown" };
        const response = await fetcher(`https://api.resend.com/emails/${id}`, {
          headers: { Authorization: `Bearer ${config.email.key}` },
          signal,
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          return { status: "unknown", category: "unknown" };
        }
        const data = await responseJson(response);
        return data.id === id
          ? { status: emailStatus(data.last_event), messageId: id }
          : { status: "unknown", category: "unknown" };
      },
    },
  };
}
export async function deliveryCall(
  call: (signal: AbortSignal) => Promise<DeliveryResult>,
  timeout = 5000,
): Promise<DeliveryResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call(controller.signal),
      new Promise<DeliveryResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ status: "unknown", category: "unknown" });
        }, timeout);
      }),
    ]);
  } catch {
    return { status: "unknown", category: "unknown" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
