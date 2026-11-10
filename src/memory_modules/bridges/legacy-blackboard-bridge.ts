import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { IBlackboardStorage } from '../../blackboard/interface.js';
import { BotRecordSchema, BotRegistrySchema, type BotRecord } from '../../bot/schema.js';
import {
  CapabilityGrantSchema,
  SecurityAuditEventSchema,
  type CapabilityGrant,
  type SecurityAuditEvent,
} from '../../capability/schema.js';
import { pathExists } from '../../core/fs-utils.js';
import { parseJsonl } from '../../core/jsonl.js';
import { redactRecursively } from '../../execution/environment.js';
import {
  BroadcastCursorSchema,
  BroadcastEventSchema,
  CURRENT_MESSAGING_SCHEMA_VERSION,
  InboxStoreSchema,
  type BroadcastCursor,
  type BroadcastEvent,
  type DirectMessage,
  type InboxStore,
} from '../../messaging/schema.js';
import {
  CURRENT_SHARED_CONTEXT_SCHEMA_VERSION,
  EnvironmentMetadataSchema,
  ProjectRootsRegistrySchema,
  SdlcDocumentsRegistrySchema,
  type DocumentType,
  type EnvironmentMetadata,
  type ProjectRootRecord,
  type ProjectRootsRegistry,
  type SdlcDocumentRecord,
  type SdlcDocumentsRegistry,
} from '../../shared/schema.js';
import { WorkLogEntrySchema, type WorkLogEntry } from '../../shared/work-log.js';
import {
  computeContentHash,
  deriveIdempotencyKey,
  deriveKnowledgeId,
  deriveMemoryEventId,
  deriveProjectUniverseId,
  deriveRelationId,
  deriveTreeNodeId,
} from '../contracts/identity.js';
import {
  qualifiesBroadcastForKnowledgePromotion,
  qualifiesDirectMessageForKnowledgeExtraction,
} from '../contracts/ownership.js';
import {
  validateKnowledgeObject,
  validateMemoryEvent,
  validateProjectMemoryUniverse,
  validateRegisterSnapshot,
} from '../contracts/schemas.js';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  type KnowledgeObject,
  type KnowledgeProvenance,
  type KnowledgeRelation,
  type KnowledgeTreeDomain,
  type KnowledgeTreeNode,
  type MemoryEvent,
  type ProjectMemoryUniverse,
  type RegisterSnapshot,
} from '../contracts/types.js';
import type { IGlobalRegisterBridge } from '../ports/registers.js';

/**
 * Diagnostic record for malformed legacy JSON or JSONL entries isolated during read-only export.
 * Never mutates the legacy session directory (PKU-005).
 */
export interface QuarantinedLegacyRecord {
  sourcePath: string;
  sourceType: string;
  lineNumber?: number;
  rawContent: string;
  error: string;
  detectedAt: string;
}

/**
 * Source-to-PKU parity and reconciliation summary for a single session export (Gate 2).
 */
export interface LegacyExportParityReport {
  sessionId: string;
  migrationBatchId: string;
  exportedAt: string;
  sourceCounts: {
    sessionMetadata: number;
    projectRoots: number;
    bots: number;
    environmentMetadata: number;
    sdlcDocuments: number;
    broadcastEvents: number;
    directMessages: number;
    broadcastCursors: number;
    workLogEntries: number;
    capabilityGrants: number;
    securityAuditEvents: number;
  };
  exportedCounts: {
    projectUniverses: number;
    knowledgeObjects: number;
    memoryEvents: number;
    globalSnapshots: number;
    individualSnapshots: number;
    relations: number;
    treeNodes: number;
    quarantinedRecords: number;
  };
  unexplainedMissingCount: number;
  parityVerified: boolean;
}

/**
 * Complete read-only export bundle produced from a legacy session (Phase 2 — Gate 2).
 */
export interface LegacySessionExportBundle {
  sessionId: string;
  migrationBatchId: string;
  ingestedAt: string;
  defaultProjectUniverse: ProjectMemoryUniverse;
  projectUniverses: ProjectMemoryUniverse[];
  knowledgeObjects: KnowledgeObject[];
  memoryEvents: MemoryEvent[];
  globalRegisterSnapshot: RegisterSnapshot;
  individualRegisterSnapshots: RegisterSnapshot[];
  relations: KnowledgeRelation[];
  treeNodes: KnowledgeTreeNode[];
  quarantinedRecords: QuarantinedLegacyRecord[];
  parityReport: LegacyExportParityReport;
}

export interface ReadOnlyBlackboardBridgeOptions {
  /**
   * Deterministic timestamp override for reproducible snapshot tests.
   * Defaults to current ISO-8601 timestamp when omitted.
   */
  ingestedAt?: string;
  /**
   * Optional batch identifier for provenance traceability.
   */
  migrationBatchId?: string;
  /**
   * Optional custom secrets to redact before computing hashes or storing payloads.
   */
  customSecrets?: string[];
}

export interface FileChecksumEntry {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Computes a deterministic SHA-256 manifest of all files inside a directory tree.
 * Used by Phase 2 acceptance tests (PKU-005) to prove zero legacy file mutation.
 */
export async function computeDirectoryManifest(rootDir: string): Promise<FileChecksumEntry[]> {
  if (!(await pathExists(rootDir))) {
    return [];
  }

  const results: FileChecksumEntry[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const buffer = await fs.readFile(fullPath);
        const stat = await fs.stat(fullPath);
        const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        results.push({
          relativePath,
          sizeBytes: stat.size,
          sha256,
        });
      }
    }
  }

  await walk(rootDir);
  return results;
}

function mapDocumentTypeToTreeDomain(docType: DocumentType): KnowledgeTreeDomain {
  switch (docType) {
    case 'SRS':
    case 'REQUIREMENTS':
      return 'Requirements';
    case 'ARCHITECTURE':
    case 'DESIGN':
    case 'API_SPEC':
      return 'Architecture';
    case 'TEST_PLAN':
      return 'Tests';
    default:
      return 'Development';
  }
}

/**
 * Read-Only Legacy Blackboard Compatibility Bridge (Phase 2 — PKU-003, PKU-004, PKU-005).
 *
 * Wraps `IBlackboardStorage` without mutating any legacy session files.
 * Extracts canonical PKU candidates (`ProjectMemoryUniverse`, `KnowledgeObject`,
 * `MemoryEvent`, `RegisterSnapshot`, `KnowledgeRelation`, `KnowledgeTreeNode`)
 * with full provenance and non-destructive quarantine diagnostics.
 */
export class ReadOnlyBlackboardCompatibilityBridge implements IGlobalRegisterBridge {
  public readonly mode = 'read_only' as const;
  private readonly storage: IBlackboardStorage;
  private readonly defaultOptions: ReadOnlyBlackboardBridgeOptions;

  constructor(storage: IBlackboardStorage, options: ReadOnlyBlackboardBridgeOptions = {}) {
    this.storage = storage;
    this.defaultOptions = options;
  }

