import type { ToolDefinition } from '../ai/provider.js';
import type { BotService } from '../bot/service.js';
import type { MessagingService } from '../messaging/service.js';
import { OperationManifoldService } from '../operation/manifold-engine.js';
import type { AccessMode, GoalTaskStatus, ModelSpec } from '../protocol/schema.js';
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

export const CREATE_GOAL_BLUEPRINT_TOOL: ToolDefinition = {
  name: 'create_goal_blueprint',
  description:
    'Initializes or updates the shared GoalLedger blueprint with decomposed tasks, owners, targetFiles, and acceptanceCriteria (BOT000 only).',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Concise overall blueprint mission summary.' },
      tasks: {
        type: 'array',
        description: 'List of tasks in the decomposed execution plan.',
        items: {
          type: 'object',
          properties: {
            task_id: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            assigned_bot_id: { type: 'string' },
            role_hint: { type: 'string' },
            depends_on: { type: 'array', items: { type: 'string' } },
            target_files: { type: 'array', items: { type: 'string' } },
            acceptance_criteria: { type: 'array', items: { type: 'string' } },
            status: {
              type: 'string',
              enum: [
                'PENDING',
                'IN_PROGRESS',
                'HANDOVER_WAIT',
                'PEER_REVIEW',
                'REVISION',
                'DONE',
                'BLOCKED_HITL',
                'CANCELLED',
              ],
            },
          },
          required: ['title', 'description'],
        },
      },
    },
    required: ['summary', 'tasks'],
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
      allow_wildcard_scope: {
        type: 'boolean',
        description: 'Explicit override allowing wildcard path scope (disabled by default).',
      },
      allow_master_write: {
        type: 'boolean',
        description: 'Explicit override when masterStrictOrchestrator is false.',
      },
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
      role_archetype: {
        type: 'string',
        description: 'Optional Operation RoleArchetype ID (e.g. developer, reviewer).',
      },
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

export const APPLY_OPERATION_TOOL: ToolDefinition = {
  name: 'apply_operation',
  description:
    'Applies a registered #Operation (almudaya.operation/v0.3) by ID or alias to configure protocols, rules, skills, and dynamic swarm manifold.',
  parameters: {
    type: 'object',
    properties: {
      operation_id: {
        type: 'string',
        description: 'Operation ID, alias (#Operation-...), or trailing slug.',
      },
      parameters: {
        type: 'object',
        description: 'Optional mission input parameters validated against operation input_schema.',
      },
    },
    required: ['operation_id'],
  },
};

export const SYNTHESIZE_OPERATION_TOOL: ToolDefinition = {
  name: 'synthesize_operation',
  description:
    'Synthesizes an ad-hoc almudaya.operation/v0.3 Dynamic Swarm Manifold on the fly for novel missions (BOT000 only).',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Human-readable Operation name.' },
      objective: { type: 'string', description: 'Mission objective statement.' },
      orchestration_regime: {
        type: 'string',
        enum: ['emergent', 'blueprint_seeded', 'stage_gated'],
      },
      topology_shape: {
        type: 'string',
        enum: ['stigmergic', 'hierarchical', 'hybrid', 'pipeline', 'sub_manifold'],
      },
      l1_single_agent_fallback: { type: 'boolean' },
    },
    required: ['name', 'objective'],
  },
};

export const CRYSTALLIZE_OPERATION_TOOL: ToolDefinition = {
  name: 'crystallize_operation',
  description:
    'Crystallizes the active Dynamic Swarm Manifold into a reusable validated Operation directory in the workspace.',
  parameters: {
    type: 'object',
    properties: {
      target_id: { type: 'string', description: 'Optional target registry ID (a.b.c).' },
      version: { type: 'string', description: 'Optional semver version (e.g. 0.1.0).' },
      force: { type: 'boolean', description: 'Override GoalLedger completion check if true.' },
    },
  },
};

