import type { ToolDefinition } from '../ai/provider.js';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import { WorkLogService, type WorkLogEntry } from '../shared/work-log.js';

export const GET_WORK_LOG_TOOL: ToolDefinition = {
  name: 'get_work_log',
  description:
    'Mengambil riwayat kerja terkini seluruh bot di session untuk orkestrasi lintas-root yang akurat.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Jumlah entri maksimal yang diambil (default: 10).',
      },
      root_id: {
        type: 'string',
        description: 'Filter berdasarkan ID root proyek spesifik (opsional).',
      },
      bot_id: {
        type: 'string',
        description: 'Filter berdasarkan ID atau nama bot spesifik (opsional).',
      },
    },
  },
};

export interface GetWorkLogArgs {
  limit?: number;
  root_id?: string;
  bot_id?: string;
}

export interface GetWorkLogResult {
  total: number;
  entries: WorkLogEntry[];
  summary: string;
}

/**
 * Executes get_work_log function call from LLM.
 */
export async function executeGetWorkLog(
  storage: IBlackboardStorage,
  sessionId: string,
  args: Record<string, unknown>
): Promise<GetWorkLogResult> {
  const service = new WorkLogService(storage);

  const limit =
    typeof args['limit'] === 'number' && args['limit'] > 0 ? args['limit'] : 10;
  const rootId =
    typeof args['root_id'] === 'string' && args['root_id'].trim().length > 0
      ? args['root_id'].trim()
      : undefined;
  const botId =
    typeof args['bot_id'] === 'string' && args['bot_id'].trim().length > 0
      ? args['bot_id'].trim()
      : undefined;

  const entries = await service.readWorkLogs(sessionId, {
    limit,
    rootId,
    botId,
  });

  const summary = await service.getRecentSummaryMarkdown(sessionId, limit);

  return {
    total: entries.length,
    entries,
    summary,
  };
}
