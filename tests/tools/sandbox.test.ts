import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  validateSandboxedPath,
  isPathInsideRoot,
  normalizeFsPath,
  getRelativeSandboxedPath,
  PathTraversalSecurityError
} from '../../src/tools/sandbox.js';

describe('Path Sandboxing & Security (Invariant 5 & FR-210)', () => {
  let testRoot1: string;
  let testRoot2: string;
  let outsideDir: string;

  beforeEach(async () => {
    const tmp = os.tmpdir();
    testRoot1 = path.join(tmp, `almudaya_sandbox_test_${Date.now()}_root1`);
    testRoot2 = path.join(tmp, `almudaya_sandbox_test_${Date.now()}_root2`);
    outsideDir = path.join(tmp, `almudaya_sandbox_test_${Date.now()}_outside`);

    await fs.mkdir(testRoot1, { recursive: true });
    await fs.mkdir(testRoot2, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testRoot1, { recursive: true, force: true });
      await fs.rm(testRoot2, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should throw if no project roots are configured', () => {
    expect(() => validateSandboxedPath([], 'src/index.ts')).toThrow(
      PathTraversalSecurityError
    );
    expect(() => validateSandboxedPath([], 'src/index.ts')).toThrow(
      /No registered project roots/
    );
  });

  it('should throw if requested path is empty', () => {
    expect(() => validateSandboxedPath([testRoot1], '')).toThrow(
      PathTraversalSecurityError
    );
    expect(() => validateSandboxedPath([testRoot1], '   ')).toThrow(
      /cannot be empty/
    );
  });

  it('should successfully validate valid relative paths within primary root', () => {
    const valid = validateSandboxedPath([testRoot1], 'src/app.ts');
    const expected = normalizeFsPath(path.join(testRoot1, 'src/app.ts'));
    expect(valid).toBe(expected);
  });

  it('should successfully validate valid absolute paths within primary root', () => {
    const absPath = path.join(testRoot1, 'config/settings.json');
    const valid = validateSandboxedPath([testRoot1], absPath);
    expect(valid).toBe(normalizeFsPath(absPath));
  });

  it('should reject parent directory traversal attempts (..)', () => {
    expect(() =>
      validateSandboxedPath([testRoot1], '../../outside.txt')
    ).toThrow(PathTraversalSecurityError);

    expect(() =>
      validateSandboxedPath([testRoot1], 'src/../../escape.txt')
    ).toThrow(PathTraversalSecurityError);
  });

  it('should reject absolute paths pointing to foreign directories outside roots', () => {
    const foreignFile = path.join(outsideDir, 'secret.env');
    expect(() =>
      validateSandboxedPath([testRoot1], foreignFile)
    ).toThrow(PathTraversalSecurityError);
  });

  it('should support multiple project roots (primary and secondary)', () => {
    const fileInRoot2 = path.join(testRoot2, 'docs/architecture.md');
    const valid = validateSandboxedPath([testRoot1, testRoot2], fileInRoot2);
    expect(valid).toBe(normalizeFsPath(fileInRoot2));
  });

  it('should support rootHint to resolve relative paths against specific root', () => {
    const valid = validateSandboxedPath(
      [testRoot1, testRoot2],
      'docs/guide.md',
      testRoot2
    );
    expect(valid).toBe(normalizeFsPath(path.join(testRoot2, 'docs/guide.md')));
  });

  it('should prevent prefix collisions (e.g. /app/project vs /app/project-other)', () => {
    const prefixTrap = `${testRoot1}-other`;
    expect(isPathInsideRoot(testRoot1, path.join(prefixTrap, 'file.txt'))).toBe(
      false
    );
  });

  it('should compute clean relative paths using getRelativeSandboxedPath', () => {
    const target = path.join(testRoot1, 'src/modules/auth.ts');
    const rel = getRelativeSandboxedPath([testRoot1], target);
    expect(rel).toBe('src/modules/auth.ts');
  });
});
