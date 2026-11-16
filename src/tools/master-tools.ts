import type { ToolDefinition } from '../ai/provider.js';
import type { BotService } from '../bot/service.js';
import type { MessagingService } from '../messaging/service.js';
import type { AccessMode, ModelSpec } from '../protocol/schema.js';
import type { SpawnManager } from '../protocol/spawn-manager.js';
import type { ProtocolSupervisor } from '../protocol/supervisor.js';

export const MANAGE_DYNAMIC_RULE_TOOL: ToolDefinition = {
  name: 'manage_dynamic_rule',
  description:
    'Adds, deactivates, or lists live Dynamic Rules governing all or specific bots in the session.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'deactivate', 'list'] },
      statement: { type: 'string', description: 'Rule text (for add).' },
      severity: { type: 'string', enum: ['ADVISORY', 'MANDATORY', 'HARD_STOP'] },
      scope: { type: 'string', enum: ['ALL_BOTS', 'SPECIFIC_BOT', 'TASK'] },
      target_id: { type: 'string' },
      rule_id: { type: 'string', description: 'Rule ID (for deactivate).' },
    },
    required: ['action'],
  },
};

export const DELEGATE_MODERATOR_ROLE_TOOL: ToolDefinition = {
  name: 'delegate_moderator_role',
  description: 'Delegates or reclaims the PrModerator arbitration seat (BOT000 only).',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['delegate', 'reclaim'] },
      target_bot_id: { type: 'string', description: 'Delegate Bot ID (for delegate).' },
    },
    required: ['action'],
  },
};

export const ISSUE_CAPABILITY_TOKEN_TOOL: ToolDefinition = {
  name: 'issue_capability_token',
  description: 'Issues or revokes a fenced PrModerator CapabilityToken for workspace writes.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['issue', 'revoke'] },
      task_id: { type: 'string' },
      holder_bot_id: { type: 'string' },
      allowed_paths: { type: 'array', items: { type: 'string' } },
      access_mode: { type: 'string', enum: ['EXCLUSIVE_WRITE', 'SHARED_READ', 'REVIEW_ONLY'] },
      token_id: { type: 'string', description: 'Token ID (for revoke).' },
      reason: { type: 'string' },
    },
    required: ['action'],
  },
};

export const SPAWN_WORKER_BOT_TOOL: ToolDefinition = {
  name: 'spawn_worker_bot',
  description:
    'Spawns a new specialized worker bot process (respecting PrBotGlobal, PrBot, and SpawnMode).',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Worker display name.' },
      role: { type: 'string', description: 'Role or specialty description.' },
      provider: { type: 'string' },
      model: { type: 'string' },
      task_id: { type: 'string' },
      allowed_paths: { type: 'array', items: { type: 'string' } },
    },
    required: ['name'],
  },
};

export const PAUSE_OR_KILL_BOT_TOOL: ToolDefinition = {
  name: 'pause_or_kill_bot',
  description: 'Pauses, activates, or stops/recycles a worker bot process.',
  parameters: {
    type: 'object',
    properties: {
      bot_id: { type: 'string' },
      action: { type: 'string', enum: ['pause', 'resume', 'stop', 'recycle'] },
    },
    required: ['bot_id', 'action'],
  },
};

export const RESOLVE_DEADEND_THREAD_TOOL: ToolDefinition = {
  name: 'resolve_deadend_thread',
  description: 'Resolves a PrDE mediating thread with Master ruling and notifies participants.',
  parameters: {
    type: 'object',
    properties: {
      thread_id: { type: 'string' },
      ruling: { type: 'string' },
      target_bot_id: { type: 'string' },
    },
    required: ['thread_id', 'ruling'],
  },
};

export const REASSIGN_HANDOVER_TASK_TOOL: ToolDefinition = {
  name: 'reassign_handover_task',
  description: 'Executes a PrIterasi takeover handover to another bot using PrTransfer.',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      from_bot_id: { type: 'string' },
      to_bot_id: { type: 'string' },
      reason: { type: 'string' },
      checkpoint_id: { type: 'string' },
    },
    required: ['task_id', 'from_bot_id', 'to_bot_id', 'reason'],
  },
};

