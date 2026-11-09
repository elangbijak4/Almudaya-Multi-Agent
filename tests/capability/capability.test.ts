import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  CapabilityRegistry,
  CapabilityPersistence,
  PolicyEngine,
  CapabilityService,
  CapabilityPresets,
  CapabilityApprovalService,
  type CapabilityGrant,
} from '../../src/capability/index.js';
import { createProgram } from '../../src/cli/index.js';
import { AuditPersistenceError } from '../../src/core/errors.js';

describe('Agent Capability Governance (ACG) Subsystem (Phase 2, SEC-03, ADR-001)', () => {
  let tmpWorkspace: string;
  const sessionId = 'S001_ACG_TEST';

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-acg-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup
    }
  });

  describe('Capability Registry (Section 6.1)', () => {
    it('should register all canonical capability identifiers with risk metadata', () => {
      const caps = CapabilityRegistry.getAllCapabilities();
      expect(caps.length).toBe(9);

      const readExt = CapabilityRegistry.getCapability('filesystem.read_external');
      expect(readExt).toBeDefined();
      expect(readExt?.risk).toBe('MEDIUM');
      expect(readExt?.scopeRequired).toBe(true);

      const arbCmd = CapabilityRegistry.getCapability('command.arbitrary');
      expect(arbCmd).toBeDefined();
      expect(arbCmd?.risk).toBe('CRITICAL');
      expect(arbCmd?.enforcement).toBe('os_isolation_required');
    });

    it('should correctly distinguish known from unknown capabilities', () => {
      expect(CapabilityRegistry.isKnownCapability('filesystem.read_external')).toBe(true);
      expect(CapabilityRegistry.isKnownCapability('command.arbitrary')).toBe(true);
      expect(CapabilityRegistry.isKnownCapability('fake.malicious_capability')).toBe(false);
    });
  });

  describe('Policy Engine & Evaluation Rules (Section 6.4)', () => {
    it('should fail-closed and return DENY for unknown capability identifiers', () => {
      const result = PolicyEngine.evaluate(
        {
          capability: 'unregistered.exploit',
          sessionId,
        },
        []
      );

      expect(result.decision).toBe('DENY');
      expect(result.reason).toContain('Unknown capability identifier');
    });

    it('should enforce hard-deny rules against sensitive OS files regardless of grants', () => {
      const activeGrant: CapabilityGrant = {
        grant_id: crypto.randomUUID(),
        capability: 'filesystem.read_external',
        scope: { paths: ['/etc', 'C:\\Windows\\System32'] },
        granted_by: 'ADMIN',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        session_id: sessionId,
        approval_mode: 'session',
        status: 'active',
      };

      const result = PolicyEngine.evaluate(
        {
          capability: 'filesystem.read_external',
          sessionId,
          targetResource: '/etc/shadow',
        },
        [activeGrant]
      );

      expect(result.decision).toBe('DENY');
      expect(result.reason).toContain('Hard-deny security rule violated');
    });

    it('should enforce rule: empty scope NEVER grants unrestricted access', () => {
      const emptyScopeGrant: CapabilityGrant = {
        grant_id: crypto.randomUUID(),
        capability: 'filesystem.read_external',
        scope: {}, // Empty scope!
        granted_by: 'ADMIN',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        session_id: sessionId,
        approval_mode: 'session',
        status: 'active',
      };

      const result = PolicyEngine.evaluate(
        {
          capability: 'filesystem.read_external',
          sessionId,
          targetResource: 'D:\\other\\file.txt',
        },
        [emptyScopeGrant]
      );

      expect(result.decision).toBe('DENY');
      expect(result.reason).toContain('empty scope does not grant unrestricted access');
    });

    it('should return DENY when target resource is outside granted path scope', () => {
      const grantedDir = path.resolve(tmpWorkspace, 'allowed_folder');
      const unauthorizedDir = path.resolve(tmpWorkspace, 'forbidden_folder', 'secret.txt');

      const scopedGrant: CapabilityGrant = {
        grant_id: crypto.randomUUID(),
        capability: 'filesystem.read_external',
        scope: { paths: [grantedDir] },
        granted_by: 'ADMIN',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        session_id: sessionId,
        approval_mode: 'session',
        status: 'active',
      };

      const result = PolicyEngine.evaluate(
        {
          capability: 'filesystem.read_external',
          sessionId,
          targetResource: unauthorizedDir,
        },
        [scopedGrant]
      );

      expect(result.decision).toBe('DENY');
      expect(result.reason).toContain('is not inside granted path scopes');
    });

    it('should return REQUIRE_APPROVAL when grant approval_mode is per_action', () => {
      const allowedPath = path.resolve(tmpWorkspace, 'docs', 'readme.txt');

      const perActionGrant: CapabilityGrant = {
        grant_id: crypto.randomUUID(),
        capability: 'filesystem.write_external',
        scope: { paths: [path.dirname(allowedPath)] },
        granted_by: 'ADMIN',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        session_id: sessionId,
        approval_mode: 'per_action',
        status: 'active',
      };

      const result = PolicyEngine.evaluate(
        {
          capability: 'filesystem.write_external',
          sessionId,
          targetResource: allowedPath,
          operation: 'write',
        },
        [perActionGrant]
      );

      expect(result.decision).toBe('REQUIRE_APPROVAL');
      expect(result.requires_approval).toBe(true);
      expect(result.matching_grant_id).toBe(perActionGrant.grant_id);
    });

    it('should return ALLOW when active grant matches capability, scope, and is unexpired', () => {
      const allowedPath = path.resolve(tmpWorkspace, 'docs', 'data.csv');

      const validGrant: CapabilityGrant = {
        grant_id: crypto.randomUUID(),
        capability: 'filesystem.read_external',
        scope: { paths: [path.dirname(allowedPath)] },
        granted_by: 'ADMIN',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        session_id: sessionId,
        approval_mode: 'session',
        status: 'active',
      };

      const result = PolicyEngine.evaluate(
        {
          capability: 'filesystem.read_external',
          sessionId,
          targetResource: allowedPath,
          operation: 'read',
        },
        [validGrant]
      );

      expect(result.decision).toBe('ALLOW');
      expect(result.requires_approval).toBe(false);
      expect(result.matching_grant_id).toBe(validGrant.grant_id);
    });

    it('AUD-04 regression: bot-bound grant must match exact authenticated botId and deny missing or mismatched botId', () => {
      const botBoundGrant: CapabilityGrant = {
        grant_id: crypto.randomUUID(),
        capability: 'process.execute_external',
        scope: { commands: ['node'] },
        granted_by: 'OPERATOR',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        session_id: sessionId,
        bot_id: 'BOT-A',
        approval_mode: 'session',
        status: 'active',
      };

      // 1. Caller with matching botId -> ALLOW
      const matchResult = PolicyEngine.evaluate(
        {
          capability: 'process.execute_external',
          sessionId,
          botId: 'BOT-A',
          targetResource: 'node script.js',
        },
        [botBoundGrant]
      );
      expect(matchResult.decision).toBe('ALLOW');

      // 2. Caller omitting botId -> DENY (AUD-04)
      const noBotResult = PolicyEngine.evaluate(
        {
          capability: 'process.execute_external',
          sessionId,
          targetResource: 'node script.js',
        },
        [botBoundGrant]
      );
      expect(noBotResult.decision).toBe('DENY');
      expect(noBotResult.reason).toContain('no active capability grant found');

      // 3. Caller with different botId -> DENY
      const otherBotResult = PolicyEngine.evaluate(
        {
          capability: 'process.execute_external',
          sessionId,
          botId: 'BOT-B',
          targetResource: 'node script.js',
        },
        [botBoundGrant]
      );
      expect(otherBotResult.decision).toBe('DENY');
    });

    it('AUD-05 regression: path scope comparison must be platform-aware and case-sensitive on linux', () => {
      const scopedGrant: CapabilityGrant = {
        grant_id: crypto.randomUUID(),
        capability: 'filesystem.read_external',
        scope: { paths: ['/var/log/Audit'] },
        granted_by: 'OPERATOR',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        session_id: sessionId,
        approval_mode: 'session',
        status: 'active',
      };

      // 1. On linux: exact case matches -> ALLOW
      const linuxMatch = PolicyEngine.evaluate(
        {
          capability: 'filesystem.read_external',
          sessionId,
          targetResource: '/var/log/Audit/report.log',
          platform: 'linux',
        },
        [scopedGrant]
      );
      expect(linuxMatch.decision).toBe('ALLOW');

      // 2. On linux: different case -> DENY (AUD-05)
      const linuxMismatch = PolicyEngine.evaluate(
        {
          capability: 'filesystem.read_external',
          sessionId,
          targetResource: '/var/log/audit/report.log',
          platform: 'linux',
        },
        [scopedGrant]
      );
      expect(linuxMismatch.decision).toBe('DENY');
      expect(linuxMismatch.reason).toContain('is not inside granted path scopes');

      // 3. On win32: case-insensitive -> ALLOW
      const winGrant: CapabilityGrant = {
        ...scopedGrant,
        grant_id: crypto.randomUUID(),
        scope: { paths: ['C:\\Secure\\Audit'] },
      };
      const winMatch = PolicyEngine.evaluate(
        {
          capability: 'filesystem.read_external',
          sessionId,
          targetResource: 'c:\\secure\\audit\\report.log',
          platform: 'win32',
        },
        [winGrant]
      );
      expect(winMatch.decision).toBe('ALLOW');

      // 4. Prefix collision protection: /var/log/Audit vs /var/log/Audit-fake -> DENY
      const prefixCollision = PolicyEngine.evaluate(
        {
          capability: 'filesystem.read_external',
          sessionId,
          targetResource: '/var/log/Audit-fake/report.log',
          platform: 'linux',
        },
        [scopedGrant]
      );
      expect(prefixCollision.decision).toBe('DENY');
    });

    it('AUD-02 regression: PolicyEngine must reject requests with missing sessionId', () => {
      const result = PolicyEngine.evaluate(
        {
          capability: 'process.execute_external',
          sessionId: '',
          targetResource: 'node script.js',
        },
        []
      );
      expect(result.decision).toBe('DENY');
      expect(result.reason).toContain('missing mandatory sessionId');
    });

    it('AUD-14 regression: PolicyEngine must deny when enforcement backend is unsupported', () => {
      const grant: CapabilityGrant = {
        grant_id: crypto.randomUUID(),
        capability: 'command.arbitrary',
        scope: {},
        granted_by: 'OPERATOR',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        session_id: sessionId,
        approval_mode: 'session',
        status: 'active',
      };

      const result = PolicyEngine.evaluate(
        {
          capability: 'command.arbitrary',
          sessionId,
          botId: 'BOT-A',
          targetResource: 'echo "test"',
          enforcementBackendAvailable: false,
        },
        [grant]
      );
      expect(result.decision).toBe('DENY');
      expect(result.reason).toContain('Required enforcement backend (os_isolation_required) is unavailable');
    });

    it('AUD-13 regression: Command scope comparison must extract executable binary and match with or without extensions', () => {
      const grant: CapabilityGrant = {
        grant_id: crypto.randomUUID(),
        capability: 'process.execute_external',
        scope: { commands: ['npm', 'node'] },
        granted_by: 'OPERATOR',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        session_id: sessionId,
        approval_mode: 'session',
        status: 'active',
      };

      // npm with arguments
      const npmRes = PolicyEngine.evaluate(
        {
          capability: 'process.execute_external',
          sessionId,
          botId: 'BOT-A',
          targetResource: 'npm install --save-dev vitest',
        },
        [grant]
      );
      expect(npmRes.decision).toBe('ALLOW');

      // npm.cmd on Windows
      const npmCmdRes = PolicyEngine.evaluate(
        {
          capability: 'process.execute_external',
          sessionId,
          botId: 'BOT-A',
          targetResource: 'npm.cmd test',
        },
        [grant]
      );
      expect(npmCmdRes.decision).toBe('ALLOW');

      // node with arguments
      const nodeRes = PolicyEngine.evaluate(
        {
          capability: 'process.execute_external',
          sessionId,
          botId: 'BOT-A',
          targetResource: 'node -e "console.log(1)"',
        },
        [grant]
      );
      expect(nodeRes.decision).toBe('ALLOW');

      // unauthorized binary
      const badRes = PolicyEngine.evaluate(
        {
          capability: 'process.execute_external',
          sessionId,
          botId: 'BOT-A',
          targetResource: 'curl http://example.com',
        },
        [grant]
      );
      expect(badRes.decision).toBe('DENY');
      expect(badRes.reason).toContain('not in granted command scope');
    });
  });

  describe('TURBO Separation (Section 6.6 Mandatory Regressions)', () => {
    it('TURBO + no grant must return DENY', () => {
      const result = PolicyEngine.evaluate(
        {
          capability: 'filesystem.write_external',
          sessionId,
          targetResource: 'C:\\test\\file.txt',
          isTurbo: true, // TURBO active
        },
        [] // No grants
      );

      expect(result.decision).toBe('DENY');
      expect(result.reason).toContain('TURBO mode cannot grant capabilities');
    });

    it('TURBO + wrong scope must return DENY', () => {
      const grant: CapabilityGrant = {
        grant_id: crypto.randomUUID(),
        capability: 'filesystem.write_external',
        scope: { paths: ['C:\\allowed_dir'] },
        granted_by: 'ADMIN',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        session_id: sessionId,
        approval_mode: 'session',
        status: 'active',
      };

      const result = PolicyEngine.evaluate(
        {
          capability: 'filesystem.write_external',
          sessionId,
          targetResource: 'C:\\forbidden_dir\\file.txt',
          isTurbo: true,
        },
        [grant]
      );

      expect(result.decision).toBe('DENY');
    });

    it('TURBO + revoked grant must return DENY', () => {
      const revokedGrant: CapabilityGrant = {
        grant_id: crypto.randomUUID(),
        capability: 'filesystem.read_external',
        scope: { paths: ['C:\\allowed_dir'] },
        granted_by: 'ADMIN',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        session_id: sessionId,
        approval_mode: 'session',
        status: 'revoked', // REVOKED!
      };

      const result = PolicyEngine.evaluate(
        {
          capability: 'filesystem.read_external',
          sessionId,
          targetResource: 'C:\\allowed_dir\\file.txt',
          isTurbo: true,
        },
        [revokedGrant]
      );

      expect(result.decision).toBe('DENY');
    });

    it('TURBO + valid grant follows its approved grant mode without privilege escalation', () => {
      const allowedPath = path.resolve(tmpWorkspace, 'allowed_dir', 'output.txt');

      const sessionGrant: CapabilityGrant = {
        grant_id: crypto.randomUUID(),
        capability: 'filesystem.write_external',
        scope: { paths: [path.dirname(allowedPath)] },
        granted_by: 'ADMIN',
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        session_id: sessionId,
        approval_mode: 'session',
        status: 'active',
      };

      const result = PolicyEngine.evaluate(
        {
          capability: 'filesystem.write_external',
          sessionId,
          targetResource: allowedPath,
          isTurbo: true,
        },
        [sessionGrant]
      );

      expect(result.decision).toBe('ALLOW');
    });
  });

  describe('Capability Service & Persistence (Section 6.2, 6.3, 6.9)', () => {
    it('should save grants and retrieve active versus expired grants', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const service = new CapabilityService(persistence);

      // Create an active grant
      const grant = await service.grantCapability({
        sessionId,
        capability: 'filesystem.read_external',
        scope: { paths: ['/workspace/docs'] },
        grantedBy: 'HUMAN_OPERATOR',
        durationHours: 2,
        reason: 'Review external specifications',
      });

      expect(grant.grant_id).toBeDefined();
      expect(grant.status).toBe('active');

      const retrieved = await service.getGrant(sessionId, grant.grant_id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.capability).toBe('filesystem.read_external');

      // Verify audit trail was logged
      const history = await service.getAuditHistory(sessionId);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0]?.type).toBe('CAPABILITY_GRANTED');
      expect(history[0]?.grant_id).toBe(grant.grant_id);
    });

    it('should revoke grants cleanly and record audit events', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const service = new CapabilityService(persistence);

      const grant = await service.grantCapability({
        sessionId,
        capability: 'network.outbound',
        scope: { hosts: ['api.github.com'] },
        grantedBy: 'OPERATOR',
      });

      const revoked = await service.revokeGrant(sessionId, grant.grant_id, 'SECURITY_OFFICER', 'Security incident');
      expect(revoked.status).toBe('revoked');
      expect(revoked.revoked_by).toBe('SECURITY_OFFICER');
      expect(revoked.revocation_reason).toBe('Security incident');

      // Audit history should have CAPABILITY_GRANTED and CAPABILITY_REVOKED
      const history = await service.getAuditHistory(sessionId);
      const revokeEvent = history.find((e) => e.type === 'CAPABILITY_REVOKED');
      expect(revokeEvent).toBeDefined();
      expect(revokeEvent?.grant_id).toBe(grant.grant_id);
    });

    it('should redact sensitive values from security audit logs', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const service = new CapabilityService(persistence);

      await service.evaluate({
        capability: 'filesystem.read_external',
        sessionId,
        targetResource: 'C:\\Users\\HP\\secret_AIzaSyFakeKey12345678901234567890_token.txt',
      });

      const history = await service.getAuditHistory(sessionId);
      const evalEvent = history.find((e) => e.type === 'POLICY_EVALUATED');
      expect(evalEvent).toBeDefined();

      const detailsStr = JSON.stringify(evalEvent?.details);
      expect(detailsStr).not.toContain('AIzaSyFakeKey');
      expect(detailsStr).toContain('[REDACTED_API_KEY]');
    });

    it('AUD-03 regression: sessionId traversal attempts must be strictly rejected', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const service = new CapabilityService(persistence);

      // 1. Path traversal in getCapabilitiesDir
      expect(() => (persistence as any).getCapabilitiesDir('../../outside')).toThrow();

      // 2. Traversal attempt in grantCapability
      await expect(
        service.grantCapability({
          sessionId: '../../escape-session',
          capability: 'network.outbound',
          grantedBy: 'OPERATOR',
        })
      ).rejects.toThrow();

      // 3. Traversal attempt in getGrants
      await expect(service.getGrants('../../../root')).rejects.toThrow();

      // 4. Verify no directories or files were created outside tmpWorkspace
      const outsidePath = path.resolve(tmpWorkspace, '..', 'escape-session');
      let outsideExists = false;
      try {
        await fs.access(outsidePath);
        outsideExists = true;
      } catch {
        outsideExists = false;
      }
      expect(outsideExists).toBe(false);
    });
  });

  describe('Capability Presets (Section 6.7)', () => {
    it('should define the 4 standard architectural presets', () => {
      const presets = CapabilityPresets.getAllPresets();
      expect(presets.length).toBe(4);
      expect(CapabilityPresets.getPreset('restricted')).toBeDefined();
      expect(CapabilityPresets.getPreset('controlled')).toBeDefined();
      expect(CapabilityPresets.getPreset('extended')).toBeDefined();
      expect(CapabilityPresets.getPreset('unrestricted')).toBeDefined();
    });

    it('should apply controlled preset to a session and generate valid grants', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const service = new CapabilityService(persistence);

      const grants = await service.applyPreset(sessionId, 'controlled', 'SECURITY_ADMIN');
      expect(grants.length).toBe(2);

      const activeGrants = await service.getGrants(sessionId);
      expect(activeGrants.length).toBe(2);
      expect(activeGrants.some((g) => g.capability === 'filesystem.read_external')).toBe(true);
      expect(activeGrants.some((g) => g.capability === 'filesystem.write_external')).toBe(true);
    });
  });

  describe('Capability Approval Workflow (Section 6.5)', () => {
    it('should format informative security approval prompt for human operator', () => {
      const prompt = CapabilityApprovalService.formatApprovalPrompt({
        sessionId,
        botId: 'B001',
        botDisplayName: 'Architect',
        capability: 'filesystem.write_external',
        operation: 'edit',
        targetResource: 'C:\\external\\config.json',
        reason: 'Update compiler target version',
      });

      expect(prompt).toContain('[CAPABILITY APPROVAL REQUIRED - RISK: HIGH]');
      expect(prompt).toContain('"Architect" [B001]');
      expect(prompt).toContain('filesystem.write_external');
      expect(prompt).toContain('C:\\external\\config.json');
      expect(prompt).toContain('Update compiler target version');
    });
  });

  describe('CLI Capability Commands (Section 6.8)', () => {
    it('should list registered capabilities via CLI', async () => {
      const program = createProgram();
      program.exitOverride();

      let output = '';
      const origLog = console.log;
      console.log = (msg: string) => { output += msg + '\n'; };

      try {
        await program.parseAsync(['node', 'almudaya', 'capability', 'list']);
      } finally {
        console.log = origLog;
      }

      expect(output).toContain('filesystem.read_external');
      expect(output).toContain('command.arbitrary');
    });

    it('should grant and inspect capability via CLI', async () => {
      const program = createProgram();
      program.exitOverride();

      let output = '';
      const origLog = console.log;
      console.log = (msg: string) => { output += msg + '\n'; };

      try {
        await program.parseAsync([
          'node',
          'almudaya',
          'capability',
          'grant',
          'filesystem.read_external',
          '-s',
          sessionId,
          '--paths',
          tmpWorkspace,
          '-w',
          tmpWorkspace,
        ]);
      } finally {
        console.log = origLog;
      }

      expect(output).toContain('Capability granted successfully!');
      expect(output).toContain('filesystem.read_external');
    });

    it('AUD-03 regression: CLI commands must reject invalid or traversing sessionId', async () => {
      const program = createProgram();
      program.exitOverride();

      let errOutput = '';
      const origErr = console.error;
      console.error = (msg: string) => { errOutput += msg + '\n'; };

      try {
        await program.parseAsync([
          'node',
          'almudaya',
          'capability',
          'grant',
          'filesystem.read_external',
          '-s',
          '../../escape-session',
          '-w',
          tmpWorkspace,
        ]);
      } finally {
        console.error = origErr;
      }

      expect(errOutput).toContain('Invalid session ID');
      expect(process.exitCode).toBe(1);
    });
  });

  describe('AUD-12 & AUD-16: Approval Workflow & Mandatory Security Audit Durability (REQ-08, REQ-11)', () => {
    it('AUD-12: should reject per_action grant for external filesystem without registered approval interface', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const service = new CapabilityService(persistence);

      await expect(
        service.grantCapability({
          sessionId,
          botId: 'BOT1',
          capability: 'filesystem.read_external',
          approvalMode: 'per_action',
          grantedBy: 'OPERATOR',
        })
      ).rejects.toThrow(
        /No trusted human approval interface is available in this environment/i
      );
    });

    it('AUD-12: should allow per_action grant when approval interface is registered', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const service = new CapabilityService(persistence);

      service.setApprovalPromptCallback(async () => true);

      const grant = await service.grantCapability({
        sessionId,
        botId: 'BOT1',
        capability: 'filesystem.read_external',
        approvalMode: 'per_action',
        grantedBy: 'OPERATOR',
      });

      expect(grant.grant_id).toBeDefined();
      expect(grant.approval_mode).toBe('per_action');
    });

    it('AUD-16: should rollback grant and fail closed when mandatory audit persistence fails', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const service = new CapabilityService(persistence);

      // Sabotage recordAuditEvent to simulate durable write failure
      persistence.recordAuditEvent = async () => {
        throw new Error('EIO: write error simulating disk failure');
      };

      await expect(
        service.grantCapability({
          sessionId,
          botId: 'BOT1',
          capability: 'process.execute_external',
          grantedBy: 'OPERATOR',
        })
      ).rejects.toThrow(AuditPersistenceError);

      // Verify that the grant was NOT persisted (rolled back)
      const grants = await persistence.getGrants(sessionId);
      expect(grants).toHaveLength(0);
    });

    it('AUD-16: should fail closed when mandatory audit persistence fails on revoke', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
      const service = new CapabilityService(persistence);

      const grant = await service.grantCapability({
        sessionId,
        botId: 'BOT1',
        capability: 'process.execute_external',
        grantedBy: 'OPERATOR',
      });

      // Sabotage recordAuditEvent
      persistence.recordAuditEvent = async () => {
        throw new Error('EIO: write error simulating disk failure');
      };

      await expect(
        service.revokeGrant(sessionId, grant.grant_id, 'SECURITY_ADMIN')
      ).rejects.toThrow(AuditPersistenceError);
    });

    it('AUD-16 / REQ-07: should recursively redact secrets from audit event details', async () => {
      const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });

      await persistence.recordAuditEvent(sessionId, {
        event_id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        type: 'CAPABILITY_GRANTED',
        capability: 'process.execute_external',
        details: {
          key1: 'AIzaSyDemoKey1234567890abcdefghijklmn',
          nested: {
            token: 'Bearer token_secret_1234567890_abcdefghij',
            list: ['ghp_1234567890abcdefghijklmnopqrstuvwxyz12', 'safe_data'],
          },
        },
      });

      const events = await persistence.getAuditEvents(sessionId);
      expect(events).toHaveLength(1);
      const details = events[0].details as {
        key1: string;
        nested: { token: string; list: string[] };
      };

      expect(details.key1).not.toContain('AIzaSyDemoKey1234567890abcdefghijklmn');
      expect(details.key1).toContain('REDACTED');
      expect(details.nested.token).not.toContain('token_secret_1234567890_abcdefghij');
      expect(details.nested.token).toContain('REDACTED');
      expect(details.nested.list[0]).not.toContain('ghp_1234567890abcdefghijklmnopqrstuvwxyz12');
      expect(details.nested.list[0]).toContain('REDACTED');
      expect(details.nested.list[1]).toBe('safe_data');
    });
  });
});
