import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import process from 'node:process';
import {
  resolveApiKey,
  maskApiKey,
  getDefaultEnvVarName,
  MissingApiKeyError,
} from '../../src/ai/credentials.js';

describe('AI Credentials Resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['GEMINI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['CUSTOM_KEY_ENV'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return correct default environment variable names', () => {
    expect(getDefaultEnvVarName('gemini')).toBe('GEMINI_API_KEY');
    expect(getDefaultEnvVarName('google')).toBe('GEMINI_API_KEY');
    expect(getDefaultEnvVarName('openai')).toBe('OPENAI_API_KEY');
    expect(getDefaultEnvVarName('anthropic')).toBe('ANTHROPIC_API_KEY');
    expect(getDefaultEnvVarName('ollama')).toBe('OLLAMA_API_KEY');
  });

  it('should resolve key from explicit argument first', () => {
    process.env['GEMINI_API_KEY'] = 'env-key-123';
    const key = resolveApiKey({
      providerId: 'gemini',
      explicitKey: 'explicit-key-456',
    });
    expect(key).toBe('explicit-key-456');
  });

  it('should resolve key from default environment variable', () => {
    process.env['GEMINI_API_KEY'] = 'gemini-live-secret-key';
    const key = resolveApiKey({ providerId: 'gemini' });
    expect(key).toBe('gemini-live-secret-key');
  });

  it('should resolve key from custom environment variable', () => {
    process.env['CUSTOM_KEY_ENV'] = 'custom-secret-key';
    const key = resolveApiKey({
      providerId: 'gemini',
      customEnvVar: 'CUSTOM_KEY_ENV',
    });
    expect(key).toBe('custom-secret-key');
  });

  it('should throw MissingApiKeyError when no key is set', () => {
    expect(() => resolveApiKey({ providerId: 'gemini' })).toThrow(MissingApiKeyError);
    expect(() =>
      resolveApiKey({ providerId: 'gemini', customEnvVar: 'CUSTOM_KEY_ENV' })
    ).toThrow(/CUSTOM_KEY_ENV/);
  });

  it('should mask API keys cleanly', () => {
    expect(maskApiKey('AIzaSy' + 'D-1234567890abcdefQWERTY')).toBe('AIzaSy...****ERTY');
    expect(maskApiKey('short')).toBe('****');
  });
});