export const MIGRATE_STALLED_MESSAGE_TOOL: ToolDefinition = {
  name: 'migrate_stalled_message',
  description: 'Redirects an unresolved PrMEend message to a qualified bot.',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      from_bot_id: { type: 'string' },
      to_bot_id: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['task_id', 'from_bot_id', 'to_bot_id', 'content'],
  },
};

export const MARK_GOAL_ACHIEVED_TOOL: ToolDefinition = {
  name: 'mark_goal_achieved',
  description:
    'Runs PrGate objective verification across GoalLedger tasks and disk targetFiles before finishing the macro loop.',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
    },
    required: ['summary'],
  },
};

export const MASTER_PROTOCOL_TOOLS: ToolDefinition[] = [
  MANAGE_DYNAMIC_RULE_TOOL,
  DELEGATE_MODERATOR_ROLE_TOOL,
  ISSUE_CAPABILITY_TOKEN_TOOL,
  SPAWN_WORKER_BOT_TOOL,
  PAUSE_OR_KILL_BOT_TOOL,
  RESOLVE_DEADEND_THREAD_TOOL,
  REASSIGN_HANDOVER_TASK_TOOL,
  MIGRATE_STALLED_MESSAGE_TOOL,
  MARK_GOAL_ACHIEVED_TOOL,
];

function assertMasterActor(trustedBotId: string, toolName: string): void {
  if (trustedBotId !== 'BOT000' && trustedBotId !== 'MASTER') {
    throw new Error(`${toolName} is restricted to Master Bot (BOT000).`);
  }
}

export interface MasterToolExecutionDeps {
  supervisor: ProtocolSupervisor;
  messagingService: MessagingService;
  botService: BotService;
  spawnManager?: SpawnManager;
  workspaceRoots: string[];
  sessionId: string;
  trustedBotId: string;
  dryRunSpawn?: boolean;
}

