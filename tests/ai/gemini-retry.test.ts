import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GeminiProvider,
  RateLimitPauseError,
  parseRetryDelay
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

describe('Gemini Rate-Limit Throttling & Adaptive Backoff (NT-05, NT-06, FR-322, FR-323)', () => {
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
            retryDelay: '39.6135s'
          }
        ]
      };

      const delay = parseRetryDelay(errWithDetails);
      expect(delay).toBe(39.6135);
    });

    it('should parse retryDelay without suffix s', () => {
      const err = {
        errorDetails: [{ retryDelay: '42' }]
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

  describe('RateLimitPauseError Generation in GeminiProvider', () => {
    it('should immediately throw RateLimitPauseError when server specifies delay > 5s', async () => {
      const serverErr = {
        message: '429 RESOURCE_EXHAUSTED: Rate limit reached',
        errorDetails: [{ retryDelay: '39.6s' }]
      };
      mockGenerateContent.mockRejectedValueOnce(serverErr);

      const provider = new GeminiProvider({
        apiKey: 'test-key-12345'
      });

      await expect(
        provider.generateResponse({
          messages: [{ role: 'user', content: 'test 429' }]
        })
      ).rejects.toThrow(RateLimitPauseError);

      try {
        mockGenerateContent.mockRejectedValueOnce(serverErr);
        await provider.generateResponse({
          messages: [{ role: 'user', content: 'test 429' }]
        });
      } catch (e: any) {
        expect(e).toBeInstanceOf(RateLimitPauseError);
        expect(e.retryDelaySeconds).toBe(39.6);
        expect(e.message).toContain('39.6s');
      }
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
        status: 'active'
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
        }
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
        }
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
        metadata: {}
      });

      expect(callCount).toBe(2);
      expect(statusNotifications).toHaveLength(1);
      expect(statusNotifications[0]).toContain('⏳ Kuota Gemini tercapai (429 RESOURCE_EXHAUSTED)');
      expect(statusNotifications[0]).toContain('Menunggu jeda 1 detik sebelum mencoba kembali');
      expect(reply).toBe('Turn completed after adaptive pause.');
    });
  });
});
