import path from 'node:path';
import fs from 'node:fs/promises';
import {
  atomicWriteJson,
  ensureDir,
  pathExists,
} from '../../core/fs-utils.js';
import { appendJsonlRecord, readJsonlFile } from '../../core/jsonl.js';
import { withLock } from '../../core/lock.js';
import { redactRecursively } from '../../execution/environment.js';
import {
  computeContentHash,
  deriveMemoryEventId,
} from '../contracts/identity.js';
import {
  KnowledgeRelationSchema,
  KnowledgeTreeNodeSchema,
  MemoryEventSchema,
  validateContract,
  validateKnowledgeObject,
  validateMemoryEvent,
  validateProjectMemoryUniverse,
  validateRegisterSnapshot,
} from '../contracts/schemas.js';
import type {
  KnowledgeId,
  KnowledgeObject,
  KnowledgeQuery,
  KnowledgeQueryResult,
  KnowledgeRelation,
  KnowledgeTreeNode,
  MemoryEvent,
  MemoryIdentity,
  MemoryWriteResult,
  ProjectMemoryUniverse,
  ProjectUniverseId,
  RegisterSnapshot,
  TreeNodeId,
} from '../contracts/types.js';
import type { IPKUStore } from '../ports/pku-store.js';
import type { IRegisterPersistence } from '../ports/registers.js';

interface IdempotencyRecord {
  key: string;
  entityType: 'knowledge' | 'relation' | 'tree' | 'event' | 'snapshot';
  entityId: string;
  version: number;
  contentHash: string;
  recordedAt: string;
}

/**
 * Shared query and graph traversal logic used by both InMemoryPKUStore and LocalFilesystemPKUStore.
 */
function executeKnowledgeQuery(
  allObjects: KnowledgeObject[],
  allRelations: KnowledgeRelation[],
  allTreeNodes: KnowledgeTreeNode[],
  query: KnowledgeQuery
): KnowledgeQueryResult {
  const universeSet = new Set(query.projectUniverseIds);

  // Resolve treeDomainPrefix filter into matching knowledgeIds if requested
  let treeAllowedKnowledgeIds: Set<string> | null = null;
  if (query.treeDomainPrefix && query.treeDomainPrefix.trim().length > 0) {
    const prefix = query.treeDomainPrefix.trim().toLowerCase();
    treeAllowedKnowledgeIds = new Set<string>();
    for (const node of allTreeNodes) {
      if (
        universeSet.has(node.projectUniverseId) &&
        node.domainPath.toLowerCase().startsWith(prefix)
      ) {
        for (const kid of node.knowledgeIds) {
          treeAllowedKnowledgeIds.add(kid);
        }
      }
    }
  }

  let matched = allObjects.filter((obj) => {
    if (!universeSet.has(obj.projectUniverseId)) {
      return false;
    }

    if (!query.includeArchived) {
      if (
        obj.lifecycleStatus === 'archived' ||
        obj.lifecycleStatus === 'deleted' ||
        obj.lifecycleStatus === 'purged'
      ) {
        return false;
      }
    } else if (obj.lifecycleStatus === 'deleted' || obj.lifecycleStatus === 'purged') {
      return false;
    }

    if (query.types && query.types.length > 0 && !query.types.includes(obj.type)) {
      return false;
    }

    if (query.scopes && query.scopes.length > 0 && !query.scopes.includes(obj.scope)) {
      return false;
    }

    if (query.ownerId && obj.ownerId !== query.ownerId) {
      return false;
    }

    if (
      query.hierarchyLevels &&
      query.hierarchyLevels.length > 0 &&
      (!obj.hierarchyLevel || !query.hierarchyLevels.includes(obj.hierarchyLevel))
    ) {
      return false;
    }

    if (treeAllowedKnowledgeIds !== null && !treeAllowedKnowledgeIds.has(obj.id)) {
      return false;
    }

    if (query.requiredEvidence) {
      const hasEvidence = Boolean(obj.provenance.sourcePath || obj.provenance.sourceId);
      if (!hasEvidence) {
        return false;
      }
    }

    if (query.text && query.text.trim().length > 0) {
      const needle = query.text.trim().toLowerCase();
      const haystack = [
        obj.title ?? '',
        obj.summary ?? '',
        ...(obj.tags ?? []),
        JSON.stringify(obj.content ?? ''),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) {
        return false;
      }
    }

    return true;
  });

  // Optional BFS graph expansion up to relationTraversalDepth
  const traversedRelations: KnowledgeRelation[] = [];
  const depth = query.relationTraversalDepth ?? 0;
  if (depth > 0 && matched.length > 0) {
    const objectById = new Map(allObjects.map((o) => [o.id, o]));
    const visitedIds = new Set<string>(matched.map((o) => o.id));
    let frontier = new Set<string>(visitedIds);
    const seenRelationIds = new Set<string>();

    for (let step = 0; step < depth; step++) {
      const nextFrontier = new Set<string>();
      for (const rel of allRelations) {
        if (frontier.has(rel.fromId) || frontier.has(rel.toId)) {
          if (!seenRelationIds.has(rel.relationId)) {
            seenRelationIds.add(rel.relationId);
            traversedRelations.push(rel);
          }
          const neighborId = frontier.has(rel.fromId) ? rel.toId : rel.fromId;
          if (!visitedIds.has(neighborId)) {
            const neighborObj = objectById.get(neighborId);
            if (
              neighborObj &&
              universeSet.has(neighborObj.projectUniverseId) &&
              neighborObj.lifecycleStatus !== 'deleted' &&
              neighborObj.lifecycleStatus !== 'purged'
            ) {
              visitedIds.add(neighborId);
              nextFrontier.add(neighborId);
              matched.push(neighborObj);
            }
          }
        }
      }
      if (nextFrontier.size === 0) break;
      frontier = nextFrontier;
    }
  }

  // Deterministic ordering by createdAt ascending, then id ascending
  matched.sort((a, b) => {
    const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });

  const total = matched.length;
  const startIdx = query.cursor ? Math.max(0, parseInt(query.cursor, 10) || 0) : 0;
  const limit = query.limit && query.limit > 0 ? query.limit : total;
  const items = matched.slice(startIdx, startIdx + limit);
  const nextCursor = startIdx + limit < total ? String(startIdx + limit) : undefined;

  const evidenceCount = items.filter((item) =>
    Boolean(item.provenance.sourcePath || item.provenance.sourceId)
  ).length;
  const evidenceCoverage = items.length > 0 ? evidenceCount / items.length : 1;

  return {
    items,
    total,
    nextCursor,
    evidenceCoverage,
    traversedRelations: traversedRelations.length > 0 ? traversedRelations : undefined,
  };
}

