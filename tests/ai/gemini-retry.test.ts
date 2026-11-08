import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GeminiProvider,
  GeminiProviderError,
  GeminiAuthenticationError,
  GeminiAbortError,
  RateLimitPauseError,
  parseRetryDelay,
  classifyGeminiError,
  sleepWithSignal,
} from '../../src/ai/gemini.js';
import type { IAIModelProvider, AIRequest, AIResponse } from '../../src/ai/provider.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';
import { ExecutionModeController } from '../../src/bot/execution-mode.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

// Mock the GoogleGenAI client
const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
      };
      constructor(_opts?: unknown) {}
    },
  };
});

describe('Gemini Rate-Limit Throttling & Adaptive Backoff (NT-01, NT-05, NT-06, FR-322, FR-323)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseRetryDelay (Pure Function)', () => {
    it('should parse retryDelay from Google errorDetails array', () => {
      const errWithDetails = {
        message: 'Resource exhausted',
        errorDetails: [
          {
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: '39.6135s',
          },
        ],
      };

      const delay = parseRetryDelay(errWithDetails);
      expect(delay).toBe(39.6135);
    });

    it('should parse retryDelay without suffix s', () => {
      const err = {
        errorDetails: [{ retryDelay: '42' }],
      };
      expect(parseRetryDelay(err)).toBe(42);
    });

    it('should parse retry delay from error message text', () => {
      const err = new Error('Quota exceeded for model gemini-2.5-flash: please retry in 40s');
      expect(parseRetryDelay(err)).toBe(40);
    });

    it('should return null when no retry information is present', () => {
      const err = new Error('Generic 429 without RetryInfo');
      expect(parseRetryDelay(err)).toBeNull();
    });
  });

  describe('classifyGeminiError', () => {
    it('should classify 401/403/API_KEY_INVALID as permanent AUTH failure', () => {
      const err1 = { status: 401, message: 'Request had invalid authentication credentials' };
      const c1 = classifyGeminiError(err1);
      expect(c1.category).toBe('AUTH');
      expect(c1.isRetryable).toBe(false);

      const err2 = new Error('API_KEY_INVALID: The provided API key is invalid.');
      const c2 = classifyGeminiError(err2);
      expect(c2.category).toBe('AUTH');
      expect(c2.isRetryable).toBe(false);

      const err3 = { status: 403, message: 'PERMISSION_DENIED' };
      const c3 = classifyGeminiError(err3);
      expect(c3.category).toBe('AUTH');
      expect(c3.isRetryable).toBe(false);
    });

    it('should classify 400/INVALID_ARGUMENT as permanent CLIENT error', () => {
      const err = { status: 400, message: 'INVALID_ARGUMENT: contents cannot be empty' };
      const c = classifyGeminiError(err);
      expect(c.category).toBe('CLIENT');
      expect(c.isRetryable).toBe(false);
    });

    it('should classify 429/RESOURCE_EXHAUSTED as retryable RATE_LIMIT', () => {
      const err = {
        status: 429,
        message: 'RESOURCE_EXHAUSTED',
        errorDetails: [{ retryDelay: '39s' }],
      };
      const c = classifyGeminiError(err);
      expect(c.category).toBe('RATE_LIMIT');
      expect(c.isRetryable).toBe(true);
      expect(c.serverDelay).toBe(39);
    });

    it('should classify 503 and network timeouts as retryable TRANSIENT errors', () => {
      const err503 = { status: 503, message: 'The model is overloaded. Please try again later.' };
      const c503 = classifyGeminiError(err503);
      expect(c503.category).toBe('TRANSIENT');
      expect(c503.isRetryable).toBe(true);

      const errTimeout = new Error('connect ETIMEDOUT 142.250.186.42:443');
      const cTimeout = classifyGeminiError(errTimeout);
      expect(cTimeout.category).toBe('TRANSIENT');
      expect(cTimeout.isRetryable).toBe(true);
    });

    it('should classify cancellation errors as CANCELLED', () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      const c = classifyGeminiError(abortErr);
      expect(c.category).toBe('CANCELLED');
      expect(c.isRetryable).toBe(false);
    });
  });

  describe('sleepWithSignal', () => {
    it('should resolve normally when not aborted', async () => {
      await expect(sleepWithSignal(10)).resolves.toBeUndefined();
    });

    it('should reject immediately if signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(sleepWithSignal(1000, controller.signal)).rejects.toThrow(GeminiAbortError);
    });

    it('should interrupt sleep immediately when signal fires during sleep', async () => {
      const controller = new AbortController();
      const start = Date.now();
      const promise = sleepWithSignal(5000, controller.signal);

      setTimeout(() => {
        controller.abort();
      }, 20);

      await expect(promise).rejects.toThrow(GeminiAbortError);
      expect(Date.now() - start).toBeLessThan(1000);
    });
  });

  describe('RateLimitPauseError & RetryInfo Handling in GeminiProvider', () => {
    it('should immediately throw RateLimitPauseError with full delay when server specifies RetryInfo 39 seconds', async () => {
      const serverErr = {
        message: '429 RESOURCE_EXHAUSTED: Rate limit reached',
        errorDetails: [
          {
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: '39s',
          },
        ],
      };
      mockGenerateContent.mockRejectedValueOnce(serverErr);

      const provider = new GeminiProvider({
        apiKey: 'test-key-12345',
      });

      try {
        await provider.generateResponse({
          messages: [{ role: 'user', content: 'test 39s retry delay' }],
        });
        expect.unreachable('Should have thrown RateLimitPauseError');
      } catch (e: any) {
        expect(e).toBeInstanceOf(RateLimitPauseError);
        expect(e.retryDelaySeconds).toBe(39);
        expect(e.message).toContain('39s');
      }
    });

    it('should immediately throw RateLimitPauseError when server specifies delay > 5s', async () => {
      const serverErr = {
        message: '429 RESOURCE_EXHAUSTED: Rate limit reached',
        errorDetails: [{ retryDelay: '39.6s' }],
      };
      mockGenerateContent.mockRejectedValueOnce(serverErr);

      const provider = new GeminiProvider({
        apiKey: 'test-key-12345',
      });

      await expect(
        provider.generateResponse({
          messages: [{ role: 'user', content: 'test 429' }],
        })
      ).rejects.toThrow(RateLimitPauseError);

      try {
        mockGenerateContent.mockRejectedValueOnce(serverErr);
        await provider.generateResponse({
          messages: [{ role: 'user', content: 'test 429' }],
        });
      } catch (e: any) {
        expect(e).toBeInstanceOf(RateLimitPauseError);
        expect(e.retryDelaySeconds).toBe(39.6);
        expect(e.message).toContain('39.6s');
      }
    });
  });

  describe('Error Classification & Retry Execution in GeminiProvider', () => {
    it('should fail fast on permanent authentication failure without retrying (1 call)', async () => {
      const authErr = {
        status: 401,
        message: 'API_KEY_INVALID: API key not valid. Please pass a valid API key.',
      };
      mockGenerateContent.mockRejectedValueOnce(authErr);

      const provider = new GeminiProvider({
        apiKey: 'invalid-key',
        maxRetries: 3,
      });

      await expect(
        provider.generateResponse({
          messages: [{ role: 'user', content: 'test auth failure' }],
        })
      ).rejects.toThrow(GeminiAuthenticationError);

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('should fail fast on permanent client error (400) without retrying (1 call)', async () => {
      const clientErr = {
        status: 400,
        message: 'INVALID_ARGUMENT: Request payload is malformed.',
      };
      mockGenerateContent.mockRejectedValueOnce(clientErr);

      const provider = new GeminiProvider({
        apiKey: 'valid-key',
        maxRetries: 3,
      });

      await expect(
        provider.generateResponse({
          messages: [{ role: 'user', content: 'test client error' }],
        })
      ).rejects.toThrow(GeminiProviderError);

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient 503 error and succeed on second attempt', async () => {
      const err503 = {
        status: 503,
        message: 'The model is overloaded. Please try again later.',
      };
      mockGenerateContent.mockRejectedValueOnce(err503);
      mockGenerateContent.mockResolvedValueOnce({
        text: 'Success after retry',
        functionCalls: undefined,
      });

      const provider = new GeminiProvider({
        apiKey: 'test-key',
        maxRetries: 3,
        initialRetryDelayMs: 10,
        maxRetryDelayMs: 50,
      });

      const res = await provider.generateResponse({
        messages: [{ role: 'user', content: 'retry test' }],
      });

      expect(res.text).toBe('Success after retry');
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it('should retry on transient network timeout and succeed on second attempt', async () => {
      const timeoutErr = new Error('request failed: ETIMEDOUT');
      mockGenerateContent.mockRejectedValueOnce(timeoutErr);
      mockGenerateContent.mockResolvedValueOnce({
        text: 'Success after timeout retry',
        functionCalls: undefined,
      });

      const provider = new GeminiProvider({
        apiKey: 'test-key',
        maxRetries: 3,
        initialRetryDelayMs: 10,
        maxRetryDelayMs: 50,
      });

      const res = await provider.generateResponse({
        messages: [{ role: 'user', content: 'timeout test' }],
      });

      expect(res.text).toBe('Success after timeout retry');
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it('should throw GeminiProviderError on retry exhaustion after maxRetries', async () => {
      const err503 = {
        status: 503,
        message: '503 Service Unavailable',
      };
      mockGenerateContent.mockRejectedValue(err503);

      const provider = new GeminiProvider({
        apiKey: 'test-key',
        maxRetries: 3,
        initialRetryDelayMs: 5,
        maxRetryDelayMs: 15,
      });

      await expect(
        provider.generateResponse({
          messages: [{ role: 'user', content: 'exhaustion test' }],
        })
      ).rejects.toThrow(/Failed after 3 attempts/);

      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    });

    it('should abort immediately when cancellation signal is triggered before request', async () => {
      const controller = new AbortController();
      controller.abort();

      const provider = new GeminiProvider({
        apiKey: 'test-key',
      });

      await expect(
        provider.generateResponse({
          messages: [{ role: 'user', content: 'cancelled test' }],
          signal: controller.signal,
        })
      ).rejects.toThrow(GeminiAbortError);

      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('should abort immediately when cancellation signal is triggered during retry backoff', async () => {
      const controller = new AbortController();
      mockGenerateContent.mockRejectedValueOnce(new Error('503 Service Unavailable'));

      const provider = new GeminiProvider({
        apiKey: 'test-key',
        initialRetryDelayMs: 2000, // Long delay
        maxRetries: 3,
      });

      setTimeout(() => {
        controller.abort();
      }, 30);

      const start = Date.now();
      await expect(
        provider.generateResponse({
          messages: [{ role: 'user', content: 'abort during backoff' }],
          signal: controller.signal,
        })
      ).rejects.toThrow(GeminiAbortError);

      expect(Date.now() - start).toBeLessThan(500);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('should throw deadline exceeded error when totalTimeoutMs is reached', async () => {
      mockGenerateContent.mockRejectedValue(new Error('503 Service Unavailable'));

      const provider = new GeminiProvider({
        apiKey: 'test-key',
        maxRetries: 5,
        initialRetryDelayMs: 100,
        totalTimeoutMs: 50, // Very short overall deadline
      });

      await expect(
        provider.generateResponse({
          messages: [{ role: 'user', content: 'deadline test' }],
        })
      ).rejects.toThrow(/Total retry deadline \(50ms\) exceeded/);
    });
  });

  describe('AutonomousAgentLoop Adaptive Rate Limit Latch', () => {
    let workspaceRoot: string;
    let storage: FilesystemSessionStorage;
    let botService: BotService;
    let messagingService: MessagingService;
    const sessionId = 'SES_RATELIMIT_01';

    beforeEach(async () => {
      workspaceRoot = path.join(
        os.tmpdir(),
        `almudaya_ratelimit_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
      );
      storage = new FilesystemSessionStorage(workspaceRoot);
      const sessionService = new SessionService(storage);
      botService = new BotService(storage);
      messagingService = new MessagingService(storage, botService);

      await sessionService.createSession({ sessionId, sessionName: 'Rate limit test' });
      await botService.registerBot(sessionId, {
        botId: 'B001',
        displayName: 'Coder',
        status: 'active',
      });
    });

    afterEach(async () => {
      try {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
    });

    it('should catch RateLimitPauseError, notify onStatus, wait adaptively, and retry without losing turn', async () => {
      let callCount = 0;
      const statusNotifications: string[] = [];

      // Mock provider that throws RateLimitPauseError on first call and succeeds on second call
      const throttledProvider: IAIModelProvider = {
        providerId: 'throttled-ai',
        modelName: 'throttled-flash',
        generateResponse: async (_req: AIRequest): Promise<AIResponse> => {
          callCount++;
          if (callCount === 1) {
            // Server asks to wait 0.2 seconds (fast test duration)
            throw new RateLimitPauseError('Resource exhausted', 0.2);
          }
          return { text: 'Turn completed after adaptive pause.' };
        },
      };

      const agentLoop = new AutonomousAgentLoop({
        sessionId,
        botId: 'B001',
        storage,
        provider: throttledProvider,
        executionModeController: new ExecutionModeController('TURBO'),
        botService,
        messagingService,
        onStatus: (msg) => {
          statusNotifications.push(msg);
        },
      });

      const reply = await agentLoop.handleMessage({
        message_id: 'msg_test_01',
        session_id: sessionId,
        sender_bot_id: 'OPERATOR',
        recipient_bot_id: 'B001',
        timestamp: new Date().toISOString(),
        message_type: 'TASK',
        content: 'Solve problem',
        status: 'unread',
        metadata: {},
      });

      expect(callCount).toBe(2);
      expect(statusNotifications).toHaveLength(1);
      expect(statusNotifications[0]).toContain('⏳ Kuota Gemini tercapai (429 RESOURCE_EXHAUSTED)');
      expect(statusNotifications[0]).toContain('Menunggu jeda 1 detik sebelum mencoba kembali');
      expect(reply).toBe('Turn completed after adaptive pause.');
    });
  });
});