  /**
   * In `read_only` mode, `captureEvent` is a safe no-op that never mutates legacy or PKU storage.
   */
  public async captureEvent(
    _sessionId: string,
    _eventType: string,
    _payload: unknown,
    _idempotencyKey: string
  ): Promise<void> {
    // No-op in Phase 2 read_only mode
  }

  /**
   * Exports all persisted artifacts from a single legacy session into canonical PKU candidates
   * without writing or modifying any files on disk (PKU-003, PKU-005).
   */
  public async exportSession(
    sessionId: string,
    options: ReadOnlyBlackboardBridgeOptions = {}
  ): Promise<LegacySessionExportBundle> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    const ingestedAt = mergedOptions.ingestedAt ?? new Date().toISOString();
    const customSecrets = mergedOptions.customSecrets ?? [];
    const sessionDir = this.storage.getSessionDir(sessionId);

    const quarantinedRecords: QuarantinedLegacyRecord[] = [];
    const knowledgeObjects: KnowledgeObject[] = [];
    const memoryEvents: MemoryEvent[] = [];
    const relations: KnowledgeRelation[] = [];
    const treeNodeMap = new Map<string, KnowledgeTreeNode>();

    // 1. Read Session Metadata (session.json)
    const sessionMeta = await this.storage.getSession(sessionId);
    const sanitizedSessionMeta = redactRecursively(sessionMeta, customSecrets);
    const sessionRelPath = `sessions/${sessionId}/session.json`;

    const migrationBatchId =
      mergedOptions.migrationBatchId ??
      `batch_${sessionId}_${computeContentHash(sanitizedSessionMeta, customSecrets).slice(0, 12)}`;

    // 2. Read Project Roots (registry/project_roots.json)
    const rootsFile = path.join(sessionDir, 'registry', 'project_roots.json');
    const rootsRelPath = `sessions/${sessionId}/registry/project_roots.json`;
    const projectRoots = await this.readOptionalJsonItems<ProjectRootRecord, ProjectRootsRegistry>(
      rootsFile,
      rootsRelPath,
      'ProjectRootsRegistry',
      ProjectRootsRegistrySchema,
      (reg) => reg.roots,
      async () => (await this.storage.getProjectRootsRegistry(sessionId)).roots,
      quarantinedRecords,
      ingestedAt
    );

    // Establish ProjectMemoryUniverse(s)
    const projectUniverses: ProjectMemoryUniverse[] = [];
    const primaryRoots = projectRoots.filter((r) => r.root_type === 'primary');

    const defaultProjectKey =
      primaryRoots[0]?.root_id ?? `session_${sessionMeta.session_id.toLowerCase()}`;
    const defaultPmuId = deriveProjectUniverseId(defaultProjectKey);
    const defaultRootNodeId = deriveTreeNodeId(defaultPmuId, 'Identity');

    const defaultUniverse = validateProjectMemoryUniverse({
      id: defaultPmuId,
      projectKey: defaultProjectKey,
      displayName: primaryRoots[0]?.name ?? sessionMeta.session_name,
      description:
        primaryRoots[0]?.description ??
        sessionMeta.description ??
        `Default Project Memory Universe for session ${sessionMeta.session_id}`,
      rootNodeId: defaultRootNodeId,
      status: sessionMeta.status === 'active' ? 'active' : 'archived',
      reusable: true,
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      createdAt: primaryRoots[0]?.created_at ?? sessionMeta.created_at,
      updatedAt: primaryRoots[0]?.updated_at ?? sessionMeta.updated_at,
      metadata: {
        sessionId: sessionMeta.session_id,
        sourcePath: primaryRoots[0] ? rootsRelPath : sessionRelPath,
      },
    });
    projectUniverses.push(defaultUniverse);

    // Ensure Identity tree node exists for default PMU
    this.ensureTreeNode(treeNodeMap, defaultPmuId, 'Identity', 'Project Identity', ingestedAt);

    // Map any additional primary roots to their own PMU
    for (let i = 1; i < primaryRoots.length; i++) {
      const root = primaryRoots[i]!;
      const pmuId = deriveProjectUniverseId(root.root_id);
      const rootNodeId = deriveTreeNodeId(pmuId, 'Identity');
      const pmu = validateProjectMemoryUniverse({
        id: pmuId,
        projectKey: root.root_id,
        displayName: root.name,
        description: root.description,
        rootNodeId,
        status: 'active',
        reusable: true,
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        createdAt: root.created_at,
        updatedAt: root.updated_at,
        metadata: {
          sessionId: sessionMeta.session_id,
          rootPath: root.path,
          sourcePath: rootsRelPath,
        },
      });
      projectUniverses.push(pmu);
      this.ensureTreeNode(treeNodeMap, pmuId, 'Identity', 'Project Identity', ingestedAt);
    }

    // Create KnowledgeObject for SessionMetadata
    const sessionKoId = deriveKnowledgeId({
      sourceSystem: 'almudaya.blackboard',
      projectUniverseId: defaultPmuId,
      sessionId,
      sourceType: 'SessionMetadata',
      sourceRecordId: sessionMeta.session_id,
    });
    const sessionContentHash = computeContentHash(sanitizedSessionMeta, customSecrets);
    const sessionProvenance: KnowledgeProvenance = {
      sourceSystem: 'almudaya.blackboard',
      sourceType: 'SessionMetadata',
      sourceId: sessionMeta.session_id,
      sourcePath: sessionRelPath,
      sourceSchemaVersion: sessionMeta.schema_version ?? '1.0.0',
      sourceTimestamp: sessionMeta.updated_at,
      createdBy: 'SYSTEM',
      createdAt: sessionMeta.created_at,
      ingestedAt,
      contentHash: sessionContentHash,
      migrationBatchId,
      originProjectUniverseId: defaultPmuId,
    };

    const identityNode = this.ensureTreeNode(
      treeNodeMap,
      defaultPmuId,
      'Identity',
      'Project Identity',
      ingestedAt
    );
    this.attachKnowledgeToTreeNode(identityNode, sessionKoId);

    const sessionKo = validateKnowledgeObject({
      id: sessionKoId,
      projectUniverseId: defaultPmuId,
      type: 'session.metadata',
      scope: 'session',
      ownerId: sessionMeta.session_id,
      title: sessionMeta.session_name,
      summary: sessionMeta.description ?? `Session ${sessionMeta.session_name}`,
      hierarchyLevel: 'L0',
      content: sanitizedSessionMeta,
      provenance: sessionProvenance,
      relationIds: [],
      treeNodeIds: [identityNode.nodeId],
      validationStatus: 'validated',
      lifecycleStatus: sessionMeta.status === 'active' ? 'active' : 'archived',
      reusable: false,
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      version: 1,
      createdAt: sessionMeta.created_at,
      updatedAt: sessionMeta.updated_at,
      tags: ['session', sessionMeta.status],
    });
    knowledgeObjects.push(sessionKo);

