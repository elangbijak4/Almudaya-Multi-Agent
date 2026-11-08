import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  ExecutionController,
  type ExecutionContext,
  type CommandExecutionRequest,
} from '../../src/execution/index.js';
import type {
  IIsolationBackend,
  IsolationSpawnOptions,
  IsolationSpawnResult,
} from '../../src/execution/isolation/interface.js';
import { UnsupportedIsolationBackend } from '../../src/execution/isolation/unsupported.js';
import { CapabilityService } from '../../src/capability/service.js';
import { CapabilityPersistence } from '../../src/capability/persistence.js';
import { PathTraversalSecurityError } from '../../src/tools/sandbox.js';

describe('ExecutionController & Enforcement Boundary (Phase 3, SEC-03, ADR-002, ADR-003)', () => {
  let tmpWorkspace: string;
  let projectRoot: string;
  let persistence: CapabilityPersistence;
  let capabilityService: CapabilityService;
  let controller: ExecutionController;
  const sessionId = 'S001_EXEC_TEST';
  const botId = 'B001';

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-exec-test-'));
    projectRoot = path.join(tmpWorkspace, 'project');
    await fs.mkdir(projectRoot, { recursive: true });

    persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
    capabilityService = new CapabilityService(persistence);
    controller = new ExecutionController(capabilityService);
    ExecutionController.setInstance(controller);
  });

  afterEach(async () => {
    ExecutionController.resetInstance();
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Core Controller Command Execution', () => {
    it('should validate command and execute successfully via isolation backend with process.execute_external grant', async () => {
      await capabilityService.grantCapability({
        sessionId,
        botId,
        capability: 'process.execute_external',
        scope: { commands: ['echo'] },
        grantedBy: 'OPERATOR',
      });

      const context: ExecutionContext = {
        sessionId,
        botId,
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = { command: 'echo "hello isolation"' };

      const res = await controller.executeCommand(context, req);

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('hello isolation');
      expect(res.timedOut).toBe(false);
      expect(res.isolationType).toBeDefined();
    });

    it('AUD-02 regression: should DENY command execution when sessionId is missing', async () => {
      const context: ExecutionContext = {
        botId,
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = { command: 'echo "unauthorized"' };

      const res = await controller.executeCommand(context, req);
      expect(res.exitCode).toBe(126);
      expect(res.deniedByPolicy).toBe(true);
      expect(res.stderr).toContain('requires authenticated session identity and bot principal');
    });

    it('AUD-02 regression: should DENY command execution when botId is missing', async () => {
      const context: ExecutionContext = {
        sessionId,
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = { command: 'echo "unauthorized"' };

      const res = await controller.executeCommand(context, req);
      expect(res.exitCode).toBe(126);
      expect(res.deniedByPolicy).toBe(true);
      expect(res.stderr).toContain('requires authenticated session identity and bot principal');
    });

    it('should reject empty command string', async () => {
      const context: ExecutionContext = {
        sessionId,
        botId,
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = { command: '   ' };

      const res = await controller.executeCommand(context, req);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('must not be empty');
    });

    it('should reject working_dir path traversal outside project roots', async () => {
      const context: ExecutionContext = {
        sessionId,
        botId,
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = {
        command: 'echo "exploit"',
        workingDir: '../../forbidden',
      };

      await expect(controller.executeCommand(context, req)).rejects.toThrow(
        PathTraversalSecurityError
      );
    });

    it('should redact sensitive output printed to stdout or stderr', async () => {
      await capabilityService.grantCapability({
        sessionId,
        botId,
        capability: 'process.execute_external',
        scope: { commands: ['echo'] },
        grantedBy: 'OPERATOR',
      });

      const context: ExecutionContext = {
        sessionId,
        botId,
        projectRoots: [projectRoot],
      };
      const fakeSecret = 'AIzaSyFakeKey123456789012345678901234';
      const req: CommandExecutionRequest = { command: `echo ${fakeSecret}` };

      const res = await controller.executeCommand(context, req);
      expect(res.stdout).not.toContain('AIzaSyFakeKey');
      expect(res.stdout).toContain('[REDACTED_API_KEY]');
    });
  });

  describe('ACG Session Capability Enforcement', () => {
    it('should DENY command execution when session has no grant for command.arbitrary', async () => {
      const context: ExecutionContext = {
        sessionId,
        botId: 'B001',
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = {
        command: 'echo "unauthorized command"',
        capability: 'command.arbitrary',
      };

      const res = await controller.executeCommand(context, req);

      expect(res.exitCode).toBe(126);
      expect(res.deniedByPolicy).toBe(true);
      expect(res.stderr).toContain('Access denied by ACG policy');

      // Verify audit event was persisted
      const auditEvents = await capabilityService.getAuditHistory(sessionId);
      expect(auditEvents.some((e) => e.type === 'CAPABILITY_DENIED')).toBe(true);
    });

    it('AUD-01 & AUD-14 regression: should fail-closed with exitCode 127 on host backend for command.arbitrary even when granted', async () => {
      // Explicitly grant command.arbitrary
      await capabilityService.grantCapability({
        sessionId,
        capability: 'command.arbitrary',
        grantedBy: 'OPERATOR',
        durationHours: 1,
      });

      const context: ExecutionContext = {
        sessionId,
        botId: 'B001',
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = {
        command: 'echo "granted command"',
        capability: 'command.arbitrary',
      };

      const res = await controller.executeCommand(context, req);

      // Fails closed because host backend does not support os_isolation_required
      expect(res.exitCode).toBe(127);
      expect(res.deniedByPolicy).toBe(true);
      expect(res.stderr).toContain('Required enforcement backend (os_isolation_required) is unavailable');
    });

    it('AUD-01 & AUD-14: should ALLOW command.arbitrary when isolation backend supports os_isolation_required', async () => {
      // Mock an isolated sandbox backend (e.g. VM / container boundary)
      const mockIsolatedBackend: IIsolationBackend = {
        platform: process.platform,
        isolationType: 'mock_container_sandbox',
        isAvailable: () => true,
        supportsCapability: (cap: string) => cap === 'os_isolation_required' || cap === 'process_isolation',
        executeCommand: async (cmd: string, _opts: IsolationSpawnOptions): Promise<IsolationSpawnResult> => ({
          exitCode: 0,
          stdout: `sandboxed: ${cmd}`,
          stderr: '',
          durationMs: 15,
          timedOut: false,
          isolationType: 'mock_container_sandbox',
        }),
      };

      const customController = new ExecutionController(capabilityService, mockIsolatedBackend);

      await capabilityService.grantCapability({
        sessionId,
        capability: 'command.arbitrary',
        grantedBy: 'OPERATOR',
        durationHours: 1,
      });

      const context: ExecutionContext = {
        sessionId,
        botId: 'B001',
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = {
        command: 'echo "granted command"',
        capability: 'command.arbitrary',
      };

      const res = await customController.executeCommand(context, req);

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('sandboxed: echo "granted command"');
      expect(res.deniedByPolicy).toBeUndefined();

      // Verify audit event EXECUTION_COMPLETED was persisted
      const auditEvents = await capabilityService.getAuditHistory(sessionId);
      expect(auditEvents.some((e) => e.type === 'EXECUTION_COMPLETED')).toBe(true);
    });

    it('AUD-13 & AUD-14: should ALLOW execution when process.execute_external is granted for command in scope', async () => {
      await capabilityService.grantCapability({
        sessionId,
        botId: 'B001',
        capability: 'process.execute_external',
        scope: { commands: ['echo'] },
        grantedBy: 'OPERATOR',
      });

      const context: ExecutionContext = {
        sessionId,
        botId: 'B001',
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = {
        command: 'echo "granted external command"',
        capability: 'process.execute_external',
      };

      const res = await controller.executeCommand(context, req);

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('granted external command');
      expect(res.deniedByPolicy).toBeUndefined();
    });

    it('should prompt for approval when approval_mode is per_action', async () => {
      await capabilityService.grantCapability({
        sessionId,
        botId: 'B001',
        capability: 'process.execute_external',
        scope: { commands: ['echo'] },
        approvalMode: 'per_action',
        grantedBy: 'OPERATOR',
      });

      const context: ExecutionContext = {
        sessionId,
        botId: 'B001',
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = {
        command: 'echo "needs approval"',
        capability: 'process.execute_external',
      };

      // Case A: Operator rejects
      let promptSeen = false;
      const resDenied = await controller.executeCommand(context, req, async (msg) => {
        promptSeen = true;
        expect(msg).toContain('[CAPABILITY APPROVAL REQUIRED');
        return false; // REJECT
      });

      expect(promptSeen).toBe(true);
      expect(resDenied.exitCode).toBe(125);
      expect(resDenied.deniedByPolicy).toBe(true);
      expect(resDenied.stderr).toContain('operator denied capability approval');

      // Case B: Operator approves
      const resApproved = await controller.executeCommand(context, req, async () => {
        return true; // APPROVE
      });

      expect(resApproved.exitCode).toBe(0);
      expect(resApproved.stdout).toContain('needs approval');
    });
  });

  describe('Fail-Closed on Unsupported Isolation Backend', () => {
    it('should fail-closed and return exitCode 127 if isolation backend is unavailable', async () => {
      const unsupported = new UnsupportedIsolationBackend();
      const customController = new ExecutionController(capabilityService, unsupported);

      await capabilityService.grantCapability({
        sessionId,
        botId: 'B001',
        capability: 'process.execute_external',
        scope: { commands: ['echo'] },
        grantedBy: 'OPERATOR',
      });

      const context: ExecutionContext = {
        sessionId,
        botId: 'B001',
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = {
        command: 'echo "test"',
        capability: 'process.execute_external',
      };

      const res = await customController.executeCommand(context, req);
      expect(res.exitCode).toBe(127);
      expect(res.stderr).toContain('Required enforcement backend (process_isolation) is unavailable on this platform');
    });
  });

  describe('External Filesystem Authorization', () => {
    it('should authorize access inside project roots without external grant', async () => {
      const context: ExecutionContext = { projectRoots: [projectRoot] };
      const internalFile = path.join(projectRoot, 'src', 'index.ts');

      await expect(
        controller.authorizeFileAccess(context, {
          operation: 'read',
          targetPath: internalFile,
        })
      ).resolves.toBeUndefined();
    });

    it('AUD-02 regression: should DENY external file access when botId is missing', async () => {
      const context: ExecutionContext = {
        sessionId,
        projectRoots: [projectRoot],
      };
      const externalFile = path.join(tmpWorkspace, 'other', 'secret.txt');

      await expect(
        controller.authorizeFileAccess(context, {
          operation: 'read',
          targetPath: externalFile,
        })
      ).rejects.toThrow('requires authenticated session identity and bot principal');
    });

    it('should deny external file access when session has no filesystem.read_external grant', async () => {
      const context: ExecutionContext = {
        sessionId,
        botId: 'B001',
        projectRoots: [projectRoot],
      };
      const externalFile = path.join(tmpWorkspace, 'other', 'secret.txt');

      await expect(
        controller.authorizeFileAccess(context, {
          operation: 'read',
          targetPath: externalFile,
        })
      ).rejects.toThrow('Access denied by ACG policy');
    });

    it('should authorize external file access when filesystem.read_external is granted', async () => {
      const externalDir = path.join(tmpWorkspace, 'other');
      const externalFile = path.join(externalDir, 'shared.txt');

      await capabilityService.grantCapability({
        sessionId,
        botId: 'B001',
        capability: 'filesystem.read_external',
        scope: { paths: [externalDir] },
        grantedBy: 'OPERATOR',
      });

      const context: ExecutionContext = {
        sessionId,
        botId: 'B001',
        projectRoots: [projectRoot],
      };

      await expect(
        controller.authorizeFileAccess(context, {
          operation: 'read',
          targetPath: externalFile,
        })
      ).resolves.toBeUndefined();
    });
  });
});