function snapshotLookupKey(identity: MemoryIdentity): string {
  return [
    identity.projectUniverseId,
    identity.registerKind,
    identity.sessionId ?? 'global',
    identity.botId ?? 'none',
  ].join('|');
}

function computeKnowledgeStateHash(
  obj: KnowledgeObject<unknown>,
  customSecrets: string[] = []
): string {
  return computeContentHash(
    {
      content: obj.content,
      lifecycleStatus: obj.lifecycleStatus,
      validationStatus: obj.validationStatus,
      reusable: obj.reusable ?? null,
      scope: obj.scope,
      title: obj.title ?? null,
      summary: obj.summary ?? null,
      treeNodeIds: obj.treeNodeIds ?? [],
      relationIds: obj.relationIds ?? [],
    },
    customSecrets
  );
}

/**
 * In-Memory PKU Store & Register Persistence implementation (Phase 3).
 * Enforces identical Zod schema validation, secret redaction (PKU-008),
 * and idempotency guarantees (PKU-002, PKU-018) as the filesystem store.
 */
export class InMemoryPKUStore implements IPKUStore, IRegisterPersistence {
  private readonly universes = new Map<ProjectUniverseId, ProjectMemoryUniverse>();
  private readonly knowledge = new Map<KnowledgeId, KnowledgeObject>();
  private readonly relations = new Map<string, KnowledgeRelation>();
  private readonly treeNodes = new Map<TreeNodeId, KnowledgeTreeNode>();
  private readonly events: MemoryEvent[] = [];
  private readonly snapshots = new Map<string, RegisterSnapshot>();
  private readonly idempotencyLedger = new Map<string, IdempotencyRecord>();
  private readonly customSecrets: string[];

  constructor(options: { customSecrets?: string[] } = {}) {
    this.customSecrets = options.customSecrets ?? [];
  }

