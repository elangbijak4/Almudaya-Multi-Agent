import { describe, it, expect } from 'vitest';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { buildDynamicSystemPrompt } from '../../src/ai/prompts.js';
import type { AIRequest, ToolDefinition } from '../../src/ai/provider.js';

describe('AI Provider Abstraction & Prompts', () => {
  it('should generate programmed responses with MockAIProvider', async () => {
    const mock = new MockAIProvider('test-model', [
      { text: 'Hello, I am Architect bot.' },
      {
        toolCalls: [
          {
            id: 'call_1',
            name: 'read_file',
            arguments: { path: 'package.json' },
          },
        ],
      },
    ]);

    const req1: AIRequest = {
      systemPrompt: 'You are an architect',
      messages: [{ role: 'user', content: 'Introduce yourself' }],
    };

    const res1 = await mock.generateResponse(req1);
    expect(res1.text).toBe('Hello, I am Architect bot.');
    expect(res1.toolCalls).toBeUndefined();
    expect(res1.usage?.totalTokens).toBe(150);

    const req2: AIRequest = {
      systemPrompt: 'You are an architect',
      messages: [{ role: 'user', content: 'Inspect the project' }],
    };

    const res2 = await mock.generateResponse(req2);
    expect(res2.toolCalls).toHaveLength(1);
    expect(res2.toolCalls?.[0]?.name).toBe('read_file');
    expect(res2.toolCalls?.[0]?.arguments).toEqual({ path: 'package.json' });

    expect(mock.calls).toHaveLength(2);
  });

  it('should throw error when scripted step specifies an error', async () => {
    const mock = new MockAIProvider('test-model', [
      { error: new Error('Rate limit exceeded') },
    ]);

    await expect(
      mock.generateResponse({
        messages: [{ role: 'user', content: 'test' }],
      })
    ).rejects.toThrow('Rate limit exceeded');
  });

  it('should build dynamic system prompt including peer bots and project roots', () => {
    const prompt = buildDynamicSystemPrompt({
      sessionId: 'S002',
      botId: 'BOT001',
      displayName: 'Architect',
      role: 'System Architect',
      description: 'Designs core modules',
      executionMode: 'REQUEST_REVIEW',
      projectRoots: [
        {
          root_id: 'testing',
          name: 'testing',
          path: 'D:\\testingbot',
          root_type: 'primary',
          description: 'Main project',
          registered_at: new Date().toISOString(),
        },
      ],
      peerBots: [
        {
          session_id: 'S002',
          bot_id: 'BOT001',
          display_name: 'Architect',
          status: 'active',
          joined_at: new Date().toISOString(),
        },
        {
          session_id: 'S002',
          bot_id: 'BOT002',
          display_name: 'Coder',
          status: 'active',
          description: 'Software Engineer',
          joined_at: new Date().toISOString(),
        },
      ],
    });

    expect(prompt).toContain('Anda adalah "Architect" (Bot ID: BOT001)');
    expect(prompt).toContain('System Architect');
    expect(prompt).toContain('Session ID: S002');
    expect(prompt).toContain('Mode Eksekusi Keamanan: REQUEST_REVIEW');
    expect(prompt).toContain('D:\\testingbot');
    expect(prompt).toContain('BOT002');
    expect(prompt).toContain('Coder');
    expect(prompt).toContain('Software Engineer');
  });
});
