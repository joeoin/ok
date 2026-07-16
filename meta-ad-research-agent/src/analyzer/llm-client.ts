import { createLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

const log = createLogger('llm');

export interface LlmRequest {
  system: string;
  user: string;
  /** Hint that the reply must be a single JSON object. */
  json?: boolean;
  maxTokens?: number;
}

export interface LlmClient {
  readonly name: string;
  complete(request: LlmRequest): Promise<string>;
}

export interface LlmClientConfig {
  provider: 'openai' | 'anthropic' | 'none';
  apiKey: string;
  baseUrl: string;
  model: string;
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const isTransient = (error: unknown): boolean =>
  !(error instanceof HttpError) || error.status === 429 || error.status >= 500;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new HttpError(response.status, `LLM API ${response.status}: ${text.slice(0, 500)}`);
  }
  return response.json();
}

/**
 * Works with the OpenAI Chat Completions API and every compatible server
 * (OpenRouter, Ollama, LM Studio, vLLM, …).
 */
class OpenAiCompatibleClient implements LlmClient {
  readonly name: string;
  constructor(private readonly config: LlmClientConfig) {
    this.name = `openai-compatible(${config.model})`;
  }

  async complete(request: LlmRequest): Promise<string> {
    return withRetry(
      async () => {
        const body: Record<string, unknown> = {
          model: this.config.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          temperature: 0.2,
          max_tokens: request.maxTokens ?? 2000,
        };
        if (request.json) body['response_format'] = { type: 'json_object' };

        const data = (await postJson(
          `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`,
          this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {},
          body,
        )) as { choices?: Array<{ message?: { content?: string } }> };

        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error('LLM returned an empty completion');
        return content;
      },
      {
        attempts: 4,
        baseDelayMs: 2000,
        shouldRetry: isTransient,
        onRetry: (e, n) => log.warn(`LLM call retry ${n}: ${String(e).slice(0, 200)}`),
      },
    );
  }
}

/** Native Anthropic Messages API client. */
class AnthropicClient implements LlmClient {
  readonly name: string;
  constructor(private readonly config: LlmClientConfig) {
    this.name = `anthropic(${config.model})`;
  }

  async complete(request: LlmRequest): Promise<string> {
    return withRetry(
      async () => {
        const data = (await postJson(
          `${this.config.baseUrl.replace(/\/$/, '')}/v1/messages`,
          {
            'x-api-key': this.config.apiKey,
            'anthropic-version': '2023-06-01',
          },
          {
            model: this.config.model,
            system: request.system,
            messages: [{ role: 'user', content: request.user }],
            max_tokens: request.maxTokens ?? 2000,
            temperature: 0.2,
          },
        )) as { content?: Array<{ type: string; text?: string }> };

        const text = data.content?.find((b) => b.type === 'text')?.text;
        if (!text) throw new Error('LLM returned an empty completion');
        return text;
      },
      {
        attempts: 4,
        baseDelayMs: 2000,
        shouldRetry: isTransient,
        onRetry: (e, n) => log.warn(`LLM call retry ${n}: ${String(e).slice(0, 200)}`),
      },
    );
  }
}

/** Returns null when analysis is disabled (provider "none"). */
export function createLlmClient(config: LlmClientConfig): LlmClient | null {
  switch (config.provider) {
    case 'none':
      return null;
    case 'anthropic':
      return new AnthropicClient(config);
    case 'openai':
      return new OpenAiCompatibleClient(config);
  }
}
