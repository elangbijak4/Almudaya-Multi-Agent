import type { ToolDefinition } from '../ai/provider.js';
import type { MessagingService } from '../messaging/service.js';
import type {
  GoalTaskStatus,
  TaskVerificationEvidence,
  TouchedFileStatus,
} from '../protocol/schema.js';
import type { ProtocolSupervisor } from '../protocol/supervisor.js';

export const REQUEST_SPAWN_BOT_TOOL: ToolDefinition = {
  name: 'request_spawn_bot',
  description:
    'Requests Master Bot (BOT000) to spawn a new specialized worker bot, subject to PrBot and PrBotGlobal limits.',
  parameters: {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        description: 'Requested specialist role (e.g. QA-Tester, Frontend-Dev).',
      },
      reason: {
        type: 'string',
        description: 'Why a new worker bot is needed.',
      },
      task_id: {
        type: 'string',
        description: 'Optional GoalLedger taskId to assign to the new worker.',
      },
    },
    required: ['role', 'reason'],
  },
};

export const UPDATE_GOAL_TASK_TOOL: ToolDefinition = {
  name: 'update_goal_task',
  description:
    'Updates the progress or status of an assigned task in the shared GoalLedger.',
  parameters: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'Target GoalTask ID.',
      },
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
        description: 'New task status.',
      },
      last_completed_step: {
        type: 'string',
        description: 'Summary of the step most recently completed.',
      },
      pending_next_step: {
        type: 'string',
        description: 'Concrete next step remaining on this task.',
      },
      verification_evidence: {
        type: 'object',
        description:
          'Optional structured evidence confirming tests passed and live UI/interactive behavior was verified before DONE.',
        properties: {
          tested: { type: 'boolean' },
          ui_verified: { type: 'boolean' },
          notes: { type: 'string' },
        },
      },
    },
    required: ['task_id', 'status'],
  },
};

export const SUBMIT_TASK_HANDOFF_TOOL: ToolDefinition = {
  name: 'submit_task_handoff',
  description:
    'Submits an atomic end-of-turn task handoff or completion signal (TASK_0) with PrTransfer envelope and CC: MASTER.',
  parameters: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'GoalLedger task ID being handed off or finished.',
      },
      recipient: {
        type: 'string',
        description:
          'Target bot ID/name, "UNKNOWN" if uncertain, or "TASK_0" if all work is complete.',
      },
      last_completed_step: {
        type: 'string',
        description: 'Factual last completed step by this bot.',
      },
      pending_next_step: {
        type: 'string',
        description: 'Exact next action for the receiving bot (or "Verify completion" for TASK_0).',
      },
      summary: {
        type: 'string',
        description: 'Context message for the receiving bot and MASTER.',
      },
      existing_token_id: {
        type: 'string',
        description: 'Optional active CapabilityToken ID to transfer atomically.',
      },
    },
    required: ['task_id', 'recipient', 'last_completed_step', 'pending_next_step', 'summary'],
  },
};

export const WORKER_PROTOCOL_TOOLS: ToolDefinition[] = [
  REQUEST_SPAWN_BOT_TOOL,
  UPDATE_GOAL_TASK_TOOL,
  SUBMIT_TASK_HANDOFF_TOOL,
];

export async function executeRequestSpawnBot(
  supervisor: ProtocolSupervisor,
  messagingService: MessagingService,
  sessionId: string,
  senderBotId: string,
  rawArgs: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const role = String(rawArgs['role'] ?? '').trim();
  const reason = String(rawArgs['reason'] ?? '').trim();
  const taskId = rawArgs['task_id'] ? String(rawArgs['task_id']).trim() : undefined;

  if (!role || !reason) {
    throw new Error('request_spawn_bot requires non-empty "role" and "reason".');
  }

  const decision = await supervisor.checkSpawnPermission(sessionId, {
    requesterBotId: senderBotId,
    enforceOnAllow: false,
  });

  if (!decision.allowed) {
    return {
      accepted: false,
      escalated: decision.action === 'ESCALATE_HITL',
      protocol: decision.protocol,
      reason: decision.reason,
    };
  }

  await messagingService.sendDirectMessage(sessionId, {
    senderBotId,
    recipient: 'BOT000',
    messageType: 'REQUEST',
    messageKind: 'TASK_LOOP',
    taskId,
    ccMaster: true,
    content: `[SPAWN_REQUEST] Role: ${role} | Task: ${taskId ?? 'N/A'} | Reason: ${reason}`,
  });

  return {
    accepted: true,
    requestedRole: role,
    forwardedToMaster: 'BOT000',
    reason: 'Spawn request forwarded to Master Bot (BOT000).',
  };
}

export async function executeUpdateGoalTask(
  supervisor: ProtocolSupervisor,
  sessionId: string,
  trustedBotId: string,
  rawArgs: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const taskId = String(rawArgs['task_id'] ?? '').trim();
  const status = String(rawArgs['status'] ?? '').trim() as GoalTaskStatus;
  if (!taskId || !status) {
    throw new Error('update_goal_task requires "task_id" and "status".');
  }

  const lastStep = rawArgs['last_completed_step']
    ? String(rawArgs['last_completed_step']).trim()
    : undefined;
  const nextStep = rawArgs['pending_next_step']
    ? String(rawArgs['pending_next_step']).trim()
    : undefined;

  let verificationEvidence: TaskVerificationEvidence | undefined;
  const rawEv = rawArgs['verification_evidence'];
  if (rawEv && typeof rawEv === 'object') {
    const ev = rawEv as Record<string, unknown>;
    verificationEvidence = {
      tested: typeof ev['tested'] === 'boolean' ? ev['tested'] : undefined,
      uiVerified: typeof ev['ui_verified'] === 'boolean' ? ev['ui_verified'] : undefined,
      notes: typeof ev['notes'] === 'string' ? ev['notes'].trim() : undefined,
    };
  }

  const updated = await supervisor.ledger.updateTaskStatus(sessionId, taskId, status, {
    lastWorkPositionLog:
      lastStep || nextStep
        ? {
            taskId,
            lastCompletedStep: lastStep ?? `Updated status to ${status} by ${trustedBotId}`,
            pendingNextStep: nextStep ?? 'Await Master/peer review.',
            touchedFiles: [],
            progressDeltaScore: 1,
            recordedAt: new Date().toISOString(),
          }
        : undefined,
    verificationEvidence,
  });

  return {
    task_id: updated.taskId,
    status: updated.status,
    verification_evidence: updated.verificationEvidence,
    updated_at: updated.updatedAt,
  };
}

