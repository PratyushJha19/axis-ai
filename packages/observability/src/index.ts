import pino from "pino";

export function createLogger(
  level = "info",
  destination?: pino.DestinationStream,
) {
  const options: pino.LoggerOptions = {
    level,
    base: { service: "axis" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "password",
        "token",
        "secret",
        "apiKey",
        "encrypted_key",
        "AI_CREDENTIALS_ENCRYPTION_KEY",
        "AI_CREDENTIALS_PREVIOUS_KEYS",
        "authorization",
        "cookie",
        "databaseUrl",
        "req",
        "res",
        "err",
      ],
      censor: "[REDACTED]",
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