export const MASTER_PROTOCOL_TOOLS: ToolDefinition[] = [
  CREATE_GOAL_BLUEPRINT_TOOL,
  MANAGE_DYNAMIC_RULE_TOOL,
  DELEGATE_MODERATOR_ROLE_TOOL,
  ISSUE_CAPABILITY_TOKEN_TOOL,
  SPAWN_WORKER_BOT_TOOL,
  PAUSE_OR_KILL_BOT_TOOL,
  RESOLVE_DEADEND_THREAD_TOOL,
  REASSIGN_HANDOVER_TASK_TOOL,
  MIGRATE_STALLED_MESSAGE_TOOL,
  MARK_GOAL_ACHIEVED_TOOL,
  APPLY_OPERATION_TOOL,
  SYNTHESIZE_OPERATION_TOOL,
  CRYSTALLIZE_OPERATION_TOOL,
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
    case 'create_goal_blueprint': {
      assertMasterActor(trustedBotId, toolName);
      const summary = String(rawArgs['summary'] ?? '').trim();
      const rawTasks = Array.isArray(rawArgs['tasks']) ? rawArgs['tasks'] : [];
      if (!summary || rawTasks.length === 0) {
        throw new Error('create_goal_blueprint requires non-empty "summary" and "tasks" array.');
      }
      const mappedTasks = rawTasks.map((entry) => {
        const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
        return {
          taskId: item['task_id'] ? String(item['task_id']).trim() : undefined,
          title: String(item['title'] ?? 'Untitled Task').trim(),
          description: String(item['description'] ?? item['title'] ?? '').trim(),
          assignedBotId: item['assigned_bot_id'] ? String(item['assigned_bot_id']).trim() : undefined,
          roleHint: item['role_hint'] ? String(item['role_hint']).trim() : undefined,
          dependsOn: Array.isArray(item['depends_on']) ? item['depends_on'].map(String) : undefined,
          targetFiles: Array.isArray(item['target_files']) ? item['target_files'].map(String) : undefined,
          acceptanceCriteria: Array.isArray(item['acceptance_criteria'])
            ? item['acceptance_criteria'].map(String)
            : undefined,
          status: item['status'] ? (String(item['status']).trim() as GoalTaskStatus) : undefined,
        };
      });
      const ledger = await supervisor.ledger.initializeBlueprint(sessionId, summary, mappedTasks);
      await messagingService.publishBroadcast(sessionId, {
        senderBotId: trustedBotId,
        category: 'DECISION',
        content: `[BLUEPRINT_INITIALIZED] ${ledger.tasks.length} task(s): ${summary}`,
        metadata: { taskIds: ledger.tasks.map((t) => t.taskId) },
      });
      return {
        action: 'blueprint_created',
        summary: ledger.blueprintSummary,
        task_count: ledger.tasks.length,
        tasks: ledger.tasks.map((t) => ({
          taskId: t.taskId,
          title: t.title,
          assignedBotId: t.assignedBotId,
          targetFiles: t.targetFiles,
          status: t.status,
        })),
      };
    }

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
      const config = await supervisor.store.getConfig(sessionId);
      const allowMasterWriteArg = Boolean(rawArgs['allow_master_write']);
      const allowWildcardArg = Boolean(rawArgs['allow_wildcard_scope']);

      if (holderBotId === 'BOT000' && accessMode === 'EXCLUSIVE_WRITE') {
        if (config.masterStrictOrchestrator !== false) {
          throw new Error(
            'issue_capability_token rejected EXCLUSIVE_WRITE self-grant to BOT000 while masterStrictOrchestrator is enabled; assign a worker bot or pass --allow-master-write.'
          );
        }
        if (!allowMasterWriteArg) {
          throw new Error(
            'issue_capability_token to BOT000 requires allow_master_write: true explicitly.'
          );
        }
      }

      const token = await supervisor.issueTaskToken(sessionId, {
        taskId,
        holderBotId,
        allowedPaths,
        accessMode,
        allowWildcardScope: allowWildcardArg,
        allowMasterWrite: allowMasterWriteArg && config.masterStrictOrchestrator === false,
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
        roleArchetype: rawArgs['role_archetype']
          ? String(rawArgs['role_archetype'])
          : rawArgs['role']
            ? String(rawArgs['role'])
            : undefined,
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

      const existingTask = await supervisor.ledger.getTask(sessionId, taskId);
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
        recordHandover: false,
      });

      await supervisor.ledger.recordHandover(
        sessionId,
        taskId,
        {
          attempt: (existingTask?.handoverCount ?? 0) + 1,
          fromBotId,
          toBotId,
          fromModel: 'previous',
          toModel: 'next',
          reason: 'ITERATION_LIMIT',
          summary: reason,
          checkpointRestored: envelope.checkpointRestored,
          newFenceEpoch: envelope.capabilityToken.fenceEpoch,
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

    case 'apply_operation': {
      assertMasterActor(trustedBotId, toolName);
      const operationId = String(rawArgs['operation_id'] ?? '').trim();
      if (!operationId) {
        throw new Error('apply_operation requires "operation_id".');
      }
      const parameters =
        rawArgs['parameters'] && typeof rawArgs['parameters'] === 'object'
          ? (rawArgs['parameters'] as Record<string, unknown>)
          : undefined;
      const manifold = new OperationManifoldService({
        storage: supervisor.store.getStorage(),
        supervisor,
      });
      const instance = await manifold.applyOperation(sessionId, operationId, {
        parameters,
        actorBotId: trustedBotId,
      });
      return {
        instance_id: instance.instanceId,
        operation_id: instance.operationId,
        version: instance.operationVersion,
        regime: instance.orchestrationRegime,
        status: instance.status,
        seeded_tasks: instance.seededTaskIds.length,
        dynamic_rules: instance.appliedDynamicRuleIds.length,
      };
    }

    case 'synthesize_operation': {
      assertMasterActor(trustedBotId, toolName);
      const name = String(rawArgs['name'] ?? '').trim();
      const objective = String(rawArgs['objective'] ?? '').trim();
      if (!name || !objective) {
        throw new Error('synthesize_operation requires "name" and "objective".');
      }
      const manifold = new OperationManifoldService({
        storage: supervisor.store.getStorage(),
        supervisor,
      });
      const instance = await manifold.synthesizeAdHocOperation(sessionId, {
        name,
        objective,
        orchestrationRegime: rawArgs['orchestration_regime'] as
          | 'emergent'
          | 'blueprint_seeded'
          | 'stage_gated'
          | undefined,
        topologyShape: rawArgs['topology_shape'] as
          | 'stigmergic'
          | 'hierarchical'
          | 'hybrid'
          | 'pipeline'
          | 'sub_manifold'
          | undefined,
        l1SingleAgentFallback:
          typeof rawArgs['l1_single_agent_fallback'] === 'boolean'
            ? rawArgs['l1_single_agent_fallback']
            : undefined,
        actorBotId: trustedBotId,
      });
      return {
        instance_id: instance.instanceId,
        operation_id: instance.operationId,
        synthesized_on_the_fly: instance.synthesizedOnTheFly,
        status: instance.status,
      };
    }

    case 'crystallize_operation': {
      assertMasterActor(trustedBotId, toolName);
      const manifold = new OperationManifoldService({
        storage: supervisor.store.getStorage(),
        supervisor,
      });
      return await manifold.crystallizeActiveOperation(sessionId, {
        targetId: rawArgs['target_id'] ? String(rawArgs['target_id']) : undefined,
        version: rawArgs['version'] ? String(rawArgs['version']) : undefined,
        force: Boolean(rawArgs['force']),
        actorBotId: trustedBotId,
      });
    }

    default:
      throw new Error(`Unknown Master protocol tool: ${toolName}`);
  }
}
