import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import type {
  DocumentStatus,
  DocumentType,
  EnvironmentMetadata,
  ProjectRootRecord,
  RegisterDocumentInput,
  RegisterEnvironmentInput,
  RegisterProjectRootInput,
  SdlcDocumentRecord,
} from './schema.js';
import {
  CURRENT_SHARED_CONTEXT_SCHEMA_VERSION,
  redactSecrets,
  validateSlugId,
} from './schema.js';
import {
  DocumentAlreadyExistsError,
  DocumentNotFoundError,
  ProjectRootAlreadyExistsError,
  ProjectRootNotFoundError,
} from '../core/errors.js';
import {
  createCodebaseIndexerForStorage,
  createWorkspaceMemoryRuntime,
  type MemoryRuntime,
  type ProjectCodebaseIndexer,
} from '../memory_modules/index.js';

export interface SharedContextServiceOptions {
  memoryRuntime?: MemoryRuntime;
  enablePkuSync?: boolean;
}

export class SharedContextService {
  private readonly storage: IBlackboardStorage;
  private readonly memoryRuntime?: MemoryRuntime;
  private readonly codebaseIndexer?: ProjectCodebaseIndexer;

  constructor(storage: IBlackboardStorage, options: SharedContextServiceOptions = {}) {
    this.storage = storage;
    this.memoryRuntime =
      options.memoryRuntime ??
      (options.enablePkuSync !== false ? createWorkspaceMemoryRuntime(storage) ?? undefined : undefined);
    this.codebaseIndexer =
      createCodebaseIndexerForStorage(storage, this.memoryRuntime?.pkuStore) ?? undefined;
  }

  // --- Project Roots ---

  public async registerProjectRoot(
    sessionId: string,
    input: RegisterProjectRootInput
  ): Promise<ProjectRootRecord> {
    const normalizedPath = path.resolve(input.path.trim());
    const rootId = input.rootId
      ? validateSlugId(input.rootId, 'Root ID')
      : validateSlugId(
          input.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'root',
          'Root ID'
        );

    const record = await this.storage.withSessionLock(sessionId, async () => {
      const registry = await this.storage.getProjectRootsRegistry(sessionId);

      if (registry.roots.some((r) => r.root_id === rootId)) {
        throw new ProjectRootAlreadyExistsError(rootId, sessionId);
      }

      const now = new Date().toISOString();
      const created: ProjectRootRecord = {
        root_id: rootId,
        name: input.name.trim(),
        path: normalizedPath,
        root_type: input.rootType ?? 'primary',
        description: input.description?.trim(),
        created_at: now,
        updated_at: now,
      };

      registry.roots.push(created);
      registry.updated_at = now;

      await this.storage.saveProjectRootsRegistry(sessionId, registry);
      return created;
    });

    // Incrementally index project root files into PKU (fail-open)
    try {
      await this.codebaseIndexer?.syncProjectRoot(sessionId, record);
      await this.memoryRuntime?.captureSessionSafely(sessionId);
    } catch {
      // Fail-open: PKU indexing errors never block root registration
    }

    return record;
  }

  public async listProjectRoots(sessionId: string): Promise<ProjectRootRecord[]> {
    const registry = await this.storage.getProjectRootsRegistry(sessionId);
    return registry.roots;
  }

  public async getProjectRoot(sessionId: string, rootId: string): Promise<ProjectRootRecord> {
    const roots = await this.listProjectRoots(sessionId);
    const found = roots.find((r) => r.root_id === rootId);
    if (!found) {
      throw new ProjectRootNotFoundError(rootId, sessionId);
    }
    return found;
  }

  // --- Environment Metadata ---

  public async registerEnvironment(
    sessionId: string,
    input: RegisterEnvironmentInput = {}
  ): Promise<EnvironmentMetadata> {
    const detectedOs = `${os.type()} ${os.release()}`;
    const detectedArch = process.arch;
    const detectedNode = process.version;

    // Apply strict secret redaction
    const safeVariables = redactSecrets(input.variables ?? {});

    const metadata: EnvironmentMetadata = {
      schema_version: CURRENT_SHARED_CONTEXT_SCHEMA_VERSION,
      session_id: sessionId,
      os: input.os ?? detectedOs,
      arch: input.arch ?? detectedArch,
      node_version: input.nodeVersion ?? detectedNode,
      npm_version: input.npmVersion ?? '11.19.0',
      git_version: input.gitVersion,
      variables: safeVariables,
      updated_at: new Date().toISOString(),
    };

    return await this.storage.withSessionLock(sessionId, async () => {
      await this.storage.saveEnvironmentMetadata(sessionId, metadata);
      return metadata;
    });
  }

  public async getEnvironment(sessionId: string): Promise<EnvironmentMetadata | null> {
    return await this.storage.getEnvironmentMetadata(sessionId);
  }

  // --- SDLC Documents ---

  public async registerDocument(
    sessionId: string,
    input: RegisterDocumentInput
  ): Promise<SdlcDocumentRecord> {
    const docId = input.documentId
      ? validateSlugId(input.documentId, 'Document ID')
      : validateSlugId(
          input.title.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'doc',
          'Document ID'
        );

    return await this.storage.withSessionLock(sessionId, async () => {
      const registry = await this.storage.getDocumentsRegistry(sessionId);

      if (registry.documents.some((d) => d.document_id === docId)) {
        throw new DocumentAlreadyExistsError(docId, sessionId);
      }

      const now = new Date().toISOString();
      const record: SdlcDocumentRecord = {
        document_id: docId,
        title: input.title.trim(),
        document_type: input.documentType ?? 'OTHER',
        uri_or_path: input.uriOrPath.trim(),
        version: input.version?.trim(),
        status: input.status ?? 'draft',
        updated_at: now,
      };

      registry.documents.push(record);
      registry.updated_at = now;

      await this.storage.saveDocumentsRegistry(sessionId, registry);
      return record;
    });
  }

  public async listDocuments(
    sessionId: string,
    filter?: { documentType?: DocumentType; status?: DocumentStatus }
  ): Promise<SdlcDocumentRecord[]> {
    const registry = await this.storage.getDocumentsRegistry(sessionId);
    let docs = registry.documents;

    if (filter?.documentType) {
      docs = docs.filter((d) => d.document_type === filter.documentType);
    }
    if (filter?.status) {
      docs = docs.filter((d) => d.status === filter.status);
    }

    return docs;
  }

  public async getDocument(sessionId: string, documentId: string): Promise<SdlcDocumentRecord> {
    const docs = await this.listDocuments(sessionId);
    const found = docs.find((d) => d.document_id === documentId);
    if (!found) {
      throw new DocumentNotFoundError(documentId, sessionId);
    }
    return found;
  }
}
