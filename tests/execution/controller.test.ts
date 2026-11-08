import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  ExecutionController,
  type ExecutionContext,
  type CommandExecutionRequest,
} from '../../src/execution/index.js';
import { UnsupportedIsolationBackend } from '../../src/execution/isolation/unsupported.js';
import { CapabilityService } from '../../src/capability/service.js';
import { CapabilityPersistence } from '../../src/capability/persistence.js';
import { PathTraversalSecurityError } from '../../src/tools/sandbox.js';

describe('ExecutionController & Enforcement Boundary (Phase 3, SEC-03, ADR-002, ADR-003)', () => {
  let tmpWorkspace: string;
  let projectRoot: string;
  const sessionId = 'S001_EXEC_TEST';

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-exec-test-'));
    projectRoot = path.join(tmpWorkspace, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
    ExecutionController.resetInstance();
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
    it('should validate command and execute successfully via isolation backend', async () => {
      const controller = ExecutionController.getInstance();
      const context: ExecutionContext = { projectRoots: [projectRoot] };
      const req: CommandExecutionRequest = { command: 'echo "hello isolation"' };

      const res = await controller.executeCommand(context, req);

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('hello isolation');
      expect(res.timedOut).toBe(false);
      expect(res.isolationType).toBeDefined();
    });

    it('should reject empty command string', async () => {
      const controller = ExecutionController.getInstance();
      const context: ExecutionContext = { projectRoots: [projectRoot] };
      const req: CommandExecutionRequest = { command: '   ' };

      const res = await controller.executeCommand(context, req);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('must not be empty');
    });

    it('should reject working_dir path traversal outside project roots', async () => {
      const controller = ExecutionController.getInstance();
      const context: ExecutionContext = { projectRoots: [projectRoot] };
      const req: CommandExecutionRequest = {
        command: 'echo "exploit"',
        workingDir: '../../forbidden',
      };

      await expect(controller.executeCommand(context, req)).rejects.toThrow(
        PathTraversalSecurityError
      );
    });

    it('should redact sensitive output printed to stdout or stderr', async () => {
      const controller = ExecutionController.getInstance();
      const context: ExecutionContext = { projectRoots: [projectRoot] };
      const fakeSecret = 'AIzaSyFakeKey123456789012345678901234';
      const req: CommandExecutionRequest = { command: `echo ${fakeSecret}` };

      const res = await controller.executeCommand(context, req);
      expect(res.stdout).not.toContain('AIzaSyFakeKey');
      expect(res.stdout).toContain('[REDACTED_API_KEY]');
    });
  });

  describe('ACG Session Capability Enforcement', () => {
    it('should DENY command execution when session has no grant for command.arbitrary', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const capabilityService = new CapabilityService(persistence);
      const controller = new ExecutionController(capabilityService);

      const context: ExecutionContext = {
        sessionId,
        botId: 'B001',
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = { command: 'echo "unauthorized command"' };

      const res = await controller.executeCommand(context, req);

      expect(res.exitCode).toBe(126);
      expect(res.deniedByPolicy).toBe(true);
      expect(res.stderr).toContain('Access denied by ACG policy');

      // Verify audit event was persisted
      const auditEvents = await capabilityService.getAuditHistory(sessionId);
      expect(auditEvents.some((e) => e.type === 'CAPABILITY_DENIED')).toBe(true);
    });

    it('should ALLOW command execution when command.arbitrary is granted to session', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const capabilityService = new CapabilityService(persistence);
      const controller = new ExecutionController(capabilityService);

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
      const req: CommandExecutionRequest = { command: 'echo "granted command"' };

      const res = await controller.executeCommand(context, req);

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('granted command');
      expect(res.deniedByPolicy).toBeUndefined();

      // Verify audit event EXECUTION_COMPLETED was persisted
      const auditEvents = await capabilityService.getAuditHistory(sessionId);
      expect(auditEvents.some((e) => e.type === 'EXECUTION_COMPLETED')).toBe(true);
    });

    it('should prompt for approval when approval_mode is per_action', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const capabilityService = new CapabilityService(persistence);
      const controller = new ExecutionController(capabilityService);

      await capabilityService.grantCapability({
        sessionId,
        capability: 'command.arbitrary',
        approvalMode: 'per_action',
        grantedBy: 'OPERATOR',
      });

      const context: ExecutionContext = {
        sessionId,
        botId: 'B001',
        projectRoots: [projectRoot],
      };
      const req: CommandExecutionRequest = { command: 'echo "needs approval"' };

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
      const controller = new ExecutionController(undefined, unsupported);

      const context: ExecutionContext = { projectRoots: [projectRoot] };
      const req: CommandExecutionRequest = { command: 'echo "test"' };

      const res = await controller.executeCommand(context, req);
      expect(res.exitCode).toBe(127);
      expect(res.stderr).toContain('Execution denied (fail-closed): OS isolation backend is not supported');
    });
  });

  describe('External Filesystem Authorization', () => {
    it('should authorize access inside project roots without external grant', async () => {
      const controller = ExecutionController.getInstance();
      const context: ExecutionContext = { projectRoots: [projectRoot] };
      const internalFile = path.join(projectRoot, 'src', 'index.ts');

      await expect(
        controller.authorizeFileAccess(context, {
          operation: 'read',
          targetPath: internalFile,
        })
      ).resolves.toBeUndefined();
    });

    it('should deny external file access when session has no filesystem.read_external grant', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const capabilityService = new CapabilityService(persistence);
      const controller = new ExecutionController(capabilityService);

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
      ).rejects.toThrow('Access denied by ACG policy');
    });

    it('should authorize external file access when filesystem.read_external is granted', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const capabilityService = new CapabilityService(persistence);
      const controller = new ExecutionController(capabilityService);

      const externalDir = path.join(tmpWorkspace, 'other');
      const externalFile = path.join(externalDir, 'shared.txt');

      await capabilityService.grantCapability({
        sessionId,
        capability: 'filesystem.read_external',
        scope: { paths: [externalDir] },
        grantedBy: 'OPERATOR',
      });

      const context: ExecutionContext = {
        sessionId,
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
