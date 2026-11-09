import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  CapabilityPersistence,
  CapabilityService,
  CapabilityPresets,
  PolicyEngine,
} from '../../src/capability/index.js';
import { ExecutionController } from '../../src/execution/controller.js';
import type { IIsolationBackend, IsolationSpawnOptions, IsolationSpawnResult } from '../../src/execution/isolation/interface.js';
import type { ExecutionContext } from '../../src/execution/types.js';

class MockIsolationBackend implements IIsolationBackend {
  public readonly platform = process.platform;
  public readonly isolationType = 'mock_isolation';
  public executedCommands: string[] = [];
  public supportedCaps = new Set(['process_isolation', 'os_isolation_required']);

  public isAvailable(): boolean {
    return true;
  }

  public supportsCapability(capability: string): boolean {
    return this.supportedCaps.has(capability);
  }

  public async executeCommand(
    command: string,
    _options: IsolationSpawnOptions
  ): Promise<IsolationSpawnResult> {
    this.executedCommands.push(command);
    return {
      command,
      exitCode: 0,
      stdout: `Mock success: ${command}`,
      stderr: '',
      durationMs: 5,
      timedOut: false,
      isolationType: this.isolationType,
    };
  }
}

describe('AUD-13 (REQ-09) Table-Driven Capability Preset & Enforcement Consistency', () => {
  let tmpDir: string;
  let projectRoot: string;
  let externalDir: string;
  let mockBackend: MockIsolationBackend;
  let controller: ExecutionController;
  let persistence: CapabilityPersistence;
  let acgService: CapabilityService;

  const sessionId = 'S_PRESET_TABLE_TEST';
  const botId = 'B_PRESET_BOT';

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `almudaya_preset_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    projectRoot = path.join(tmpDir, 'project');
    externalDir = path.join(tmpDir, 'external');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(externalDir, { recursive: true });

    mockBackend = new MockIsolationBackend();
    persistence = new CapabilityPersistence({ workspaceRoot: tmpDir });
    acgService = new CapabilityService(persistence);
    controller = new ExecutionController(acgService, mockBackend);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  const getContext = (): ExecutionContext => ({
    sessionId,
    botId,
    projectRoots: [projectRoot],
    isTurbo: false,
  });

  describe('1. Preset "restricted" (Default Fail-Closed)', () => {
    beforeEach(async () => {
      await acgService.applyPreset(sessionId, 'restricted', 'ADMIN');
    });

    it('denies external filesystem read', async () => {
      const externalFile = path.join(externalDir, 'doc.txt');
      await fs.writeFile(externalFile, 'data', 'utf-8');

      await expect(
        controller.authorizeFileAccess(getContext(), {
          targetPath: externalFile,
          operation: 'read',
        })
      ).rejects.toThrow(/Access denied by ACG policy/);
    });

    it('denies external filesystem write', async () => {
      const externalFile = path.join(externalDir, 'new.txt');
      await expect(
        controller.authorizeFileAccess(getContext(), {
          targetPath: externalFile,
          operation: 'write',
        })
      ).rejects.toThrow(/Access denied by ACG policy/);
    });

    it('denies toolchain and arbitrary shell commands', async () => {
      const result = await controller.executeCommand(getContext(), { command: 'git status' });
      expect(result.exitCode).toBe(126);
      expect(result.deniedByPolicy).toBe(true);
    });
  });

  describe('2. Preset "controlled" (Reference Read + Human-Approved Write)', () => {
    beforeEach(async () => {
      await acgService.applyPreset(sessionId, 'controlled', 'ADMIN');
    });

    it('allows external filesystem read without approval prompt', async () => {
      const externalFile = path.join(externalDir, 'reference.md');
      await fs.writeFile(externalFile, '# Ref Doc', 'utf-8');

      await expect(
        controller.authorizeFileAccess(getContext(), {
          targetPath: externalFile,
          operation: 'read',
        })
      ).resolves.not.toThrow();
    });

    it('requires human approval for external write and succeeds when approved', async () => {
      let promptSeen = false;
      controller.setApprovalCallback(async () => {
        promptSeen = true;
        return true;
      });

      const externalFile = path.join(externalDir, 'output.md');
      await controller.authorizeFileAccess(getContext(), {
        targetPath: externalFile,
        operation: 'write',
      });

      expect(promptSeen).toBe(true);
    });

    it('denies external write when operator rejects approval prompt', async () => {
      controller.setApprovalCallback(async () => false);

      const externalFile = path.join(externalDir, 'output.md');
      await expect(
        controller.authorizeFileAccess(getContext(), {
          targetPath: externalFile,
          operation: 'write',
        })
      ).rejects.toThrow(/rejected by human operator/);
    });

    it('denies shell command execution (controlled has no command grants)', async () => {
      const result = await controller.executeCommand(getContext(), { command: 'git status' });
      expect(result.exitCode).toBe(126);
      expect(result.deniedByPolicy).toBe(true);
    });
  });

  describe('3. Preset "extended" (Scoped Toolchain + External Read/Write)', () => {
    beforeEach(async () => {
      await acgService.applyPreset(sessionId, 'extended', 'ADMIN');
    });

    it('allows external filesystem read and write without per-action approval', async () => {
      const externalFile = path.join(externalDir, 'file.ts');
      await fs.writeFile(externalFile, 'code', 'utf-8');

      await expect(
        controller.authorizeFileAccess(getContext(), {
          targetPath: externalFile,
          operation: 'read',
        })
      ).resolves.not.toThrow();

      await expect(
        controller.authorizeFileAccess(getContext(), {
          targetPath: externalFile,
          operation: 'write',
        })
      ).resolves.not.toThrow();
    });

    const TOOLCHAIN_COMMANDS = ['git status', 'npm test', 'tsc --version', 'node index.js'];
    for (const cmd of TOOLCHAIN_COMMANDS) {
      it(`allows authorized toolchain command: "${cmd}"`, async () => {
        const result = await controller.executeCommand(getContext(), { command: cmd });
        expect(result.exitCode).toBe(0);
        expect(result.deniedByPolicy).toBeFalsy();
      });
    }

    const DISALLOWED_COMMANDS = ['curl https://example.com', 'powershell.exe -c dir', 'bash -c ls'];
    for (const cmd of DISALLOWED_COMMANDS) {
      it(`denies unlisted / non-toolchain command: "${cmd}"`, async () => {
        const result = await controller.executeCommand(getContext(), { command: cmd });
        expect(result.exitCode).toBe(126);
        expect(result.deniedByPolicy).toBe(true);
      });
    }
  });

  describe('4. Preset "unrestricted" (Arbitrary Shell + External FS + Hard-Deny)', () => {
    beforeEach(async () => {
      await acgService.applyPreset(sessionId, 'unrestricted', 'ADMIN');
    });

    it('allows external read and write', async () => {
      const externalFile = path.join(externalDir, 'unrestricted.dat');
      await fs.writeFile(externalFile, 'bytes', 'utf-8');

      await expect(
        controller.authorizeFileAccess(getContext(), {
          targetPath: externalFile,
          operation: 'read',
        })
      ).resolves.not.toThrow();

      await expect(
        controller.authorizeFileAccess(getContext(), {
          targetPath: externalFile,
          operation: 'write',
        })
      ).resolves.not.toThrow();
    });

    it('allows arbitrary command when backend supports os_isolation_required', async () => {
      const result = await controller.executeCommand(getContext(), {
        command: 'arbitrary_custom_binary --arg 123',
      });
      expect(result.exitCode).toBe(0);
      expect(result.deniedByPolicy).toBeFalsy();
    });

    it('strictly enforces hard-deny OS paths even in unrestricted mode', async () => {
      const samPath = 'C:\\Windows\\System32\\config\\SAM';
      await expect(
        controller.authorizeFileAccess(getContext(), {
          targetPath: samPath,
          operation: 'read',
        })
      ).rejects.toThrow(/Hard-deny security rule violated/);
    });
  });

  describe('5. Bounded Preset with Explicit Paths Override', () => {
    it('overrides wildcard paths when explicit caller paths are provided', async () => {
      const boundedDir = path.join(tmpDir, 'bounded_safe_area');
      await fs.mkdir(boundedDir, { recursive: true });

      await acgService.applyPreset(sessionId, 'extended', 'ADMIN', {
        paths: [boundedDir],
      });

      const allowedFile = path.join(boundedDir, 'allowed.txt');
      await fs.writeFile(allowedFile, 'allowed', 'utf-8');

      const forbiddenFile = path.join(externalDir, 'disallowed.txt');
      await fs.writeFile(forbiddenFile, 'denied', 'utf-8');

      // Inside bounded path: ALLOW
      await expect(
        controller.authorizeFileAccess(getContext(), {
          targetPath: allowedFile,
          operation: 'read',
        })
      ).resolves.not.toThrow();

      // Outside bounded path: DENY
      await expect(
        controller.authorizeFileAccess(getContext(), {
          targetPath: forbiddenFile,
          operation: 'read',
        })
      ).rejects.toThrow(/is not inside granted path scopes/);
    });
  });

  describe('6. Unenforced Capabilities Fail Closed', () => {
    const UNENFORCED = [
      'system.config_access',
      'network.outbound',
      'system.environment_access',
      'system.process_control',
    ];

    for (const cap of UNENFORCED) {
      it(`returns DENY for registered but unenforced capability: "${cap}"`, async () => {
        // Even if grant is manually persisted:
        await persistence.saveGrant(sessionId, {
          grant_id: crypto.randomUUID(),
          capability: cap,
          scope: { hosts: ['api.example.com'], paths: ['*'], env_vars: ['*'] },
          granted_by: 'OPERATOR',
          granted_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          session_id: sessionId,
          approval_mode: 'session',
          status: 'active',
          reason: 'Test unenforced grant',
        });

        const result = await acgService.evaluate({
          capability: cap,
          sessionId,
          botId,
          targetResource: 'test-resource',
        });

        expect(result.decision).toBe('DENY');
        expect(result.reason).toContain('is not currently supported');
      });
    }
  });
});