export async function executeSubmitTaskHandoff(
  supervisor: ProtocolSupervisor,
  messagingService: MessagingService,
  sessionId: string,
  trustedSenderBotId: string,
  rawArgs: Record<string, unknown>,
  options?: { touchedFiles?: TouchedFileStatus[]; threadId?: string }
): Promise<Record<string, unknown>> {
  const taskId = String(rawArgs['task_id'] ?? '').trim();
  const recipient = String(rawArgs['recipient'] ?? '').trim();
  const lastCompletedStep = String(rawArgs['last_completed_step'] ?? '').trim();
  const pendingNextStep = String(rawArgs['pending_next_step'] ?? '').trim();
  const summary = String(rawArgs['summary'] ?? '').trim();
  const existingTokenId = rawArgs['existing_token_id']
    ? String(rawArgs['existing_token_id']).trim()
    : undefined;

  if (!taskId || !recipient || !lastCompletedStep || !pendingNextStep || !summary) {
    throw new Error(
      'submit_task_handoff requires task_id, recipient, last_completed_step, pending_next_step, and summary.'
    );
  }

  const isTaskZero = recipient.toUpperCase() === 'TASK_0';
  const isUnknown = recipient.toUpperCase() === 'UNKNOWN';

  // Resolve real destination safely: route TASK_0 or UNKNOWN directly to Master Bot (BOT000)
  let recipientExists = false;
  let actualDeliveryTarget = 'BOT000';
  if (!isTaskZero && !isUnknown) {
    try {
      const sentProbe = await messagingService.sendDirectMessage(sessionId, {
        senderBotId: trustedSenderBotId,
        recipient,
        messageType: 'REQUEST',
        messageKind: 'HANDOVER',
        taskId,
        threadId: options?.threadId,
        ccMaster: true,
        isTaskZero: false,
        recipientStatus: 'RESOLVED',
        content: summary,
      });
      recipientExists = true;
      actualDeliveryTarget = sentProbe.recipient_bot_id;
    } catch {
      recipientExists = false;
      actualDeliveryTarget = 'BOT000';
    }
  }

  const envelope = await supervisor.commitTaskTransfer({
    sessionId,
    taskId,
    fromBotId: trustedSenderBotId,
    toBotId: actualDeliveryTarget,
    transferKind: isTaskZero
      ? 'NORMAL_HANDOFF'
      : isUnknown || !recipientExists
        ? 'PR_ME_END_MIGRATION'
        : 'NORMAL_HANDOFF',
    lastCompletedStep,
    pendingNextStep,
    touchedFiles: options?.touchedFiles ?? [],
    existingTokenId,
  });

  const meEndEval = await supervisor.evaluatePrMeEnd({
    sessionId,
    senderBotId: trustedSenderBotId,
    recipientBotId: recipient,
    recipientExists,
    isTaskZero,
    messageContent: summary,
    hasSentLoopMessage: true,
  });

  // Always notify BOT000 with envelope metadata (CC: MASTER)
  if (actualDeliveryTarget === 'BOT000' || !recipientExists || isTaskZero || isUnknown) {
    await messagingService.sendDirectMessage(sessionId, {
      senderBotId: trustedSenderBotId,
      recipient: 'BOT000',
      messageType: 'NOTIFICATION',
      messageKind: isTaskZero
        ? 'TASK_0'
        : isUnknown || !recipientExists
          ? 'ME_END_MIGRATION'
          : 'HANDOVER',
      taskId,
      threadId: options?.threadId,
      ccMaster: true,
      isTaskZero,
      recipientStatus: isTaskZero
        ? 'RESOLVED'
        : isUnknown || !recipientExists
          ? 'UNKNOWN'
          : 'RESOLVED',
      transferEnvelope: envelope,
      content: `[${meEndEval.decision.action}] Task ${taskId}: ${summary}`,
    });
  } else if (trustedSenderBotId !== 'BOT000') {
    await messagingService.sendDirectMessage(sessionId, {
      senderBotId: trustedSenderBotId,
      recipient: 'BOT000',
      messageType: 'NOTIFICATION',
      messageKind: 'HANDOVER',
      taskId,
      threadId: options?.threadId,
      ccMaster: true,
      isTaskZero: false,
      recipientStatus: 'RESOLVED',
      transferEnvelope: envelope,
      content: `[CC: MASTER] Handover ${trustedSenderBotId} -> ${actualDeliveryTarget} (${taskId}): ${summary}`,
    });
  }

  return {
    delivered_to: actualDeliveryTarget,
    pr_me_end_action: meEndEval.decision.action,
    pr_me_end_reason: meEndEval.decision.reason,
    transfer_id: envelope.transferId,
    capability_token_id: envelope.capabilityToken.tokenId,
    fence_epoch: envelope.capabilityToken.fenceEpoch,
    cc_master: true,
  };
}
