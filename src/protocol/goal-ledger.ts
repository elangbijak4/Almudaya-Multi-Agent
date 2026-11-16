import {
  GoalLedgerSchema,
  GoalTaskSchema,
  generateProtocolId,
  type GoalLedger,
  type GoalTask,
  type GoalTaskStatus,
  type HandoverRecord,
  type LastWorkPositionLog,
} from './schema.js';
import { ProtocolStore } from './store.js';

export interface CreateGoalTaskInput {
  taskId?: string;
  title: string;
  description: string;
  assignedBotId?: string;
  roleHint?: string;
  dependsOn?: string[];
  targetFiles?: string[];
  acceptanceCriteria?: string[];
  status?: GoalTaskStatus;
}

/**
 * Manages the shared GoalLedger under `protocol/goal_ledger.json`,
 * tracking blueprint tasks, assignments, fencing tokens, and handovers.
 */
export class GoalLedgerService {
  private readonly store: ProtocolStore;

  constructor(store: ProtocolStore) {
    this.store = store;
  }

  public async getLedger(sessionId: string): Promise<GoalLedger> {
    return await this.store.getGoalLedger(sessionId);
  }

  public async initializeBlueprint(
    sessionId: string,
    blueprintSummary: string,
    tasks: CreateGoalTaskInput[]
  ): Promise<GoalLedger> {
    const now = new Date().toISOString();
    return await this.store.updateGoalLedger(sessionId, (current) => {
      const createdTasks: GoalTask[] = tasks.map((item) =>
        GoalTaskSchema.parse({
          taskId: item.taskId ?? generateProtocolId('TASK'),
          title: item.title,
          description: item.description,
          assignedBotId: item.assignedBotId,
          roleHint: item.roleHint,
          dependsOn: item.dependsOn ?? [],
          targetFiles: item.targetFiles ?? [],
          acceptanceCriteria: item.acceptanceCriteria ?? [],
          status: item.status ?? 'PENDING',
          taskFenceToken: 1,
          triedModels: [],
          handoverCount: 0,
          handoverHistory: [],
          createdAt: now,
          updatedAt: now,
        })
      );

      return GoalLedgerSchema.parse({
        ...current,
        sessionId,
        blueprintSummary,
        tasks: createdTasks,
        updatedAt: now,
      });
    });
  }

  public async addTask(sessionId: string, input: CreateGoalTaskInput): Promise<GoalTask> {
    const now = new Date().toISOString();
    const task = GoalTaskSchema.parse({
      taskId: input.taskId ?? generateProtocolId('TASK'),
      title: input.title,
      description: input.description,
      assignedBotId: input.assignedBotId,
      roleHint: input.roleHint,
      dependsOn: input.dependsOn ?? [],
      targetFiles: input.targetFiles ?? [],
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      status: input.status ?? 'PENDING',
      taskFenceToken: 1,
      triedModels: [],
      handoverCount: 0,
      handoverHistory: [],
      createdAt: now,
      updatedAt: now,
    });

    await this.store.updateGoalLedger(sessionId, (current) => ({
      ...current,
      tasks: [...current.tasks, task],
      updatedAt: now,
    }));
    return task;
  }

  public async getTask(sessionId: string, taskId: string): Promise<GoalTask | undefined> {
    const ledger = await this.getLedger(sessionId);
    return ledger.tasks.find((t) => t.taskId === taskId);
  }

  public async updateTaskStatus(
    sessionId: string,
    taskId: string,
    status: GoalTaskStatus,
    options?: { assignedBotId?: string; latestCheckpointId?: string; lastWorkPositionLog?: LastWorkPositionLog }
  ): Promise<GoalTask> {
    let updatedTask: GoalTask | undefined;
    const now = new Date().toISOString();

    await this.store.updateGoalLedger(sessionId, (current) => {
      const nextTasks = current.tasks.map((task) => {
        if (task.taskId !== taskId) {
          return task;
        }
        updatedTask = {
          ...task,
          status,
          assignedBotId: options?.assignedBotId ?? task.assignedBotId,
          latestCheckpointId: options?.latestCheckpointId ?? task.latestCheckpointId,
          lastWorkPositionLog: options?.lastWorkPositionLog ?? task.lastWorkPositionLog,
          updatedAt: now,
        };
        return updatedTask;
      });
      return {
        ...current,
        tasks: nextTasks,
        updatedAt: now,
      };
    });

    if (!updatedTask) {
      throw new Error(`Goal task not found: ${taskId}`);
    }
    return updatedTask;
  }

