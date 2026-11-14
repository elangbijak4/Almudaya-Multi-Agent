import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OpenAICompatibleProvider,
  RateLimitPauseError,
  classifyHardwareTier,
  createAIProvider,
  detectHardwareProfile,
  discoverModels,
  inferProviderForModel,
  pullOllamaModel,
  recommendModelsForHardware,
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
    expect(inferProviderForModel('meta/llama-3.3-70b-instruct')).toBe('nvidia');
    expect(inferProviderForModel('nvidia/llama-3.1-nemotron-ultra-253b-v1')).toBe('nvidia');
    const created = createAIProvider({ provider: '9router', modelName: '9router/free-coder', baseUrl });
    expect(created.providerId).toBe('9router');
    expect(created.modelName).toBe('9router/free-coder');
  });

  it('OpenAICompatibleProvider supports direct NVIDIA NIM chat/completions with Bearer auth and errors when key is missing', async () => {
    const prevNvidiaKey = process.env['NVIDIA_API_KEY'];
    delete process.env['NVIDIA_API_KEY'];
    try {
      const noKeyProvider = new OpenAICompatibleProvider({
        providerId: 'nvidia',
        modelName: 'meta/llama-3.3-70b-instruct',
      });
      await expect(
        noKeyProvider.generateResponse({
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow(/NVIDIA API key is missing/);
    } finally {
      if (prevNvidiaKey !== undefined) {
        process.env['NVIDIA_API_KEY'] = prevNvidiaKey;
      }
    }

    const baseUrl = await startMockRouter((req, body, res) => {
      expect(req.url).toBe('/v1/chat/completions');
      expect(req.headers['authorization']).toBe('Bearer nvapi-test-direct-key-12345');
      const parsed = JSON.parse(body) as { model: string };
      expect(parsed.model).toBe('meta/llama-3.3-70b-instruct');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: 'Direct NVIDIA reply' } }],
          usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
        })
      );
    });

    const provider = createAIProvider({
      provider: 'nvidia',
      modelName: 'meta/llama-3.3-70b-instruct',
      apiKey: 'nvapi-test-direct-key-12345',
      baseUrl,
    });

    try {
      const response = await provider.generateResponse({
        messages: [{ role: 'user', content: 'Hello NVIDIA' }],
      });
      expect(response.text).toBe('Direct NVIDIA reply');
      expect(response.usage?.totalTokens).toBe(7);
    } finally {
      provider.dispose?.();
    }
  });

  it('discovers live NVIDIA NIM models with Authorization header and merges built-in catalog', async () => {
    const baseUrl = await startMockRouter((req, _body, res) => {
      if (req.url === '/v1/models') {
        expect(req.headers['authorization']).toBe('Bearer nvapi-live-list-key-99999');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [
              { id: 'nvidia/nemotron-4-340b-instruct' },
              { id: 'meta/llama-3.3-70b-instruct' },
            ],
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const models = await discoverModels({
      provider: 'nvidia',
      nvidiaBaseUrl: baseUrl,
      nvidiaApiKey: 'nvapi-live-list-key-99999',
      timeoutMs: 1000,
    });

    expect(models.every((m) => m.provider === 'nvidia')).toBe(true);
    expect(models.some((m) => m.id === 'nvidia/nemotron-4-340b-instruct')).toBe(true);
    expect(models.filter((m) => m.id === 'meta/llama-3.3-70b-instruct')).toHaveLength(1);
    expect(models.some((m) => m.id === 'deepseek-ai/deepseek-r1')).toBe(true);
  });

  it('supports Ollama local provider chat/completions, /api/tags & /v1/models discovery, and model inference', async () => {
    const baseUrl = await startMockRouter((req, body, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [
              { id: 'qwen2.5-coder:7b' },
              { id: 'llama3.2:3b' },
            ],
          })
        );
        return;
      }
      if (req.url === '/v1/chat/completions') {
        const parsed = JSON.parse(body) as { model: string };
        expect(parsed.model).toBe('qwen2.5-coder:7b');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: 'Local Ollama response' } }],
            usage: { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 },
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const models = await discoverModels({
      provider: 'ollama',
      ollamaBaseUrl: baseUrl,
      timeoutMs: 1000,
    });
    expect(models.every((m) => m.provider === 'ollama' && !m.requiresApiKey)).toBe(true);
    expect(models.some((m) => m.id === 'qwen2.5-coder:7b')).toBe(true);
    expect(models.some((m) => m.id === 'llama3.2:3b')).toBe(true);
    expect(inferProviderForModel('qwen2.5-coder:7b')).toBe('ollama');
    expect(inferProviderForModel('ollama/llama3.2')).toBe('ollama');

    const provider = createAIProvider({
      provider: 'ollama',
      modelName: 'qwen2.5-coder:7b',
      baseUrl,
    });
    const reply = await provider.generateResponse({
      messages: [{ role: 'user', content: 'Hi local Ollama' }],
    });
    expect(reply.text).toBe('Local Ollama response');
    expect(reply.usage?.totalTokens).toBe(10);
  });

  it('classifies hardware tiers and recommends matching local Ollama & free cloud models across low/medium/high/workstation specs', async () => {
    expect(classifyHardwareTier(4, 0)).toBe('low');
    expect(classifyHardwareTier(8, 0)).toBe('medium');
    expect(classifyHardwareTier(16, 8)).toBe('high');
    expect(classifyHardwareTier(64, 24)).toBe('workstation');

    const baseUrl = await startMockRouter((req, _body, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }));
        return;
      }
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'qwen2.5-coder:7b' }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const lowProfile = await detectHardwareProfile({
      ollamaBaseUrl: 'http://127.0.0.1:1/unreachable',
      skipSystemProbe: true,
      overrideRamGB: 4,
      overrideVramGB: 0,
      timeoutMs: 300,
    });
    expect(lowProfile.tier).toBe('low');
    const lowReport = await recommendModelsForHardware(lowProfile, {
      includeOnlineFree: false,
    });
    expect(lowReport.bestLocalModel?.modelId).toBe('qwen2.5-coder:1.5b');
    expect(
      lowReport.recommendedLocalModels.find((m) => m.modelId === 'qwen2.5-coder:32b')?.fitStatus
    ).toBe('too_heavy');
    expect(lowReport.onlineFreeModels.some((m) => m.provider === 'openrouter')).toBe(true);
    expect(lowReport.onlineFreeModels.some((m) => m.provider === 'nvidia')).toBe(true);

    const medProfile = await detectHardwareProfile({
      ollamaBaseUrl: baseUrl,
      skipSystemProbe: true,
      overrideRamGB: 16,
      overrideVramGB: 6,
      timeoutMs: 500,
    });
    expect(medProfile.ollamaRunning).toBe(true);
    expect(medProfile.installedOllamaModels).toContain('qwen2.5-coder:7b');
    const medReport = await recommendModelsForHardware(medProfile, { includeOnlineFree: false });
    const sevenB = medReport.recommendedLocalModels.find((m) => m.modelId === 'qwen2.5-coder:7b');
    expect(sevenB?.fitStatus).toBe('optimal');
    expect(sevenB?.installed).toBe(true);

    const highProfile = await detectHardwareProfile({
      ollamaBaseUrl: baseUrl,
      skipSystemProbe: true,
      overrideRamGB: 16,
      overrideVramGB: 10,
      timeoutMs: 500,
    });
    expect(highProfile.tier).toBe('high');
    const highReport = await recommendModelsForHardware(highProfile, { includeOnlineFree: false });
    expect(highReport.bestLocalModel?.modelId).toBe('qwen2.5-coder:14b');

    const wsProfile = await detectHardwareProfile({
      ollamaBaseUrl: baseUrl,
      skipSystemProbe: true,
      overrideRamGB: 64,
      overrideVramGB: 24,
      timeoutMs: 500,
    });
    expect(wsProfile.tier).toBe('workstation');
    const wsReport = await recommendModelsForHardware(wsProfile, { includeOnlineFree: false });
    expect(wsReport.bestLocalModel?.modelId).toBe('qwen2.5-coder:32b');
  });

  it('pulls an Ollama model via streaming /api/pull NDJSON chunks and reports progress', async () => {
    const baseUrl = await startMockRouter((req, body, res) => {
      if (req.url === '/api/pull') {
        const parsed = JSON.parse(body) as { name: string; stream: boolean };
        expect(parsed.name).toBe('qwen2.5-coder:7b');
        expect(parsed.stream).toBe(true);

        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
        res.write(
          JSON.stringify({ status: 'downloading', completed: 512 * 1024, total: 1024 * 1024 }) + '\n'
        );
        res.end(JSON.stringify({ status: 'success' }) + '\n');
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const progressEvents: Array<{ status: string; completed?: number; total?: number }> = [];
    const result = await pullOllamaModel('qwen2.5-coder:7b', {
      ollamaBaseUrl: baseUrl,
      onProgress: (status, completed, total) => {
        progressEvents.push({ status, completed, total });
      },
    });

    expect(result.success).toBe(true);
    expect(result.modelId).toBe('qwen2.5-coder:7b');
    expect(result.status).toBe('success');
    expect(progressEvents.map((e) => e.status)).toEqual([
      'pulling manifest',
      'downloading',
      'success',
    ]);
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
        for (let i = 0; i < 100; i++) {
          if (capturedOutput.includes(needle)) return;
          await new Promise((r) => setTimeout(r, 50));
        }
      };

      const prevOllamaUrl = process.env['OLLAMA_BASE_URL'];
      const prevOpenRouterUrl = process.env['OPENROUTER_BASE_URL'];
      const ollamaMockUrl = await startMockRouter((req, _body, res) => {
        if (req.url === '/api/tags') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }));
          return;
        }
        if (req.url === '/v1/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'qwen2.5-coder:7b' }] }));
          return;
        }
        if (req.url === '/api/pull') {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
          res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
          res.end(JSON.stringify({ status: 'success' }) + '\n');
          return;
        }
        res.writeHead(404);
        res.end();
      });
      process.env['OLLAMA_BASE_URL'] = ollamaMockUrl;
      process.env['OPENROUTER_BASE_URL'] = 'http://127.0.0.1:1/unreachable';

      try {
        await consoleInst.start();
        input.write('/model\n');
        await waitForOutput('Gunakan: /model <modelId>');
        expect(capturedOutput).toContain('Daftar Model Tersedia');
        expect(capturedOutput).toMatch(/deepseek\/deepseek-chat-v3-0324:free|\[9router\]|\[ollama\]/);

        input.write('/model qwen/qwen3-coder:free openrouter\n');
        await waitForOutput('openrouter:qwen/qwen3-coder:free');
        expect(capturedOutput).toContain('openrouter:qwen/qwen3-coder:free');
        expect(agentLoop.getProvider().providerId).toBe('openrouter');
        expect(agentLoop.getProvider().modelName).toBe('qwen/qwen3-coder:free');

        input.write('/model meta/llama-3.3-70b-instruct nvidia\n');
        await waitForOutput('nvidia:meta/llama-3.3-70b-instruct');
        expect(capturedOutput).toContain('nvidia:meta/llama-3.3-70b-instruct');
        expect(agentLoop.getProvider().providerId).toBe('nvidia');
        expect(agentLoop.getProvider().modelName).toBe('meta/llama-3.3-70b-instruct');

        input.write('/model recommend\n');
        await waitForOutput('=== Hardware Spec & AI Model Advisor ===');
        expect(capturedOutput).toContain('=== Hardware Spec & AI Model Advisor ===');
        expect(capturedOutput).toContain('Rekomendasi Model Lokal (Ollama):');

        input.write('/model pull qwen2.5-coder:7b\n');
        await waitForOutput('Model "qwen2.5-coder:7b" selesai diunduh');
        expect(capturedOutput).toContain('Model "qwen2.5-coder:7b" selesai diunduh');

        input.write('/model qwen2.5-coder:7b ollama\n');
        await waitForOutput('ollama:qwen2.5-coder:7b');
        expect(capturedOutput).toContain('ollama:qwen2.5-coder:7b');
        expect(agentLoop.getProvider().providerId).toBe('ollama');
        expect(agentLoop.getProvider().modelName).toBe('qwen2.5-coder:7b');
      } finally {
        if (prevOllamaUrl === undefined) {
          delete process.env['OLLAMA_BASE_URL'];
        } else {
          process.env['OLLAMA_BASE_URL'] = prevOllamaUrl;
        }
        if (prevOpenRouterUrl === undefined) {
          delete process.env['OPENROUTER_BASE_URL'];
        } else {
          process.env['OPENROUTER_BASE_URL'] = prevOpenRouterUrl;
        }
        input.end();
        await consoleInst.stop();
        await runtime.stop();
      }
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
