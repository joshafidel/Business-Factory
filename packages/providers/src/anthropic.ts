import {
  type AIProvider,
  type ChatMessage,
  type GenerateObjectParams,
  type GenerateObjectResult,
  type GenerateTextParams,
  type GenerateTextResult,
  ProviderError,
  type StreamChunk,
  type ToolCall,
  normalizeHttpError,
} from "./types";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * Direct fetch-based Anthropic Messages API adapter (no SDK dependency).
 * Only constructed server-side; the key never reaches the browser.
 */
export class AnthropicProvider implements AIProvider {
  readonly key = "anthropic";
  readonly models = ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1"];

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("AnthropicProvider requires an API key");
  }

  private split(messages: ChatMessage[]): {
    system: string | undefined;
    rest: { role: "user" | "assistant"; content: string }[];
  } {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const rest = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: m.content,
      }));
    return { system: system || undefined, rest };
  }

  private async request(body: Record<string, unknown>, timeoutMs?: number): Promise<{
    content: AnthropicContentBlock[];
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? 120_000);
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new ProviderError("PROVIDER_TIMEOUT", "anthropic: request timed out", {
          retryable: true,
        });
      }
      throw new ProviderError("PROVIDER_ERROR", "anthropic: network error", {
        retryable: true,
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw normalizeHttpError("anthropic", res.status, await res.text());
    }
    return (await res.json()) as {
      content: AnthropicContentBlock[];
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };
  }

  async generateText(params: GenerateTextParams): Promise<GenerateTextResult> {
    const { system, rest } = this.split(params.messages);
    const data = await this.request(
      {
        model: params.model,
        system,
        messages: rest,
        max_tokens: params.maxTokens ?? 4096,
        temperature: params.temperature,
        stop_sequences: params.stopSequences,
        tools: params.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      },
      params.timeoutMs,
    );
    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const toolCalls: ToolCall[] = data.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id ?? "", name: b.name ?? "", arguments: b.input ?? {} }));
    return {
      text,
      toolCalls,
      usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
      stopReason:
        data.stop_reason === "tool_use"
          ? "tool_call"
          : data.stop_reason === "max_tokens"
            ? "max_tokens"
            : "end",
      raw: data,
    };
  }

  async generateObject(params: GenerateObjectParams): Promise<GenerateObjectResult> {
    // Structured output via a forced tool call whose input schema is the target schema.
    const { system, rest } = this.split(params.messages);
    const toolName = params.schemaName ?? "emit_result";
    const data = await this.request(
      {
        model: params.model,
        system,
        messages: rest,
        max_tokens: params.maxTokens ?? 4096,
        temperature: params.temperature,
        tools: [
          {
            name: toolName,
            description: "Emit the final structured result.",
            input_schema: params.schema,
          },
        ],
        tool_choice: { type: "tool", name: toolName },
      },
      params.timeoutMs,
    );
    const call = data.content.find((b) => b.type === "tool_use");
    if (!call) {
      throw new ProviderError("PROVIDER_ERROR", "anthropic: no structured output returned", {
        retryable: true,
      });
    }
    return {
      object: call.input ?? {},
      usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
      raw: data,
    };
  }

  async *streamText(params: GenerateTextParams): AsyncIterable<StreamChunk> {
    // Simple non-SSE fallback: emit the full result as a single chunk.
    // True incremental streaming can be added when a UI consumer needs it.
    const result = await this.generateText(params);
    yield { type: "text", delta: result.text };
    yield { type: "usage", usage: result.usage };
    yield { type: "done" };
  }
}