export async function executeMasterProtocolTool(
  toolName: string,
  rawArgs: Record<string, unknown>,
  deps: MasterToolExecutionDeps
): Promise<Record<string, unknown>> {
  const { supervisor, messagingService, botService, spawnManager, workspaceRoots, sessionId, trustedBotId } = deps;

  switch (toolName) {
    case 'manage_dynamic_rule': {
      assertMasterActor(trustedBotId, toolName);
      const action = String(rawArgs['action'] ?? 'list');
      if (action === 'add') {
        const statement = String(rawArgs['statement'] ?? '').trim();
        if (!statement) throw new Error('manage_dynamic_rule(add) requires statement.');
        const rule = await supervisor.rules.addRule(sessionId, {
          statement,
          severity: rawArgs['severity'] as 'ADVISORY' | 'MANDATORY' | 'HARD_STOP' | undefined,
          scope: rawArgs['scope'] as 'ALL_BOTS' | 'SPECIFIC_BOT' | 'TASK' | undefined,
          targetId: rawArgs['target_id'] ? String(rawArgs['target_id']) : undefined,
          createdBy: trustedBotId,
        });
        await messagingService.publishBroadcast(sessionId, {
          senderBotId: trustedBotId,
          category: 'DECISION',
          content: `[DYNAMIC_RULE ${rule.ruleId}][${rule.severity}] ${rule.statement}`,
        });
        return { action: 'added', rule };
      }
      if (action === 'deactivate') {
        const ruleId = String(rawArgs['rule_id'] ?? '').trim();
        const removed = await supervisor.rules.deactivateRule(sessionId, ruleId);
        return { action: 'deactivated', rule_id: ruleId, found: removed };
      }
      const rules = await supervisor.rules.listRules(sessionId, { activeOnly: true });
      return { action: 'list', count: rules.length, rules };
    }

    case 'delegate_moderator_role': {
      assertMasterActor(trustedBotId, toolName);
      const action = String(rawArgs['action'] ?? '');
      if (action === 'delegate') {
        const targetBotId = String(rawArgs['target_bot_id'] ?? '').trim();
        if (!targetBotId) throw new Error('delegate_moderator_role(delegate) requires target_bot_id.');
        const modState = await supervisor.prModerator.delegateModerator(
          sessionId,
          targetBotId,
          trustedBotId
        );
        return { activeModeratorBotId: modState.activeModeratorBotId };
      }
      const modState = await supervisor.prModerator.reclaimModerator(sessionId, trustedBotId);
      return { activeModeratorBotId: modState.activeModeratorBotId };
    }

    case 'issue_capability_token': {
      const modState = await supervisor.prModerator.getModeratorState(sessionId);
      if (
        trustedBotId !== 'BOT000' &&
        trustedBotId !== modState.activeModeratorBotId
      ) {
        throw new Error(
          `Only Master (BOT000) or active PrModerator (${modState.activeModeratorBotId}) may issue/revoke tokens.`
        );
      }
      const action = String(rawArgs['action'] ?? 'issue');
      if (action === 'revoke') {
        const tokenId = String(rawArgs['token_id'] ?? '').trim();
        const reason = String(rawArgs['reason'] ?? 'Revoked by Moderator').trim();
        const revoked = await supervisor.prModerator.revokeToken(
          sessionId,
          tokenId,
          reason,
          trustedBotId
        );
        return { revoked };
      }
      const taskId = String(rawArgs['task_id'] ?? '').trim();
      const holderBotId = String(rawArgs['holder_bot_id'] ?? '').trim();
      if (!taskId || !holderBotId) {
        throw new Error('issue_capability_token requires task_id and holder_bot_id.');
      }
      const allowedPaths = Array.isArray(rawArgs['allowed_paths'])
        ? rawArgs['allowed_paths'].map(String)
        : undefined;
      const accessMode = (rawArgs['access_mode'] as AccessMode | undefined) ?? 'EXCLUSIVE_WRITE';
      const token = await supervisor.issueTaskToken(sessionId, {
        taskId,
        holderBotId,
        allowedPaths,
        accessMode,
      });
      return { token };
    }

    case 'spawn_worker_bot': {
      assertMasterActor(trustedBotId, toolName);
      if (!spawnManager) {
        throw new Error('SpawnManager is not attached to this execution context.');
      }
      const config = await supervisor.store.getConfig(sessionId);
      const modelSpec: ModelSpec = {
        provider: rawArgs['provider'] ? String(rawArgs['provider']) : config.masterModel.provider,
        model: rawArgs['model'] ? String(rawArgs['model']) : config.masterModel.model,
        baseUrl: config.masterModel.baseUrl,
      };
      const outcome = await spawnManager.spawnWorker({
        sessionId,
        displayName: String(rawArgs['name'] ?? 'Worker').trim(),
        description: rawArgs['role'] ? String(rawArgs['role']) : undefined,
        requesterBotId: trustedBotId,
        model: modelSpec,
        taskId: rawArgs['task_id'] ? String(rawArgs['task_id']) : undefined,
        allowedPaths: Array.isArray(rawArgs['allowed_paths'])
          ? rawArgs['allowed_paths'].map(String)
          : undefined,
        workspaceRoots,
        dryRun: deps.dryRunSpawn,
      });
      return outcome as unknown as Record<string, unknown>;
    }

    case 'pause_or_kill_bot': {
      assertMasterActor(trustedBotId, toolName);
      const botId = String(rawArgs['bot_id'] ?? '').trim();
      const action = String(rawArgs['action'] ?? 'pause');
      const statusMap: Record<string, 'paused' | 'active' | 'stopped' | 'recycled'> = {
        pause: 'paused',
        resume: 'active',
        stop: 'stopped',
        recycle: 'recycled',
      };
      const nextStatus = statusMap[action] ?? 'stopped';
      const updated = await botService.updateStatus(sessionId, botId, nextStatus);
      if (action === 'stop' && spawnManager) {
        spawnManager.reapBotProcess(botId);
      }
      return { bot_id: updated.bot_id, status: updated.status };
    }

    case 'resolve_deadend_thread': {
      assertMasterActor(trustedBotId, toolName);
      const threadId = String(rawArgs['thread_id'] ?? '').trim();
      const ruling = String(rawArgs['ruling'] ?? '').trim();
      const targetBotId = rawArgs['target_bot_id'] ? String(rawArgs['target_bot_id']) : undefined;
      await supervisor.store.updateRuntimeState(sessionId, (rt) => {
        const existing = rt.threads[threadId];
        if (!existing) return rt;
        return {
          ...rt,
          threads: {
            ...rt.threads,
            [threadId]: {
              ...existing,
              status: 'RESOLVED',
              resolution: ruling,
              lastMessageAt: new Date().toISOString(),
            },
          },
        };
      });
      if (targetBotId) {
        await messagingService.sendDirectMessage(sessionId, {
          senderBotId: trustedBotId,
          recipient: targetBotId,
          messageType: 'NOTIFICATION',
          messageKind: 'DE_ESCALATION',
          threadId,
          content: `[MASTER RULING on ${threadId}] ${ruling}`,
        });
      }
      return { thread_id: threadId, status: 'RESOLVED', ruling };
    }

    case 'reassign_handover_task': {
      assertMasterActor(trustedBotId, toolName);
      const taskId = String(rawArgs['task_id'] ?? '').trim();
      const fromBotId = String(rawArgs['from_bot_id'] ?? '').trim();
      const toBotId = String(rawArgs['to_bot_id'] ?? '').trim();
      const reason = String(rawArgs['reason'] ?? '').trim();
      const checkpointId = rawArgs['checkpoint_id']
        ? String(rawArgs['checkpoint_id'])
        : undefined;

      const envelope = await supervisor.commitTaskTransfer({
        sessionId,
        taskId,
        fromBotId,
        toBotId,
        transferKind: 'PR_ITERASI_TAKEOVER',
        lastCompletedStep: `Reassigned by Master due to: ${reason}`,
        pendingNextStep: 'Execute assigned task cleanly under new CapabilityToken.',
        checkpointIdToRestore: checkpointId,
        workspaceRoots,
      });

      await supervisor.ledger.recordHandover(
        sessionId,
        taskId,
        {
          attempt: 1,
          fromBotId,
          toBotId,
          fromModel: 'previous',
          toModel: 'next',
          reason: 'ITERATION_LIMIT',
          summary: reason,
          checkpointRestored: envelope.checkpointRestored,
          timestamp: new Date().toISOString(),
        },
        { newBotId: toBotId, status: 'PENDING' }
      );

      return { envelope };
    }

    case 'migrate_stalled_message': {
      assertMasterActor(trustedBotId, toolName);
      const taskId = String(rawArgs['task_id'] ?? '').trim();
      const fromBotId = String(rawArgs['from_bot_id'] ?? '').trim();
      const toBotId = String(rawArgs['to_bot_id'] ?? '').trim();
      const content = String(rawArgs['content'] ?? '').trim();

      const envelope = await supervisor.commitTaskTransfer({
        sessionId,
        taskId,
        fromBotId,
        toBotId,
        transferKind: 'PR_ME_END_MIGRATION',
        lastCompletedStep: `Migrated by Master from ${fromBotId}`,
        pendingNextStep: content,
      });

      const sent = await messagingService.sendDirectMessage(sessionId, {
        senderBotId: trustedBotId,
        recipient: toBotId,
        messageType: 'REQUEST',
        messageKind: 'ME_END_MIGRATION',
        taskId,
        transferEnvelope: envelope,
        content: `[PrMEend Migration] ${content}`,
      });

      return { message_id: sent.message_id, migrated_to: sent.recipient_bot_id, envelope };
    }

    case 'mark_goal_achieved': {
      assertMasterActor(trustedBotId, toolName);
      const evaluation = await supervisor.verifyObjectiveGate(sessionId, workspaceRoots, {
        actorBotId: trustedBotId,
      });
      return {
        goal_achieved: evaluation.decision.allowed,
        action: evaluation.decision.action,
        reason: evaluation.decision.reason,
        details: evaluation.decision.metadata,
      };
    }

    default:
      throw new Error(`Unknown Master protocol tool: ${toolName}`);
  }
}
