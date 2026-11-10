import type { BotRecord } from '../../bot/schema.js';
import type { BroadcastCategory } from '../../messaging/schema.js';

/**
 * PKU Knowledge Ownership, Source-of-Truth & Persistence Qualification Policies
 * (Phase 1 — Spec §2.1, §4.2, §9.3, §10.5 & MIGRATION_RISK_REGISTER RISK-03, RISK-08).
 */

export type DataDomainKind =
  | 'source_code'
  | 'commit_history'
  | 'session_coordination_state'
  | 'individual_agent_continuity'
  | 'project_knowledge_representation'
  | 'message_delivery_state'
  | 'capability_governance_state'
  | 'external_obsidian_notes'
  | 'external_vector_index'
  | 'external_graph_store';

export interface SourceOfTruthRule {
  domain: DataDomainKind;
  primarySourceOfTruth: string;
  pkuRole: 'reference_and_metadata_only' | 'persistent_register_backing' | 'canonical_owner' | 'external_adapter_sync';
  pkuMayPhysicallyDeleteSource: boolean;
  retentionPolicy: 'permanent_project_lifecycle' | 'session_operational_with_snapshot' | 'external_owner_controlled';
}

/**
 * Normative Source-of-Truth & Retention Boundary Table (Spec §4.2, §10.5).
 */
export const SOURCE_OF_TRUTH_BOUNDARIES: Readonly<Record<DataDomainKind, SourceOfTruthRule>> = {
  source_code: {
    domain: 'source_code',
    primarySourceOfTruth: 'Git repository / Target Project Root filesystem',
    pkuRole: 'reference_and_metadata_only',
    pkuMayPhysicallyDeleteSource: false,
    retentionPolicy: 'external_owner_controlled',
  },
  commit_history: {
    domain: 'commit_history',
    primarySourceOfTruth: 'Git',
    pkuRole: 'reference_and_metadata_only',
    pkuMayPhysicallyDeleteSource: false,
    retentionPolicy: 'external_owner_controlled',
  },
  session_coordination_state: {
    domain: 'session_coordination_state',
    primarySourceOfTruth: 'Blackboard Global Register (FilesystemSessionStorage), backed by PKU',
    pkuRole: 'persistent_register_backing',
    pkuMayPhysicallyDeleteSource: false,
    retentionPolicy: 'session_operational_with_snapshot',
  },
  individual_agent_continuity: {
    domain: 'individual_agent_continuity',
    primarySourceOfTruth: 'ACMA Individual Register, backed by PKU',
    pkuRole: 'persistent_register_backing',
    pkuMayPhysicallyDeleteSource: false,
    retentionPolicy: 'permanent_project_lifecycle',
  },
  project_knowledge_representation: {
    domain: 'project_knowledge_representation',
    primarySourceOfTruth: 'PKU (Project Memory Universe)',
    pkuRole: 'canonical_owner',
    pkuMayPhysicallyDeleteSource: true,
    retentionPolicy: 'permanent_project_lifecycle',
  },
  message_delivery_state: {
    domain: 'message_delivery_state',
    primarySourceOfTruth: 'Messaging / InboxDeliveryService (messages.json & broadcast_cursor.json)',
    pkuRole: 'persistent_register_backing',
    pkuMayPhysicallyDeleteSource: false,
    retentionPolicy: 'session_operational_with_snapshot',
  },
  capability_governance_state: {
    domain: 'capability_governance_state',
    primarySourceOfTruth: 'ACG CapabilityPersistence (grants.jsonl & audit.jsonl)',
    pkuRole: 'reference_and_metadata_only',
    pkuMayPhysicallyDeleteSource: false,
    retentionPolicy: 'session_operational_with_snapshot',
  },
  external_obsidian_notes: {
    domain: 'external_obsidian_notes',
    primarySourceOfTruth: 'Obsidian Vault',
    pkuRole: 'external_adapter_sync',
    pkuMayPhysicallyDeleteSource: false,
    retentionPolicy: 'external_owner_controlled',
  },
  external_vector_index: {
    domain: 'external_vector_index',
    primarySourceOfTruth: 'Registered Vector Backend',
    pkuRole: 'external_adapter_sync',
    pkuMayPhysicallyDeleteSource: false,
    retentionPolicy: 'external_owner_controlled',
  },
  external_graph_store: {
    domain: 'external_graph_store',
    primarySourceOfTruth: 'Registered Graph Backend',
    pkuRole: 'external_adapter_sync',
    pkuMayPhysicallyDeleteSource: false,
    retentionPolicy: 'external_owner_controlled',
  },
};

/**
 * Persistence Qualification Policy for Bot Registry Updates (RISK-03 Mitigation).
 *
 * `BotRuntime` updates `last_seen_at` every 2,000 ms via `BotService.touchHeartbeat()`.
 * To prevent flooding PKU with ephemeral heartbeat ticks, a bot registry mutation
 * only qualifies for PKU persistence when semantic identity or status fields change.
 */
export function qualifiesBotRegistryMutation(
  previous: BotRecord | undefined,
  next: BotRecord
): boolean {
  if (!previous) {
    return true; // Newly registered bot
  }

  if (
    previous.bot_id !== next.bot_id ||
    previous.display_name !== next.display_name ||
    previous.status !== next.status ||
    previous.description !== next.description
  ) {
    return true;
  }

  const prevMeta = JSON.stringify(previous.metadata ?? {});
  const nextMeta = JSON.stringify(next.metadata ?? {});
  if (prevMeta !== nextMeta) {
    return true;
  }

  // Only `last_seen_at` or transient `pid` changed -> ephemeral heartbeat, do not persist as new PKU event
  return false;
}

/**
 * Determines whether a session BroadcastEvent category qualifies for promotion to
 * a canonical project/session KnowledgeObject in addition to being recorded as a MemoryEvent (Spec §9.3).
 */
export function qualifiesBroadcastForKnowledgePromotion(category: BroadcastCategory): boolean {
  return category === 'DECISION' || category === 'ARTIFACT' || category === 'OBSERVATION';
}

/**
 * Determines whether a DirectMessage qualifies for extraction as a persistent KnowledgeObject
 * beyond its operational message record (Spec §9.3).
 */
export function qualifiesDirectMessageForKnowledgeExtraction(message: {
  message_type?: string;
  metadata?: Record<string, unknown>;
}): boolean {
  if (message.metadata?.['promoteToKnowledge'] === true) {
    return true;
  }
  const knowledgeRefs = message.metadata?.['knowledgeRefs'];
  if (Array.isArray(knowledgeRefs) && knowledgeRefs.length > 0) {
    return true;
  }
  return false;
}
