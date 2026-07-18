import pino, { type Logger } from "pino";

/**
 * Structured logger. Child loggers carry correlation ids (orgId, runId, stepId)
 * so every line of a workflow run can be traced. Secrets must never be passed
 * as log fields; redact common key names defensively.
 */
export function createLogger(name: string): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
    redact: {
      paths: [
        "*.apiKey",
        "*.password",
        "*.secret",
        "*.token",
        "*.authorization",
        "apiKey",
        "password",
        "secret",
        "token",
      ],
      censor: "[REDACTED]",
    },
  });
}

export type { Logger };