    // Create KnowledgeObjects for ProjectRoots
    for (const root of projectRoots) {
      const sanitizedRoot = redactRecursively(root, customSecrets);
      const targetPmuId =
        root.root_type === 'primary' ? deriveProjectUniverseId(root.root_id) : defaultPmuId;
      const rootKoId = deriveKnowledgeId({
        sourceSystem: 'almudaya.blackboard',
        projectUniverseId: targetPmuId,
        sessionId,
        sourceType: 'ProjectRootRecord',
        sourceRecordId: root.root_id,
      });
      const rootHash = computeContentHash(sanitizedRoot, customSecrets);
      const treeNode = this.ensureTreeNode(
        treeNodeMap,
        targetPmuId,
        'Identity',
        'Project Identity',
        ingestedAt
      );
      this.attachKnowledgeToTreeNode(treeNode, rootKoId);

      const rootKo = validateKnowledgeObject({
        id: rootKoId,
        projectUniverseId: targetPmuId,
        type: 'project.root',
        scope: 'project',
        ownerId: root.root_id,
        title: root.name,
        summary: root.description ?? `Project root ${root.name} (${root.root_type})`,
        hierarchyLevel: 'L0',
        content: sanitizedRoot,
        provenance: {
          sourceSystem: 'almudaya.blackboard',
          sourceType: 'ProjectRootRecord',
          sourceId: root.root_id,
          sourcePath: rootsRelPath,
          sourceSchemaVersion: CURRENT_SHARED_CONTEXT_SCHEMA_VERSION,
          sourceTimestamp: root.updated_at,
          createdBy: 'SYSTEM',
          createdAt: root.created_at,
          ingestedAt,
          contentHash: rootHash,
          migrationBatchId,
          originProjectUniverseId: targetPmuId,
        },
        relationIds: [],
        treeNodeIds: [treeNode.nodeId],
        validationStatus: 'validated',
        lifecycleStatus: 'active',
        reusable: true,
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: root.created_at,
        updatedAt: root.updated_at,
        tags: ['project_root', root.root_type],
      });
      knowledgeObjects.push(rootKo);
    }

    // 3. Read Bot Registry (registry/bots.json)
    const botsFile = path.join(sessionDir, 'registry', 'bots.json');
    const botsRelPath = `sessions/${sessionId}/registry/bots.json`;
    const bots = await this.readOptionalBots(
      botsFile,
      botsRelPath,
      sessionId,
      quarantinedRecords,
      ingestedAt
    );

    const botKoIdMap = new Map<string, string>();
    for (const bot of bots) {
      const sanitizedBot = redactRecursively(bot, customSecrets);
      const botKoId = deriveKnowledgeId({
        sourceSystem: 'almudaya.blackboard',
        projectUniverseId: defaultPmuId,
        sessionId,
        sourceType: 'BotRecord',
        sourceRecordId: bot.bot_id,
      });
      botKoIdMap.set(bot.bot_id, botKoId);

      // Compute stable identity hash excluding ephemeral last_seen_at/pid ticks (RISK-03)
      const stableBotProjection = {
        bot_id: sanitizedBot.bot_id,
        session_id: sanitizedBot.session_id,
        display_name: sanitizedBot.display_name,
        description: sanitizedBot.description,
        status: sanitizedBot.status,
        joined_at: sanitizedBot.joined_at,
        metadata: sanitizedBot.metadata,
      };
      const botHash = computeContentHash(stableBotProjection, customSecrets);

      const botKo = validateKnowledgeObject({
        id: botKoId,
        projectUniverseId: defaultPmuId,
        type: 'agent.identity',
        scope: 'agent',
        ownerId: bot.bot_id,
        title: bot.display_name,
        summary: bot.description ?? `Bot ${bot.display_name} (${bot.bot_id})`,
        hierarchyLevel: 'L1',
        content: sanitizedBot,
        provenance: {
          sourceSystem: 'almudaya.blackboard',
          sourceType: 'BotRecord',
          sourceId: bot.bot_id,
          sourcePath: botsRelPath,
          sourceSchemaVersion: '1.0.0',
          sourceTimestamp: bot.joined_at,
          createdBy: bot.bot_id,
          createdAt: bot.joined_at,
          ingestedAt,
          contentHash: botHash,
          migrationBatchId,
          originProjectUniverseId: defaultPmuId,
        },
        relationIds: [],
        validationStatus: 'validated',
        lifecycleStatus: bot.status === 'stopped' ? 'dormant' : 'active',
        reusable: false,
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: bot.joined_at,
        updatedAt: bot.last_seen_at,
        tags: ['bot', bot.status],
      });
      knowledgeObjects.push(botKo);
    }

    // 4. Read Environment Metadata (registry/environment.json)
    const envFile = path.join(sessionDir, 'registry', 'environment.json');
    const envRelPath = `sessions/${sessionId}/registry/environment.json`;
    const envMeta = await this.readOptionalSingleJson<EnvironmentMetadata>(
      envFile,
      envRelPath,
      'EnvironmentMetadata',
      EnvironmentMetadataSchema,
      async () => await this.storage.getEnvironmentMetadata(sessionId),
      quarantinedRecords,
      ingestedAt
    );

    if (envMeta) {
      const sanitizedEnv = redactRecursively(envMeta, customSecrets);
      const envKoId = deriveKnowledgeId({
        sourceSystem: 'almudaya.blackboard',
        projectUniverseId: defaultPmuId,
        sessionId,
        sourceType: 'EnvironmentMetadata',
        sourceRecordId: sessionId,
      });
      const envHash = computeContentHash(sanitizedEnv, customSecrets);
      const envKo = validateKnowledgeObject({
        id: envKoId,
        projectUniverseId: defaultPmuId,
        type: 'session.environment',
        scope: 'session',
        ownerId: sessionId,
        title: `Environment Metadata (${sanitizedEnv.os}/${sanitizedEnv.arch})`,
        summary: `Node ${sanitizedEnv.node_version}, npm ${sanitizedEnv.npm_version}`,
        hierarchyLevel: 'L2',
        content: sanitizedEnv,
        provenance: {
          sourceSystem: 'almudaya.blackboard',
          sourceType: 'EnvironmentMetadata',
          sourceId: sessionId,
          sourcePath: envRelPath,
          sourceSchemaVersion: sanitizedEnv.schema_version ?? CURRENT_SHARED_CONTEXT_SCHEMA_VERSION,
          sourceTimestamp: sanitizedEnv.updated_at,
          createdBy: 'SYSTEM',
          createdAt: sanitizedEnv.updated_at,
          ingestedAt,
          contentHash: envHash,
          migrationBatchId,
          originProjectUniverseId: defaultPmuId,
        },
        relationIds: [],
        validationStatus: 'validated',
        lifecycleStatus: 'active',
        reusable: false,
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: sanitizedEnv.updated_at,
        updatedAt: sanitizedEnv.updated_at,
        tags: ['environment', sanitizedEnv.os],
      });
      knowledgeObjects.push(envKo);
    }

