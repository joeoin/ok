import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLlmClient, preflightLlmConfig, LlmConfigError } from '../src/analyzer/llm-client.js';

/** Mock server that returns a given status for /chat/completions and /v1/messages. */
function mockServer(status: number, body = '{"error":"invalid key"}'): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(status === 200 ? JSON.stringify({ choices: [{ message: { content: 'OK' } }], content: [{ type: 'text', text: 'OK' }] }) : body);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

describe('preflightLlmConfig — static, no-network checks', () => {
  it('flags a missing key on a hosted provider', () => {
    const e = preflightLlmConfig({ provider: 'openai', apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' });
    expect(e).toBeInstanceOf(LlmConfigError);
    expect(e!.message).toMatch(/no API key is set/i);
  });

  it('detects an Anthropic key used with the openai provider', () => {
    const e = preflightLlmConfig({ provider: 'openai', apiKey: 'sk-ant-abc', baseUrl: 'https://api.openai.com/v1', model: 'x' });
    expect(e).toBeInstanceOf(LlmConfigError);
    expect(e!.message).toMatch(/anthropic/i);
  });

  it('detects an OpenAI key used with the anthropic provider', () => {
    const e = preflightLlmConfig({ provider: 'anthropic', apiKey: 'sk-abc123', baseUrl: 'https://api.anthropic.com', model: 'x' });
    expect(e).toBeInstanceOf(LlmConfigError);
    expect(e!.message).toMatch(/openai/i);
  });

  it('allows an empty key for a local/custom base URL (e.g. Ollama)', () => {
    expect(preflightLlmConfig({ provider: 'openai', apiKey: '', baseUrl: 'http://localhost:11434/v1', model: 'llama3' })).toBeNull();
  });

  it('passes a well-formed hosted config', () => {
    expect(preflightLlmConfig({ provider: 'anthropic', apiKey: 'sk-ant-good', baseUrl: 'https://api.anthropic.com', model: 'claude' })).toBeNull();
    expect(preflightLlmConfig({ provider: 'none', apiKey: '', baseUrl: '', model: '' })).toBeNull();
  });
});

describe('client.verify() — never surfaces a raw 401', () => {
  it('OpenAI: maps 401 to a friendly LlmConfigError', async () => {
    const s = await mockServer(401);
    const client = createLlmClient({ provider: 'openai', apiKey: 'bad', baseUrl: `${s.url}/v1`, model: 'gpt-4o-mini' })!;
    await expect(client.verify()).rejects.toBeInstanceOf(LlmConfigError);
    await expect(client.verify()).rejects.toThrow(/rejected the API key \(HTTP 401\)/);
    await s.close();
  });

  it('Anthropic: maps 403 to a friendly LlmConfigError', async () => {
    const s = await mockServer(403);
    const client = createLlmClient({ provider: 'anthropic', apiKey: 'bad', baseUrl: s.url, model: 'claude' })!;
    await expect(client.verify()).rejects.toBeInstanceOf(LlmConfigError);
    await s.close();
  });

  it('resolves when the key is accepted', async () => {
    const s = await mockServer(200);
    const client = createLlmClient({ provider: 'openai', apiKey: 'good', baseUrl: `${s.url}/v1`, model: 'gpt-4o-mini' })!;
    await expect(client.verify()).resolves.toBeUndefined();
    await s.close();
  });

  it('does not hard-fail on a non-auth (500) blip', async () => {
    const s = await mockServer(500);
    const client = createLlmClient({ provider: 'openai', apiKey: 'good', baseUrl: `${s.url}/v1`, model: 'gpt-4o-mini' })!;
    // 500 is transient/non-auth — verify() swallows it so a blip doesn't block analysis.
    await expect(client.verify()).resolves.toBeUndefined();
    await s.close();
  }, 30_000);
});
