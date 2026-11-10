# Data Migration Mapping (`Phase 0`)

**Target:** Field-by-field mapping from all 10 existing persisted JSON/JSONL record types in Almudaya Multi-Agent v0.3.3 to PKU canonical structures (`ProjectMemoryUniverse`, `KnowledgeObject`, `MemoryEvent`, `RegisterSnapshot`, and `KnowledgeRelation`).

---

## 1. Deterministic Identity & Provenance Rules (`PKU-002`, `PKU-003`)

To guarantee idempotent re-imports (`PKU-002`) and full traceability (`PKU-003`), every migrated record derives its canonical PKU identity and `KnowledgeProvenance` deterministically:

1. **Deterministic Knowledge / Event ID Formula:**
   ```text
   canonicalId = "pku_" + sha256(`${sourceSystem}:${sessionId}:${sourceType}:${sourceRecordId}`).slice(0, 32)
   idempotencyKey = `${sourceSystem}:${sessionId}:${sourceType}:${sourceRecordId}:${contentHash}`
   ```
2. **Canonical Content Hash (`contentHash`):**
   - SHA-256 hex digest of canonically key-sorted JSON (`redactRecursively(record)`).
3. **Standard Provenance Population (`KnowledgeProvenance`):**
   - `sourceSystem`: `'almudaya.blackboard'` (or `'almudaya.acg'` for capability files)
   - `sourceType`: Legacy schema type name (e.g., `'SessionMetadata'`, `'WorkLogEntry'`)
   - `sourceId`: Legacy primary key (`session_id`, `bot_id`, `event_id`, `message_id`, `entry_id`, `root_id`, `document_id`, `grant_id`)
   - `sourcePath`: Relative path inside `<workspaceRoot>` (e.g., `sessions/<sessionId>/work_log.jsonl#L<lineNumber>`)
   - `sourceSchemaVersion`: Legacy `schema_version` (`'1.0.0'` where present, `'1.0.0-jsonl'` for JSONL streams)
   - `sourceTimestamp`: Original `created_at` / `updated_at` / `timestamp` from legacy record
   - `createdBy`: `sender_bot_id` / `bot_id` / `granted_by` / `'SYSTEM'`
   - `createdAt`: Original record creation timestamp
   - `ingestedAt`: ISO-8601 timestamp of migration execution
   - `contentHash`: SHA-256 hex digest
   - `migrationBatchId`: Batch UUID/slug for reconciliation and rollback tracking

---

## 2. Entity-by-Entity Mapping Table