    // 5. Read SDLC Documents Registry (registry/documents.json)
    const docsFile = path.join(sessionDir, 'registry', 'documents.json');
    const docsRelPath = `sessions/${sessionId}/registry/documents.json`;
    const sdlcDocs = await this.readOptionalJsonItems<SdlcDocumentRecord, SdlcDocumentsRegistry>(
      docsFile,
      docsRelPath,
      'SdlcDocumentsRegistry',
      SdlcDocumentsRegistrySchema,
      (reg) => reg.documents,
      async () => (await this.storage.getDocumentsRegistry(sessionId)).documents,
      quarantinedRecords,
      ingestedAt
    );

    for (const doc of sdlcDocs) {
      const sanitizedDoc = redactRecursively(doc, customSecrets);
      const docKoId = deriveKnowledgeId({
        sourceSystem: 'almudaya.blackboard',
        projectUniverseId: defaultPmuId,
        sessionId,
        sourceType: 'SdlcDocumentRecord',
        sourceRecordId: doc.document_id,
      });
      const docHash = computeContentHash(sanitizedDoc, customSecrets);
      const domain = mapDocumentTypeToTreeDomain(doc.document_type);
      const treeNode = this.ensureTreeNode(
        treeNodeMap,
        defaultPmuId,
        domain,
        `Project ${domain}`,
        ingestedAt
      );
      this.attachKnowledgeToTreeNode(treeNode, docKoId);

      const validationStatus =
        doc.status === 'approved'
          ? 'validated'
          : doc.status === 'deprecated'
            ? 'superseded'
            : 'unverified';

      const docKo = validateKnowledgeObject({
        id: docKoId,
        projectUniverseId: defaultPmuId,
        type: 'sdlc.document',
        scope: 'project',
        ownerId: doc.document_id,
        title: doc.title,
        summary: `${doc.document_type} document at ${doc.uri_or_path}`,
        hierarchyLevel: 'L2',
        content: sanitizedDoc,
        provenance: {
          sourceSystem: 'almudaya.blackboard',
          sourceType: 'SdlcDocumentRecord',
          sourceId: doc.document_id,
          sourcePath: docsRelPath,
          sourceSchemaVersion: CURRENT_SHARED_CONTEXT_SCHEMA_VERSION,
          sourceTimestamp: doc.updated_at,
          createdBy: 'SYSTEM',
          createdAt: doc.updated_at,
          ingestedAt,
          contentHash: docHash,
          migrationBatchId,
          originProjectUniverseId: defaultPmuId,
        },
        relationIds: [],
        treeNodeIds: [treeNode.nodeId],
        validationStatus,
        lifecycleStatus: doc.status === 'deprecated' ? 'archived' : 'active',
        reusable: true,
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: doc.updated_at,
        updatedAt: doc.updated_at,
        tags: ['sdlc_document', doc.document_type.toLowerCase(), doc.status],
      });
      knowledgeObjects.push(docKo);
    }

    // 6. Read Broadcast Events (broadcast/events.jsonl) without writing .corrupt.jsonl to legacy dir
    const broadcastFile = path.join(sessionDir, 'broadcast', 'events.jsonl');
    const broadcastRelPath = `sessions/${sessionId}/broadcast/events.jsonl`;
    const broadcastRecords = await this.readJsonlWithLineNumbers<BroadcastEvent>(
      broadcastFile,
      broadcastRelPath,
      'BroadcastEvent',
      BroadcastEventSchema,
      async () => await this.storage.readBroadcasts(sessionId),
      quarantinedRecords,
      ingestedAt
    );

