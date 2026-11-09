import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { BotRuntime } from '../../src/bot/runtime.js';
import { BotService } from '../../src/bot/service.js';
import { MessagingService } from '../../src/messaging/service.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import type {
  IAIModelProvider,
  AIRequest,
  AIResponse,
} from '../../src/ai/provider.js';
import { RateLimitPauseError } from '../../src/ai/provider.js';
import type { DirectMessage } from '../../src/messaging/schema.js';

class MockCancellableProvider implements IAIModelProvider {
  public readonly providerId = 'mock_cancellable';
  public readonly modelName = 'mock-model';
  public callCount = 0;
  public disposed = false;
  public simulateRateLimit = false;
  public rateLimitDelaySeconds = 10;
  public hangMs = 0;
  public onGenerateStart?: () => void;

  public async generateResponse(request: AIRequest): Promise<AIResponse> {
    this.callCount++;
    if (this.onGenerateStart) {
      this.onGenerateStart();
    }

    if (request.signal?.aborted) {
      throw new Error('Request aborted by signal prior to inference');
    }

    if (this.simulateRateLimit) {
      this.simulateRateLimit = false; // Only throw once
      throw new RateLimitPauseError('Quota exceeded', this.rateLimitDelaySeconds);
    }

    if (this.hangMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.hangMs);
        if (request.signal) {
          request.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new Error('Request aborted mid-flight'));
            },
            { once: true }
          );
        }
      });
    }

    return {
      text: 'Mock response text',
      toolCalls: [],
    };
  }

  public dispose(): void {
    this.disposed = true;
  }
}

describe('AUD-20 (REQ-12) Cancellation Propagation & Graceful Abort Suite', () => {
  let tmpDir: string;
  let storage: FilesystemSessionStorage;
  let botService: BotService;
  let messagingService: MessagingService;

  const sessionId = 'S_CANCEL_TEST';
  const botId = 'B_CANCEL_BOT';

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `almudaya_cancel_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(tmpDir, { recursive: true });
    storage = new FilesystemSessionStorage(tmpDir);
    const sessionService = new SessionService(storage);
    await sessionService.createSession({ sessionId, sessionName: 'Cancellation Test' });
    botService = new BotService(storage);
    messagingService = new MessagingService(storage, botService);

    // Register active bot in session
    await botService.registerBot(sessionId, {
      botId,
      displayName: 'Cancel Test Bot',
      status: 'active',
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const createDummyMessage = (): DirectMessage => ({
    message_id: 'M_TEST_001',
    session_id: sessionId,
    sender_bot_id: 'B_SENDER',
    recipient_bot_id: botId,
    content: 'Process this task please',
    timestamp: new Date().toISOString(),
    status: 'delivered',
  });

  it('AUD-20: should reject immediately if passed an already-aborted signal', async () => {
    const provider = new MockCancellableProvider();
    const loop = new AutonomousAgentLoop({
      sessionId,
      botId,
      storage,
      provider,
    });

    const abortController = new AbortController();
    abortController.abort();

    await expect(
      loop.handleMessage(createDummyMessage(), abortController.signal)
    ).rejects.toThrow(/Operation aborted/);

    expect(provider.callCount).toBe(0);
  });

  it('AUD-20: should propagate AbortSignal through to provider inference', async () => {
    const provider = new MockCancellableProvider();
    provider.hangMs = 5000;

    const loop = new AutonomousAgentLoop({
      sessionId,
      botId,
      storage,
      provider,
    });

    const abortController = new AbortController();
    provider.onGenerateStart = () => {
      // Abort once provider inference has actually started
      setTimeout(() => {
        abortController.abort();
      }, 10);
    };

    // Trigger handleMessage in background
    const handlePromise = loop.handleMessage(createDummyMessage(), abortController.signal);

    await expect(handlePromise).rejects.toThrow(/aborted/i);
    expect(provider.callCount).toBe(1);
  });

  it('AUD-20: should abort rate-limit retry pause immediately without retrying', async () => {
    const provider = new MockCancellableProvider();
    provider.simulateRateLimit = true;
    provider.rateLimitDelaySeconds = 30; // 30-second server delay

    const loop = new AutonomousAgentLoop({
      sessionId,
      botId,
      storage,
      provider,
    });

    const abortController = new AbortController();
    provider.onGenerateStart = () => {
      // Abort once rate limit pause is entered in sleepWithSignal
      setTimeout(() => {
        abortController.abort();
      }, 20);
    };

    const startTime = Date.now();
    const handlePromise = loop.handleMessage(createDummyMessage(), abortController.signal);

    await expect(handlePromise).rejects.toThrow(/cancelled|aborted/i);
    const duration = Date.now() - startTime;

    // Must return in < 1000ms instead of waiting 30 seconds!
    expect(duration).toBeLessThan(1000);
    // Must NOT have retried after abort
    expect(provider.callCount).toBe(1);
  });

  it('AUD-20: loop.stop() aborts internal controller and disposes provider', () => {
    const provider = new MockCancellableProvider();
    const loop = new AutonomousAgentLoop({
      sessionId,
      botId,
      storage,
      provider,
    });

    expect(provider.disposed).toBe(false);
    loop.stop();
    expect(provider.disposed).toBe(true);
  });

  it('AUD-20: runtime.stop() aborts runtime.signal and terminates message polling cleanly', async () => {
    let receivedSignalInCallback: AbortSignal | undefined;

    const runtime = new BotRuntime(storage, {
      sessionId,
      botId,
      heartbeatIntervalMs: 100,
      pollIntervalMs: 50,
      onMessage: async (_msg, signal) => {
        receivedSignalInCallback = signal;
      },
    });

    await runtime.start();
    expect(runtime.running).toBe(true);
    expect(runtime.signal.aborted).toBe(false);

    await runtime.stop();
    expect(runtime.running).toBe(false);
    expect(runtime.signal.aborted).toBe(true);
  });
});
