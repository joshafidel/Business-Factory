import {
  type AIProvider,
  type GenerateObjectParams,
  type GenerateObjectResult,
  type GenerateTextParams,
  type GenerateTextResult,
  ProviderError,
  type StreamChunk,
  type ToolCall,
  normalizeHttpError,
} from "./types";

const API_URL = "https://api.openai.com/v1/chat/completions";

interface OpenAIChoice {
  message: {
    content: string | null;
    tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  };
  finish_reason: string;
}

/** Fetch-based OpenAI Chat Completions adapter (no SDK dependency). */
export class OpenAIProvider implements AIProvider {
  readonly key = "openai";
  readonly models = ["gpt-4o", "gpt-4o-mini"];

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("OpenAIProvider requires an API key");
  }

  private async request(
    body: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<{
    choices: OpenAIChoice[];
    usage: { prompt_tokens: number; completion_tokens: number };
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? 120_000);
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new ProviderError("PROVIDER_TIMEOUT", "openai: request timed out", {
          retryable: true,
        });
      }
      throw new ProviderError("PROVIDER_ERROR", "openai: network error", {
        retryable: true,
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw normalizeHttpError("openai", res.status, await res.text());
    }
    return (await res.json()) as {
      choices: OpenAIChoice[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };
  }

  async generateText(params: GenerateTextParams): Promise<GenerateTextResult> {
    const data = await this.request(
      {
        model: params.model,
        messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stop: params.stopSequences,
        tools: params.tools?.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      },
      params.timeoutMs,
    );
    const choice = data.choices[0];
    if (!choice) {
      throw new ProviderError("PROVIDER_ERROR", "openai: empty choices", { retryable: true });
    }
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: safeParse(c.function.arguments),
    }));
    return {
      text: choice.message.content ?? "",
      toolCalls,
      usage: { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens },
      stopReason:
        choice.finish_reason === "tool_calls"
          ? "tool_call"
          : choice.finish_reason === "length"
            ? "max_tokens"
            : "end",
      raw: data,
    };
  }

  async generateObject(params: GenerateObjectParams): Promise<GenerateObjectResult> {
    const data = await this.request(
      {
        model: params.model,
        messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: params.schemaName ?? "result",
            schema: params.schema,
            strict: false,
          },
        },
      },
      params.timeoutMs,
    );
    const choice = data.choices[0];
    if (!choice?.message.content) {
      throw new ProviderError("PROVIDER_ERROR", "openai: no structured output returned", {
        retryable: true,
      });
    }
    return {
      object: safeParse(choice.message.content),
      usage: { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens },
      raw: data,
    };
  }

  async *streamText(params: GenerateTextParams): AsyncIterable<StreamChunk> {
    const result = await this.generateText(params);
    yield { type: "text", delta: result.text };
    yield { type: "usage", usage: result.usage };
    yield { type: "done" };
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    throw new ProviderError("PROVIDER_ERROR", "openai: invalid JSON in response", {
      retryable: true,
      details: { snippet: s.slice(0, 200) },
    });
  }
}
