import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  sanitizeChildEnv,
  redactSensitiveOutput,
  SAFE_ENV_ALLOWLIST
} from '../../src/tools/sandbox.js';
import { executeRunCommand } from '../../src/tools/command-tools.js';

describe('Environment Sanitization & Credential Protection (SEC-01, FR-319, Invariant 7)', () => {
  let projectRoot: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    projectRoot = path.join(
      os.tmpdir(),
      `almudaya_env_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    try {
      await fs.rm(projectRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('sanitizeChildEnv (Pure Function)', () => {
    it('should strip sensitive tokens and API keys from raw environment', () => {
      const dirtyEnv: NodeJS.ProcessEnv = {
        PATH: 'C:\\Windows\\system32',
        SYSTEMROOT: 'C:\\Windows',
        TEMP: 'C:\\Temp',
        GEMINI_API_KEY: 'AIzaSySentinelSecretDoNotLeak12345',
        GITHUB_TOKEN: 'ghp_abcdef1234567890abcdef1234567890',
        DATABASE_PASSWORD: 'supersecretpassword',
        MY_SECRET_KEY: 'secret123',
        AUTH_TOKEN: 'bearer_token_xyz',
        USER_CREDENTIALS: 'creds',
      };

      const cleanEnv = sanitizeChildEnv(dirtyEnv);

      // Sensitive keys must be completely absent
      expect(cleanEnv['GEMINI_API_KEY']).toBeUndefined();
      expect(cleanEnv['GITHUB_TOKEN']).toBeUndefined();
      expect(cleanEnv['DATABASE_PASSWORD']).toBeUndefined();
      expect(cleanEnv['MY_SECRET_KEY']).toBeUndefined();
      expect(cleanEnv['AUTH_TOKEN']).toBeUndefined();
      expect(cleanEnv['USER_CREDENTIALS']).toBeUndefined();

      // Safe OS keys must be retained
      expect(cleanEnv['PATH']).toBe('C:\\Windows\\system32');
      expect(cleanEnv['SYSTEMROOT']).toBe('C:\\Windows');
      expect(cleanEnv['TEMP']).toBe('C:\\Temp');

      // Default execution flags enforced
      expect(cleanEnv['FORCE_COLOR']).toBe('0');
      expect(cleanEnv['CI']).toBe('true');
    });

    it('should handle case-insensitive key matching for safe allowlist', () => {
      const rawEnv: NodeJS.ProcessEnv = {
        Path: 'C:\\Windows\\system32',
        SystemRoot: 'C:\\Windows',
        temp: 'C:\\Temp',
        Gemini_Api_Key: 'leak_me',
      };

      const cleanEnv = sanitizeChildEnv(rawEnv);

      expect(cleanEnv['Path']).toBe('C:\\Windows\\system32');
      expect(cleanEnv['SystemRoot']).toBe('C:\\Windows');
      expect(cleanEnv['temp']).toBe('C:\\Temp');
      expect(cleanEnv['Gemini_Api_Key']).toBeUndefined();
    });

    it('should drop non-allowlisted custom environment variables', () => {
      const rawEnv: NodeJS.ProcessEnv = {
        PATH: 'C:\\bin',
        CUSTOM_APP_INTERNAL_METRIC: 'some_internal_data',
        COMPANY_PRIVATE_CONFIG: 'conf',
      };

      const cleanEnv = sanitizeChildEnv(rawEnv);
      expect(cleanEnv['CUSTOM_APP_INTERNAL_METRIC']).toBeUndefined();
      expect(cleanEnv['COMPANY_PRIVATE_CONFIG']).toBeUndefined();
      expect(cleanEnv['PATH']).toBe('C:\\bin');
    });
  });

  describe('redactSensitiveOutput', () => {
    it('should redact Google Gemini API keys (classic AIzaSy and new AQ. format)', () => {
      const text = 'Failed with key AIzaSyBCDEFGHIJKLMNOPQRSTUVWXYZ12345 and AQ.Abcdefghijklmnopqrstuvwxyz123456789';
      const redacted = redactSensitiveOutput(text);

      expect(redacted).not.toContain('AIzaSy');
      expect(redacted).not.toContain('AQ.Abcdef');
      expect(redacted).toContain('[REDACTED_API_KEY]');
    });

    it('should redact GitHub Personal Access Tokens', () => {
      const text = 'Clone failed with ghp_123456789012345678901234567890123456';
      const redacted = redactSensitiveOutput(text);

      expect(redacted).not.toContain('ghp_12345');
      expect(redacted).toContain('[REDACTED_TOKEN]');
    });
  });

  describe('executeRunCommand Integration (SEC-01 Live Verification)', () => {
    it('should NOT inherit GEMINI_API_KEY or GITHUB_TOKEN into spawned shell process', async () => {
      // Set sensitive keys in parent process.env
      process.env.GEMINI_API_KEY = 'SENTINEL_LEAK_TEST_KEY_AIzaSy123456789';
      process.env.GITHUB_TOKEN = 'ghp_sentineltoken12345678901234567890';

      const res = await executeRunCommand([projectRoot], {
        command: 'node -e "console.log(\'GEMINI:\' + (process.env.GEMINI_API_KEY || \'NOT_SET\')); console.log(\'GITHUB:\' + (process.env.GITHUB_TOKEN || \'NOT_SET\'));"'
      });

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('GEMINI:NOT_SET');
      expect(res.stdout).toContain('GITHUB:NOT_SET');
      expect(res.stdout).not.toContain('SENTINEL_LEAK');
    });

    it('should redact any sensitive key accidentally printed by command output', async () => {
      const res = await executeRunCommand([projectRoot], {
        command: 'node -e "console.log(\'Key leaked: AIzaSyBBBBBBBBBBBBBBBBBBBBBBBBBBBB123\')"'
      });

      expect(res.exitCode).toBe(0);
      expect(res.stdout).not.toContain('AIzaSyBBBB');
      expect(res.stdout).toContain('[REDACTED_API_KEY]');
    });
  });
});
