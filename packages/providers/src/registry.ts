import { loadEnv } from "@bf/config";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import { OpenAIProvider } from "./openai";
import { type AIProvider } from "./types";

/**
 * Provider registry. Real providers register only when their env key exists;
 * "mock" is always available and is the default for local development.
 * Agents select a provider by key on their AgentVersion.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();

  constructor(custom?: AIProvider[]) {
    this.register(new MockProvider());
    if (custom) {
      for (const p of custom) this.register(p);
    } else {
      const env = loadEnv();
      if (env.ANTHROPIC_API_KEY) this.register(new AnthropicProvider(env.ANTHROPIC_API_KEY));
      if (env.OPENAI_API_KEY) this.register(new OpenAIProvider(env.OPENAI_API_KEY));
    }
  }

  register(provider: AIProvider): void {
    this.providers.set(provider.key, provider);
  }

  get(key: string): AIProvider {
    const provider = this.providers.get(key);
    if (!provider) {
      throw new Error(
        `Provider "${key}" is not enabled. Available: ${[...this.providers.keys()].join(", ")}. ` +
          `Enable it by setting its API key environment variable.`,
      );
    }
    return provider;
  }

  available(): { key: string; models: string[] }[] {
    return [...this.providers.values()].map((p) => ({ key: p.key, models: p.models }));
  }
}

let cached: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
  if (!cached) cached = new ProviderRegistry();
  return cached;
}

export function resetProviderRegistry(): void {
  cached = null;
}
