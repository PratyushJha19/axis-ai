import {
  messagingConfig,
  responseJson,
} from "../packages/domain/src/notification-provider.js";

// Operator-invoked only. Startup never changes Telegram configuration.
try {
  const config = messagingConfig(),
    operation = process.argv[2] || "status";
  if (!config.telegram) throw new Error("Configure live Telegram first");
  let method = "getWebhookInfo",
    body: Record<string, unknown> = {};
  if (operation === "set") {
    if (!process.argv.includes("--apply") || !config.telegramWebhookSecret)
      throw new Error("Explicit --apply and secret required");
    const url = new URL(process.env.TELEGRAM_WEBHOOK_URL || "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/webhooks/telegram"
    )
      throw new Error("Invalid URL");
    method = "setWebhook";
    body = {
      url: url.toString(),
      secret_token: config.telegramWebhookSecret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
      max_connections: 2,
    };
  } else if (operation === "delete") {
    if (!process.argv.includes("--apply"))
      throw new Error("Explicit --apply required");
    method = "deleteWebhook";
    body = { drop_pending_updates: false };
  } else if (operation !== "status") throw new Error("Unknown operation");
  const response = await fetch(
    `https://api.telegram.org/bot${config.telegram.token}/${method}`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = await responseJson(response);
  if (!response.ok || data.ok !== true)
    throw new Error("Telegram rejected request");
  if (method === "getWebhookInfo") {
    const result = data.result as Record<string, unknown>;
    console.log(
      JSON.stringify({
        configured: Boolean(result?.url),
        pending_updates: result?.pending_update_count,
        has_delivery_error: Boolean(result?.last_error_date),
      }),
    );
  } else console.log(`Telegram webhook ${operation} confirmed.`);
} catch {
  console.error(
    "Webhook operation unavailable or unconfirmed. Check live bot settings, TELEGRAM_WEBHOOK_SECRET and TELEGRAM_WEBHOOK_URL. Use 'status', 'set --apply', or 'delete --apply'. No credentials or provider response are printed.",
  );
  process.exitCode = 1;
}
