import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import {
  WorkLogService,
  WorkLogEntrySchema,
  generateWorkEntryId,
} from '../../src/shared/work-log.js';
import { CorruptedDataError, SessionNotFoundError } from '../../src/core/errors.js';

describe('Shared Session Work Memory Engine (FR-311..316, NFR-305, ADR-302)', () => {
  let tmpWorkspace: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let workLogService: WorkLogService;
  const sessionId = 'SESS_WORK_01';

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-work-log-test-'));
    storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);
    workLogService = new WorkLogService(storage);

    await sessionService.createSession({
      sessionId,
      sessionName: 'Multi-Root Work Lab',
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('ID Generation & Schema Validation', () => {
    it('should generate a unique work entry ID matching prefix convention', () => {
      const id1 = generateWorkEntryId();
      const id2 = generateWorkEntryId();

      expect(id1).toMatch(/^work_\d+_[a-f0-9]{6}$/);
      expect(id2).toMatch(/^work_\d+_[a-f0-9]{6}$/);
      expect(id1).not.toBe(id2);
    });

    it('should validate complete WorkLogEntry with all required fields', () => {
      const validEntry = {
        entry_id: 'work_12345_abcdef',
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        bot_id: 'B001',
        bot_name: 'Architect',
        action_type: 'WRITE' as const,
        target_root_id: 'backend',
        target_root_name: 'Backend API',
        target_root_path: 'D:/project/backend',
        relative_path: 'src/index.ts',
        full_path: 'D:/project/backend/src/index.ts',
        summary: 'Created Express app bootstrap',
        details: { linesCreated: 42 },
      };

      const parsed = WorkLogEntrySchema.parse(validEntry);
      expect(parsed.entry_id).toBe('work_12345_abcdef');
      expect(parsed.action_type).toBe('WRITE');
    });

    it('should reject invalid action_type in WorkLogEntrySchema', () => {
      const invalidEntry = {
        entry_id: 'work_12345_abcdef',
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        bot_id: 'B001',
        bot_name: 'Architect',
        action_type: 'INVALID_TYPE',
        target_root_id: 'backend',
        target_root_name: 'Backend API',
        target_root_path: 'D:/project/backend',
        summary: 'Invalid action test',
      };

      expect(() => WorkLogEntrySchema.parse(invalidEntry)).toThrow();
    });
  });

  describe('Recording Work Actions', () => {
    it('should record WRITE action and persist to work_log.jsonl under session lock', async () => {
      const entry = await workLogService.recordWork(sessionId, {
        botId: 'B001',
        botName: 'Coder',
        actionType: 'WRITE',
        targetRootId: 'backend',
        targetRootName: 'Backend API',
        targetRootPath: 'D:/testingbot/backend',
        relativePath: 'src/server.ts',
        fullPath: 'D:/testingbot/backend/src/server.ts',
        summary: 'Created REST server entrypoint',
        details: { language: 'typescript' },
      });

      expect(entry.entry_id).toMatch(/^work_\d+_[a-f0-9]{6}$/);
      expect(entry.session_id).toBe(sessionId);
      expect(entry.bot_name).toBe('Coder');
      expect(entry.action_type).toBe('WRITE');
      expect(entry.target_root_id).toBe('backend');
      expect(entry.relative_path).toBe('src/server.ts');

      // Verify physical file content
      const workLogFile = storage.getWorkLogFilePath(sessionId);
      const rawContent = await fs.readFile(workLogFile, 'utf-8');
      const lines = rawContent.trim().split('\n');
      expect(lines.length).toBe(1);

      const parsed = JSON.parse(lines[0]!);
      expect(parsed.entry_id).toBe(entry.entry_id);
      expect(parsed.summary).toBe('Created REST server entrypoint');
    });

    it('should throw SessionNotFoundError when recording to a non-existent session', async () => {
      await expect(
        workLogService.recordWork('NON_EXISTENT_SESSION', {
          botId: 'B001',
          botName: 'Coder',
          actionType: 'WRITE',
          targetRootId: 'backend',
          targetRootName: 'Backend API',
          targetRootPath: 'D:/testingbot/backend',
          summary: 'Should fail',
        })
      ).rejects.toThrow(SessionNotFoundError);
    });
  });

  describe('Cross-Root Multi-Target Logging', () => {
    it('should record actions across multiple project roots with correct metadata', async () => {
      // Backend root work
      await workLogService.recordWork(sessionId, {
        botId: 'B001',
        botName: 'Coder',
        actionType: 'WRITE',
        targetRootId: 'backend',
        targetRootName: 'Backend API',
        targetRootPath: 'D:/app/backend',
        relativePath: 'src/api.ts',
        summary: 'Created REST API routes',
      });

      // Frontend root work
      await workLogService.recordWork(sessionId, {
        botId: 'B002',
        botName: 'FrontendDev',
        actionType: 'WRITE',
        targetRootId: 'frontend',
        targetRootName: 'Web App',
        targetRootPath: 'D:/app/frontend',
        relativePath: 'src/App.tsx',
        summary: 'Created React main view',
      });

      // Command run in backend root
      await workLogService.recordWork(sessionId, {
        botId: 'B003',
        botName: 'Tester',
        actionType: 'COMMAND',
        targetRootId: 'backend',
        targetRootName: 'Backend API',
        targetRootPath: 'D:/app/backend',
        summary: 'npm test (passed 12 tests)',
        details: { exitCode: 0 },
      });

      const all = await workLogService.readWorkLogs(sessionId);
      expect(all.length).toBe(3);
      expect(all[0]!.target_root_id).toBe('backend');
      expect(all[1]!.target_root_id).toBe('frontend');
      expect(all[2]!.action_type).toBe('COMMAND');
    });
  });

  describe('Filtering and Querying (readWorkLogs)', () => {
    beforeEach(async () => {
      // Seed 4 entries
      await workLogService.recordWork(sessionId, {
        botId: 'B001',
        botName: 'Coder',
        actionType: 'WRITE',
        targetRootId: 'backend',
        targetRootName: 'Backend API',
        targetRootPath: '/app/backend',
        relativePath: 'server.js',
        summary: 'Backend server',
      });

      await workLogService.recordWork(sessionId, {
        botId: 'B001',
        botName: 'Coder',
        actionType: 'COMMAND',
        targetRootId: 'backend',
        targetRootName: 'Backend API',
        targetRootPath: '/app/backend',
        summary: 'node server.js',
      });

      await workLogService.recordWork(sessionId, {
        botId: 'B002',
        botName: 'Tester',
        actionType: 'WRITE',
        targetRootId: 'frontend',
        targetRootName: 'Frontend App',
        targetRootPath: '/app/frontend',
        relativePath: 'test.html',
        summary: 'Frontend test page',
      });

      await workLogService.recordWork(sessionId, {
        botId: 'B002',
        botName: 'Tester',
        actionType: 'DECISION',
        targetRootId: 'frontend',
        targetRootName: 'Frontend App',
        targetRootPath: '/app/frontend',
        summary: 'Approved UI design',
      });
    });

    it('should return all entries when no filter is provided', async () => {
      const logs = await workLogService.readWorkLogs(sessionId);
      expect(logs.length).toBe(4);
    });

    it('should filter by rootId (case-insensitive)', async () => {
      const backendLogs = await workLogService.readWorkLogs(sessionId, { rootId: 'BACKEND' });
      expect(backendLogs.length).toBe(2);
      expect(backendLogs.every((l) => l.target_root_id === 'backend')).toBe(true);

      const frontendLogs = await workLogService.readWorkLogs(sessionId, { rootId: 'frontend' });
      expect(frontendLogs.length).toBe(2);
      expect(frontendLogs.every((l) => l.target_root_id === 'frontend')).toBe(true);
    });

    it('should filter by botId or botName (case-insensitive)', async () => {
      const coderLogsById = await workLogService.readWorkLogs(sessionId, { botId: 'b001' });
      expect(coderLogsById.length).toBe(2);

      const coderLogsByName = await workLogService.readWorkLogs(sessionId, { botId: 'CODER' });
      expect(coderLogsByName.length).toBe(2);

      const testerLogs = await workLogService.readWorkLogs(sessionId, { botId: 'Tester' });
      expect(testerLogs.length).toBe(2);
    });

    it('should filter by actionType', async () => {
      const writeLogs = await workLogService.readWorkLogs(sessionId, { actionType: 'WRITE' });
      expect(writeLogs.length).toBe(2);

      const cmdLogs = await workLogService.readWorkLogs(sessionId, { actionType: 'COMMAND' });
      expect(cmdLogs.length).toBe(1);
      expect(cmdLogs[0]!.summary).toBe('node server.js');

      const decisionLogs = await workLogService.readWorkLogs(sessionId, { actionType: 'DECISION' });
      expect(decisionLogs.length).toBe(1);
    });

    it('should combine multiple filters', async () => {
      const result = await workLogService.readWorkLogs(sessionId, {
        rootId: 'backend',
        actionType: 'COMMAND',
      });

      expect(result.length).toBe(1);
      expect(result[0]!.bot_name).toBe('Coder');
    });

    it('should respect limit by returning the most recent N matching entries', async () => {
      const limited = await workLogService.readWorkLogs(sessionId, { limit: 2 });
      expect(limited.length).toBe(2);
      // Chronological tail: entries 3 and 4
      expect(limited[0]!.summary).toBe('Frontend test page');
      expect(limited[1]!.summary).toBe('Approved UI design');
    });
  });

  describe('Markdown Summary Formatting (getRecentSummaryMarkdown)', () => {
    it('should return placeholder message when session work log is empty', async () => {
      const summary = await workLogService.getRecentSummaryMarkdown(sessionId);
      expect(summary).toBe('(Belum ada riwayat kerja yang dicatat dalam sesi ini.)');
    });

    it('should format multiple entries into readable markdown list', async () => {
      await workLogService.recordWork(sessionId, {
        botId: 'B001',
        botName: 'Coder',
        actionType: 'WRITE',
        targetRootId: 'backend',
        targetRootName: 'Backend API',
        targetRootPath: '/app/backend',
        relativePath: 'src/server.ts',
        summary: 'Created REST server',
      });

      await workLogService.recordWork(sessionId, {
        botId: 'B001',
        botName: 'Coder',
        actionType: 'COMMAND',
        targetRootId: 'backend',
        targetRootName: 'Backend API',
        targetRootPath: '/app/backend',
        summary: 'node tests/test.js (LULUS)',
      });

      const summary = await workLogService.getRecentSummaryMarkdown(sessionId, 5);
      expect(summary).toContain('Coder [WRITE] root "Backend API" (src/server.ts): Created REST server');
      expect(summary).toContain('Coder [COMMAND] root "Backend API": node tests/test.js (LULUS)');
    });
  });

  describe('Concurrent Append & Multi-Process Safety (NFR-305)', () => {
    it('should safely append work log entries concurrently without dropped records or file corruption', async () => {
      const CONCURRENT_COUNT = 25;
      const tasks = Array.from({ length: CONCURRENT_COUNT }, (_, i) => {
        return workLogService.recordWork(sessionId, {
          botId: `BOT_${i % 3}`,
          botName: `WorkerBot_${i % 3}`,
          actionType: i % 2 === 0 ? 'WRITE' : 'COMMAND',
          targetRootId: i % 2 === 0 ? 'backend' : 'frontend',
          targetRootName: i % 2 === 0 ? 'Backend' : 'Frontend',
          targetRootPath: i % 2 === 0 ? '/app/backend' : '/app/frontend',
          relativePath: `file_${i}.ts`,
          summary: `Task action ${i}`,
          details: { index: i },
        });
      });

      const results = await Promise.all(tasks);
      expect(results.length).toBe(CONCURRENT_COUNT);

      // Verify all records in file
      const logs = await workLogService.readWorkLogs(sessionId);
      expect(logs.length).toBe(CONCURRENT_COUNT);

      // Verify unique entry IDs
      const uniqueIds = new Set(logs.map((l) => l.entry_id));
      expect(uniqueIds.size).toBe(CONCURRENT_COUNT);
    });
  });

  describe('Corrupted Data Recovery & Robustness', () => {
    it('should throw CorruptedDataError when encountering invalid JSONL line', async () => {
      const workLogFile = storage.getWorkLogFilePath(sessionId);
      await fs.writeFile(workLogFile, 'VALID_NOT_JSON\n', 'utf-8');

      await expect(workLogService.readWorkLogs(sessionId)).rejects.toThrow(
        CorruptedDataError
      );
    });
  });
});
