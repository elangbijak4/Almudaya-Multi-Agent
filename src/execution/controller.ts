import type {
  ExecutionContext,
  CommandExecutionRequest,
  CommandExecutionResult,
  FilesystemExecutionRequest,
} from './types.js';
import type { IIsolationBackend } from './isolation/interface.js';
import { getIsolationBackend } from './isolation/factory.js';
import { CapabilityService } from '../capability/service.js';
import { CapabilityRegistry } from '../capability/registry.js';
import { CapabilityApprovalService } from '../capability/approval.js';
import { ExecutionEnvironmentBuilder, redactSecrets } from './environment.js';
import { validateSandboxedPath, isPathInsideRoot } from '../tools/sandbox.js';

export class ExecutionController {
  private static instance: ExecutionController | null = null;
  private backend: IIsolationBackend;
  private capabilityService: CapabilityService;

  constructor(
    capabilityService?: CapabilityService,
    backend?: IIsolationBackend
  ) {
    this.capabilityService = capabilityService ?? new CapabilityService();
    this.backend = backend ?? getIsolationBackend();
  }

  public static getInstance(): ExecutionController {
    if (!ExecutionController.instance) {
      ExecutionController.instance = new ExecutionController();
    }
    return ExecutionController.instance;
  }

  public static resetInstance(): void {
    ExecutionController.instance = null;
  }

  public static setInstance(instance: ExecutionController | null): void {
    ExecutionController.instance = instance;
  }

  public getIsolationBackend(): IIsolationBackend {
    return this.backend;
  }

  public getCapabilityService(): CapabilityService {
    return this.capabilityService;
  }

