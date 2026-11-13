import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { ExecutionModeController } from '../../src/bot/execution-mode.js';
import { BotService } from '../../src/bot/service.js';
import {
  LocalFilesystemPKUStore,
  ProjectCodebaseIndexer,
  createWorkspaceMemoryRuntime,
  deriveProjectUniverseId,
} from '../../src/memory_modules/index.js';
import { MessagingService } from '../../src/messaging/service.js';
import { SessionService } from '../../src/session/service.js';
import { SharedContextService } from '../../src/shared/service.js';

describe('PKU Incremental Codebase Indexer & Standardized Bot Reading (query_pku_memory)', () => {
  let workspaceDir: string;
  let projectDir: string;
  let storage: FilesystemSessionStorage;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-pku-ws-'));
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-pku-proj-'));
    storage = new FilesystemSessionStorage(workspaceDir);

    await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'src', 'auth.ts'),
      'export function verifyToken(token: string): boolean { return token.length > 0; }\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(projectDir, 'src', 'server.ts'),
      "import { verifyToken } from './auth.js';\nexport function startServer() { return verifyToken('ok'); }\n",
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
  });

  it('indexes project into L0/L1/L2 + Knowledge Graph and updates ONLY changed files incrementally', async () => {
    const pkuDir = path.join(workspaceDir, 'pku');
    const pkuStore = new LocalFilesystemPKUStore(pkuDir);
    const indexer = new ProjectCodebaseIndexer(pkuStore, pkuDir);
    const rootRecord = {
      root_id: 'app-root',
      name: 'App Root',
      path: projectDir,
      root_type: 'primary' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Initial full index
    const firstSync = await indexer.syncProjectRoot('S_IDX', rootRecord);
    expect(firstSync.addedCount).toBe(2);
    expect(firstSync.updatedCount).toBe(0);
    expect(firstSync.totalIndexedFiles).toBe(2);

    const pmuId = deriveProjectUniverseId('session_s_idx');
    const l0 = await pkuStore.queryKnowledge({
      projectUniverseIds: [pmuId],
      hierarchyLevels: ['L0'],
    });
    expect(l0.items.length).toBe(1);
    expect(l0.items[0].type).toBe('codebase.project_map');

    const l2 = await pkuStore.queryKnowledge({
      projectUniverseIds: [pmuId],
      hierarchyLevels: ['L2'],
      relationTraversalDepth: 1,
    });
    expect(l2.items.length).toBe(2);
    expect(l2.traversedRelations?.some((r) => r.relationType === 'depends_on')).toBe(true);

    // Re-sync with no changes -> 0 added, 0 updated, 2 unchanged
    const secondSync = await indexer.syncProjectRoot('S_IDX', rootRecord);
    expect(secondSync.addedCount).toBe(0);
    expect(secondSync.updatedCount).toBe(0);
    expect(secondSync.unchangedCount).toBe(2);

    // Modify ONLY src/auth.ts -> only 1 file updated, src/server.ts untouched
    await fs.writeFile(
      path.join(projectDir, 'src', 'auth.ts'),
      'export function verifyToken(token: string): boolean { return token.startsWith("v2_"); }\nexport function revokeToken() {}\n',
      'utf-8'
    );
    const thirdSync = await indexer.syncProjectRoot('S_IDX', rootRecord);
    expect(thirdSync.updatedCount).toBe(1);
    expect(thirdSync.unchangedCount).toBe(1);

    // Single-file update hook on src/auth.ts when unchanged returns updated: false
    const singleUnchanged = await indexer.indexSingleFile(
      'S_IDX',
      rootRecord,
      path.join(projectDir, 'src', 'auth.ts')
    );
    expect(singleUnchanged.updated).toBe(false);
  });

  it('equips AutonomousAgentLoop with PKU-First Policy, query_pku_memory tool, and single-file index update on write_file', async () => {
    const sessionService = new SessionService(storage);
    await sessionService.createSession({
      sessionId: 'S_BOT_PKU',
      sessionName: 'Bot PKU Test',
    });

    const sharedContext = new SharedContextService(storage);
    await sharedContext.registerProjectRoot('S_BOT_PKU', {
      rootId: 'app-root',
      name: 'App Root',
      path: projectDir,
      rootType: 'primary',
    });

    const botService = new BotService(storage);
    await botService.registerBot(
      'S_BOT_PKU',
      { botId: 'BOT001', displayName: 'AuditorBot', description: 'Security Auditor' }
    );

    const mockProvider = new MockAIProvider('mock-model-v1', [
      {
        toolCalls: [
          {
            id: 'tc_1',
            name: 'query_pku_memory',
            arguments: { query: 'verifyToken', level: 'auto' },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'tc_2',
            name: 'write_file',
            arguments: {
              path: path.join(projectDir, 'src', 'audit-note.md'),
              content: '# Audit Note\nVerified via PKU.\n',
            },
          },
        ],
      },
      {
        text: 'Audit selesai menggunakan ringkasan PKU.',
      },
    ]);

    const memoryRuntime = createWorkspaceMemoryRuntime(storage)!;
    const agentLoop = new AutonomousAgentLoop({
      sessionId: 'S_BOT_PKU',
      botId: 'BOT001',
      storage,
      provider: mockProvider,
      executionModeController: new ExecutionModeController('TURBO'),
      memoryRuntime,
    });

    const messagingService = new MessagingService(storage, botService);
    const msg = await messagingService.sendDirectMessage('S_BOT_PKU', {
      senderBotId: 'OPERATOR',
      recipient: 'BOT001',
      content: 'Audit proyek ini.',
    });

    const reply = await agentLoop.handleMessage(msg);
    expect(reply).toContain('Audit selesai');

    // Verify system prompt enforces PKU-First Policy and query_pku_memory tool is registered
    expect(mockProvider.calls.length).toBeGreaterThanOrEqual(1);
    expect(mockProvider.calls[0].systemPrompt).toContain('PKU-First Policy');
    expect(mockProvider.calls[0].systemPrompt).toContain('query_pku_memory');
    expect(mockProvider.calls[0].tools?.some((t) => t.name === 'query_pku_memory')).toBe(true);

    // Verify write_file triggered single-file incremental indexing of src/audit-note.md
    const pmuId = deriveProjectUniverseId('session_s_bot_pku');
    const pkuStore = new LocalFilesystemPKUStore(path.join(workspaceDir, 'pku'));
    const indexedNote = await pkuStore.queryKnowledge({
      projectUniverseIds: [pmuId],
      text: 'audit-note.md',
      hierarchyLevels: ['L2'],
    });
    expect(indexedNote.items.length).toBe(1);
    expect(indexedNote.items[0].title).toContain('audit-note.md');
  }, 15000);
});
