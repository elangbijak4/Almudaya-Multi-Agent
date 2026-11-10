import crypto from 'node:crypto';
import { redactRecursively } from '../../execution/environment.js';
import type {
  CheckpointId,
  KnowledgeId,
  MemoryEventId,
  ProjectUniverseId,
  TreeNodeId,
} from './types.js';

/**
 * Deterministic Canonical JSON Serialization & Identity Strategy (Phase 1 — PKU-002).
 *
 * Ensures that importing the same legacy record or knowledge object multiple times
 * produces identical canonical hashes, IDs, and idempotency keys regardless of
 * property insertion order.
 */

/**
 * Recursively sorts object keys and normalizes values into a deterministic JSON string.
 * Undefined object properties are omitted; array ordering is preserved.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJson(item === undefined ? null : item));
    return `[${items.join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();

    const pairs = sortedKeys.map(
      (key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`
    );
    return `{${pairs.join(',')}}`;
  }

  return JSON.stringify(String(value));
}

/**
 * Computes a deterministic SHA-256 hex digest of a value after applying recursive
 * secret redaction (PKU-008) and canonical key-sorted JSON serialization (PKU-002).
 */
export function computeContentHash(value: unknown, customSecrets: string[] = []): string {
  const redacted = redactRecursively(value, customSecrets);
  const canonical = canonicalizeJson(redacted);
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
}

function sha256Prefix(input: string, length: number = 32): string {
  return crypto.createHash('sha256').update(input, 'utf-8').digest('hex').slice(0, length);
}

export interface DeterministicKnowledgeIdInput {
  sourceSystem: string;
  projectUniverseId?: string;
  sessionId?: string;
  sourceType: string;
  sourceRecordId: string;
}

/**
 * Derives a stable, deterministic KnowledgeId from source provenance coordinates (PKU-002).
 */
export function deriveKnowledgeId(input: DeterministicKnowledgeIdInput): KnowledgeId {
  const scopeSegment = input.projectUniverseId
    ? `pmu:${input.projectUniverseId.trim()}`
    : `sess:${(input.sessionId ?? 'global').trim()}`;
  const composite = [
    input.sourceSystem.trim().toLowerCase(),
    scopeSegment,
    input.sourceType.trim().toLowerCase(),
    input.sourceRecordId.trim(),
  ].join('|');

  return `pku_ko_${sha256Prefix(composite, 32)}`;
}

export interface DeterministicEventIdInput {
  sourceSystem: string;
  sessionId?: string;
  sourceType: string;
  sourceRecordId: string;
}

/**
 * Derives a stable, deterministic MemoryEventId from source event coordinates (PKU-002).
 */
export function deriveMemoryEventId(input: DeterministicEventIdInput): MemoryEventId {
  const composite = [
    input.sourceSystem.trim().toLowerCase(),
    (input.sessionId ?? 'global').trim(),
    input.sourceType.trim().toLowerCase(),
    input.sourceRecordId.trim(),
  ].join('|');

  return `pku_evt_${sha256Prefix(composite, 32)}`;
}

/**
 * Derives a deterministic ProjectUniverseId from a canonical project key or slug.
 */
export function deriveProjectUniverseId(projectKey: string): ProjectUniverseId {
  const normalized = projectKey.trim().toLowerCase();
  return `pmu_${sha256Prefix(normalized, 24)}`;
}

/**
 * Derives a deterministic KnowledgeRelation ID from its endpoints and relation type.
 */
export function deriveRelationId(
  fromId: KnowledgeId,
  relationType: string,
  toId: KnowledgeId
): string {
  const composite = `${fromId.trim()}|${relationType.trim().toLowerCase()}|${toId.trim()}`;
  return `pku_rel_${sha256Prefix(composite, 32)}`;
}

/**
 * Derives a deterministic TreeNodeId from the owning PMU and hierarchical domain path.
 */
export function deriveTreeNodeId(
  projectUniverseId: ProjectUniverseId,
  domainPath: string
): TreeNodeId {
  const composite = `${projectUniverseId.trim()}|${domainPath.trim()}`;
  return `pku_tree_${sha256Prefix(composite, 24)}`;
}

/**
 * Derives a deterministic CheckpointId from bot identity, task/message ID, and iteration.
 */
export function deriveCheckpointId(
  sessionId: string,
  botId: string,
  sourceMessageId: string,
  iteration: number
): CheckpointId {
  const composite = `${sessionId.trim()}|${botId.trim()}|${sourceMessageId.trim()}|${iteration}`;
  return `pku_chk_${sha256Prefix(composite, 24)}`;
}

export interface IdempotencyKeyInput {
  sourceSystem: string;
  scopeId: string;
  sourceType: string;
  sourceRecordId: string;
  contentHash?: string;
}

/**
 * Generates a deterministic idempotency key for replay-safe PKU writes (PKU-002, PKU-018).
 */
export function deriveIdempotencyKey(input: IdempotencyKeyInput): string {
  const base = [
    input.sourceSystem.trim().toLowerCase(),
    input.scopeId.trim(),
    input.sourceType.trim().toLowerCase(),
    input.sourceRecordId.trim(),
    input.contentHash ?? 'v1',
  ].join(':');
  return `idem_${sha256Prefix(base, 36)}`;
}
