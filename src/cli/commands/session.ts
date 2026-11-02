import { Command } from 'commander';
import { resolveWorkspaceRoot } from '../../core/config.js';
import { FilesystemSessionStorage } from '../../blackboard/filesystem.js';
import { SessionService } from '../../session/service.js';

export function registerSessionCommands(program: Command): void {
  const session = program
    .command('session')
    .description('Manage Almudaya collaboration sessions');

  session
    .command('create <name>')
    .description('Create a new collaboration session')
    .option('-s, --session <id>', 'Specify a stable session ID (defaults to derived slug)')
    .option('--id <id>', 'Alias for --session ID')
    .option('--description <description>', 'Optional session description')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .action(async (name: string, options: { session?: string; id?: string; description?: string; workspace?: string }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new SessionService(storage);

        const targetSessionId = options.session ?? options.id;
        const created = await service.createSession({
          sessionId: targetSessionId,
          sessionName: name,
          description: options.description,
        });

        const sessionPath = service.getSessionDir(created.session_id);
        console.log(`Session created successfully!`);
        console.log(`  Session ID:   ${created.session_id}`);
        console.log(`  Name:         ${created.session_name}`);
        if (created.description) {
          console.log(`  Description:  ${created.description}`);
        }
        console.log(`  Status:       ${created.status}`);
        console.log(`  Created:      ${created.created_at}`);
        console.log(`  Location:     ${sessionPath}`);
      } catch (error: unknown) {
        console.error(`Error creating session: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  session
    .command('list')
    .description('List all sessions in the workspace')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output list as JSON')
    .action(async (options: { workspace?: string; json?: boolean }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new SessionService(storage);

        const sessions = await service.listSessions();

        if (options.json) {
          console.log(JSON.stringify(sessions, null, 2));
          return;
        }

        if (sessions.length === 0) {
          console.log(`No sessions found in workspace: ${workspaceRoot}`);
          return;
        }

        console.log(`Sessions in workspace (${workspaceRoot}):\n`);
        for (const s of sessions) {
          console.log(`  - [${s.session_id}] ${s.session_name} (${s.status})`);
          if (s.description) {
            console.log(`      ${s.description}`);
          }
          console.log(`      Created: ${s.created_at}`);
        }
      } catch (error: unknown) {
        console.error(`Error listing sessions: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  session
    .command('inspect [sessionId]')
    .description('Inspect details of an existing session')
    .option('-s, --session <id>', 'Session ID to inspect')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output details as JSON')
    .action(async (sessionId: string | undefined, options: { session?: string; workspace?: string; json?: boolean }) => {
      try {
        const targetSessionId = sessionId ?? options.session;
        if (!targetSessionId) {
          console.error('Error: Session ID is required (e.g. almudaya session inspect <id> or --session <id>)');
          process.exitCode = 1;
          return;
        }

        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const service = new SessionService(storage);

        const sessionData = await service.getSession(targetSessionId);
        const sessionPath = service.getSessionDir(sessionData.session_id);

        if (options.json) {
          console.log(JSON.stringify({ ...sessionData, location: sessionPath }, null, 2));
          return;
        }

        console.log(`Session Details:`);
        console.log(`  Session ID:     ${sessionData.session_id}`);
        console.log(`  Name:           ${sessionData.session_name}`);
        console.log(`  Description:    ${sessionData.description ?? 'None'}`);
        console.log(`  Status:         ${sessionData.status}`);
        console.log(`  Schema Version: ${sessionData.schema_version}`);
        console.log(`  Created At:     ${sessionData.created_at}`);
        console.log(`  Updated At:     ${sessionData.updated_at}`);
        console.log(`  Location:       ${sessionPath}`);
      } catch (error: unknown) {
        console.error(`Error inspecting session: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });
}
