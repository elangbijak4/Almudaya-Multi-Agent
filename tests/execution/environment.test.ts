import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import {
  ExecutionEnvironmentBuilder,
  sanitizePath,
  sanitizeComspec,
  redactSecrets,
  registerSecret,
  clearRegisteredSecrets,
  DANGEROUS_ENV_VARS,
} from '../../src/execution/environment.js';

describe('Execution Environment Architecture & Sanitization (SEC-01, NT-02)', () => {
  beforeEach(() => {
    clearRegisteredSecrets();
  });

  afterEach(() => {
    clearRegisteredSecrets();
  });

  describe('ExecutionEnvironmentBuilder', () => {
    it('should build clean environment with safe defaults and exclude sensitive host keys', () => {
      const hostEnv: NodeJS.ProcessEnv = {
        PATH: 'C:\\Windows\\system32',
        SYSTEMROOT: 'C:\\Windows',
        TEMP: 'C:\\Temp',
        GEMINI_API_KEY: 'AIzaSy' + 'Secret12345678901234567890',
        AWS_SECRET_ACCESS_KEY: 'supersecretawskey',
        PRIVATE_SSH_KEY: 'ssh-rsa-secret',
        CUSTOM_INTERNAL_METRIC: 'metric_data',
      };

      const builder = new ExecutionEnvironmentBuilder({ baseEnv: hostEnv });
      const env = builder.build();

      expect(env.PATH).toBe('C:\\Windows\\system32');
      expect(env.SYSTEMROOT).toBe('C:\\Windows');
      expect(env.TEMP).toBe('C:\\Temp');
      expect(env.GEMINI_API_KEY).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(env.PRIVATE_SSH_KEY).toBeUndefined();
      expect(env.CUSTOM_INTERNAL_METRIC).toBeUndefined();
      expect(env.CI).toBe('true');
      expect(env.FORCE_COLOR).toBe('0');
    });

    it('should unconditionally strip dangerous runtime variables (PYTHONPATH, NODE_OPTIONS, LD_PRELOAD)', () => {
      const hostEnv: NodeJS.ProcessEnv = {
        PATH: 'C:\\Windows\\system32',
        PYTHONPATH: 'C:\\malicious\\lib',
        PYTHONHOME: 'C:\\malicious\\python',
        NODE_OPTIONS: '--inspect=0.0.0.0:9229',
        NODE_PATH: 'C:\\malicious\\node_modules',
        LD_PRELOAD: '/tmp/malicious.so',
        DYLD_INSERT_LIBRARIES: '/tmp/malicious.dylib',
      };

      const builder = new ExecutionEnvironmentBuilder({ baseEnv: hostEnv });
      const env = builder.build();

      for (const dangerous of DANGEROUS_ENV_VARS) {
        expect(env[dangerous]).toBeUndefined();
      }
    });

    it('should allow explicitly approved variables to be layered into environment', () => {
      const builder = new ExecutionEnvironmentBuilder({ baseEnv: { PATH: 'C:\\Windows\\system32' } });
      builder.withApprovedVar('APPROVED_PROJECT_ENV', 'production_test');
      builder.withApprovedVar('BUILD_TARGET', 'x64');

      const env = builder.build();
      expect(env.APPROVED_PROJECT_ENV).toBe('production_test');
      expect(env.BUILD_TARGET).toBe('x64');
    });

    it('should safely inject secrets into process environment and auto-register for redaction', () => {
      const builder = new ExecutionEnvironmentBuilder({ baseEnv: { PATH: 'C:\\Windows\\system32' } });
      const secretToken = 'vault_injected_super_secret_token_12345';
      builder.withSecret('INJECTED_VAULT_TOKEN', secretToken);

      const env = builder.build();
      expect(env.INJECTED_VAULT_TOKEN).toBe(secretToken);

      // Verify that this secret is automatically redacted from any logged string
      const logText = `Error occurred with token: ${secretToken}`;
      expect(redactSecrets(logText)).toBe('Error occurred with token: [REDACTED_SECRET]');
    });

    it('should allow execution-specific variables', () => {
      const builder = new ExecutionEnvironmentBuilder({ baseEnv: { PATH: 'C:\\Windows\\system32' } });
      builder.withExecutionSpecific('ALMUDAYA_SESSION_ID', 'S001');

      const env = builder.build();
      expect(env.ALMUDAYA_SESSION_ID).toBe('S001');
    });
  });

  describe('Path & Comspec Sanitization', () => {
    it('should strip relative directories from PATH to prevent binary hijacking', () => {
      const delimiter = path.delimiter;
      const rawPath = [
        '.',
        '..',
        'relative/bin',
        'C:\\Windows\\system32',
        'C:\\Program Files\\nodejs',
      ].join(delimiter);

      const cleaned = sanitizePath(rawPath);
      const segments = cleaned.split(delimiter);

      expect(segments).not.toContain('.');
      expect(segments).not.toContain('..');
      expect(segments).not.toContain('relative/bin');
      expect(segments).toContain('C:\\Windows\\system32');
      expect(segments).toContain('C:\\Program Files\\nodejs');
    });

    it('should fallback to genuine system cmd.exe if COMSPEC points to suspicious binary on Windows', () => {
      if (process.platform === 'win32') {
        const suspicious = 'C:\\malicious\\fake_cmd.exe';
        const sanitized = sanitizeComspec(suspicious);
        expect(sanitized.toLowerCase()).toContain('system32\\cmd.exe');
      }
    });
  });

  describe('Centralized Secret Redaction', () => {
    it('should redact bearer tokens and URLs containing credentials', () => {
      const output = 'Request to https://admin:super_secret_password123@api.internal.com/data with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';
      const redacted = redactSecrets(output);

      expect(redacted).not.toContain('super_secret_password123');
      expect(redacted).toContain('[REDACTED_PASSWORD]');
      expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz');
      expect(redacted).toContain('Bearer [REDACTED_BEARER_TOKEN]');
    });

    it('should redact custom registered secrets', () => {
      registerSecret('CUSTOM_TOP_SECRET_CREDENTIAL_VALUE');
      const text = 'Failed connection using secret CUSTOM_TOP_SECRET_CREDENTIAL_VALUE at runtime';
      const redacted = redactSecrets(text);

      expect(redacted).not.toContain('CUSTOM_TOP_SECRET_CREDENTIAL_VALUE');
      expect(redacted).toContain('[REDACTED_SECRET]');
    });
  });
});
