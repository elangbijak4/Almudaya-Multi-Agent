import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OpenAICompatibleProvider,
  RateLimitPauseError,
  createAIProvider,
  discoverModels,
  inferProviderForModel,
} from '../../src/ai/index.js';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { BotConsole } from '../../src/bot/console.js';
import { BotRuntime } from '../../src/bot/runtime.js';
import { SessionService } from '../../src/session/service.js';

describe('OpenRouter, 9router, ModelCatalog & REPL /model Switching', () => {
  let mockServer: http.Server | undefined;
  let mockServerUrl = '';

  afterEach(async () => {
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
      mockServer = undefined;
    }
  });

  async function startMockRouter(
    handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void
  ): Promise<string> {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => handler(req, body, res));
    });

    await new Promise<void>((resolve) => {
      mockServer!.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = mockServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    mockServerUrl = `http://127.0.0.1:${port}/v1`;
    return mockServerUrl;
  }

  it('OpenAICompatibleProvider executes 9router chat/completions with tool_calls and no API key', async () => {
    const baseUrl = await startMockRouter((req, body, res) => {
      expect(req.url).toBe('/v1/chat/completions');
      const parsed = JSON.parse(body) as { model: string; tools?: unknown[] };
      expect(parsed.model).toBe('9router/deepseek-coder');
      expect(parsed.tools?.length).toBe(1);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Checking PKU first.',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'query_pku_memory',
                      arguments: JSON.stringify({ query: 'auth' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      );
    });

    const provider = new OpenAICompatibleProvider({
      providerId: '9router',
      baseUrl,
      modelName: '9router/deepseek-coder',
    });

    const response = await provider.generateResponse({
      systemPrompt: 'You are a coding bot.',
      messages: [{ role: 'user', content: 'Audit auth' }],
      tools: [
        {
          name: 'query_pku_memory',
          description: 'Query PKU',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
    });

    expect(response.text).toBe('Checking PKU first.');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls?.[0].name).toBe('query_pku_memory');
    expect(response.toolCalls?.[0].arguments).toEqual({ query: 'auth' });
    expect(response.usage?.totalTokens).toBe(15);
  });

  it('OpenAICompatibleProvider maps HTTP 429 Retry-After to RateLimitPauseError', async () => {
    const baseUrl = await startMockRouter((_req, _body, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '12' });
      res.end(JSON.stringify({ error: { message: 'Rate limited' } }));
    });

    const provider = new OpenAICompatibleProvider({
      providerId: '9router',
      baseUrl,
      modelName: 'test-model',
    });

    await expect(
      provider.generateResponse({
        messages: [{ role: 'user', content: 'Hi' }],
      })
    ).rejects.toThrow(RateLimitPauseError);
  });

  it('discovers live 9router models alongside curated OpenRouter :free and Gemini models', async () => {
    const baseUrl = await startMockRouter((req, _body, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [
              { id: '9router/free-coder', name: '9Router Free Coder' },
              { id: '9router/fast-audit', name: '9Router Fast Audit' },
            ],
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const models = await discoverModels({
      nineRouterBaseUrl: baseUrl,
      openRouterBaseUrl: 'http://127.0.0.1:1/unreachable',
      timeoutMs: 800,
    });

    expect(models.some((m) => m.provider === '9router' && m.id === '9router/free-coder' && !m.requiresApiKey)).toBe(true);
    expect(models.some((m) => m.provider === 'openrouter' && m.id.endsWith(':free'))).toBe(true);
    expect(models.some((m) => m.provider === 'gemini' && m.id === 'gemini-2.5-flash')).toBe(true);

    expect(inferProviderForModel('deepseek/deepseek-chat-v3-0324:free')).toBe('openrouter');
    expect(inferProviderForModel('gemini-2.5-pro')).toBe('gemini');
    const created = createAIProvider({ provider: '9router', modelName: '9router/free-coder', baseUrl });
    expect(created.providerId).toBe('9router');
    expect(created.modelName).toBe('9router/free-coder');
  });

  describe('BotConsole /model slash command', () => {
    let tmpDir: string;
    let storage: FilesystemSessionStorage;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-model-repl-'));
      storage = new FilesystemSessionStorage(tmpDir);
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('lists models and switches active provider on BotConsole and AutonomousAgentLoop', async () => {
      const sessionService = new SessionService(storage);
      await sessionService.createSession({ sessionId: 'S_MODEL', sessionName: 'Model Test' });

      const runtime = new BotRuntime(storage, {
        sessionId: 'S_MODEL',
        botId: 'BOT001',
        displayName: 'ModelBot',
      });
      await runtime.start();

      const initialProvider = new MockAIProvider('mock-initial', []);
      const agentLoop = new AutonomousAgentLoop({
        sessionId: 'S_MODEL',
        botId: 'BOT001',
        storage,
        provider: initialProvider,
      });

      const input = new PassThrough();
      const output = new PassThrough();
      let capturedOutput = '';
      output.on('data', (chunk) => {
        capturedOutput += chunk.toString();
      });

      const consoleInst = new BotConsole({
        runtime,
        agentLoop,
        storage,
        aiProvider: initialProvider,
        inputStream: input,
        outputStream: output,
      });

      const waitForOutput = async (needle: string) => {
        for (let i = 0; i < 40; i++) {
          if (capturedOutput.includes(needle)) return;
          await new Promise((r) => setTimeout(r, 50));
        }
      };

      await consoleInst.start();
      input.write('/model\n');
      await waitForOutput('Gunakan: /model <modelId>');
      expect(capturedOutput).toContain('Daftar Model Tersedia');
      expect(capturedOutput).toMatch(/deepseek\/deepseek-chat-v3-0324:free|\[9router\]/);

      input.write('/model qwen/qwen3-coder:free openrouter\n');
      await waitForOutput('openrouter:qwen/qwen3-coder:free');
      expect(capturedOutput).toContain('openrouter:qwen/qwen3-coder:free');
      expect(agentLoop.getProvider().providerId).toBe('openrouter');
      expect(agentLoop.getProvider().modelName).toBe('qwen/qwen3-coder:free');

      input.end();
      await consoleInst.stop();
      await runtime.stop();
    });
  });

  it('OpenAICompatibleProvider handles JSON with trailing data: [DONE] and SSE delta chunks', async () => {
    const baseUrlTrailing = await startMockRouter((_req, body, res) => {
      const parsed = JSON.parse(body) as { stream?: boolean };
      expect(parsed.stream).toBe(false);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'OK from mycombo',
              },
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        }) + '\n\ndata: [DONE]\n\n'
      );
    });

    const providerTrailing = new OpenAICompatibleProvider({
      providerId: '9router',
      baseUrl: baseUrlTrailing,
      modelName: 'mycombo',
    });

    const resTrailing = await providerTrailing.generateResponse({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(resTrailing.text).toBe('OK from mycombo');
    expect(resTrailing.usage?.totalTokens).toBe(12);

    await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
    mockServer = undefined;

    const baseUrlSse = await startMockRouter((_req, _body, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        [
          'data: {"choices":[{"delta":{"content":"Hello "}}]}',
          'data: {"choices":[{"delta":{"content":"world","tool_calls":[{"index":0,"id":"call_sse","function":{"name":"query_pku_memory","arguments":"{\\"query\\":"}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"auth\\"}"}}]}}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}',
          'data: [DONE]',
          '',
        ].join('\n\n')
      );
    });

    const providerSse = new OpenAICompatibleProvider({
      providerId: '9router',
      baseUrl: baseUrlSse,
      modelName: 'mycombo',
    });

    const resSse = await providerSse.generateResponse({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(resSse.text).toBe('Hello world');
    expect(resSse.toolCalls).toEqual([
      { id: 'call_sse', name: 'query_pku_memory', arguments: { query: 'auth' } },
    ]);
    expect(resSse.usage?.totalTokens).toBe(8);
  });
});
