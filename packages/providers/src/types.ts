import { type ErrorCode, PlatformError } from "@bf/shared";

/** Normalized message format shared by all providers. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** For role=tool: the id of the tool call being answered. */
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of parameters. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateTextParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  stopSequences?: string[];
  timeoutMs?: number;
}

export interface GenerateTextResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: "end" | "max_tokens" | "tool_call" | "stop_sequence";
  raw?: unknown;
}

export interface GenerateObjectParams extends Omit<GenerateTextParams, "tools"> {
  /** JSON Schema the output must satisfy. */
  schema: Record<string, unknown>;
  schemaName?: string;
}

export interface GenerateObjectResult {
  object: unknown;
  usage: Usage;
  raw?: unknown;
}

export type StreamChunk =
  | { type: "text"; delta: string }
  | { type: "usage"; usage: Usage }
  | { type: "done" };

/**
 * Provider-neutral AI interface. All adapters normalize errors to
 * ProviderError so retry logic is uniform.
 */
export interface AIProvider {
  readonly key: string;
  readonly models: string[];
  generateText(params: GenerateTextParams): Promise<GenerateTextResult>;
  generateObject(params: GenerateObjectParams): Promise<GenerateObjectResult>;
  streamText(params: GenerateTextParams): AsyncIterable<StreamChunk>;
}

export class ProviderError extends PlatformError {
  constructor(
    code: Extract<ErrorCode, "PROVIDER_ERROR" | "PROVIDER_RATE_LIMIT" | "PROVIDER_TIMEOUT">,
    message: string,
    opts?: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(code, message, opts);
    this.name = "ProviderError";
  }
}

/** Map an HTTP status from a provider API to a normalized error. */
export function normalizeHttpError(providerKey: string, status: number, body: string): ProviderError {
  const detail = { providerKey, status, body: body.slice(0, 500) };
  if (status === 429) {
    return new ProviderError("PROVIDER_RATE_LIMIT", `${providerKey}: rate limited`, {
      retryable: true,
      details: detail,
    });
  }
  if (status === 408 || status === 504) {
    return new ProviderError("PROVIDER_TIMEOUT", `${providerKey}: timeout`, {
      retryable: true,
      details: detail,
    });
  }
  if (status >= 500) {
    return new ProviderError("PROVIDER_ERROR", `${providerKey}: server error ${status}`, {
      retryable: true,
      details: detail,
    });
  }
  return new ProviderError("PROVIDER_ERROR", `${providerKey}: request failed (${status})`, {
    retryable: false,
    details: detail,
  });
}
