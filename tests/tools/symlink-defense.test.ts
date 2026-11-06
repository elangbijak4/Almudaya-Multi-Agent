import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  validateSandboxedPath,
  getCanonicalPath,
  PathTraversalSecurityError
} from '../../src/tools/sandbox.js';
import {
  executeReadFile,
  executeWriteFile
} from '../../src/tools/file-tools.js';

describe('Symlink & Directory Junction Defense (§14/6, FR-320, Invariant 5)', () => {
  let projectRoot: string;
  let outsideDir: string;
  let junctionPath: string | null = null;

  beforeEach(async () => {
    const tmp = os.tmpdir();
    const nonce = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    projectRoot = path.join(tmp, `almudaya_symlink_test_${nonce}_root`);
    outsideDir = path.join(tmp, `almudaya_symlink_test_${nonce}_outside`);

    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });

    // Create a target secret file outside the project root
    await fs.writeFile(
      path.join(outsideDir, 'confidential_outside.txt'),
      'CRITICAL_OUTSIDE_DATA',
      'utf8'
    );
  });

  afterEach(async () => {
    if (junctionPath && existsSync(junctionPath)) {
      if (process.platform === 'win32') {
        try {
          execSync(`cmd /c rmdir "${junctionPath}"`, { stdio: 'ignore' });
        } catch {
          // ignore
        }
      } else {
        try {
          await fs.unlink(junctionPath);
        } catch {
          // ignore
        }
      }
    }
    junctionPath = null;

    try {
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should correctly canonicalize paths of existing and non-existing files', async () => {
    const existingFile = path.join(projectRoot, 'hello.txt');
    await fs.writeFile(existingFile, 'world');

    const canonicalExisting = getCanonicalPath(existingFile);
    expect(canonicalExisting.toLowerCase()).toBe(existingFile.toLowerCase());

    const nonExistingFile = path.join(projectRoot, 'nested', 'deep', 'future.txt');
    const canonicalNonExisting = getCanonicalPath(nonExistingFile);
    expect(canonicalNonExisting.toLowerCase()).toBe(nonExistingFile.toLowerCase());
  });

  it('should allow valid files inside the registered project root', async () => {
    await fs.writeFile(path.join(projectRoot, 'valid.js'), 'console.log("ok");');

    const validated = validateSandboxedPath([projectRoot], 'valid.js');
    expect(validated).toBeDefined();

    const readRes = await executeReadFile([projectRoot], { path: 'valid.js' });
    expect(readRes.content).toContain('console.log("ok");');
  });

  it('should strictly reject reading files outside root via Windows Junction or Symlink (§14/6 live test)', async () => {
    junctionPath = path.join(projectRoot, 'escape_link');

    // Create a directory junction (Windows) or symlink (Unix) inside projectRoot pointing to outsideDir
    let linkCreated = false;
    if (process.platform === 'win32') {
      try {
        execSync(`cmd /c mklink /J "${junctionPath}" "${outsideDir}"`, { stdio: 'ignore' });
        linkCreated = existsSync(junctionPath);
      } catch {
        linkCreated = false;
      }
    } else {
      try {
        await fs.symlink(outsideDir, junctionPath, 'dir');
        linkCreated = true;
      } catch {
        linkCreated = false;
      }
    }

    if (!linkCreated) {
      // In constrained environments where symlinks/junctions cannot be created, skip
      return;
    }

    // 1. Validating the sandboxed path pointing through the junction MUST fail
    expect(() =>
      validateSandboxedPath([projectRoot], 'escape_link/confidential_outside.txt')
    ).toThrow(PathTraversalSecurityError);

    // 2. executeReadFile through the junction MUST fail with PathTraversalSecurityError
    await expect(
      executeReadFile([projectRoot], { path: 'escape_link/confidential_outside.txt' })
    ).rejects.toThrow(PathTraversalSecurityError);

    // 3. executeWriteFile through the junction to create a file outside MUST also fail
    await expect(
      executeWriteFile([projectRoot], {
        path: 'escape_link/malicious_write.txt',
        content: 'hacked'
      })
    ).rejects.toThrow(PathTraversalSecurityError);
  });
});
