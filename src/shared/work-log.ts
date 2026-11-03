import { z } from 'zod';
import crypto from 'node:crypto';
import type { IBlackboardStorage } from '../blackboard/interface.js';

export const WorkActionTypeSchema = z.enum([
  'WRITE',
  'EDIT',
  'READ',
  'COMMAND',
  'DECISION',
]);
export type WorkActionType = z.infer<typeof WorkActionTypeSchema>;

export const WorkLogEntrySchema = z.object({
  entry_id: z.string(),
  session_id: z.string(),
  timestamp: z.string().datetime(),
  bot_id: z.string(),
  bot_name: z.string(),
  action_type: WorkActionTypeSchema,
  target_root_id: z.string(),
  target_root_name: z.string(),
  target_root_path: z.string(),
  relative_path: z.string().optional(),
  full_path: z.string().optional(),
  summary: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional().default({}),
});
export type WorkLogEntry = z.infer<typeof WorkLogEntrySchema>;

export interface RecordWorkInput {
  botId: string;
  botName: string;
  actionType: WorkActionType;
  targetRootId: string;
  targetRootName: string;
  targetRootPath: string;
  relativePath?: string;
  fullPath?: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface ReadWorkLogOptions {
  limit?: number;
  rootId?: string;
  botId?: string;
  actionType?: WorkActionType;
}

export function generateWorkEntryId(): string {
  const rand = crypto.randomBytes(3).toString('hex');
  return `work_${Date.now()}_${rand}`;
}

export class WorkLogService {
  private readonly storage: IBlackboardStorage;

  constructor(storage: IBlackboardStorage) {
    this.storage = storage;
  }

  /**
   * Records a work action entry into the session's work_log.jsonl under session lock.
   */
  public async recordWork(
    sessionId: string,
    input: RecordWorkInput
  ): Promise<WorkLogEntry> {
    const entry: WorkLogEntry = {
      entry_id: generateWorkEntryId(),
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      bot_id: input.botId.trim(),
      bot_name: input.botName.trim(),
      action_type: input.actionType,
      target_root_id: input.targetRootId.trim(),
      target_root_name: input.targetRootName.trim(),
      target_root_path: input.targetRootPath.trim(),
      relative_path: input.relativePath?.trim(),
      full_path: input.fullPath?.trim(),
      summary: input.summary.trim(),
      details: input.details ?? {},
    };

    const validated = WorkLogEntrySchema.parse(entry);
    await this.storage.appendWorkLog(sessionId, validated);
    return validated;
  }

  /**
   * Reads and filters work log entries from the session.
   * If limit is specified, returns the most recent N matching entries.
   */
  public async readWorkLogs(
    sessionId: string,
    options?: ReadWorkLogOptions
  ): Promise<WorkLogEntry[]> {
    const all = await this.storage.readWorkLogs(sessionId);

    let filtered = all;

    if (options?.rootId) {
      const targetRoot = options.rootId.trim().toLowerCase();
      filtered = filtered.filter(
        (e) => e.target_root_id.toLowerCase() === targetRoot
      );
    }

    if (options?.botId) {
      const targetBot = options.botId.trim().toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.bot_id.toLowerCase() === targetBot ||
          e.bot_name.toLowerCase() === targetBot
      );
    }

    if (options?.actionType) {
      filtered = filtered.filter((e) => e.action_type === options.actionType);
    }

    if (options?.limit && options.limit > 0 && filtered.length > options.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  /**
   * Formats recent work log entries into a clean Markdown list suitable for
   * AI system prompt context injection.
   */
  public async getRecentSummaryMarkdown(
    sessionId: string,
    limit: number = 10
  ): Promise<string> {
    const entries = await this.readWorkLogs(sessionId, { limit });

    if (entries.length === 0) {
      return '(Belum ada riwayat kerja yang dicatat dalam sesi ini.)';
    }

    const lines = entries.map((entry) => {
      const rootDisplay = entry.target_root_name || entry.target_root_id;
      const pathSuffix = entry.relative_path ? ` (${entry.relative_path})` : '';
      const timeFormatted = entry.timestamp.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
      return `- [${timeFormatted}] ${entry.bot_name} [${entry.action_type}] root "${rootDisplay}"${pathSuffix}: ${entry.summary}`;
    });

    return lines.join('\n');
  }
}
