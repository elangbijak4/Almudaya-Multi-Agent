import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import process from 'node:process';
import {
  resolveWorkspaceRoot,
  getDefaultWorkspaceRoot,
  getSessionDir,
  getSessionsBaseDir,
} from '../../src/core/config.js';

describe('Config & Workspace Resolution', () => {
  const originalEnv = process.env['ALMUDAYA_WORKSPACE'];

  beforeEach(() => {
    delete process.env['ALMUDAYA_WORKSPACE'];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['ALMUDAYA_WORKSPACE'] = originalEnv;
    } else {
      delete process.env['ALMUDAYA_WORKSPACE'];
    }
  });

  it('should use explicit workspace option over everything else', () => {
    process.env['ALMUDAYA_WORKSPACE'] = '/env/path';
    const resolved = resolveWorkspaceRoot({ workspace: './my-custom-workspace' });
    expect(resolved).toBe(path.resolve('./my-custom-workspace'));
  });

  it('should use ALMUDAYA_WORKSPACE when no explicit option is provided', () => {
    process.env['ALMUDAYA_WORKSPACE'] = path.resolve('./from-env');
    const resolved = resolveWorkspaceRoot();
    expect(resolved).toBe(path.resolve('./from-env'));
  });

  it('should fallback to platform default when neither option nor env is set', () => {
    const resolved = resolveWorkspaceRoot();
    const defaultRoot = getDefaultWorkspaceRoot();
    expect(resolved).toBe(defaultRoot);
    expect(resolved).toContain('almudaya');
  });

  it('should construct correct session directory paths', () => {
    const ws = path.resolve('/tmp/almudaya-test');
    expect(getSessionDir(ws, 'S001')).toBe(path.join(ws, 'sessions', 'S001'));
    expect(getSessionsBaseDir(ws)).toBe(path.join(ws, 'sessions'));
  });
});
