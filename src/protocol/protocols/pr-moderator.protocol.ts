import type {
  IProtocol,
  ProtocolDecision,
  ProtocolEvaluation,
} from '../contracts.js';
import {
  CapabilityTokenSchema,
  PROTOCOL_SCHEMA_VERSION,
  generateProtocolId,
  type AccessMode,
  type CapabilityToken,
  type ModeratorState,
  type ProtocolConfig,
} from '../schema.js';
import { ProtocolStore } from '../store.js';

export interface PrModeratorContext {
  sessionId: string;
  operation: 'WRITE_CHECK' | 'ISSUE_TOKEN' | 'TRANSFER_TOKEN' | 'REVOKE_TOKEN' | 'DELEGATE';
  actorBotId: string;
  taskId?: string;
  tokenId?: string;
  fenceEpoch?: number;
  targetPath?: string;
  targetBotId?: string;
  allowedPaths?: string[];
  allowedComponents?: string[];
  accessMode?: AccessMode;
  requireToken?: boolean;
}

export function isGlobalWildcardPath(pattern: string): boolean {
  const norm = pattern.replace(/\\/g, '/').trim().replace(/^\.\//, '');
  return norm === '*' || norm === '**' || norm === '**/*';
}

function matchesAllowedPath(pattern: string, targetPath: string): boolean {
  const normPattern = pattern.replace(/\\/g, '/').trim();
  const normTarget = targetPath.replace(/\\/g, '/').trim();
  if (normPattern === '*' || normPattern === '**/*' || normPattern === '**') {
    return true;
  }
  if (normPattern.endsWith('/**') || normPattern.endsWith('/*')) {
    const prefix = normPattern.replace(/\/\*\*?$/, '');
    return normTarget === prefix || normTarget.startsWith(`${prefix}/`);
  }
  return normTarget === normPattern || normTarget.endsWith(`/${normPattern}`);
}

/**
 * PrModerator: Dynamic Arbitration & Write-Fencing protocol.
 * Issues, transfers, revokes, and validates fenced CapabilityTokens so
 * concurrent bots cannot stomp each other's workspace rights.
 */
export class PrModeratorArbitrationProtocol
  implements IProtocol<PrModeratorContext, ProtocolDecision>
{
  public readonly protocolId = 'PrModerator' as const;
  public readonly version = PROTOCOL_SCHEMA_VERSION;
  private defaultModeratorBotId = 'BOT000';
  private readonly store: ProtocolStore;

  constructor(store: ProtocolStore, defaultModeratorBotId = 'BOT000') {
    this.store = store;
    this.defaultModeratorBotId = defaultModeratorBotId;
  }

  public get isEnabled(): boolean {
    return true;
  }

  public configure(limits: Partial<ProtocolConfig>): void {
    if (limits.moderatorBotId) {
      this.defaultModeratorBotId = limits.moderatorBotId;
    }
  }

  public async getModeratorState(sessionId: string): Promise<ModeratorState> {
    return await this.store.getModeratorState(sessionId);
  }

  public async getActiveTokensForBot(
    sessionId: string,
    botId: string
  ): Promise<CapabilityToken[]> {
    const modState = await this.store.getModeratorState(sessionId);
    return Object.values(modState.tokens).filter(
      (t) => t.status === 'ACTIVE' && t.holderBotId === botId
    );
  }

  public async findActiveTokenForTask(
    sessionId: string,
    taskId: string,
    holderBotId?: string
  ): Promise<CapabilityToken | undefined> {
    const modState = await this.store.getModeratorState(sessionId);
    const matches = Object.values(modState.tokens).filter(
      (t) =>
        t.status === 'ACTIVE' &&
        t.taskId === taskId &&
        (!holderBotId || t.holderBotId === holderBotId)
    );
    return matches.sort((a, b) => b.fenceEpoch - a.fenceEpoch)[0];
  }

  public async findMatchingActiveTokenForPath(
    sessionId: string,
    botId: string,
    targetPath: string
  ): Promise<CapabilityToken | undefined> {
    const tokens = await this.getActiveTokensForBot(sessionId, botId);
    return tokens.find(
      (t) =>
        t.accessMode === 'EXCLUSIVE_WRITE' &&
        t.allowedPaths.some((p) => matchesAllowedPath(p, targetPath))
    );
  }

  public async delegateModerator(
    sessionId: string,
    delegateBotId: string,
    requesterBotId: string
  ): Promise<ModeratorState> {
    if (requesterBotId !== 'BOT000' && requesterBotId !== 'MASTER') {
      throw new Error('Only Master Bot (BOT000) may delegate the PrModerator seat.');
    }
    const now = new Date().toISOString();
    const next = await this.store.updateModeratorState(sessionId, (current) => ({
      ...current,
      activeModeratorBotId: delegateBotId,
      delegatedByMasterAt: now,
      updatedAt: now,
    }));
    await this.store.updateRuntimeState(sessionId, (rt) => ({
      ...rt,
      activeModeratorBotId: delegateBotId,
    }));
    await this.store.recordEvent(sessionId, {
      protocolId: this.protocolId,
      action: 'DELEGATE_MODERATOR',
      actorBotId: requesterBotId,
      reason: `Delegated PrModerator seat to ${delegateBotId}.`,
      metadata: { delegateBotId },
    });
    return next;
  }

  public async reclaimModerator(
    sessionId: string,
    requesterBotId: string
  ): Promise<ModeratorState> {
    if (requesterBotId !== 'BOT000' && requesterBotId !== 'MASTER') {
      throw new Error('Only Master Bot (BOT000) may reclaim the PrModerator seat.');
    }
    const now = new Date().toISOString();
    const next = await this.store.updateModeratorState(sessionId, (current) => ({
      ...current,
      activeModeratorBotId: 'BOT000',
      updatedAt: now,
    }));
    await this.store.updateRuntimeState(sessionId, (rt) => ({
      ...rt,
      activeModeratorBotId: 'BOT000',
    }));
    await this.store.recordEvent(sessionId, {
      protocolId: this.protocolId,
      action: 'RECLAIM_MODERATOR',
      actorBotId: requesterBotId,
      reason: 'Master Bot reclaimed PrModerator seat (BOT000).',
    });
    return next;
  }

  public async issueToken(
    sessionId: string,
    input: {
      taskId: string;
      holderBotId: string;
      issuerBotId?: string;
      allowedPaths?: string[];
      allowedComponents?: string[];
      accessMode?: AccessMode;
      allowWildcardScope?: boolean;
      allowMasterWrite?: boolean;
    }
  ): Promise<CapabilityToken> {
    const cleanedPaths = (input.allowedPaths ?? []).map((p) => p.trim()).filter(Boolean);
    const cleanedComponents = (input.allowedComponents ?? []).map((c) => c.trim()).filter(Boolean);

    let effectiveAccessMode: AccessMode;
    if (input.holderBotId === 'BOT000' && input.accessMode === undefined) {
      effectiveAccessMode = 'REVIEW_ONLY';
    } else if (cleanedPaths.length === 0 && input.accessMode === undefined) {
      effectiveAccessMode = 'REVIEW_ONLY';
    } else {
      effectiveAccessMode = input.accessMode ?? 'EXCLUSIVE_WRITE';
    }

    if (
      input.holderBotId === 'BOT000' &&
      effectiveAccessMode === 'EXCLUSIVE_WRITE' &&
      !input.allowMasterWrite
    ) {
      throw new Error(
        'PrModerator rejected EXCLUSIVE_WRITE CapabilityToken for Master Bot (BOT000): assign a worker bot or pass allowMasterWrite: true explicitly.'
      );
    }

    if (
      effectiveAccessMode === 'EXCLUSIVE_WRITE' &&
      !input.allowWildcardScope &&
      (cleanedPaths.length === 0 || cleanedPaths.some((p) => isGlobalWildcardPath(p)))
    ) {
      throw new Error(
        `PrModerator rejected EXCLUSIVE_WRITE CapabilityToken without concrete non-wildcard allowedPaths (received: [${cleanedPaths.join(', ')}]).`
      );
    }

    const now = new Date().toISOString();
    let issued!: CapabilityToken;

    const updated = await this.store.updateModeratorState(sessionId, (current) => {
      const nextEpoch = current.globalFenceEpoch + 1;
      const issuer = input.issuerBotId ?? current.activeModeratorBotId;
      const updatedTokens: Record<string, CapabilityToken> = { ...current.tokens };

      // Auto-revoke older active EXCLUSIVE_WRITE tokens for the same task
      for (const [id, tok] of Object.entries(updatedTokens)) {
        if (
          tok.status === 'ACTIVE' &&
          tok.taskId === input.taskId &&
          tok.accessMode === 'EXCLUSIVE_WRITE'
        ) {
          updatedTokens[id] = {
            ...tok,
            status: 'REVOKED',
            revokedAt: now,
          };
        }
      }

      issued = CapabilityTokenSchema.parse({
        tokenId: generateProtocolId('CTOK'),
        taskId: input.taskId,
        issuedByModeratorId: issuer,
        holderBotId: input.holderBotId,
        fenceEpoch: nextEpoch,
        allowedPaths: cleanedPaths,
        allowedComponents: cleanedComponents,
        accessMode: effectiveAccessMode,
        status: 'ACTIVE',
        issuedAt: now,
      });

      updatedTokens[issued.tokenId] = issued;

      return {
        ...current,
        globalFenceEpoch: nextEpoch,
        tokens: updatedTokens,
        updatedAt: now,
      };
    });

    await this.store.updateRuntimeState(sessionId, (rt) => ({
      ...rt,
      currentFenceEpoch: updated.globalFenceEpoch,
    }));

    await this.store.recordEvent(sessionId, {
      protocolId: this.protocolId,
      action: 'ISSUE_TOKEN',
      actorBotId: issued.issuedByModeratorId,
      taskId: issued.taskId,
      tokenId: issued.tokenId,
      fenceEpoch: issued.fenceEpoch,
      reason: `Issued ${issued.accessMode} token to ${issued.holderBotId} at epoch ${issued.fenceEpoch}.`,
      metadata: { holderBotId: issued.holderBotId, allowedPaths: issued.allowedPaths },
    });

    return issued;
  }

  public async transferToken(
    sessionId: string,
    tokenId: string,
    fromBotId: string,
    toBotId: string,
    overrideAllowedPaths?: string[]
  ): Promise<{ previousToken: CapabilityToken; nextToken: CapabilityToken }> {
    const cleanedOverride = overrideAllowedPaths?.map((p) => p.trim()).filter(Boolean);
    if (cleanedOverride && cleanedOverride.some((p) => isGlobalWildcardPath(p))) {
      throw new Error(
        `PrModerator rejected global wildcard override allowedPaths during token transfer: [${cleanedOverride.join(', ')}].`
      );
    }

    const now = new Date().toISOString();
    let previousToken!: CapabilityToken;
    let nextToken!: CapabilityToken;

    const updated = await this.store.updateModeratorState(sessionId, (current) => {
      const existing = current.tokens[tokenId];
      if (!existing) {
        throw new Error(`CapabilityToken not found: ${tokenId}`);
      }
      if (existing.status !== 'ACTIVE') {
        throw new Error(`CapabilityToken ${tokenId} is ${existing.status}, cannot transfer.`);
      }
      if (existing.holderBotId !== fromBotId && fromBotId !== current.activeModeratorBotId && fromBotId !== 'BOT000') {
        throw new Error(
          `Bot ${fromBotId} does not hold token ${tokenId} (held by ${existing.holderBotId}).`
        );
      }

      const nextEpoch = current.globalFenceEpoch + 1;
      previousToken = {
        ...existing,
        status: 'TRANSFERRED',
        revokedAt: now,
      };
      const nextAllowedPaths =
        cleanedOverride && cleanedOverride.length > 0
          ? cleanedOverride
          : existing.allowedPaths;
      const nextAccessMode: AccessMode =
        toBotId === 'BOT000' && existing.accessMode === 'EXCLUSIVE_WRITE'
          ? 'REVIEW_ONLY'
          : existing.accessMode;

      nextToken = CapabilityTokenSchema.parse({
        tokenId: generateProtocolId('CTOK'),
        taskId: existing.taskId,
        issuedByModeratorId: current.activeModeratorBotId,
        holderBotId: toBotId,
        fenceEpoch: nextEpoch,
        allowedPaths: nextAllowedPaths,
        allowedComponents: existing.allowedComponents,
        accessMode: nextAccessMode,
        status: 'ACTIVE',
        issuedAt: now,
      });

      return {
        ...current,
        globalFenceEpoch: nextEpoch,
        tokens: {
          ...current.tokens,
          [tokenId]: previousToken,
          [nextToken.tokenId]: nextToken,
        },
        updatedAt: now,
      };
    });

    await this.store.updateRuntimeState(sessionId, (rt) => ({
      ...rt,
      currentFenceEpoch: updated.globalFenceEpoch,
    }));

    await this.store.recordEvent(sessionId, {
      protocolId: this.protocolId,
      action: 'TRANSFER_TOKEN',
      actorBotId: fromBotId,
      taskId: nextToken.taskId,
      tokenId: nextToken.tokenId,
      fenceEpoch: nextToken.fenceEpoch,
      reason: `Transferred write capability from ${fromBotId} to ${toBotId} (epoch ${nextToken.fenceEpoch}).`,
      metadata: { previousTokenId: previousToken.tokenId },
    });

    return { previousToken, nextToken };
  }

  public async revokeToken(
    sessionId: string,
    tokenId: string,
    reason: string,
    actorBotId = 'BOT000'
  ): Promise<CapabilityToken> {
    const now = new Date().toISOString();
    let revoked!: CapabilityToken;

    await this.store.updateModeratorState(sessionId, (current) => {
      const existing = current.tokens[tokenId];
      if (!existing) {
        throw new Error(`CapabilityToken not found: ${tokenId}`);
      }
      revoked = {
        ...existing,
        status: 'REVOKED',
        revokedAt: now,
      };
      return {
        ...current,
        tokens: {
          ...current.tokens,
          [tokenId]: revoked,
        },
        updatedAt: now,
      };
    });

    await this.store.recordEvent(sessionId, {
      protocolId: this.protocolId,
      action: 'REVOKE_TOKEN',
      actorBotId,
      taskId: revoked.taskId,
      tokenId: revoked.tokenId,
      fenceEpoch: revoked.fenceEpoch,
      reason,
    });

    return revoked;
  }

  public async validateWriteAccess(
    sessionId: string,
    input: {
      botId: string;
      tokenId?: string;
      fenceEpoch?: number;
      targetPath?: string;
      requireToken?: boolean;
    }
  ): Promise<ProtocolDecision> {
    // Master / Moderator can always intervene when no explicit stale token was presented
    const modState = await this.store.getModeratorState(sessionId);
    const allTokens = Object.values(modState.tokens);
    const activeTokens = allTokens.filter((t) => t.status === 'ACTIVE');

    if (input.tokenId) {
      const token = modState.tokens[input.tokenId];
      if (!token) {
        return {
          allowed: false,
          protocol: this.protocolId,
          action: 'DENY',
          reason: `CapabilityToken ${input.tokenId} does not exist.`,
        };
      }
      if (token.status !== 'ACTIVE') {
        return {
          allowed: false,
          protocol: this.protocolId,
          action: 'DENY',
          reason: `Stale CapabilityToken ${token.tokenId} has status ${token.status}.`,
          metadata: { tokenStatus: token.status, fenceEpoch: token.fenceEpoch },
        };
      }
      if (token.holderBotId !== input.botId) {
        return {
          allowed: false,
          protocol: this.protocolId,
          action: 'DENY',
          reason: `CapabilityToken ${token.tokenId} is held by ${token.holderBotId}, not ${input.botId}.`,
        };
      }
      if (
        input.fenceEpoch !== undefined &&
        token.fenceEpoch !== input.fenceEpoch
      ) {
        return {
          allowed: false,
          protocol: this.protocolId,
          action: 'DENY',
          reason: `Fencing epoch mismatch on ${token.tokenId}: expected ${token.fenceEpoch}, got ${input.fenceEpoch}.`,
        };
      }
      if (token.accessMode !== 'EXCLUSIVE_WRITE') {
        return {
          allowed: false,
          protocol: this.protocolId,
          action: 'DENY',
          reason: `Token ${token.tokenId} has accessMode=${token.accessMode}; write denied.`,
        };
      }
      if (
        input.targetPath &&
        !token.allowedPaths.some((p) => matchesAllowedPath(p, input.targetPath!))
      ) {
        return {
          allowed: false,
          protocol: this.protocolId,
          action: 'DENY',
          reason: `Path "${input.targetPath}" is outside allowedPaths for token ${token.tokenId}.`,
        };
      }
      return {
        allowed: true,
        protocol: this.protocolId,
        action: 'ALLOW',
        reason: `Verified CapabilityToken ${token.tokenId} at epoch ${token.fenceEpoch}.`,
        metadata: { tokenId: token.tokenId, fenceEpoch: token.fenceEpoch },
      };
    }

    // No explicit tokenId passed: check whether ANY other bot (even against BOT000 — APP-BUG-20)
    // holds an active exclusive write lock on targetPath.
    if (input.targetPath) {
      const conflicting = activeTokens.find(
        (tok) =>
          tok.holderBotId !== input.botId &&
          tok.accessMode === 'EXCLUSIVE_WRITE' &&
          tok.allowedPaths.some((p) => matchesAllowedPath(p, input.targetPath!))
      );
      if (conflicting) {
        return {
          allowed: false,
          protocol: this.protocolId,
          action: 'DENY',
          reason: `Write fencing conflict on "${input.targetPath}": active EXCLUSIVE_WRITE token ${conflicting.tokenId} is held by ${conflicting.holderBotId} (epoch ${conflicting.fenceEpoch}).`,
          metadata: {
            conflictingTokenId: conflicting.tokenId,
            holderBotId: conflicting.holderBotId,
            fenceEpoch: conflicting.fenceEpoch,
          },
        };
      }
    }

    // Default-deny for non-Master workers when write-fencing is active in the session (APP-BUG-12 / S2b)
    if (input.botId !== 'BOT000') {
      const activeExclusiveTokens = activeTokens.filter(
        (tok) => tok.accessMode === 'EXCLUSIVE_WRITE'
      );
      const ownedExclusiveTokens = activeExclusiveTokens.filter(
        (tok) => tok.holderBotId === input.botId
      );

      if (input.requireToken || activeExclusiveTokens.length > 0) {
        if (ownedExclusiveTokens.length === 0) {
          return {
            allowed: false,
            protocol: this.protocolId,
            action: 'DENY',
            reason: `Worker ${input.botId} lacks an active EXCLUSIVE_WRITE CapabilityToken.`,
          };
        }

        if (input.targetPath) {
          const matchingOwned = ownedExclusiveTokens.find((tok) =>
            tok.allowedPaths.some((p) => matchesAllowedPath(p, input.targetPath!))
          );
          if (!matchingOwned) {
            return {
              allowed: false,
              protocol: this.protocolId,
              action: 'DENY',
              reason: `Write denied: path "${input.targetPath}" is outside active CapabilityToken allowedPaths for ${input.botId}.`,
            };
          }
          return {
            allowed: true,
            protocol: this.protocolId,
            action: 'ALLOW',
            reason: `Verified owned CapabilityToken ${matchingOwned.tokenId} (epoch ${matchingOwned.fenceEpoch}) for ${input.targetPath}.`,
            metadata: { tokenId: matchingOwned.tokenId, fenceEpoch: matchingOwned.fenceEpoch },
          };
        }
      }
    }

    return {
      allowed: true,
      protocol: this.protocolId,
      action: 'ALLOW',
      reason: 'No conflicting CapabilityToken write fence detected.',
    };
  }

  public async evaluate(
    ctx: PrModeratorContext
  ): Promise<ProtocolEvaluation<ProtocolDecision>> {
    if (ctx.operation === 'WRITE_CHECK') {
      const decision = await this.validateWriteAccess(ctx.sessionId, {
        botId: ctx.actorBotId,
        tokenId: ctx.tokenId,
        fenceEpoch: ctx.fenceEpoch,
        targetPath: ctx.targetPath,
        requireToken: ctx.requireToken,
      });
      return {
        protocolId: this.protocolId,
        triggered: !decision.allowed,
        priority: 4,
        decision,
      };
    }

    return {
      protocolId: this.protocolId,
      triggered: false,
      priority: 4,
      decision: {
        allowed: true,
        protocol: this.protocolId,
        action: 'ALLOW',
        reason: `PrModerator ready for operation ${ctx.operation}.`,
      },
    };
  }

  public async enforce(
    decision: ProtocolDecision,
    ctx: PrModeratorContext
  ): Promise<void> {
    if (!decision.allowed) {
      await this.store.recordEvent(ctx.sessionId, {
        protocolId: this.protocolId,
        action: decision.action,
        actorBotId: ctx.actorBotId,
        taskId: ctx.taskId,
        tokenId: ctx.tokenId,
        fenceEpoch: ctx.fenceEpoch,
        reason: decision.reason,
        metadata: decision.metadata ?? {},
      });
    }
  }

  public getStateSnapshot(): Record<string, unknown> {
    return {
      protocolId: this.protocolId,
      defaultModeratorBotId: this.defaultModeratorBotId,
    };
  }
}
