import { Command } from 'commander';
import { resolveWorkspaceRoot } from '../../core/config.js';
import { FilesystemSessionStorage } from '../../blackboard/filesystem.js';
import { SharedContextService } from '../../shared/service.js';
import type { DocumentStatus, DocumentType, ProjectRootType } from '../../shared/schema.js';

export function registerContextCommands(program: Command): void {
  const context = program
    .command('context')
    .description('Manage shared project context (project roots, environment, SDLC documents)');

  // --- Project Root Commands ---
  const root = context
    .command('root')
    .description('Manage shared project root directories');

  root
    .command('add <name> <path>')
    .description('Register a project directory root in the Session')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('--id <rootId>', 'Optional slug identifier for the root')
    .option('-t, --type <type>', 'Root type (primary, dependency, reference, docs)', 'primary')
    .option('-d, --description <description>', 'Root description')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (name: string, dirPath: string, options: {
      session: string;
      id?: string;
      type: string;
      description?: string;
      workspace?: string;
    }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new SharedContextService(storage);

        const record = await service.registerProjectRoot(options.session, {
          rootId: options.id,
          name,
          path: dirPath,
          rootType: options.type.toLowerCase() as ProjectRootType,
          description: options.description,
        });

        console.log(`Project root registered successfully!`);
        console.log(`  Root ID:     ${record.root_id}`);
        console.log(`  Name:        ${record.name}`);
        console.log(`  Path:        ${record.path}`);
        console.log(`  Type:        ${record.root_type}`);
        if (record.description) {
          console.log(`  Description: ${record.description}`);
        }
      } catch (error: unknown) {
        console.error(`Error registering project root: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  root
    .command('list')
    .description('List registered project roots in the Session')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output list as JSON')
    .action(async (options: { session: string; workspace?: string; json?: boolean }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new SharedContextService(storage);

        const roots = await service.listProjectRoots(options.session);

        if (options.json) {
          console.log(JSON.stringify(roots, null, 2));
          return;
        }

        if (roots.length === 0) {
          console.log(`No project roots registered in session: ${options.session}`);
          return;
        }

        console.log(`Project roots in Session [${options.session}]:\n`);
        for (const r of roots) {
          console.log(`  - [${r.root_id}] ${r.name} (${r.root_type}) -> ${r.path}`);
          if (r.description) {
            console.log(`      ${r.description}`);
          }
        }
      } catch (error: unknown) {
        console.error(`Error listing project roots: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  // --- Environment Metadata Commands ---
  const env = context
    .command('env')
    .description('Manage shared environment metadata');

  env
    .command('set')
    .description('Capture and save host environment metadata with secret redaction')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('--var <keyVal...>', 'Custom environment variable in key=value format (repeatable)')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (options: { session: string; var?: string[]; workspace?: string }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new SharedContextService(storage);

        const customVars: Record<string, string> = {};
        if (options.var) {
          for (const item of options.var) {
            const eqIdx = item.indexOf('=');
            if (eqIdx !== -1) {
              const k = item.slice(0, eqIdx).trim();
              const v = item.slice(eqIdx + 1).trim();
              customVars[k] = v;
            }
          }
        }

        const envMeta = await service.registerEnvironment(options.session, {
          variables: customVars,
        });

        console.log(`Environment metadata recorded successfully!`);
        console.log(`  OS:        ${envMeta.os}`);
        console.log(`  Arch:      ${envMeta.arch}`);
        console.log(`  Node:      ${envMeta.node_version}`);
        console.log(`  npm:       ${envMeta.npm_version}`);
        console.log(`  Variables: ${Object.keys(envMeta.variables).length} registered (secrets redacted)`);
      } catch (error: unknown) {
        console.error(`Error recording environment: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  env
    .command('show')
    .description('Display recorded environment metadata')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output details as JSON')
    .action(async (options: { session: string; workspace?: string; json?: boolean }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new SharedContextService(storage);

        const envMeta = await service.getEnvironment(options.session);

        if (!envMeta) {
          console.log(`No environment metadata recorded for session: ${options.session}`);
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(envMeta, null, 2));
          return;
        }

        console.log(`Environment Metadata for Session [${options.session}]:`);
        console.log(`  OS:           ${envMeta.os}`);
        console.log(`  Arch:         ${envMeta.arch}`);
        console.log(`  Node:         ${envMeta.node_version}`);
        console.log(`  npm:          ${envMeta.npm_version}`);
        console.log(`  Git:          ${envMeta.git_version ?? 'Not recorded'}`);
        console.log(`  Updated At:   ${envMeta.updated_at}`);
        if (Object.keys(envMeta.variables).length > 0) {
          console.log(`  Variables:`);
          for (const [k, v] of Object.entries(envMeta.variables)) {
            console.log(`    ${k} = ${v}`);
          }
        }
      } catch (error: unknown) {
        console.error(`Error displaying environment: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  // --- SDLC Document Commands ---
  const doc = context
    .command('doc')
    .description('Manage references to SDLC documents');

  doc
    .command('add <title> <uriOrPath>')
    .description('Register an SDLC document reference')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('--id <documentId>', 'Optional slug identifier for the document')
    .option(
      '-t, --type <documentType>',
      'Document type (SRS, REQUIREMENTS, ARCHITECTURE, DESIGN, API_SPEC, TEST_PLAN, USER_GUIDE, OTHER)',
      'OTHER'
    )
    .option('--doc-version <version>', 'Document version (e.g. 1.0.0)')
    .option('--status <status>', 'Document status (draft, approved, deprecated)', 'draft')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (title: string, uriOrPath: string, options: {
      session: string;
      id?: string;
      type: string;
      docVersion?: string;
      status: string;
      workspace?: string;
    }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new SharedContextService(storage);

        const document = await service.registerDocument(options.session, {
          documentId: options.id,
          title,
          uriOrPath,
          documentType: options.type.toUpperCase() as DocumentType,
          version: options.docVersion,
          status: options.status.toLowerCase() as DocumentStatus,
        });

        console.log(`SDLC document reference registered successfully!`);
        console.log(`  Doc ID:      ${document.document_id}`);
        console.log(`  Title:       ${document.title}`);
        console.log(`  Type:        ${document.document_type}`);
        console.log(`  URI/Path:    ${document.uri_or_path}`);
        console.log(`  Status:      ${document.status}`);
        if (document.version) {
          console.log(`  Version:     ${document.version}`);
        }
      } catch (error: unknown) {
        console.error(`Error registering document: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  doc
    .command('list')
    .description('List registered SDLC documents in the Session')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output list as JSON')
    .action(async (options: { session: string; workspace?: string; json?: boolean }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new SharedContextService(storage);

        const docs = await service.listDocuments(options.session);

        if (options.json) {
          console.log(JSON.stringify(docs, null, 2));
          return;
        }

        if (docs.length === 0) {
          console.log(`No SDLC documents registered in session: ${options.session}`);
          return;
        }

        console.log(`SDLC Documents in Session [${options.session}]:\n`);
        for (const d of docs) {
          console.log(`  - [${d.document_id}] ${d.title} (${d.document_type}, ${d.status}) -> ${d.uri_or_path}`);
          if (d.version) {
            console.log(`      Version: ${d.version}`);
          }
        }
      } catch (error: unknown) {
        console.error(`Error listing documents: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });
}
