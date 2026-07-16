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
  /** Cheap auth check. Throws LlmConfigError on a rejected key; resolves otherwise. */
  verify(): Promise<void>;
}

export interface LlmClientConfig {
  provider: 'openai' | 'anthropic' | 'none';
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * A user-facing configuration problem (bad/missing API key, wrong provider).
 * Its message is safe and friendly — never a raw 401 body — and is shown to
 * the customer as a configuration error.
 */
export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmConfigError';
  }
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

const HOSTED_HOSTS = ['api.openai.com', 'api.anthropic.com'];

/** Map an auth failure to a friendly, safe message; return null if not an auth error. */
function toConfigError(error: unknown, config: LlmClientConfig): LlmConfigError | null {
  if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
    return new LlmConfigError(
      `AI analysis is misconfigured: the ${config.provider} API rejected the API key ` +
        `(HTTP ${error.status}). Check LLM_API_KEY and LLM_PROVIDER in your .env.` +
        providerMismatchHint(config),
    );
  }
  return null;
}

function providerMismatchHint(config: LlmClientConfig): string {
  const key = config.apiKey.trim();
  if (config.provider === 'openai' && key.startsWith('sk-ant-')) {
    return ' The key looks like an Anthropic key (sk-ant-…) — set LLM_PROVIDER=anthropic.';
  }
  if (config.provider === 'anthropic' && key.startsWith('sk-') && !key.startsWith('sk-ant-')) {
    return ' The key looks like an OpenAI key (sk-…) — set LLM_PROVIDER=openai.';
  }
  return '';
}

/**
 * Static, no-network checks that catch the most common misconfigurations
 * before we spend a scrape. Returns a friendly error or null.
 */
export function preflightLlmConfig(config: LlmClientConfig): LlmConfigError | null {
  if (config.provider === 'none') return null;
  const key = config.apiKey.trim();
  const isHosted = HOSTED_HOSTS.some((host) => config.baseUrl.includes(host));
  if (!key && isHosted) {
    return new LlmConfigError(
      `AI analysis is enabled (LLM_PROVIDER=${config.provider}) but no API key is set. ` +
        'Add LLM_API_KEY to your .env, or set LLM_PROVIDER=none to run without AI narrative.',
    );
  }
  const mismatch = providerMismatchHint(config).trim();
  if (mismatch) return new LlmConfigError(`AI analysis is misconfigured.${providerMismatchHint(config)}`);
  return null;
}

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

  async verify(): Promise<void> {
    await verifyAuth(() => this.complete({ system: 'Health check.', user: 'Reply with OK.', maxTokens: 5 }), this.config);
  }
}

/**
 * Run a minimal completion to confirm the key is accepted. Converts a 401/403
 * into a friendly LlmConfigError; other (transient/network) errors during the
 * probe are logged but not fatal — the real analysis will surface them.
 */
async function verifyAuth(probe: () => Promise<string>, config: LlmClientConfig): Promise<void> {
  try {
    await probe();
  } catch (error) {
    const configError = toConfigError(error, config);
    if (configError) throw configError;
    log.warn(`LLM auth probe did not complete (non-auth): ${String(error).slice(0, 160)}`);
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

  async verify(): Promise<void> {
    await verifyAuth(() => this.complete({ system: 'Health check.', user: 'Reply with OK.', maxTokens: 5 }), this.config);
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
