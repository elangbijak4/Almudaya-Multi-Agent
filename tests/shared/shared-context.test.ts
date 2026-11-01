import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import { SharedContextService } from '../../src/shared/service.js';
import { redactSecrets } from '../../src/shared/schema.js';
import {
  DocumentAlreadyExistsError,
  DocumentNotFoundError,
  ProjectRootAlreadyExistsError,
  ProjectRootNotFoundError,
} from '../../src/core/errors.js';

describe('Shared Project Context & Secret Redaction', () => {
  let tmpWorkspace: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let contextService: SharedContextService;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-shared-test-'));
    storage = new FilesystemSessionStorage(tmpWorkspace);
    sessionService = new SessionService(storage);
    contextService = new SharedContextService(storage);

    await sessionService.createSession({ sessionId: 'S001', sessionName: 'Context Lab' });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Secret Redaction Utility', () => {
    it('should redact sensitive keys and JWT tokens', () => {
      const vars = {
        API_KEY: 'sk-1234567890abcdef',
        DATABASE_PASSWORD: 'supersecretpassword',
        AUTH_TOKEN: 'token-xyz',
        MY_SECRET: 'very_confidential',
        NORMAL_PATH: '/usr/local/bin',
        APP_ENV: 'development',
      };

      const redacted = redactSecrets(vars);

      expect(redacted['API_KEY']).toBe('[REDACTED]');
      expect(redacted['DATABASE_PASSWORD']).toBe('[REDACTED]');
      expect(redacted['AUTH_TOKEN']).toBe('[REDACTED]');
      expect(redacted['MY_SECRET']).toBe('[REDACTED]');
      expect(redacted['NORMAL_PATH']).toBe('/usr/local/bin');
      expect(redacted['APP_ENV']).toBe('development');
    });
  });

  describe('Project Roots Registry', () => {
    it('should register and list multiple project roots with normalized paths', async () => {
      const root1 = await contextService.registerProjectRoot('S001', {
        rootId: 'frontend',
        name: 'Frontend App',
        path: './apps/web',
        rootType: 'primary',
        description: 'Next.js frontend',
      });

      const root2 = await contextService.registerProjectRoot('S001', {
        rootId: 'backend',
        name: 'Backend API',
        path: './services/api',
        rootType: 'dependency',
      });

      expect(root1.root_id).toBe('frontend');
      expect(root1.path).toBe(path.resolve('./apps/web'));
      expect(root2.root_id).toBe('backend');
      expect(root2.path).toBe(path.resolve('./services/api'));

      const all = await contextService.listProjectRoots('S001');
      expect(all.length).toBe(2);
      expect(all.map((r) => r.root_id)).toEqual(['frontend', 'backend']);
    });

    it('should reject duplicate project root ID', async () => {
      await contextService.registerProjectRoot('S001', {
        rootId: 'core',
        name: 'Core Module',
        path: '/path/core',
      });

      await expect(
        contextService.registerProjectRoot('S001', {
          rootId: 'core',
          name: 'Core Duplicate',
          path: '/path/other',
        })
      ).rejects.toThrow(ProjectRootAlreadyExistsError);
    });

    it('should retrieve a specific root and throw if not found', async () => {
      await contextService.registerProjectRoot('S001', {
        rootId: 'docs',
        name: 'Documentation',
        path: '/docs',
      });

      const root = await contextService.getProjectRoot('S001', 'docs');
      expect(root.name).toBe('Documentation');

      await expect(contextService.getProjectRoot('S001', 'nonexistent')).rejects.toThrow(
        ProjectRootNotFoundError
      );
    });

    it('should persist project roots across restarts', async () => {
      await contextService.registerProjectRoot('S001', {
        rootId: 'persistent-root',
        name: 'Persistent Root',
        path: '/path/durable',
      });

      const freshStorage = new FilesystemSessionStorage(tmpWorkspace);
      const freshContext = new SharedContextService(freshStorage);

      const roots = await freshContext.listProjectRoots('S001');
      expect(roots.length).toBe(1);
      expect(roots[0]?.root_id).toBe('persistent-root');
    });
  });

  describe('Environment Metadata Registry', () => {
    it('should capture environment metadata and redact sensitive variables', async () => {
      const recorded = await contextService.registerEnvironment('S001', {
        variables: {
          SAFE_VAR: 'hello-world',
          DATABASE_SECRET: 'leaked-secret-123',
        },
      });

      expect(recorded.os).toBeDefined();
      expect(recorded.node_version).toBe(process.version);
      expect(recorded.variables['SAFE_VAR']).toBe('hello-world');
      expect(recorded.variables['DATABASE_SECRET']).toBe('[REDACTED]');

      const retrieved = await contextService.getEnvironment('S001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.variables['DATABASE_SECRET']).toBe('[REDACTED]');
    });
  });

  describe('SDLC Document Registry', () => {
    it('should register and filter SDLC document references', async () => {
      await contextService.registerDocument('S001', {
        documentId: 'srs-doc',
        title: 'System Requirements Specification',
        documentType: 'SRS',
        uriOrPath: 'docs/SRS.md',
        status: 'approved',
      });

      await contextService.registerDocument('S001', {
        documentId: 'arch-doc',
        title: 'Architecture Blueprint',
        documentType: 'ARCHITECTURE',
        uriOrPath: 'docs/ARCH.md',
        status: 'draft',
      });

      const all = await contextService.listDocuments('S001');
      expect(all.length).toBe(2);

      const srsDocs = await contextService.listDocuments('S001', { documentType: 'SRS' });
      expect(srsDocs.length).toBe(1);
      expect(srsDocs[0]?.document_id).toBe('srs-doc');

      const draftDocs = await contextService.listDocuments('S001', { status: 'draft' });
      expect(draftDocs.length).toBe(1);
      expect(draftDocs[0]?.document_id).toBe('arch-doc');
    });

    it('should reject duplicate document ID', async () => {
      await contextService.registerDocument('S001', {
        documentId: 'api-spec',
        title: 'API Spec',
        uriOrPath: 'docs/api.yaml',
      });

      await expect(
        contextService.registerDocument('S001', {
          documentId: 'api-spec',
          title: 'Duplicate Spec',
          uriOrPath: 'docs/api_v2.yaml',
        })
      ).rejects.toThrow(DocumentAlreadyExistsError);
    });

    it('should throw DocumentNotFoundError for unknown document ID', async () => {
      await expect(contextService.getDocument('S001', 'unknown')).rejects.toThrow(
        DocumentNotFoundError
      );
    });
  });
});
