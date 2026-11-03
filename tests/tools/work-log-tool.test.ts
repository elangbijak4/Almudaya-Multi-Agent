import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { WorkLogService } from '../../src/shared/work-log.js';
import {
  GET_WORK_LOG_TOOL,
  executeGetWorkLog,
} from '../../src/tools/work-log-tool.js';

describe('AI Tool get_work_log (FR-315, ADR-302)', () => {
  let tmpWorkspace: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let workLogService: WorkLogService;
  const sessionId = 'SESS_TOOL_WORKLOG_01';

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-tool-worklog-'));
    storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);
    workLogService = new WorkLogService(storage);

    await sessionService.createSession({
      sessionId,
      sessionName: 'Work Log Tool Lab',
    });

    // Seed sample work logs
    await workLogService.recordWork(sessionId, {
      botId: 'B001',
      botName: 'Architect',
      actionType: 'WRITE',
      targetRootId: 'backend',
      targetRootName: 'Backend API',
      targetRootPath: '/app/backend',
      relativePath: 'openapi.yaml',
      summary: 'Designed REST endpoints specification',
    });

    await workLogService.recordWork(sessionId, {
      botId: 'B002',
      botName: 'Coder',
      actionType: 'WRITE',
      targetRootId: 'backend',
      targetRootName: 'Backend API',
      targetRootPath: '/app/backend',
      relativePath: 'src/server.ts',
      summary: 'Implemented REST endpoints in Express',
    });

    await workLogService.recordWork(sessionId, {
      botId: 'B003',
      botName: 'FrontendDev',
      actionType: 'WRITE',
      targetRootId: 'frontend',
      targetRootName: 'Web App',
      targetRootPath: '/app/frontend',
      relativePath: 'src/api-client.ts',
      summary: 'Connected React components to backend API',
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should declare valid JSON Schema function declaration for get_work_log', () => {
    expect(GET_WORK_LOG_TOOL.name).toBe('get_work_log');
    expect(GET_WORK_LOG_TOOL.description).toContain('Mengambil riwayat kerja terkini');
    expect(GET_WORK_LOG_TOOL.parameters.type).toBe('object');
    expect(GET_WORK_LOG_TOOL.parameters.properties).toHaveProperty('limit');
    expect(GET_WORK_LOG_TOOL.parameters.properties).toHaveProperty('root_id');
    expect(GET_WORK_LOG_TOOL.parameters.properties).toHaveProperty('bot_id');
  });

  it('should execute get_work_log and return all entries with default limit', async () => {
    const result = await executeGetWorkLog(storage, sessionId, {});
    expect(result.total).toBe(3);
    expect(result.entries.length).toBe(3);
    expect(result.summary).toContain('Architect [WRITE] root "Backend API" (openapi.yaml)');
    expect(result.summary).toContain('Coder [WRITE] root "Backend API" (src/server.ts)');
    expect(result.summary).toContain('FrontendDev [WRITE] root "Web App" (src/api-client.ts)');
  });

  it('should filter work log by root_id', async () => {
    const result = await executeGetWorkLog(storage, sessionId, { root_id: 'frontend' });
    expect(result.total).toBe(1);
    expect(result.entries[0]!.bot_name).toBe('FrontendDev');
    expect(result.entries[0]!.target_root_id).toBe('frontend');
  });

  it('should filter work log by bot_id or bot_name', async () => {
    const result = await executeGetWorkLog(storage, sessionId, { bot_id: 'B002' });
    expect(result.total).toBe(1);
    expect(result.entries[0]!.bot_id).toBe('B002');
    expect(result.entries[0]!.summary).toBe('Implemented REST endpoints in Express');
  });

  it('should respect custom limit', async () => {
    const result = await executeGetWorkLog(storage, sessionId, { limit: 2 });
    expect(result.total).toBe(2);
    // Returns most recent 2 entries
    expect(result.entries[0]!.bot_name).toBe('Coder');
    expect(result.entries[1]!.bot_name).toBe('FrontendDev');
  });
});
