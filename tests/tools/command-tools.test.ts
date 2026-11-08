import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  executeRunCommand,
  RUN_COMMAND_TOOL
} from '../../src/tools/command-tools.js';
import { PathTraversalSecurityError } from '../../src/tools/sandbox.js';
import { CapabilityService } from '../../src/capability/service.js';
import { CapabilityPersistence } from '../../src/capability/persistence.js';
import { ExecutionController } from '../../src/execution/controller.js';

describe('System Command Execution Tool (FR-211, FR-212)', () => {
  let projectRoot: string;
  let tmpWorkspace: string;
  const sessionId = 'S_CMD_TOOL_TEST';
  const botId = 'B_CMD_TOOL_TEST';
  let context: { sessionId: string; botId: string };

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-cmd-bb-'));
    projectRoot = path.join(
      os.tmpdir(),
      `almudaya_cmd_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(projectRoot, { recursive: true });

    const persistence = new CapabilityPersistence({ workspaceRoot: tmpWorkspace });
    const capabilityService = new CapabilityService(persistence);
    const controller = new ExecutionController(capabilityService);
    ExecutionController.setInstance(controller);

    // Grant process.execute_external for node and echo commands
    await capabilityService.grantCapability({
      sessionId,
      botId,
      capability: 'process.execute_external',
      scope: { commands: ['node', 'echo'] },
      grantedBy: 'OPERATOR',
    });

    context = { sessionId, botId };
  });

  afterEach(async () => {
    ExecutionController.resetInstance();
    try {
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should successfully execute a basic shell command and capture stdout', async () => {
    const res = await executeRunCommand(
      [projectRoot],
      { command: 'node -e "console.log(\'ALMUDAYA_COMMAND_TEST\')"' },
      context
    );

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('ALMUDAYA_COMMAND_TEST');
    expect(res.timedOut).toBe(false);
    expect(res.durationMs).toBeGreaterThan(0);
  });

  it('should capture non-zero exit code and stderr', async () => {
    const res = await executeRunCommand(
      [projectRoot],
      { command: 'node -e "console.error(\'CUSTOM_ERROR\'); process.exit(42);"' },
      context
    );

    expect(res.exitCode).toBe(42);
    expect(res.stderr).toContain('CUSTOM_ERROR');
    expect(res.timedOut).toBe(false);
  });

  it('should execute inside the specified sandboxed working directory', async () => {
    const subDir = path.join(projectRoot, 'nested');
    await fs.mkdir(subDir, { recursive: true });

    const res = await executeRunCommand(
      [projectRoot],
      {
        command: 'node -e "console.log(process.cwd())"',
        working_dir: 'nested'
      },
      context
    );

    expect(res.exitCode).toBe(0);
    expect(res.stdout.toLowerCase()).toContain('nested');
  });

  it('should reject working_dir outside project roots', async () => {
    await expect(
      executeRunCommand(
        [projectRoot],
        {
          command: 'echo "test"',
          working_dir: '../../forbidden'
        },
        context
      )
    ).rejects.toThrow(PathTraversalSecurityError);
  });

  it('should enforce execution timeout and terminate long-running processes', async () => {
    const res = await executeRunCommand(
      [projectRoot],
      {
        command: 'node -e "setTimeout(() => {}, 15000)"',
        timeout_ms: 1000
      },
      context
    );

    expect(res.timedOut).toBe(true);
    expect(res.durationMs).toBeGreaterThanOrEqual(950);
  });

  it('AUD-02 regression: should DENY execution when context is omitted', async () => {
    const res = await executeRunCommand([projectRoot], {
      command: 'node -e "console.log(\'unauthorized\')"',
    });

    expect(res.exitCode).toBe(126);
    expect(res.deniedByPolicy).toBe(true);
    expect(res.stderr).toContain('requires authenticated session identity and bot principal');
  });

  it('AUD-02 regression: should DENY execution when botId is missing in context', async () => {
    const res = await executeRunCommand(
      [projectRoot],
      { command: 'node -e "console.log(\'unauthorized\')"' },
      { sessionId }
    );

    expect(res.exitCode).toBe(126);
    expect(res.deniedByPolicy).toBe(true);
  });

  it('AUD-02 regression: should DENY execution when sessionId is missing in context', async () => {
    const res = await executeRunCommand(
      [projectRoot],
      { command: 'node -e "console.log(\'unauthorized\')"' },
      { botId }
    );

    expect(res.exitCode).toBe(126);
    expect(res.deniedByPolicy).toBe(true);
  });

  it('should conform to ToolDefinition schema for AI Function Calling', () => {
    expect(RUN_COMMAND_TOOL.name).toBe('run_command');
    expect(RUN_COMMAND_TOOL.parameters.type).toBe('object');
    expect(RUN_COMMAND_TOOL.parameters.required).toContain('command');
    expect(RUN_COMMAND_TOOL.parameters.properties['command']).toBeDefined();
    expect(RUN_COMMAND_TOOL.parameters.properties['timeout_ms']).toBeDefined();
    expect(RUN_COMMAND_TOOL.parameters.properties['working_dir']).toBeDefined();
  });
});