  public async assignTask(
    sessionId: string,
    taskId: string,
    botId: string,
    bumpFenceToken = true
  ): Promise<GoalTask> {
    let updatedTask: GoalTask | undefined;
    const now = new Date().toISOString();

    await this.store.updateGoalLedger(sessionId, (current) => {
      const nextTasks = current.tasks.map((task) => {
        if (task.taskId !== taskId) {
          return task;
        }
        updatedTask = {
          ...task,
          assignedBotId: botId,
          taskFenceToken: bumpFenceToken ? task.taskFenceToken + 1 : task.taskFenceToken,
          updatedAt: now,
        };
        return updatedTask;
      });
      return {
        ...current,
        tasks: nextTasks,
        updatedAt: now,
      };
    });

    if (!updatedTask) {
      throw new Error(`Goal task not found: ${taskId}`);
    }
    return updatedTask;
  }

  public async recordHandover(
    sessionId: string,
    taskId: string,
    handover: HandoverRecord,
    nextOptions?: {
      newBotId?: string;
      status?: GoalTaskStatus;
      triedModel?: string;
      latestCheckpointId?: string;
      lastWorkPositionLog?: LastWorkPositionLog;
    }
  ): Promise<GoalTask> {
    let updatedTask: GoalTask | undefined;
    const now = new Date().toISOString();

    await this.store.updateGoalLedger(sessionId, (current) => {
      const nextTasks = current.tasks.map((task) => {
        if (task.taskId !== taskId) {
          return task;
        }
        const triedModels = new Set(task.triedModels);
        if (handover.fromModel) {
          triedModels.add(handover.fromModel);
        }
        if (nextOptions?.triedModel) {
          triedModels.add(nextOptions.triedModel);
        }
        updatedTask = {
          ...task,
          assignedBotId: nextOptions?.newBotId ?? handover.toBotId,
          status: nextOptions?.status ?? 'PENDING',
          taskFenceToken: task.taskFenceToken + 1,
          latestCheckpointId: nextOptions?.latestCheckpointId ?? task.latestCheckpointId,
          lastWorkPositionLog: nextOptions?.lastWorkPositionLog ?? task.lastWorkPositionLog,
          triedModels: Array.from(triedModels),
          handoverCount: task.handoverCount + 1,
          handoverHistory: [...task.handoverHistory, handover],
          updatedAt: now,
        };
        return updatedTask;
      });
      return {
        ...current,
        tasks: nextTasks,
        updatedAt: now,
      };
    });

    if (!updatedTask) {
      throw new Error(`Goal task not found: ${taskId}`);
    }
    return updatedTask;
  }

  public async hasOpenTasks(sessionId: string): Promise<boolean> {
    const ledger = await this.getLedger(sessionId);
    return ledger.tasks.some((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');
  }

  public async getPendingTasks(sessionId: string): Promise<GoalTask[]> {
    const ledger = await this.getLedger(sessionId);
    return ledger.tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');
  }

  public async formatSummaryMarkdown(sessionId: string, botId?: string): Promise<string> {
    const ledger = await this.getLedger(sessionId);
    if (ledger.tasks.length === 0 && !ledger.blueprintSummary) {
      return '';
    }

    const lines: string[] = [];
    if (ledger.blueprintSummary) {
      lines.push(`Blueprint: ${ledger.blueprintSummary}`);
    }

    const relevant = botId
      ? ledger.tasks.filter((t) => !t.assignedBotId || t.assignedBotId === botId)
      : ledger.tasks;

    for (const task of relevant) {
      const owner = task.assignedBotId ?? 'UNASSIGNED';
      const files = task.targetFiles.length > 0 ? ` | files: ${task.targetFiles.join(', ')}` : '';
      lines.push(`- [${task.taskId}] (${task.status}, owner=${owner}${files}): ${task.title}`);
    }
    return lines.join('\n');
  }
}
