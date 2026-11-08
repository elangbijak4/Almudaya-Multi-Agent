import type {
  ExecutionContext,
  CommandExecutionRequest,
  CommandExecutionResult,
  FilesystemExecutionRequest,
} from './types.js';
import type { IIsolationBackend } from './isolation/interface.js';
import { getIsolationBackend } from './isolation/factory.js';
import { CapabilityService } from '../capability/service.js';
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

    // 3. ACG Policy Evaluation (if executed in a session context)
    if (context.sessionId) {
      const evalResult = await this.capabilityService.evaluate({
        capability: 'command.arbitrary',
        sessionId: context.sessionId,
        botId: context.botId,
        targetResource: rawCmd,
        isTurbo: context.isTurbo,
        enforcementBackendAvailable: this.backend.isAvailable(),
      });

      if (evalResult.decision === 'DENY') {
        return {
          command: rawCmd,
          exitCode: 126,
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
            capability: 'command.arbitrary',
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
    }

    // 5. Confirm enforcement backend availability
    if (!this.backend.isAvailable()) {
      return {
        command: rawCmd,
        exitCode: 127,
        stdout: '',
        stderr: 'Execution denied (fail-closed): OS isolation backend is not supported on this platform.',
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
          capability: 'command.arbitrary',
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

    if (!context.sessionId) {
      throw new Error(`Access denied: external path access to "${request.targetPath}" requires an active session with ACG authorization.`);
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