  /**
   * Executes a command through the central Execution Controller (Section 7.1).
   * Follows the 9-step execution enforcement workflow:
   * 1. Validate request
   * 2. Build trusted execution context & validate sandbox working directory
   * 3. Call ACG policy evaluation
   * 4. Request approval if required
   * 5. Confirm enforcement backend availability
   * 6. Execute through selected isolation backend
   * 7. Redact outputs
   * 8. Record audit events
   * 9. Return structured results
   */
  public async executeCommand(
    context: ExecutionContext,
    request: CommandExecutionRequest,
    promptFn?: (message: string) => Promise<boolean>
  ): Promise<CommandExecutionResult> {
    const rawCmd = request.command ? request.command.trim() : '';

    // 1. Validate request
    if (!rawCmd) {
      return {
        command: '',
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Command string must not be empty.',
        durationMs: 0,
        timedOut: false,
        isolationType: this.backend.isolationType,
      };
    }

    // 2. Validate sandbox working directory (enforces Invariant 5 and throws PathTraversalSecurityError if unauthorized)
    const workingDirArg = request.workingDir || '.';
    const resolvedWorkingDir = validateSandboxedPath(context.projectRoots, workingDirArg);

    // 2.5. Validate mandatory authenticated identity (AUD-02, REQ-02, ADR-SRP1-003, Security Invariant 1)
    if (!context.sessionId || !context.sessionId.trim() || !context.botId || !context.botId.trim()) {
      return {
        command: rawCmd,
        exitCode: 126,
        stdout: '',
        stderr: 'Access denied by ACG policy: Command execution requires authenticated session identity and bot principal (sessionId and botId).',
        durationMs: 0,
        timedOut: false,
        deniedByPolicy: true,
        isolationType: this.backend.isolationType,
      };
    }

    // 3. Determine capability and perform ACG Policy Evaluation (AUD-01, AUD-13, AUD-14, REQ-01, REQ-09)
    let targetCap = request.capability;
    if (!targetCap) {
      // If not explicitly set, check if session has an active grant for process.execute_external
      const grants = await this.capabilityService.getGrants(context.sessionId);
      const hasExecGrant = grants.some(
        (g) => g.capability === 'process.execute_external' && g.status === 'active'
      );
      targetCap = hasExecGrant ? 'process.execute_external' : 'command.arbitrary';
    }

    const def = CapabilityRegistry.getCapability(targetCap);
    if (!def) {
      return {
        command: rawCmd,
        exitCode: 126,
        stdout: '',
        stderr: `Access denied by ACG policy: Unknown capability identifier: "${targetCap}". Capability must be registered in ACG registry.`,
        durationMs: 0,
        timedOut: false,
        deniedByPolicy: true,
        isolationType: this.backend.isolationType,
      };
    }

    const backendSupportsCapability =
      this.backend.isAvailable() && this.backend.supportsCapability(def.enforcement);

    const evalResult = await this.capabilityService.evaluate({
      capability: targetCap,
      sessionId: context.sessionId,
      botId: context.botId,
      targetResource: rawCmd,
      isTurbo: context.isTurbo,
      enforcementBackendAvailable: backendSupportsCapability,
    });

    if (evalResult.decision === 'DENY') {
      const exitCode = evalResult.reason.includes('Required enforcement backend') ? 127 : 126;
      return {
        command: rawCmd,
        exitCode,
        stdout: '',
        stderr: `Access denied by ACG policy: ${evalResult.reason}`,
        durationMs: 0,
        timedOut: false,
        deniedByPolicy: true,
        isolationType: this.backend.isolationType,
      };
    }

    // 4. Request approval if required (e.g. per_action mode or high risk)
    if (evalResult.decision === 'REQUIRE_APPROVAL') {
      const approved = await CapabilityApprovalService.promptUser(
        {
          sessionId: context.sessionId,
          botId: context.botId,
          botDisplayName: context.botDisplayName,
          capability: targetCap,
          targetResource: rawCmd,
          operation: 'shell',
          reason: evalResult.reason,
        },
        promptFn
      );

      if (!approved) {
        return {
          command: rawCmd,
          exitCode: 125,
          stdout: '',
          stderr: 'Execution aborted: operator denied capability approval.',
          durationMs: 0,
          timedOut: false,
          deniedByPolicy: true,
          isolationType: this.backend.isolationType,
        };
      }
    }

    // 5. Confirm enforcement backend availability and capability support (AUD-01, AUD-14, REQ-01, ADR-SRP1-002)
    if (!this.backend.isAvailable() || !this.backend.supportsCapability(def.enforcement)) {
      return {
        command: rawCmd,
        exitCode: 127,
        stdout: '',
        stderr: `Execution denied (fail-closed): Required isolation capability "${def.enforcement}" is not supported by backend "${this.backend.isolationType}" on this platform.`,
        durationMs: 0,
        timedOut: false,
        deniedByPolicy: true,
        isolationType: this.backend.isolationType,
      };
    }

    // 6. Build sanitized execution environment
    const envBuilder = new ExecutionEnvironmentBuilder({
      approvedVars: request.env,
      executionSpecific: {
        ALMUDAYA_SESSION_ID: context.sessionId ?? '',
        ALMUDAYA_BOT_ID: context.botId ?? '',
      },
    });
    const sanitizedEnv = envBuilder.build();

    const timeoutMs = Math.max(1000, request.timeoutMs ?? 30000);

    // 7. Execute through isolation backend
    const spawnResult = await this.backend.executeCommand(rawCmd, {
      cwd: resolvedWorkingDir,
      env: sanitizedEnv,
      timeoutMs,
    });

    // 8. Redact outputs
    const cleanStdout = redactSecrets(spawnResult.stdout);
    const cleanStderr = redactSecrets(spawnResult.stderr);

    // 9. Record audit event in session capabilities if active
    if (context.sessionId) {
      try {
        const persistence = this.capabilityService.getPersistence();
        await persistence.recordAuditEvent(context.sessionId, {
          event_id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          session_id: context.sessionId,
          bot_id: context.botId,
          type: spawnResult.exitCode === 0 ? 'EXECUTION_COMPLETED' : 'EXECUTION_FAILED',
          capability: targetCap,
          details: {
            command: rawCmd,
            exit_code: spawnResult.exitCode,
            timed_out: spawnResult.timedOut,
            duration_ms: spawnResult.durationMs,
            isolation_type: spawnResult.isolationType,
          },
        });
      } catch {
        // Best-effort audit logging
      }
    }

    return {
      command: rawCmd,
      exitCode: spawnResult.exitCode,
      stdout: cleanStdout,
      stderr: cleanStderr,
      durationMs: spawnResult.durationMs,
      timedOut: spawnResult.timedOut,
      isolationType: spawnResult.isolationType,
    };
  }

  /**
   * Evaluates external filesystem access against ACG policies.
   */
  public async authorizeFileAccess(
    context: ExecutionContext,
    request: FilesystemExecutionRequest
  ): Promise<void> {
    const isInsideProject = context.projectRoots.some((root) =>
      isPathInsideRoot(root, request.targetPath)
    );

    // Access strictly inside workspace project roots is authorized by the workspace sandbox
    if (isInsideProject) {
      return;
    }

    // Access outside project roots requires explicit ACG capability
    let requiredCap = 'filesystem.read_external';
    if (request.operation === 'write') {
      requiredCap = 'filesystem.write_external';
    } else if (request.operation === 'delete') {
      requiredCap = 'filesystem.delete_external';
    }

    if (!context.sessionId || !context.sessionId.trim() || !context.botId || !context.botId.trim()) {
      throw new Error(`Access denied: External filesystem access to "${request.targetPath}" requires authenticated session identity and bot principal (sessionId and botId).`);
    }

    const evalResult = await this.capabilityService.evaluate({
      capability: requiredCap,
      sessionId: context.sessionId,
      botId: context.botId,
      targetResource: request.targetPath,
      operation: request.operation,
      isTurbo: context.isTurbo,
    });

    if (evalResult.decision === 'DENY') {
      throw new Error(`Access denied by ACG policy for external path: ${evalResult.reason}`);
    }

    if (evalResult.decision === 'REQUIRE_APPROVAL') {
      throw new Error(`Operation requires human approval for external path "${request.targetPath}".`);
    }
  }
}