    for (const { record: evt, lineNumber } of broadcastRecords) {
      const sanitizedEvt = redactRecursively(evt, customSecrets);
      const evtHash = computeContentHash(sanitizedEvt, customSecrets);
      const locator = lineNumber
        ? `${broadcastRelPath}#L${lineNumber}`
        : `${broadcastRelPath}#${evt.event_id}`;
      const evtId = deriveMemoryEventId({
        sourceSystem: 'almudaya.blackboard',
        sessionId,
        sourceType: 'BroadcastEvent',
        sourceRecordId: evt.event_id,
      });
      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.blackboard',
        scopeId: sessionId,
        sourceType: 'BroadcastEvent',
        sourceRecordId: evt.event_id,
        contentHash: evtHash,
      });

      const provenance: KnowledgeProvenance = {
        sourceSystem: 'almudaya.blackboard',
        sourceType: 'BroadcastEvent',
        sourceId: evt.event_id,
        sourcePath: locator,
        sourceSchemaVersion: CURRENT_MESSAGING_SCHEMA_VERSION,
        sourceTimestamp: evt.timestamp,
        createdBy: evt.sender_bot_id,
        createdAt: evt.timestamp,
        ingestedAt,
        contentHash: evtHash,
        migrationBatchId,
        originProjectUniverseId: defaultPmuId,
      };

      const memEvt = validateMemoryEvent({
        id: evtId,
        eventType: `broadcast.${evt.category.toLowerCase()}`,
        identity: {
          projectUniverseId: defaultPmuId,
          sessionId,
          botId: evt.sender_bot_id,
          principalId: evt.sender_bot_id,
          registerKind: 'global',
        },
        payload: sanitizedEvt,
        occurredAt: evt.timestamp,
        recordedAt: ingestedAt,
        idempotencyKey: idemKey,
        provenance,
      });
      memoryEvents.push(memEvt);

      // Promote DECISION / ARTIFACT / OBSERVATION broadcasts to KnowledgeObjects (Spec §9.3)
      if (qualifiesBroadcastForKnowledgePromotion(evt.category)) {
        const koId = deriveKnowledgeId({
          sourceSystem: 'almudaya.blackboard',
          projectUniverseId: defaultPmuId,
          sessionId,
          sourceType: `BroadcastEvent.${evt.category}`,
          sourceRecordId: evt.event_id,
        });
        const treeDomain: KnowledgeTreeDomain =
          evt.category === 'DECISION' ? 'Decisions' : 'Development';
        const treeNode = this.ensureTreeNode(
          treeNodeMap,
          defaultPmuId,
          treeDomain,
          `Project ${treeDomain}`,
          ingestedAt
        );
        this.attachKnowledgeToTreeNode(treeNode, koId);

        const relId = deriveRelationId(koId, 'executed_during', sessionKoId);
        const rel: KnowledgeRelation = {
          relationId: relId,
          projectUniverseId: defaultPmuId,
          fromId: koId,
          toId: sessionKoId,
          relationType: 'executed_during',
          createdAt: evt.timestamp,
          provenance,
        };
        relations.push(rel);

        const promotedKo = validateKnowledgeObject({
          id: koId,
          projectUniverseId: defaultPmuId,
          type: `session.${evt.category.toLowerCase()}`,
          scope: evt.category === 'DECISION' || evt.category === 'ARTIFACT' ? 'project' : 'session',
          ownerId: evt.sender_bot_id,
          title: `${evt.category}: ${sanitizedEvt.content.slice(0, 80)}`,
          summary: sanitizedEvt.content,
          hierarchyLevel: evt.category === 'DECISION' ? 'L2' : 'L3',
          content: sanitizedEvt,
          provenance,
          relationIds: [relId],
          treeNodeIds: [treeNode.nodeId],
          validationStatus: evt.category === 'DECISION' ? 'validated' : 'unverified',
          lifecycleStatus: 'active',
          reusable: evt.category === 'DECISION' || evt.category === 'ARTIFACT',
          schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
          version: 1,
          createdAt: evt.timestamp,
          updatedAt: evt.timestamp,
          tags: ['broadcast', evt.category.toLowerCase()],
        });
        knowledgeObjects.push(promotedKo);
      }
    }

    // 7 & 8. Read Per-Bot Inboxes (messages.json) and Broadcast Cursors (broadcast_cursor.json)
    const discoveredBotIds = await this.discoverAllBotIds(sessionDir, bots);
    const individualRegisterSnapshots: RegisterSnapshot[] = [];
    let totalDirectMessages = 0;
    let totalBroadcastCursors = 0;

    for (const botId of discoveredBotIds) {
      const inboxFile = path.join(sessionDir, 'inbox', botId, 'messages.json');
      const inboxRelPath = `sessions/${sessionId}/inbox/${botId}/messages.json`;
      const cursorFile = path.join(sessionDir, 'inbox', botId, 'broadcast_cursor.json');
      const cursorRelPath = `sessions/${sessionId}/inbox/${botId}/broadcast_cursor.json`;

      const messages = await this.readOptionalJsonItems<DirectMessage, InboxStore>(
        inboxFile,
        inboxRelPath,
        'InboxStore',
        InboxStoreSchema,
        (store) => store.messages,
        async () => (await this.storage.getInbox(sessionId, botId)).messages,
        quarantinedRecords,
        ingestedAt
      );

      const cursor = await this.readOptionalSingleJson<BroadcastCursor>(
        cursorFile,
        cursorRelPath,
        'BroadcastCursor',
        BroadcastCursorSchema,
        async () => await this.storage.getBroadcastCursor(sessionId, botId),
        quarantinedRecords,
        ingestedAt
      );
      if (cursor) {
        totalBroadcastCursors++;
      }

      const botPersistedKnowledgeIds: string[] = [];
      const botKoId = botKoIdMap.get(botId);
      if (botKoId) {
        botPersistedKnowledgeIds.push(botKoId);
      }

      for (const msg of messages) {
        totalDirectMessages++;
        const sanitizedMsg = redactRecursively(msg, customSecrets);
        // Content hash for message event excludes transient lease fields so delivery retries don't alter message identity
        const immutableMessageProjection = {
          message_id: sanitizedMsg.message_id,
          session_id: sanitizedMsg.session_id,
          sender_bot_id: sanitizedMsg.sender_bot_id,
          recipient_bot_id: sanitizedMsg.recipient_bot_id,
          timestamp: sanitizedMsg.timestamp,
          message_type: sanitizedMsg.message_type,
          content: sanitizedMsg.content,
          metadata: sanitizedMsg.metadata,
        };
        const msgHash = computeContentHash(immutableMessageProjection, customSecrets);
        const msgLocator = `${inboxRelPath}#${msg.message_id}`;
        const msgEvtId = deriveMemoryEventId({
          sourceSystem: 'almudaya.blackboard',
          sessionId,
          sourceType: 'DirectMessage',
          sourceRecordId: msg.message_id,
        });
        const msgIdemKey = deriveIdempotencyKey({
          sourceSystem: 'almudaya.blackboard',
          scopeId: sessionId,
          sourceType: 'DirectMessage',
          sourceRecordId: msg.message_id,
          contentHash: msgHash,
        });

        const msgProvenance: KnowledgeProvenance = {
          sourceSystem: 'almudaya.blackboard',
          sourceType: 'DirectMessage',
          sourceId: msg.message_id,
          sourcePath: msgLocator,
          sourceSchemaVersion: CURRENT_MESSAGING_SCHEMA_VERSION,
          sourceTimestamp: msg.timestamp,
          createdBy: msg.sender_bot_id,
          createdAt: msg.timestamp,
          ingestedAt,
          contentHash: msgHash,
          migrationBatchId,
          originProjectUniverseId: defaultPmuId,
        };

        const msgEvent = validateMemoryEvent({
          id: msgEvtId,
          eventType: 'message.direct',
          identity: {
            projectUniverseId: defaultPmuId,
            sessionId,
            botId: msg.recipient_bot_id,
            principalId: msg.sender_bot_id,
            registerKind: 'individual',
          },
          payload: immutableMessageProjection,
          occurredAt: msg.timestamp,
          recordedAt: ingestedAt,
          idempotencyKey: msgIdemKey,
          provenance: msgProvenance,
        });
        memoryEvents.push(msgEvent);

        if (qualifiesDirectMessageForKnowledgeExtraction(sanitizedMsg)) {
          const msgKoId = deriveKnowledgeId({
            sourceSystem: 'almudaya.blackboard',
            projectUniverseId: defaultPmuId,
            sessionId,
            sourceType: 'DirectMessage.Knowledge',
            sourceRecordId: msg.message_id,
          });
          botPersistedKnowledgeIds.push(msgKoId);

          const msgKo = validateKnowledgeObject({
            id: msgKoId,
            projectUniverseId: defaultPmuId,
            type: 'agent.message_knowledge',
            scope: 'agent',
            ownerId: msg.recipient_bot_id,
            title: `Direct Message Knowledge (${msg.message_id})`,
            summary: sanitizedMsg.content,
            hierarchyLevel: 'L3',
            content: immutableMessageProjection,
            provenance: msgProvenance,
            relationIds: [],
            validationStatus: 'unverified',
            lifecycleStatus: 'active',
            reusable: false,
            schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
            version: 1,
            createdAt: msg.timestamp,
            updatedAt: msg.timestamp,
            tags: ['direct_message', msg.message_type.toLowerCase()],
          });
          knowledgeObjects.push(msgKo);
        }
      }

      // Build Individual RegisterSnapshot preserving inbox delivery/lease/fencing state and broadcast cursor
      const botRecord = bots.find((b) => b.bot_id === botId) ?? null;
      const individualState = redactRecursively(
        {
          botRecord,
          broadcastCursor: cursor ?? {
            last_read_event_id: null,
            last_read_timestamp: null,
            category_cursors: {},
            acknowledged_event_ids: [],
          },
          inboxDeliveryState: messages.map((m) => ({
            message_id: m.message_id,
            status: m.status,
            delivery_state: m.delivery_state,
            attempt_count: m.attempt_count,
            max_attempts: m.max_attempts,
            fence_token: m.fence_token,
            lease_owner: m.lease_owner,
            lease_expires_at: m.lease_expires_at,
            read_at: m.read_at,
            acknowledged_at: m.acknowledged_at,
          })),
        },
        customSecrets
      );

      const individualSnapshotId = `snap_ind_${sessionId}_${botId}`;
      const individualSnap = validateRegisterSnapshot({
        id: individualSnapshotId,
        identity: {
          projectUniverseId: defaultPmuId,
          sessionId,
          botId,
          principalId: botId,
          registerKind: 'individual',
        },
        state: individualState,
        syncStatus: 'persisted',
        sourceRevision: computeContentHash(individualState, customSecrets).slice(0, 16),
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        createdAt: botRecord?.joined_at ?? sessionMeta.created_at,
        updatedAt: botRecord?.last_seen_at ?? ingestedAt,
        persistedKnowledgeIds: botPersistedKnowledgeIds,
      });
      individualRegisterSnapshots.push(individualSnap);
    }

    // 9. Read Work Log (work_log.jsonl) with strict: false so corrupt lines are quarantined in-memory
    const workLogFile = path.join(sessionDir, 'work_log.jsonl');
    const workLogRelPath = `sessions/${sessionId}/work_log.jsonl`;
    const workLogRecords = await this.readJsonlWithLineNumbers<WorkLogEntry>(
      workLogFile,
      workLogRelPath,
      'WorkLogEntry',
      WorkLogEntrySchema,
      async () => await this.storage.readWorkLogs(sessionId),
      quarantinedRecords,
      ingestedAt
    );

    for (const { record: entry, lineNumber } of workLogRecords) {
      const sanitizedEntry = redactRecursively(entry, customSecrets);
      const entryHash = computeContentHash(sanitizedEntry, customSecrets);
      const locator = lineNumber
        ? `${workLogRelPath}#L${lineNumber}`
        : `${workLogRelPath}#${entry.entry_id}`;

      const targetRoot = projectRoots.find((r) => r.root_id === entry.target_root_id);
      const entryPmuId =
        targetRoot?.root_type === 'primary'
          ? deriveProjectUniverseId(targetRoot.root_id)
          : defaultPmuId;

      const workEvtId = deriveMemoryEventId({
        sourceSystem: 'almudaya.blackboard',
        sessionId,
        sourceType: 'WorkLogEntry',
        sourceRecordId: entry.entry_id,
      });
      const workIdemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.blackboard',
        scopeId: sessionId,
        sourceType: 'WorkLogEntry',
        sourceRecordId: entry.entry_id,
        contentHash: entryHash,
      });

      const workProvenance: KnowledgeProvenance = {
        sourceSystem: 'almudaya.blackboard',
        sourceType: 'WorkLogEntry',
        sourceId: entry.entry_id,
        sourcePath: locator,
        sourceSchemaVersion: '1.0.0-jsonl',
        sourceTimestamp: entry.timestamp,
        createdBy: entry.bot_id,
        createdAt: entry.timestamp,
        ingestedAt,
        contentHash: entryHash,
        migrationBatchId,
        originProjectUniverseId: entryPmuId,
      };

      const workMemEvt = validateMemoryEvent({
        id: workEvtId,
        eventType: `work_log.${entry.action_type.toLowerCase()}`,
        identity: {
          projectUniverseId: entryPmuId,
          sessionId,
          botId: entry.bot_id,
          principalId: entry.bot_id,
          registerKind: 'global',
        },
        payload: sanitizedEntry,
        occurredAt: entry.timestamp,
        recordedAt: ingestedAt,
        idempotencyKey: workIdemKey,
        provenance: workProvenance,
      });
      memoryEvents.push(workMemEvt);

      const workKoId = deriveKnowledgeId({
        sourceSystem: 'almudaya.blackboard',
        projectUniverseId: entryPmuId,
        sessionId,
        sourceType: 'WorkLogEntry',
        sourceRecordId: entry.entry_id,
      });

      const workRelationIds: string[] = [];
      const execRelId = deriveRelationId(workKoId, 'executed_during', sessionKoId);
      relations.push({
        relationId: execRelId,
        projectUniverseId: entryPmuId,
        fromId: workKoId,
        toId: sessionKoId,
        relationType: 'executed_during',
        createdAt: entry.timestamp,
        provenance: workProvenance,
      });
      workRelationIds.push(execRelId);

      const creatorBotKoId = botKoIdMap.get(entry.bot_id);
      if (creatorBotKoId) {
        const createdByRelId = deriveRelationId(workKoId, 'created_by', creatorBotKoId);
        relations.push({
          relationId: createdByRelId,
          projectUniverseId: entryPmuId,
          fromId: workKoId,
          toId: creatorBotKoId,
          relationType: 'created_by',
          createdAt: entry.timestamp,
          provenance: workProvenance,
        });
        workRelationIds.push(createdByRelId);
      }

      const workTreeDomain: KnowledgeTreeDomain =
        entry.action_type === 'DECISION' ? 'Decisions' : 'Development';
      const workTreeNode = this.ensureTreeNode(
        treeNodeMap,
        entryPmuId,
        workTreeDomain,
        `Project ${workTreeDomain}`,
        ingestedAt
      );
      this.attachKnowledgeToTreeNode(workTreeNode, workKoId);

      const workKo = validateKnowledgeObject({
        id: workKoId,
        projectUniverseId: entryPmuId,
        type: 'development.work_log',
        scope: 'project',
        ownerId: entry.bot_id,
        title: `[${entry.action_type}] ${sanitizedEntry.summary.slice(0, 80)}`,
        summary: sanitizedEntry.summary,
        hierarchyLevel: entry.action_type === 'DECISION' ? 'L2' : 'L3',
        content: sanitizedEntry,
        provenance: workProvenance,
        relationIds: workRelationIds,
        treeNodeIds: [workTreeNode.nodeId],
        validationStatus: entry.action_type === 'DECISION' ? 'validated' : 'unverified',
        lifecycleStatus: 'active',
        reusable: entry.action_type === 'DECISION',
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: entry.timestamp,
        updatedAt: entry.timestamp,
        tags: ['work_log', entry.action_type.toLowerCase(), entry.target_root_id],
      });
      knowledgeObjects.push(workKo);
    }

    // 10. Read Optional Capability Governance JSONL Files (capabilities/grants.jsonl & audit.jsonl)
    const grantsFile = path.join(sessionDir, 'capabilities', 'grants.jsonl');
    const grantsRelPath = `sessions/${sessionId}/capabilities/grants.jsonl`;
    const grantRecords = await this.readJsonlWithLineNumbers<CapabilityGrant>(
      grantsFile,
      grantsRelPath,
      'CapabilityGrant',
      CapabilityGrantSchema,
      async () => [],
      quarantinedRecords,
      ingestedAt
    );

    for (const { record: grant, lineNumber } of grantRecords) {
      const sanitizedGrant = redactRecursively(grant, customSecrets);
      const grantHash = computeContentHash(sanitizedGrant, customSecrets);
      const locator = lineNumber
        ? `${grantsRelPath}#L${lineNumber}`
        : `${grantsRelPath}#${grant.grant_id}`;
      const grantEvtId = deriveMemoryEventId({
        sourceSystem: 'almudaya.acg',
        sessionId,
        sourceType: 'CapabilityGrant',
        sourceRecordId: `${grant.grant_id}_L${lineNumber ?? 1}`,
      });
      const grantIdemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.acg',
        scopeId: sessionId,
        sourceType: 'CapabilityGrant',
        sourceRecordId: `${grant.grant_id}_L${lineNumber ?? 1}`,
        contentHash: grantHash,
      });

      const grantEvt = validateMemoryEvent({
        id: grantEvtId,
        eventType: 'security.capability_grant',
        identity: {
          projectUniverseId: defaultPmuId,
          sessionId,
          botId: grant.bot_id,
          principalId: grant.granted_by,
          registerKind: 'global',
        },
        payload: sanitizedGrant,
        occurredAt: grant.granted_at,
        recordedAt: ingestedAt,
        idempotencyKey: grantIdemKey,
        provenance: {
          sourceSystem: 'almudaya.acg',
          sourceType: 'CapabilityGrant',
          sourceId: grant.grant_id,
          sourcePath: locator,
          sourceSchemaVersion: '1.0.0-jsonl',
          sourceTimestamp: grant.granted_at,
          createdBy: grant.granted_by,
          createdAt: grant.granted_at,
          ingestedAt,
          contentHash: grantHash,
          migrationBatchId,
          originProjectUniverseId: defaultPmuId,
        },
      });
      memoryEvents.push(grantEvt);
    }

    const auditFile = path.join(sessionDir, 'capabilities', 'audit.jsonl');
    const auditRelPath = `sessions/${sessionId}/capabilities/audit.jsonl`;
    const auditRecords = await this.readJsonlWithLineNumbers<SecurityAuditEvent>(
      auditFile,
      auditRelPath,
      'SecurityAuditEvent',
      SecurityAuditEventSchema,
      async () => [],
      quarantinedRecords,
      ingestedAt
    );

    for (const { record: auditEvt, lineNumber } of auditRecords) {
      const sanitizedAudit = redactRecursively(auditEvt, customSecrets);
      const auditHash = computeContentHash(sanitizedAudit, customSecrets);
      const locator = lineNumber
        ? `${auditRelPath}#L${lineNumber}`
        : `${auditRelPath}#${auditEvt.event_id}`;
      const memEvtId = deriveMemoryEventId({
        sourceSystem: 'almudaya.acg',
        sessionId,
        sourceType: 'SecurityAuditEvent',
        sourceRecordId: auditEvt.event_id,
      });
      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.acg',
        scopeId: sessionId,
        sourceType: 'SecurityAuditEvent',
        sourceRecordId: auditEvt.event_id,
        contentHash: auditHash,
      });

      const secEvt = validateMemoryEvent({
        id: memEvtId,
        eventType: 'security.audit_event',
        identity: {
          projectUniverseId: defaultPmuId,
          sessionId,
          botId: auditEvt.bot_id,
          principalId: auditEvt.bot_id ?? 'SYSTEM',
          registerKind: 'global',
        },
        payload: sanitizedAudit,
        occurredAt: auditEvt.timestamp,
        recordedAt: ingestedAt,
        idempotencyKey: idemKey,
        provenance: {
          sourceSystem: 'almudaya.acg',
          sourceType: 'SecurityAuditEvent',
          sourceId: auditEvt.event_id,
          sourcePath: locator,
          sourceSchemaVersion: '1.0.0-jsonl',
          sourceTimestamp: auditEvt.timestamp,
          createdBy: auditEvt.bot_id ?? 'SYSTEM',
          createdAt: auditEvt.timestamp,
          ingestedAt,
          contentHash: auditHash,
          migrationBatchId,
          originProjectUniverseId: defaultPmuId,
        },
      });
      memoryEvents.push(secEvt);
    }

    // Build Global RegisterSnapshot
    const globalState = redactRecursively(
      {
        session: sanitizedSessionMeta,
        projectRootIds: projectRoots.map((r) => r.root_id),
        registeredBotIds: bots.map((b) => b.bot_id),
        documentIds: sdlcDocs.map((d) => d.document_id),
        hasEnvironmentMetadata: Boolean(envMeta),
        broadcastCount: broadcastRecords.length,
        workLogCount: workLogRecords.length,
      },
      customSecrets
    );

    const globalRegisterSnapshot = validateRegisterSnapshot({
      id: `snap_glb_${sessionId}`,
      identity: {
        projectUniverseId: defaultPmuId,
        sessionId,
        principalId: 'SYSTEM',
        registerKind: 'global',
      },
      state: globalState,
      syncStatus: 'persisted',
      sourceRevision: computeContentHash(globalState, customSecrets).slice(0, 16),
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      createdAt: sessionMeta.created_at,
      updatedAt: sessionMeta.updated_at,
      persistedKnowledgeIds: knowledgeObjects.map((ko) => ko.id),
    });

    const treeNodes = Array.from(treeNodeMap.values());

    // Compute Parity Report
    const expectedMinimumMemoryEvents =
      broadcastRecords.length +
      totalDirectMessages +
      workLogRecords.length +
      grantRecords.length +
      auditRecords.length;

    const expectedMinimumKnowledgeObjects =
      1 + // sessionMetadata
      projectRoots.length +
      bots.length +
      (envMeta ? 1 : 0) +
      sdlcDocs.length +
      workLogRecords.length;

    const missingEvents = Math.max(0, expectedMinimumMemoryEvents - memoryEvents.length);
    const missingKo = Math.max(0, expectedMinimumKnowledgeObjects - knowledgeObjects.length);
    const unexplainedMissingCount = missingEvents + missingKo;

    const parityReport: LegacyExportParityReport = {
      sessionId,
      migrationBatchId,
      exportedAt: ingestedAt,
      sourceCounts: {
        sessionMetadata: 1,
        projectRoots: projectRoots.length,
        bots: bots.length,
        environmentMetadata: envMeta ? 1 : 0,
        sdlcDocuments: sdlcDocs.length,
        broadcastEvents: broadcastRecords.length,
        directMessages: totalDirectMessages,
        broadcastCursors: totalBroadcastCursors,
        workLogEntries: workLogRecords.length,
        capabilityGrants: grantRecords.length,
        securityAuditEvents: auditRecords.length,
      },
      exportedCounts: {
        projectUniverses: projectUniverses.length,
        knowledgeObjects: knowledgeObjects.length,
        memoryEvents: memoryEvents.length,
        globalSnapshots: 1,
        individualSnapshots: individualRegisterSnapshots.length,
        relations: relations.length,
        treeNodes: treeNodes.length,
        quarantinedRecords: quarantinedRecords.length,
      },
      unexplainedMissingCount,
      parityVerified: unexplainedMissingCount === 0,
    };

    return {
      sessionId,
      migrationBatchId,
      ingestedAt,
      defaultProjectUniverse: defaultUniverse,
      projectUniverses,
      knowledgeObjects,
      memoryEvents,
      globalRegisterSnapshot,
      individualRegisterSnapshots,
      relations,
      treeNodes,
      quarantinedRecords,
      parityReport,
    };
  }

  /**
   * Exports all valid sessions discovered via `storage.listSessions()`.
   */
  public async exportAllSessions(
    options: ReadOnlyBlackboardBridgeOptions = {}
  ): Promise<LegacySessionExportBundle[]> {
    const sessions = await this.storage.listSessions();
    const bundles: LegacySessionExportBundle[] = [];
    for (const session of sessions) {
      const bundle = await this.exportSession(session.session_id, options);
      bundles.push(bundle);
    }
    return bundles;
  }

  private ensureTreeNode(
    treeNodeMap: Map<string, KnowledgeTreeNode>,
    projectUniverseId: string,
    domainPath: KnowledgeTreeDomain,
    label: string,
    timestamp: string
  ): KnowledgeTreeNode {
    const nodeId = deriveTreeNodeId(projectUniverseId, domainPath);
    const existing = treeNodeMap.get(nodeId);
    if (existing) {
      return existing;
    }

    const created: KnowledgeTreeNode = {
      nodeId,
      projectUniverseId,
      parentNodeId:
        domainPath === 'Identity' ? null : deriveTreeNodeId(projectUniverseId, 'Identity'),
      domainPath,
      label,
      knowledgeIds: [],
      childNodeIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    treeNodeMap.set(nodeId, created);

    if (domainPath !== 'Identity') {
      const rootNode = treeNodeMap.get(deriveTreeNodeId(projectUniverseId, 'Identity'));
      if (rootNode && !rootNode.childNodeIds.includes(nodeId)) {
        rootNode.childNodeIds.push(nodeId);
      }
    }

    return created;
  }

  private attachKnowledgeToTreeNode(node: KnowledgeTreeNode, knowledgeId: string): void {
    if (!node.knowledgeIds.includes(knowledgeId)) {
      node.knowledgeIds.push(knowledgeId);
    }
  }

  private async discoverAllBotIds(sessionDir: string, registeredBots: BotRecord[]): Promise<string[]> {
    const ids = new Set<string>(registeredBots.map((b) => b.bot_id));
    const inboxBase = path.join(sessionDir, 'inbox');
    if (await pathExists(inboxBase)) {
      try {
        const entries = await fs.readdir(inboxBase, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            ids.add(entry.name);
          }
        }
      } catch {
        // Ignore directory listing errors
      }
    }
    return Array.from(ids).sort();
  }

  private async readOptionalBots(
    filePath: string,
    relativePath: string,
    sessionId: string,
    quarantinedRecords: QuarantinedLegacyRecord[],
    detectedAt: string
  ): Promise<BotRecord[]> {
    if (await pathExists(filePath)) {
      const raw = await fs.readFile(filePath, 'utf-8');
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const registryParse = BotRegistrySchema.safeParse(parsed);
        if (registryParse.success) {
          return registryParse.data.bots;
        }
        // Element-level recovery if some bot entries are valid and others are malformed
        if (Array.isArray(parsed['bots'])) {
          const validBots: BotRecord[] = [];
          parsed['bots'].forEach((candidate, idx) => {
            const botRes = BotRecordSchema.safeParse(candidate);
            if (botRes.success) {
              validBots.push(botRes.data);
            } else {
              quarantinedRecords.push({
                sourcePath: `${relativePath}#bots[${idx}]`,
                sourceType: 'BotRecord',
                rawContent: JSON.stringify(candidate),
                error: botRes.error.message,
                detectedAt,
              });
            }
          });
          return validBots;
        }
        quarantinedRecords.push({
          sourcePath: relativePath,
          sourceType: 'BotRegistry',
          rawContent: raw,
          error: registryParse.error.message,
          detectedAt,
        });
        return [];
      } catch (err: unknown) {
        quarantinedRecords.push({
          sourcePath: relativePath,
          sourceType: 'BotRegistry',
          rawContent: raw,
          error: (err as Error).message,
          detectedAt,
        });
        return [];
      }
    }

    try {
      return await this.storage.listBots(sessionId);
    } catch {
      return [];
    }
  }

  private async readOptionalSingleJson<T>(
    filePath: string,
    relativePath: string,
    sourceType: string,
    schema: z.ZodType<T>,
    fallbackLoader: () => Promise<T | null>,
    quarantinedRecords: QuarantinedLegacyRecord[],
    detectedAt: string
  ): Promise<T | null> {
    if (await pathExists(filePath)) {
      const raw = await fs.readFile(filePath, 'utf-8');
      try {
        const parsed = JSON.parse(raw);
        const validated = schema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
        quarantinedRecords.push({
          sourcePath: relativePath,
          sourceType,
          rawContent: raw,
          error: validated.error.message,
          detectedAt,
        });
        return null;
      } catch (err: unknown) {
        quarantinedRecords.push({
          sourcePath: relativePath,
          sourceType,
          rawContent: raw,
          error: (err as Error).message,
          detectedAt,
        });
        return null;
      }
    }

    try {
      return await fallbackLoader();
    } catch {
      return null;
    }
  }

  private async readOptionalJsonItems<TItem, TContainer = unknown>(
    filePath: string,
    relativePath: string,
    sourceType: string,
    containerSchema: z.ZodType<TContainer>,
    extractor: (container: TContainer) => TItem[],
    fallbackLoader: () => Promise<TItem[]>,
    quarantinedRecords: QuarantinedLegacyRecord[],
    detectedAt: string
  ): Promise<TItem[]> {
    if (await pathExists(filePath)) {
      const raw = await fs.readFile(filePath, 'utf-8');
      try {
        const parsed = JSON.parse(raw);
        const validated = containerSchema.safeParse(parsed);
        if (validated.success) {
          return extractor(validated.data);
        }
        quarantinedRecords.push({
          sourcePath: relativePath,
          sourceType,
          rawContent: raw,
          error: validated.error.message,
          detectedAt,
        });
        return [];
      } catch (err: unknown) {
        quarantinedRecords.push({
          sourcePath: relativePath,
          sourceType,
          rawContent: raw,
          error: (err as Error).message,
          detectedAt,
        });
        return [];
      }
    }

    try {
      return await fallbackLoader();
    } catch {
      return [];
    }
  }

  /**
   * Reads a JSONL file line-by-line in non-strict mode without writing `.corrupt.jsonl`
   * to the legacy directory, preserving exact 1-based line numbers for provenance (PKU-003, PKU-005).
   */
  private async readJsonlWithLineNumbers<T>(
    filePath: string,
    relativePath: string,
    sourceType: string,
    schema: z.ZodType<T>,
    fallbackLoader: () => Promise<T[]>,
    quarantinedRecords: QuarantinedLegacyRecord[],
    detectedAt: string
  ): Promise<Array<{ record: T; lineNumber?: number }>> {
    if (await pathExists(filePath)) {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const valid: Array<{ record: T; lineNumber: number }> = [];

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i]!;
        const trimmed = rawLine.trim();
        if (trimmed.length === 0) continue;
        const lineNumber = i + 1;

        const parsedLine = parseJsonl(trimmed, schema, relativePath, { strict: false });
        if (parsedLine.records.length > 0) {
          valid.push({ record: parsedLine.records[0]!, lineNumber });
        }
        for (const corrupt of parsedLine.corruptRecords) {
          quarantinedRecords.push({
            sourcePath: `${relativePath}#L${lineNumber}`,
            sourceType,
            lineNumber,
            rawContent: corrupt.rawLine,
            error: corrupt.error,
            detectedAt,
          });
        }
      }

      return valid;
    }

    try {
      const records = await fallbackLoader();
      return records.map((record) => ({ record }));
    } catch {
      return [];
    }
  }
}
