/** Platform error taxonomy. `retryable` drives queue retry behavior. */
export type ErrorCode =
  | "VALIDATION"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "COST_LIMIT"
  | "BUDGET_EXCEEDED"
  | "PROVIDER_ERROR"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "TOOL_FORBIDDEN"
  | "APPROVAL_REQUIRED"
  | "STEP_FAILED"
  | "CANCELLED"
  | "CONFLICT"
  | "INTERNAL";

export class PlatformError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    opts?: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, { cause: opts?.cause });
    this.name = "PlatformError";
    this.code = code;
    this.retryable = opts?.retryable ?? DEFAULT_RETRYABLE[code];
    this.details = opts?.details;
  }
}

const DEFAULT_RETRYABLE: Record<ErrorCode, boolean> = {
  VALIDATION: false,
  PERMISSION_DENIED: false,
  NOT_FOUND: false,
  COST_LIMIT: false,
  BUDGET_EXCEEDED: false,
  PROVIDER_ERROR: true,
  PROVIDER_RATE_LIMIT: true,
  PROVIDER_TIMEOUT: true,
  TOOL_FORBIDDEN: false,
  APPROVAL_REQUIRED: false,
  STEP_FAILED: false,
  CANCELLED: false,
  CONFLICT: false,
  INTERNAL: true,
};

export function isPlatformError(err: unknown): err is PlatformError {
  return err instanceof PlatformError;
}

export function isRetryable(err: unknown): boolean {
  return isPlatformError(err) ? err.retryable : false;
}

/** Serialize any error for storage without leaking stack internals to users. */
export function toErrorRecord(err: unknown): {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
} {
  if (isPlatformError(err)) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof Error) {
    return { code: "INTERNAL", message: err.message };
  }
  return { code: "INTERNAL", message: String(err) };
}