  public async createUniverse(universe: ProjectMemoryUniverse): Promise<void> {
    const sanitized = redactRecursively(universe, this.customSecrets);
    const validated = validateProjectMemoryUniverse(sanitized);
    this.universes.set(validated.id, validated);
  }

  public async getUniverse(universeId: ProjectUniverseId): Promise<ProjectMemoryUniverse | null> {
    return this.universes.get(universeId) ?? null;
  }

  public async listUniverses(): Promise<ProjectMemoryUniverse[]> {
    return Array.from(this.universes.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  public async putKnowledge<T>(
    object: KnowledgeObject<T>,
    idempotencyKey: string
  ): Promise<MemoryWriteResult> {
    const sanitized = redactRecursively(object, this.customSecrets);
    const validated = validateKnowledgeObject<T>(sanitized);
    const contentHash = computeKnowledgeStateHash(validated, this.customSecrets);

    const existingIdem = this.idempotencyLedger.get(idempotencyKey);
    if (existingIdem && existingIdem.entityType === 'knowledge') {
      return {
        knowledgeId: existingIdem.entityId,
        created: false,
        version: existingIdem.version,
        idempotentReplay: true,
      };
    }

    const existingObj = this.knowledge.get(validated.id);
    if (existingObj) {
      const existingHash = computeKnowledgeStateHash(existingObj, this.customSecrets);
      if (existingHash === contentHash) {
        this.idempotencyLedger.set(idempotencyKey, {
          key: idempotencyKey,
          entityType: 'knowledge',
          entityId: existingObj.id,
          version: existingObj.version,
          contentHash,
          recordedAt: new Date().toISOString(),
        });
        return {
          knowledgeId: existingObj.id,
          created: false,
          version: existingObj.version,
          idempotentReplay: true,
        };
      }

      const existingContentHash = computeContentHash(existingObj.content, this.customSecrets);
      const nextContentHash = computeContentHash(validated.content, this.customSecrets);
      const nextVersion =
        existingContentHash === nextContentHash ? existingObj.version : existingObj.version + 1;
      const updated: KnowledgeObject<T> = {
        ...validated,
        version: nextVersion,
        updatedAt: new Date().toISOString(),
      };
      this.knowledge.set(updated.id, updated);
      this.idempotencyLedger.set(idempotencyKey, {
        key: idempotencyKey,
        entityType: 'knowledge',
        entityId: updated.id,
        version: nextVersion,
        contentHash,
        recordedAt: new Date().toISOString(),
      });
      return {
        knowledgeId: updated.id,
        created: false,
        version: nextVersion,
        idempotentReplay: false,
      };
    }

    this.knowledge.set(validated.id, validated);
    this.idempotencyLedger.set(idempotencyKey, {
      key: idempotencyKey,
      entityType: 'knowledge',
      entityId: validated.id,
      version: validated.version,
      contentHash,
      recordedAt: new Date().toISOString(),
    });

    return {
      knowledgeId: validated.id,
      created: true,
      version: validated.version,
      idempotentReplay: false,
    };
  }

  public async getKnowledge<T = unknown>(
    knowledgeId: KnowledgeId
  ): Promise<KnowledgeObject<T> | null> {
    return (this.knowledge.get(knowledgeId) as KnowledgeObject<T> | undefined) ?? null;
  }

  public async queryKnowledge(query: KnowledgeQuery): Promise<KnowledgeQueryResult> {
    return executeKnowledgeQuery(
      Array.from(this.knowledge.values()),
      Array.from(this.relations.values()),
      Array.from(this.treeNodes.values()),
      query
    );
  }

  public async putRelation(relation: KnowledgeRelation, idempotencyKey: string): Promise<void> {
    if (this.idempotencyLedger.has(idempotencyKey)) {
      return;
    }
    const sanitized = redactRecursively(relation, this.customSecrets);
    const validated = validateContract('KnowledgeRelation', KnowledgeRelationSchema, sanitized);
    this.relations.set(validated.relationId, validated);
    this.idempotencyLedger.set(idempotencyKey, {
      key: idempotencyKey,
      entityType: 'relation',
      entityId: validated.relationId,
      version: 1,
      contentHash: computeContentHash(validated, this.customSecrets),
      recordedAt: new Date().toISOString(),
    });
  }

  public async getRelations(knowledgeId: KnowledgeId): Promise<KnowledgeRelation[]> {
    return Array.from(this.relations.values()).filter(
      (r) => r.fromId === knowledgeId || r.toId === knowledgeId
    );
  }

  public async putTreeNode(node: KnowledgeTreeNode, idempotencyKey: string): Promise<void> {
    if (this.idempotencyLedger.has(idempotencyKey)) {
      return;
    }
    const sanitized = redactRecursively(node, this.customSecrets);
    const validated = validateContract('KnowledgeTreeNode', KnowledgeTreeNodeSchema, sanitized);
    this.treeNodes.set(validated.nodeId, validated);
    this.idempotencyLedger.set(idempotencyKey, {
      key: idempotencyKey,
      entityType: 'tree',
      entityId: validated.nodeId,
      version: 1,
      contentHash: computeContentHash(validated, this.customSecrets),
      recordedAt: new Date().toISOString(),
    });
  }

  public async getTreeNode(nodeId: TreeNodeId): Promise<KnowledgeTreeNode | null> {
    return this.treeNodes.get(nodeId) ?? null;
  }

  public async listTreeNodes(projectUniverseId: ProjectUniverseId): Promise<KnowledgeTreeNode[]> {
    return Array.from(this.treeNodes.values())
      .filter((n) => n.projectUniverseId === projectUniverseId)
      .sort((a, b) => a.domainPath.localeCompare(b.domainPath));
  }

  public async appendEvent(event: MemoryEvent, idempotencyKey: string): Promise<void> {
    if (this.idempotencyLedger.has(idempotencyKey)) {
      return;
    }
    const sanitized = redactRecursively(event, this.customSecrets);
    const validated = validateMemoryEvent(sanitized);
    if (this.events.some((e) => e.id === validated.id || e.idempotencyKey === idempotencyKey)) {
      return;
    }
    this.events.push(validated);
    this.idempotencyLedger.set(idempotencyKey, {
      key: idempotencyKey,
      entityType: 'event',
      entityId: validated.id,
      version: 1,
      contentHash: computeContentHash(validated.payload, this.customSecrets),
      recordedAt: new Date().toISOString(),
    });
  }

  public async listEvents(
    projectUniverseId: ProjectUniverseId,
    limit?: number
  ): Promise<MemoryEvent[]> {
    const filtered = this.events.filter(
      (e) => e.identity.projectUniverseId === projectUniverseId
    );
    if (limit && limit > 0 && filtered.length > limit) {
      return filtered.slice(-limit);
    }
    return filtered;
  }

  public async loadSnapshot<TState = unknown>(
    identity: MemoryIdentity
  ): Promise<RegisterSnapshot<TState> | null> {
    const key = snapshotLookupKey(identity);
    return (this.snapshots.get(key) as RegisterSnapshot<TState> | undefined) ?? null;
  }

  public async saveSnapshot<TState = unknown>(
    snapshot: RegisterSnapshot<TState>,
    idempotencyKey: string
  ): Promise<void> {
    if (this.idempotencyLedger.has(idempotencyKey)) {
      return;
    }
    const sanitized = redactRecursively(snapshot, this.customSecrets);
    const validated = validateRegisterSnapshot<TState>(sanitized);
    const key = snapshotLookupKey(validated.identity);
    this.snapshots.set(key, validated);
    this.idempotencyLedger.set(idempotencyKey, {
      key: idempotencyKey,
      entityType: 'snapshot',
      entityId: validated.id,
      version: 1,
      contentHash: computeContentHash(validated.state, this.customSecrets),
      recordedAt: new Date().toISOString(),
    });
  }

  public async appendRegisterEvent<TPayload = unknown>(
    identity: MemoryIdentity,
    eventType: string,
    payload: TPayload,
    idempotencyKey: string
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const sanitizedPayload = redactRecursively(payload, this.customSecrets);
    const eventId = deriveMemoryEventId({
      sourceSystem: 'pku.register',
      sessionId: identity.sessionId,
      sourceType: eventType,
      sourceRecordId: idempotencyKey,
    });
    const evt: MemoryEvent<TPayload> = {
      id: eventId,
      eventType,
      identity,
      payload: sanitizedPayload,
      occurredAt: nowIso,
      recordedAt: nowIso,
      idempotencyKey,
      provenance: {
        sourceSystem: 'pku.register',
        sourceType: eventType,
        sourceId: eventId,
        createdBy: identity.principalId,
        createdAt: nowIso,
        ingestedAt: nowIso,
        contentHash: computeContentHash(sanitizedPayload, this.customSecrets),
        originProjectUniverseId: identity.projectUniverseId,
      },
    };
    await this.appendEvent(evt, idempotencyKey);
  }
}

/**
 * Local Filesystem Prototype PKU Store & Register Persistence (Phase 3 — ADR-003).
 *
 * Persists canonical PKU entities under `<pkuRootDir>` (separate from legacy `<workspaceRoot>/sessions/`)
 * using atomic JSON writes, append-only JSONL event streams, file locks (`withLock`),
 * recursive secret redaction (`PKU-008`), and durable idempotency tracking (`PKU-002`, `PKU-018`).
 */
export class LocalFilesystemPKUStore implements IPKUStore, IRegisterPersistence {
  public readonly pkuRootDir: string;
  private readonly customSecrets: string[];

  constructor(pkuRootDir: string, options: { customSecrets?: string[] } = {}) {
    this.pkuRootDir = pkuRootDir;
    this.customSecrets = options.customSecrets ?? [];
  }

  private getUniverseDir(universeId: ProjectUniverseId): string {
    return path.join(this.pkuRootDir, 'universes', universeId);
  }

  private getUniverseFile(universeId: ProjectUniverseId): string {
    return path.join(this.getUniverseDir(universeId), 'universe.json');
  }

  private getObjectsDir(universeId: ProjectUniverseId): string {
    return path.join(this.getUniverseDir(universeId), 'objects');
  }

  private getRelationsDir(universeId: ProjectUniverseId): string {
    return path.join(this.getUniverseDir(universeId), 'relations');
  }

  private getTreeDir(universeId: ProjectUniverseId): string {
    return path.join(this.getUniverseDir(universeId), 'tree');
  }

  private getEventsFile(universeId: ProjectUniverseId): string {
    return path.join(this.getUniverseDir(universeId), 'events.jsonl');
  }

  private getSnapshotsDir(): string {
    return path.join(this.pkuRootDir, 'snapshots');
  }

  private getIdempotencyFile(): string {
    return path.join(this.pkuRootDir, 'idempotency', 'ledger.json');
  }

  private async withStoreLock<T>(action: () => Promise<T>): Promise<T> {
    await ensureDir(this.pkuRootDir);
    return await withLock(this.pkuRootDir, async () => await action());
  }

  private async readIdempotencyLedger(): Promise<Record<string, IdempotencyRecord>> {
    const file = this.getIdempotencyFile();
    if (!(await pathExists(file))) {
      return {};
    }
    try {
      const raw = await fs.readFile(file, 'utf-8');
      return JSON.parse(raw) as Record<string, IdempotencyRecord>;
    } catch {
      return {};
    }
  }

  private async writeIdempotencyLedger(ledger: Record<string, IdempotencyRecord>): Promise<void> {
    const file = this.getIdempotencyFile();
    await ensureDir(path.dirname(file));
    await atomicWriteJson(file, ledger);
  }

  public async createUniverse(universe: ProjectMemoryUniverse): Promise<void> {
    const sanitized = redactRecursively(universe, this.customSecrets);
    const validated = validateProjectMemoryUniverse(sanitized);

    await this.withStoreLock(async () => {
      const uDir = this.getUniverseDir(validated.id);
      await ensureDir(uDir);
      await ensureDir(this.getObjectsDir(validated.id));
      await ensureDir(this.getRelationsDir(validated.id));
      await ensureDir(this.getTreeDir(validated.id));
      await atomicWriteJson(this.getUniverseFile(validated.id), validated);
    });
  }

  public async getUniverse(universeId: ProjectUniverseId): Promise<ProjectMemoryUniverse | null> {
    const file = this.getUniverseFile(universeId);
    if (!(await pathExists(file))) {
      return null;
    }
    const raw = JSON.parse(await fs.readFile(file, 'utf-8'));
    return validateProjectMemoryUniverse(raw);
  }

  public async listUniverses(): Promise<ProjectMemoryUniverse[]> {
    const baseDir = path.join(this.pkuRootDir, 'universes');
    if (!(await pathExists(baseDir))) {
      return [];
    }
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const universes: ProjectMemoryUniverse[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const u = await this.getUniverse(entry.name);
        if (u) universes.push(u);
      }
    }
    return universes.sort((a, b) => a.id.localeCompare(b.id));
  }

  public async putKnowledge<T>(
    object: KnowledgeObject<T>,
    idempotencyKey: string
  ): Promise<MemoryWriteResult> {
    const sanitized = redactRecursively(object, this.customSecrets);
    const validated = validateKnowledgeObject<T>(sanitized);
    const contentHash = computeKnowledgeStateHash(validated, this.customSecrets);

    return await this.withStoreLock(async () => {
      const ledger = await this.readIdempotencyLedger();
      const existingIdem = ledger[idempotencyKey];
      if (existingIdem && existingIdem.entityType === 'knowledge') {
        return {
          knowledgeId: existingIdem.entityId,
          created: false,
          version: existingIdem.version,
          idempotentReplay: true,
        };
      }

      const objDir = this.getObjectsDir(validated.projectUniverseId);
      await ensureDir(objDir);
      const objFile = path.join(objDir, `${validated.id}.json`);

      if (await pathExists(objFile)) {
        const existingObj = validateKnowledgeObject<T>(
          JSON.parse(await fs.readFile(objFile, 'utf-8'))
        );
        const existingHash = computeKnowledgeStateHash(existingObj, this.customSecrets);

        if (existingHash === contentHash) {
          ledger[idempotencyKey] = {
            key: idempotencyKey,
            entityType: 'knowledge',
            entityId: existingObj.id,
            version: existingObj.version,
            contentHash,
            recordedAt: new Date().toISOString(),
          };
          await this.writeIdempotencyLedger(ledger);
          return {
            knowledgeId: existingObj.id,
            created: false,
            version: existingObj.version,
            idempotentReplay: true,
          };
        }

        const existingContentHash = computeContentHash(existingObj.content, this.customSecrets);
        const nextContentHash = computeContentHash(validated.content, this.customSecrets);
        const nextVersion =
          existingContentHash === nextContentHash ? existingObj.version : existingObj.version + 1;
        const updated: KnowledgeObject<T> = {
          ...validated,
          version: nextVersion,
          updatedAt: new Date().toISOString(),
        };
        await atomicWriteJson(objFile, updated);
        ledger[idempotencyKey] = {
          key: idempotencyKey,
          entityType: 'knowledge',
          entityId: updated.id,
          version: nextVersion,
          contentHash,
          recordedAt: new Date().toISOString(),
        };
        await this.writeIdempotencyLedger(ledger);
        return {
          knowledgeId: updated.id,
          created: false,
          version: nextVersion,
          idempotentReplay: false,
        };
      }

      await atomicWriteJson(objFile, validated);
      ledger[idempotencyKey] = {
        key: idempotencyKey,
        entityType: 'knowledge',
        entityId: validated.id,
        version: validated.version,
        contentHash,
        recordedAt: new Date().toISOString(),
      };
      await this.writeIdempotencyLedger(ledger);

      return {
        knowledgeId: validated.id,
        created: true,
        version: validated.version,
        idempotentReplay: false,
      };
    });
  }

  public async getKnowledge<T = unknown>(
    knowledgeId: KnowledgeId
  ): Promise<KnowledgeObject<T> | null> {
    const universes = await this.listUniverses();
    for (const u of universes) {
      const file = path.join(this.getObjectsDir(u.id), `${knowledgeId}.json`);
      if (await pathExists(file)) {
        const raw = JSON.parse(await fs.readFile(file, 'utf-8'));
        return validateKnowledgeObject<T>(raw);
      }
    }
    return null;
  }

  private async loadAllObjectsForUniverses(
    universeIds: ProjectUniverseId[]
  ): Promise<KnowledgeObject[]> {
    const results: KnowledgeObject[] = [];
    for (const uid of universeIds) {
      const dir = this.getObjectsDir(uid);
      if (!(await pathExists(dir))) continue;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          const raw = JSON.parse(await fs.readFile(path.join(dir, entry.name), 'utf-8'));
          results.push(validateKnowledgeObject(raw));
        }
      }
    }
    return results;
  }

  private async loadAllRelationsForUniverses(
    universeIds: ProjectUniverseId[]
  ): Promise<KnowledgeRelation[]> {
    const results: KnowledgeRelation[] = [];
    for (const uid of universeIds) {
      const dir = this.getRelationsDir(uid);
      if (!(await pathExists(dir))) continue;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          const raw = JSON.parse(await fs.readFile(path.join(dir, entry.name), 'utf-8'));
          results.push(validateContract('KnowledgeRelation', KnowledgeRelationSchema, raw));
        }
      }
    }
    return results;
  }

  private async loadAllTreeNodesForUniverses(
    universeIds: ProjectUniverseId[]
  ): Promise<KnowledgeTreeNode[]> {
    const results: KnowledgeTreeNode[] = [];
    for (const uid of universeIds) {
      const dir = this.getTreeDir(uid);
      if (!(await pathExists(dir))) continue;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          const raw = JSON.parse(await fs.readFile(path.join(dir, entry.name), 'utf-8'));
          results.push(validateContract('KnowledgeTreeNode', KnowledgeTreeNodeSchema, raw));
        }
      }
    }
    return results;
  }

  public async queryKnowledge(query: KnowledgeQuery): Promise<KnowledgeQueryResult> {
    const objects = await this.loadAllObjectsForUniverses(query.projectUniverseIds);
    const relations = await this.loadAllRelationsForUniverses(query.projectUniverseIds);
    const treeNodes = await this.loadAllTreeNodesForUniverses(query.projectUniverseIds);
    return executeKnowledgeQuery(objects, relations, treeNodes, query);
  }

  public async putRelation(relation: KnowledgeRelation, idempotencyKey: string): Promise<void> {
    const sanitized = redactRecursively(relation, this.customSecrets);
    const validated = validateContract('KnowledgeRelation', KnowledgeRelationSchema, sanitized);

    await this.withStoreLock(async () => {
      const ledger = await this.readIdempotencyLedger();
      if (ledger[idempotencyKey]) {
        return;
      }

      const universeId = validated.projectUniverseId ?? 'default';
      const relDir = this.getRelationsDir(universeId);
      await ensureDir(relDir);
      const relFile = path.join(relDir, `${validated.relationId}.json`);
      await atomicWriteJson(relFile, validated);

      ledger[idempotencyKey] = {
        key: idempotencyKey,
        entityType: 'relation',
        entityId: validated.relationId,
        version: 1,
        contentHash: computeContentHash(validated, this.customSecrets),
        recordedAt: new Date().toISOString(),
      };
      await this.writeIdempotencyLedger(ledger);
    });
  }

  public async getRelations(knowledgeId: KnowledgeId): Promise<KnowledgeRelation[]> {
    const universes = await this.listUniverses();
    const allRels = await this.loadAllRelationsForUniverses(universes.map((u) => u.id));
    return allRels.filter((r) => r.fromId === knowledgeId || r.toId === knowledgeId);
  }

  public async putTreeNode(node: KnowledgeTreeNode, idempotencyKey: string): Promise<void> {
    const sanitized = redactRecursively(node, this.customSecrets);
    const validated = validateContract('KnowledgeTreeNode', KnowledgeTreeNodeSchema, sanitized);

    await this.withStoreLock(async () => {
      const ledger = await this.readIdempotencyLedger();
      if (ledger[idempotencyKey]) {
        return;
      }

      const treeDir = this.getTreeDir(validated.projectUniverseId);
      await ensureDir(treeDir);
      const nodeFile = path.join(treeDir, `${validated.nodeId}.json`);
      await atomicWriteJson(nodeFile, validated);

      ledger[idempotencyKey] = {
        key: idempotencyKey,
        entityType: 'tree',
        entityId: validated.nodeId,
        version: 1,
        contentHash: computeContentHash(validated, this.customSecrets),
        recordedAt: new Date().toISOString(),
      };
      await this.writeIdempotencyLedger(ledger);
    });
  }

  public async getTreeNode(nodeId: TreeNodeId): Promise<KnowledgeTreeNode | null> {
    const universes = await this.listUniverses();
    for (const u of universes) {
      const file = path.join(this.getTreeDir(u.id), `${nodeId}.json`);
      if (await pathExists(file)) {
        const raw = JSON.parse(await fs.readFile(file, 'utf-8'));
        return validateContract('KnowledgeTreeNode', KnowledgeTreeNodeSchema, raw);
      }
    }
    return null;
  }

  public async listTreeNodes(projectUniverseId: ProjectUniverseId): Promise<KnowledgeTreeNode[]> {
    const nodes = await this.loadAllTreeNodesForUniverses([projectUniverseId]);
    return nodes.sort((a, b) => a.domainPath.localeCompare(b.domainPath));
  }

  public async appendEvent(event: MemoryEvent, idempotencyKey: string): Promise<void> {
    const sanitized = redactRecursively(event, this.customSecrets);
    const validated = validateMemoryEvent(sanitized);

    await this.withStoreLock(async () => {
      const ledger = await this.readIdempotencyLedger();
      if (ledger[idempotencyKey]) {
        return;
      }

      const eventsFile = this.getEventsFile(validated.identity.projectUniverseId);
      const existing = await readJsonlFile(eventsFile, MemoryEventSchema, { strict: false });
      if (
        existing.records.some(
          (e) => e.id === validated.id || e.idempotencyKey === idempotencyKey
        )
      ) {
        return;
      }

      await appendJsonlRecord(eventsFile, validated, MemoryEventSchema);
      ledger[idempotencyKey] = {
        key: idempotencyKey,
        entityType: 'event',
        entityId: validated.id,
        version: 1,
        contentHash: computeContentHash(validated.payload, this.customSecrets),
        recordedAt: new Date().toISOString(),
      };
      await this.writeIdempotencyLedger(ledger);
    });
  }

  public async listEvents(
    projectUniverseId: ProjectUniverseId,
    limit?: number
  ): Promise<MemoryEvent[]> {
    const eventsFile = this.getEventsFile(projectUniverseId);
    const parsed = await readJsonlFile(eventsFile, MemoryEventSchema, { strict: false });
    const records = parsed.records;
    if (limit && limit > 0 && records.length > limit) {
      return records.slice(-limit);
    }
    return records;
  }

  private getSnapshotFilePath(identity: MemoryIdentity): string {
    const safeSession = (identity.sessionId ?? 'global').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeBot = (identity.botId ?? 'none').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${identity.projectUniverseId}__${identity.registerKind}__${safeSession}__${safeBot}.json`;
    return path.join(this.getSnapshotsDir(), fileName);
  }

  public async loadSnapshot<TState = unknown>(
    identity: MemoryIdentity
  ): Promise<RegisterSnapshot<TState> | null> {
    const file = this.getSnapshotFilePath(identity);
    if (!(await pathExists(file))) {
      return null;
    }
    const raw = JSON.parse(await fs.readFile(file, 'utf-8'));
    return validateRegisterSnapshot<TState>(raw);
  }

  public async saveSnapshot<TState = unknown>(
    snapshot: RegisterSnapshot<TState>,
    idempotencyKey: string
  ): Promise<void> {
    const sanitized = redactRecursively(snapshot, this.customSecrets);
    const validated = validateRegisterSnapshot<TState>(sanitized);

    await this.withStoreLock(async () => {
      const ledger = await this.readIdempotencyLedger();
      if (ledger[idempotencyKey]) {
        return;
      }

      const file = this.getSnapshotFilePath(validated.identity);
      await ensureDir(path.dirname(file));
      await atomicWriteJson(file, validated);

      ledger[idempotencyKey] = {
        key: idempotencyKey,
        entityType: 'snapshot',
        entityId: validated.id,
        version: 1,
        contentHash: computeContentHash(validated.state, this.customSecrets),
        recordedAt: new Date().toISOString(),
      };
      await this.writeIdempotencyLedger(ledger);
    });
  }

  public async appendRegisterEvent<TPayload = unknown>(
    identity: MemoryIdentity,
    eventType: string,
    payload: TPayload,
    idempotencyKey: string
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const sanitizedPayload = redactRecursively(payload, this.customSecrets);
    const eventId = deriveMemoryEventId({
      sourceSystem: 'pku.register',
      sessionId: identity.sessionId,
      sourceType: eventType,
      sourceRecordId: idempotencyKey,
    });
    const evt: MemoryEvent<TPayload> = {
      id: eventId,
      eventType,
      identity,
      payload: sanitizedPayload,
      occurredAt: nowIso,
      recordedAt: nowIso,
      idempotencyKey,
      provenance: {
        sourceSystem: 'pku.register',
        sourceType: eventType,
        sourceId: eventId,
        createdBy: identity.principalId,
        createdAt: nowIso,
        ingestedAt: nowIso,
        contentHash: computeContentHash(sanitizedPayload, this.customSecrets),
        originProjectUniverseId: identity.projectUniverseId,
      },
    };
    await this.appendEvent(evt, idempotencyKey);
  }
}
