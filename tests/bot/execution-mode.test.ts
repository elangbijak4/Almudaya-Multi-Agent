import { describe, it, expect, vi } from 'vitest';
import {
  ExecutionModeController,
  type ToolExecutionRequest
} from '../../src/bot/execution-mode.js';

describe('Execution Mode & Review Sovereignty (FR-213..215, Invariant 6)', () => {
  it('should default to REQUEST_REVIEW mode', () => {
    const controller = new ExecutionModeController();
    expect(controller.getMode()).toBe('REQUEST_REVIEW');
  });

  it('should identify read-only tools as not requiring review', () => {
    const controller = new ExecutionModeController('REQUEST_REVIEW');

    expect(controller.isReviewRequired('read_file')).toBe(false);
    expect(controller.isReviewRequired('list_dir')).toBe(false);
    expect(controller.isReviewRequired('search_files')).toBe(false);
  });

  it('should require review for mutating tools in REQUEST_REVIEW mode', () => {
    const controller = new ExecutionModeController('REQUEST_REVIEW');

    expect(controller.isReviewRequired('write_file')).toBe(true);
    expect(controller.isReviewRequired('edit_file')).toBe(true);
    expect(controller.isReviewRequired('run_command')).toBe(true);
  });

  it('should bypass all review in TURBO mode', async () => {
    const controller = new ExecutionModeController('TURBO');

    expect(controller.isReviewRequired('write_file')).toBe(false);
    expect(controller.isReviewRequired('run_command')).toBe(false);

    const request: ToolExecutionRequest = {
      toolName: 'run_command',
      args: { command: 'npm test' },
      botName: 'Coder',
      botId: 'BOT002'
    };

    const decision = await controller.requestApproval(request);
    expect(decision.approved).toBe(true);
  });

  it('should approve execution when operator responds "y" via prompt handler', async () => {
    const promptHandler = vi.fn().mockResolvedValue('y');
    const controller = new ExecutionModeController('REQUEST_REVIEW', promptHandler);

    const request: ToolExecutionRequest = {
      toolName: 'write_file',
      args: { path: 'src/app.ts', content: 'console.log(1)' },
      botName: 'Architect',
      botId: 'BOT001'
    };

    const decision = await controller.requestApproval(request);
    expect(decision.approved).toBe(true);
    expect(promptHandler).toHaveBeenCalledTimes(1);
    expect(promptHandler.mock.calls[0]![0]).toContain('write_file');
    expect(promptHandler.mock.calls[0]![0]).toContain('src/app.ts');
  });

  it('should reject execution when operator responds "n" via prompt handler', async () => {
    const promptHandler = vi.fn().mockResolvedValue('n');
    const controller = new ExecutionModeController('REQUEST_REVIEW', promptHandler);

    const request: ToolExecutionRequest = {
      toolName: 'run_command',
      args: { command: 'rm -rf /' },
      botName: 'Coder',
      botId: 'BOT002'
    };

    const decision = await controller.requestApproval(request);
    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain('rejected');
    expect(promptHandler).toHaveBeenCalledTimes(1);
  });

  it('should allow dynamically toggling between REQUEST_REVIEW and TURBO modes', () => {
    const controller = new ExecutionModeController('REQUEST_REVIEW');
    expect(controller.isReviewRequired('edit_file')).toBe(true);

    controller.setMode('TURBO');
    expect(controller.getMode()).toBe('TURBO');
    expect(controller.isReviewRequired('edit_file')).toBe(false);

    controller.setMode('REQUEST_REVIEW');
    expect(controller.getMode()).toBe('REQUEST_REVIEW');
    expect(controller.isReviewRequired('edit_file')).toBe(true);
  });
});
