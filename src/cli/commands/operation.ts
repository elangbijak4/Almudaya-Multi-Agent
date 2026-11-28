import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Command } from 'commander';
import { FilesystemSessionStorage } from '../../blackboard/filesystem.js';
import { resolveWorkspaceRoot } from '../../core/config.js';
import { OperationManifoldService } from '../../operation/manifold-engine.js';
import { OperationRegistry } from '../../operation/registry.js';
import { validateOperationPackage } from '../../operation/validator.js';
import { ProtocolSupervisor } from '../../protocol/supervisor.js';

async function parseJsonOrFile(raw?: string): Promise<Record<string, unknown> | undefined> {
  if (!raw || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }
  const text = await fs.readFile(path.resolve(trimmed), 'utf-8');
  return JSON.parse(text) as Record<string, unknown>;
}

export function registerOperationCommands(program: Command): void {
  const opCmd = program
    .command('operation')
    .description(
      'Manage, validate, apply, evaluate, and crystallize almudaya.operation/v0.3 Dynamic Swarm Manifolds'
    );

  opCmd
    .command('list')
    .description('List bundled and workspace-registered Agentic Operations (v0.3)')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--dir <path...>', 'Additional Operation directories to scan')
    .option('--json', 'Output as JSON')
    .action(async (options: { workspace?: string; dir?: string[]; json?: boolean }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const registry = new OperationRegistry({ workspaceRoot, extraDirs: options.dir });
        const ops = await registry.listOperations();

        if (options.json) {
          console.log(
            JSON.stringify(
              ops.map((p) => ({
                id: p.op.identity.id,
                name: p.op.identity.name,
                version: p.op.identity.version,
                alias: p.op.identity.alias,
                regime: p.op.manifold.orchestration_regime,
                topology: p.op.manifold.topology_shape,
                roles: p.op.manifold.roles.map((r) => r.id),
                sub_operations: (p.op.manifold.sub_operations ?? []).map((s) => s.operation_ref),
                dir: p.opDir,
              })),
              null,
              2
            )
          );
          return;
        }

        console.log(`Registered Agentic Operations (${ops.length}):\n`);
        for (const p of ops) {
          const alias = p.op.identity.alias ? ` (${p.op.identity.alias})` : '';
          console.log(`  * ${p.op.identity.id}@${p.op.identity.version}${alias}`);
          console.log(
            `    Regime: ${p.op.manifold.orchestration_regime} | Topology: ${p.op.manifold.topology_shape} | L1 Fallback: ${p.op.manifold.continuity.l1_single_agent_fallback}`
          );
          console.log(`    Roles:  ${p.op.manifold.roles.map((r) => r.id).join(', ')}`);
          console.log(`    Path:   ${p.opDir}`);
        }
      } catch (err: unknown) {
        console.error(`Error listing operations: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  opCmd
    .command('inspect <idOrAlias>')
    .description('Inspect full definition, Role Archetypes, OBS loops, and protocol bindings')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--dir <path...>', 'Additional Operation directories to scan')
    .option('--json', 'Output as JSON')
    .action(
      async (
        idOrAlias: string,
        options: { workspace?: string; dir?: string[]; json?: boolean }
      ) => {
        try {
          const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
          const registry = new OperationRegistry({ workspaceRoot, extraDirs: options.dir });
          const pkg = await registry.resolveOperation(idOrAlias);

          if (options.json) {
            console.log(JSON.stringify(pkg.op, null, 2));
            return;
          }

          const op = pkg.op;
          console.log(`Operation: ${op.identity.name} [${op.identity.id}@${op.identity.version}]`);
          console.log(`  Objective : ${op.mission.objective}`);
          console.log(
            `  Manifold  : regime=${op.manifold.orchestration_regime}, topology=${op.manifold.topology_shape}, l1_fallback=${op.manifold.continuity.l1_single_agent_fallback}`
          );
          console.log(`  Roles (${op.manifold.roles.length}):`);
          for (const r of op.manifold.roles) {
            console.log(
              `    - ${r.id} [${r.kind}] card=${r.lifecycle.cardinality.min}..${r.lifecycle.cardinality.max} trigger=${r.lifecycle.spawn_trigger} dissolve=${r.lifecycle.dissolve_on} access=${r.default_access_mode}`
            );
          }
          if (op.manifold.anti_affinity?.length) {
            console.log(`  Anti-Affinity:`);
            for (const aa of op.manifold.anti_affinity) {
              console.log(`    - ${aa.roles[0]} != ${aa.roles[1]} (${aa.enforcement})`);
            }
          }
          console.log(`  OBS Loops (${op.behavior.loops.length}):`);
          for (const lp of op.behavior.loops) {
            console.log(
              `    - ${lp.id} [${lp.scope}] max_iter=${lp.max_iterations} no_progress=${lp.no_progress_limit}`
            );
          }
        } catch (err: unknown) {
          console.error(`Error inspecting operation: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  opCmd
    .command('validate [idOrAlias]')
    .description('Run 9-layer static semantic validation across Operations')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--dir <path...>', 'Additional Operation directories to scan')
    .option('--json', 'Output as JSON')
    .action(
      async (
        idOrAlias: string | undefined,
        options: { workspace?: string; dir?: string[]; json?: boolean }
      ) => {
        try {
          const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
          const registry = new OperationRegistry({ workspaceRoot, extraDirs: options.dir });

          if (idOrAlias) {
            const pkg = await registry.resolveOperation(idOrAlias);
            const all = await registry.listOperations();
            const map = new Map(all.map((p) => [p.op.identity.id, p]));
            const errors = await validateOperationPackage(pkg.opDir, map);
            const res = {
              valid: errors.length === 0,
              checkedCount: 1,
              operationId: pkg.op.identity.id,
              errors,
            };
            if (options.json) {
              console.log(JSON.stringify(res, null, 2));
            } else {
              console.log(
                res.valid
                  ? `Operation ${pkg.op.identity.id} is VALID (0 errors).`
                  : `Validation FAILED (${errors.length} error(s)):\n- ${errors.join('\n- ')}`
              );
            }
            if (!res.valid) process.exitCode = 1;
            return;
          }

          const res = await registry.validateAll();
          if (options.json) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            console.log(
              res.valid
                ? `All ${res.checkedCount} Operation(s) PASSED static semantic validation (0 errors).`
                : `Validation FAILED (${res.errors.length} error(s)):\n- ${res.errors.join('\n- ')}`
            );
          }
          if (!res.valid) process.exitCode = 1;
        } catch (err: unknown) {
          console.error(`Error validating operations: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  opCmd
    .command('apply <idOrAlias>')
    .description('Apply an Agentic Operation to a session, configuring protocols, rules, and GoalLedger')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-p, --params <jsonOrFile>', 'Optional JSON string or path to input parameters JSON')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--dir <path...>', 'Additional Operation directories to scan')
    .option('--json', 'Output as JSON')
    .action(
      async (
        idOrAlias: string,
        options: {
          session: string;
          params?: string;
          workspace?: string;
          dir?: string[];
          json?: boolean;
        }
      ) => {
        try {
          const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
          const storage = new FilesystemSessionStorage(workspaceRoot);
          const supervisor = new ProtocolSupervisor({ storage });
          const manifold = new OperationManifoldService({ storage, supervisor });
          const parameters = await parseJsonOrFile(options.params);

          const instance = await manifold.applyOperation(options.session, idOrAlias, {
            parameters,
            extraDirs: options.dir,
          });

          if (options.json) {
            console.log(JSON.stringify(instance, null, 2));
            return;
          }

          console.log(
            `Applied Operation "${instance.operationId}@${instance.operationVersion}" to session ${options.session}`
          );
          console.log(`  Instance ID : ${instance.instanceId}`);
          console.log(`  Regime      : ${instance.orchestrationRegime} (${instance.topologyShape})`);
          console.log(`  Seeded Tasks: ${instance.seededTaskIds.length}`);
          console.log(`  Dynamic Rules: ${instance.appliedDynamicRuleIds.length}`);
        } catch (err: unknown) {
          console.error(`Error applying operation: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  opCmd
    .command('status')
    .description('Show active Operation Instance state and live role realizations for a session')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output as JSON')
    .action(async (options: { session: string; workspace?: string; json?: boolean }) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
        const storage = new FilesystemSessionStorage(workspaceRoot);
        const supervisor = new ProtocolSupervisor({ storage });
        const manifold = new OperationManifoldService({ storage, supervisor });
        const instance = await manifold.getActiveInstance(options.session);

        if (options.json) {
          console.log(JSON.stringify(instance ?? null, null, 2));
          return;
        }

        if (!instance) {
          console.log(`No active Operation bound to session ${options.session}.`);
          return;
        }

        console.log(`Active Operation [${instance.operationId}@${instance.operationVersion}]`);
        console.log(`  Status      : ${instance.status}`);
        console.log(`  Regime      : ${instance.orchestrationRegime} (${instance.topologyShape})`);
        console.log(`  Active Roles: ${JSON.stringify(instance.roleRealizationMap)}`);
        console.log(`  History     : ${JSON.stringify(instance.botRoleBindings)}`);
      } catch (err: unknown) {
        console.error(`Error reading operation status: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  opCmd
    .command('evaluate')
    .description('Evaluate structured OBS PredicateExpr loops and termination guards for a session')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('--metrics <jsonOrFile>', 'Optional candidate/accepted/gate metric overrides JSON')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output as JSON')
    .action(
      async (options: {
        session: string;
        metrics?: string;
        workspace?: string;
        json?: boolean;
      }) => {
        try {
          const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
          const storage = new FilesystemSessionStorage(workspaceRoot);
          const supervisor = new ProtocolSupervisor({ storage });
          const manifold = new OperationManifoldService({ storage, supervisor });
          const overrides = await parseJsonOrFile(options.metrics);
          const verdict = await manifold.evaluateBehavior(options.session, overrides);

          if (options.json) {
            console.log(JSON.stringify(verdict, null, 2));
            return;
          }

          console.log(`OBS Evaluation for ${verdict.operationId} (status=${verdict.status}):`);
          console.log(`  Termination: ${JSON.stringify(verdict.termination)}`);
          for (const lp of verdict.loops) {
            console.log(
              `  Loop ${lp.id} [${lp.scope}]: continue=${lp.continuation} accept=${lp.acceptance} rollback=${lp.rollback}`
            );
          }
        } catch (err: unknown) {
          console.error(`Error evaluating operation OBS: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  opCmd
    .command('crystallize')
    .description('Crystallize the active Operation manifold into a validated workspace package')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('--id <operationId>', 'Target Operation registry ID')
    .option('--ver <version>', 'Target semantic version')
    .option('--force', 'Allow crystallization even before all GoalLedger tasks are DONE', false)
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output as JSON')
    .action(
      async (options: {
        session: string;
        id?: string;
        ver?: string;
        force?: boolean;
        workspace?: string;
        json?: boolean;
      }) => {
        try {
          const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
          const storage = new FilesystemSessionStorage(workspaceRoot);
          const supervisor = new ProtocolSupervisor({ storage });
          const manifold = new OperationManifoldService({ storage, supervisor });
          const result = await manifold.crystallizeActiveOperation(options.session, {
            targetId: options.id,
            version: options.ver,
            force: Boolean(options.force),
          });

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }

          console.log(
            `Crystallized ${result.operationId}@${result.version} -> ${result.outputDir}`
          );
        } catch (err: unknown) {
          console.error(`Error crystallizing operation: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );
}