| # | Legacy File & Schema | PKU Target Artifact(s) | Scope & Ownership | Field Mapping & Persistence Policy |
|---|---|---|---|---|
| **1** | `session.json`<br>`SessionMetadataSchema` | 1. `KnowledgeObject<SessionMetadata>` (`type: 'session.metadata'`)<br>2. `RegisterSnapshot` (`registerKind: 'global'`) | `scope: 'session'`<br>`ownerId: session_id` | • `id`: deterministic from `session_id`<br>• `title`: `session_name`<br>• `lifecycleStatus`: `'active'` if `status === 'active'`, `'archived'` if `status === 'archived' \| 'closed'`<br>• `createdAt`: `created_at`, `updatedAt`: `updated_at`<br>• Links session to its default or primary `ProjectMemoryUniverse`. |
| **2** | `registry/project_roots.json`<br>`ProjectRootRecordSchema` | 1. `ProjectMemoryUniverse` (for `root_type === 'primary'` or explicit project key)<br>2. `KnowledgeObject<ProjectRootRecord>` (`type: 'project.root'`) | `scope: 'project'`<br>`ownerId: root_id` | • Primary roots establish or bind to a `ProjectMemoryUniverse` (`projectKey: root_id`, `displayName: name`).<br>• **Ownership Rule (`Spec §4.2`):** Only the root descriptor (`root_id`, `name`, `path`, `root_type`, `description`) is stored in PKU; files inside `path` remain owned by the Git repository. |
| **3** | `registry/bots.json`<br>`BotRecordSchema` | 1. `KnowledgeObject<BotRecord>` (`type: 'agent.identity'`)<br>2. `RegisterSnapshot` (`registerKind: 'individual'`) | `scope: 'agent'`<br>`ownerId: bot_id` | • Maps `bot_id`, `display_name`, `description` (role), `status`, `joined_at`, `metadata`.<br>• **Persistence Policy Filter:** Ephemeral `pid` and 2-second `last_seen_at` heartbeat ticks are **excluded** from generating new PKU `MemoryEvent` versions during live runtime; only registration, rename, and status transitions (`active`, `stopped`, `failed`, `stale`) are persisted. |
| **4** | `registry/environment.json`<br>`EnvironmentMetadataSchema` | `KnowledgeObject<EnvironmentMetadata>` (`type: 'session.environment'`) | `scope: 'session'`<br>`ownerId: session_id` | • Maps `os`, `arch`, `node_version`, `npm_version`, `git_version`, and pre-redacted `variables`.<br>• Re-applies `redactRecursively()` prior to PKU storage (`PKU-008`). |
| **5** | `registry/documents.json`<br>`SdlcDocumentRecordSchema` | `KnowledgeObject<SdlcDocumentRecord>` (`type: 'sdlc.document'`) + Tree Membership (`Requirements` / `Architecture` / `Tests`) | `scope: 'project'`<br>`ownerId: document_id` | • Maps `document_id`, `title`, `document_type`, `uri_or_path`, `version`, `status`.<br>• Tree placement derived from `document_type`:<br>  - `SRS`, `REQUIREMENTS` -> `Project/Requirements`<br>  - `ARCHITECTURE`, `DESIGN`, `API_SPEC` -> `Project/Architecture`<br>  - `TEST_PLAN` -> `Project/Tests`<br>• `validationStatus`: `'validated'` if `status === 'approved'`, `'superseded'` if `'deprecated'`, else `'unverified'`. |
| **6** | `broadcast/events.jsonl`<br>`BroadcastEventSchema` | 1. `MemoryEvent<BroadcastEvent>` (`eventType: 'broadcast.' + category.toLowerCase()`)<br>2. Qualifying `KnowledgeObject` for `DECISION` and `ARTIFACT` categories | `scope: 'session'` (or `'project'` for promoted `DECISION`/`ARTIFACT`)<br>`ownerId: sender_bot_id` | • Every broadcast line is ingested idempotently as a `MemoryEvent` (`sourceId: event_id`).<br>• **Knowledge Qualification (`Spec §9.3`):** Broadcasts with `category === 'DECISION'` or `'ARTIFACT'` also materialize a linked `KnowledgeObject` (`type: 'session.decision'` or `'session.artifact'`) with graph relation `derived_from` pointing to the `MemoryEvent`. |
| **7** | `inbox/<botId>/messages.json`<br>`DirectMessageSchema` | 1. `MemoryEvent<DirectMessage>` (`eventType: 'message.direct'`)<br>2. Optional extracted `KnowledgeObject` when qualified | `scope: 'agent'` (recipient/sender scoped)<br>`ownerId: recipient_bot_id` | • Preserves `message_id`, `sender_bot_id`, `recipient_bot_id`, `message_type`, `content`, `timestamp`, `metadata` (`correlationId`).<br>• **Separation Rule (`Spec §4.2, §9.3`):** Transient lease fields (`lease_owner`, `lease_expires_at`, `fence_token`, `attempt_count`, `delivery_state`) remain authoritative in `InboxStore` (`messages.json`) and are captured in `RegisterSnapshot` for operational recovery, never conflated with project knowledge. |
| **8** | `inbox/<botId>/broadcast_cursor.json`<br>`BroadcastCursorSchema` | Included in `RegisterSnapshot` (`registerKind: 'individual'`) | `scope: 'agent'`<br>`ownerId: bot_id` | • Treated strictly as operational Individual Register state (`last_read_event_id`, `last_read_timestamp`, `category_cursors`, `acknowledged_event_ids`), not as a `KnowledgeObject`. |
| **9** | `work_log.jsonl`<br>`WorkLogEntrySchema` | 1. `MemoryEvent<WorkLogEntry>` (`eventType: 'work_log.' + action_type.toLowerCase()`)<br>2. `KnowledgeObject<WorkLogEntry>` (`type: 'development.work_log'`) + Graph Relations | `scope: 'project'` (linked to `target_root_id`) & `'agent'` (`bot_id`)<br>`ownerId: bot_id` | • Preserves `entry_id`, `bot_id`, `bot_name`, `action_type`, `target_root_id`, `relative_path`, `summary`, `details`, `timestamp`.<br>• Creates graph relations: `(workLogObj) --created_by--> (botIdentityObj)` and `(workLogObj) --executed_during--> (sessionMetadataObj)`. |
| **10** | `capabilities/grants.jsonl` & `audit.jsonl`<br>`CapabilityGrantSchema`, `SecurityAuditEventSchema` | `MemoryEvent` (`eventType: 'security.capability_grant'` / `'security.audit_event'`) | `scope: 'session'`<br>`ownerId: session_id` | • Imported read-only with original `grant_id` / `event_id` and `timestamp` for security provenance and audit traceability. ACG `CapabilityPersistence` remains authoritative for policy evaluation. |

---

## 3. Baseline Checksummed Legacy Session Fixtures in Repository (`sessions/`)

The following live session artifacts currently exist in the working tree (`D:\almudaya_multiagent_v0.1.0\sessions\`) and are recorded as the Phase 0 baseline checksum manifest:

| Relative File Path | Size (Bytes) | SHA-256 Checksum |
|---|---:|---|
| `sessions/S_CODING_BENCHMARK/capabilities/audit.jsonl` | 4,668 | `660EE555638444AF03796AA3FE8941C128E520AB8628B44DCA25CAFF35ED0F57` |
| `sessions/S_MULTI_ROOT_BENCHMARK/capabilities/audit.jsonl` | 9,090 | `1275D8EEA9BC375BE6785365589BD416582307B0B7A5DD7F3C0A6D4E4CAAD860` |
| `sessions/S_SEC_PROMPT_INJECTION_TEST/.fencing_token` | 1 | `4B227777D4DD1FC61C6F884F48641D02B4D121D3FD328CB08B5531FCACDABF8A` |
| `sessions/S_SEC_PROMPT_INJECTION_TEST/capabilities/audit.jsonl` | 8,666 | `D9144CBE3B94290EA95A365E4573AA8FBB090C5AD702DA84ECF9ADE3A8975B8C` |
| `sessions/S_SEC_PROMPT_INJECTION_TEST/capabilities/grants.jsonl` | 0 | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` |
