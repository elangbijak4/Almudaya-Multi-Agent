import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Command } from 'commander';
import { FilesystemSessionStorage } from '../../blackboard/filesystem.js';
import { resolveWorkspaceRoot } from '../../core/config.js';
import { LocalFilesystemPKUStore } from '../../memory_modules/index.js';
import type { SkillEntryPoint } from '../../skills/schema.js';
import { SkillService } from '../../skills/service.js';

export function registerSkillCommands(program: Command): void {
  const skill = program
    .command('skill')
    .description(
      'Manage and inspect agent skills, AVDS v1.0.1 visual styles, platform profiles, modalities, and session skill bindings'
    );

  // 1. almudaya skill list
  skill
    .command('list')
    .description('List installed skill modules and active session/bot skill bindings')
    .option('-s, --session <sessionId>', 'Optional session ID to also list active bindings')
    .option('-b, --bot <botId>', 'Optional bot ID filter when --session is provided')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output as JSON')
    .action(
      async (options: {
        session?: string;
        bot?: string;
        workspace?: string;
        json?: boolean;
      }) => {
        try {
          const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
          const storage = new FilesystemSessionStorage(workspaceRoot);
          const service = new SkillService({ storage });

          const installed = await service.listSkills();
          const bindings = options.session
            ? await service.getSessionSkills(options.session, options.bot, false)
            : [];

          if (options.json) {
            console.log(
              JSON.stringify(
                {
                  installed_skills: installed,
                  session_bindings: bindings,
                },
                null,
                2
              )
            );
            return;
          }

          console.log(`Installed Skill Modules (${installed.length}):\n`);
          for (const s of installed) {
            console.log(`  * ${s.skill_id} (v${s.version})`);
            console.log(`    ${s.description}`);
            console.log(
              `    Assets:       ${s.styles_count} visual styles | ${s.platforms_count} platform profiles | ${s.modalities_count} interaction modalities`
            );
            console.log(`    Sub-skills:   ${s.sub_skills.length} specialist modules`);
            console.log(`    Entry Points: ${s.entry_points.join(', ')}`);
            console.log(`    Location:     ${s.root_path}`);
          }

          if (options.session) {
            console.log(`\nSkill Bindings in Session [${options.session}]:`);
            if (bindings.length === 0) {
              console.log('  (No explicit skill bindings registered yet)');
            } else {
              for (const b of bindings) {
                console.log(
                  `  - [${b.status.toUpperCase()}] ${b.skill_id} -> ${b.bot_id ? `Bot ${b.bot_id}` : 'All Bots in Session'}`
                );
                if (b.config.primary_style) {
                  console.log(`      Primary Style: ${b.config.primary_style}`);
                }
                if (b.config.secondary_styles?.length) {
                  console.log(
                    `      Influences:    ${b.config.secondary_styles.join(', ')}`
                  );
                }
                if (b.config.platform) {
                  console.log(`      Platform:      ${b.config.platform}`);
                }
                if (b.config.modalities?.length) {
                  console.log(`      Modalities:    ${b.config.modalities.join(', ')}`);
                }
                if (b.config.entry_point) {
                  console.log(`      Entry Point:   ${b.config.entry_point}`);
                }
              }
            }
          }
        } catch (err: unknown) {
          console.error(`Error listing skills: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  // 2. almudaya skill inspect [skillId]
  skill
    .command('inspect [skillId]')
    .description('Inspect architecture, sub-skills, schemas, and scenarios of a skill module')
    .option('--json', 'Output as JSON')
    .action(async (skillId: string | undefined, options: { json?: boolean }) => {
      try {
        const service = new SkillService();
        const meta = await service.inspectSkill(skillId);

        if (options.json) {
          console.log(JSON.stringify(meta, null, 2));
          return;
        }

        console.log(`Skill Module Details: ${meta.skill_id} (v${meta.version})`);
        console.log(`  Description:  ${meta.description}`);
        console.log(`  Root Path:    ${meta.root_path}`);
        console.log(`  Entry Points: ${meta.entry_points.join(', ')}`);
        console.log(
          `  Dimensions:   ${meta.styles_count} styles | ${meta.platforms_count} platforms | ${meta.modalities_count} modalities`
        );
        console.log(`\n  Specialist Sub-Skills (${meta.sub_skills.length}):`);
        for (const sub of meta.sub_skills) {
          console.log(`    - [${sub.id}] (${sub.relativePath}): ${sub.description}`);
        }
        console.log(`\n  Schemas (${meta.schemas.length}):`);
        for (const sc of meta.schemas) {
          console.log(`    - ${sc}`);
        }
        console.log(`\n  Benchmark Scenarios (${meta.benchmark_scenarios.length}):`);
        for (const bs of meta.benchmark_scenarios) {
          console.log(`    - ${bs}`);
        }
      } catch (err: unknown) {
        console.error(`Error inspecting skill: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  // 3. almudaya skill styles
  skill
    .command('styles [styleId]')
    .description('List the 40 AVDS visual style profiles or inspect a specific style YAML')
    .option('-f, --family <family>', 'Filter by style family (minimalist, futuristic, premium, editorial, organic, corporate, playful, specialized)')
    .option('--style <styleId>', 'Inspect a specific visual style ID')
    .option('--json', 'Output as JSON')
    .action(
      async (
        posStyleId: string | undefined,
        options: { family?: string; style?: string; json?: boolean }
      ) => {
        try {
          const service = new SkillService();
          const targetStyle = posStyleId ?? options.style;

          if (targetStyle) {
            const profile = await service.getStyleProfile(targetStyle);
            if (options.json) {
              console.log(JSON.stringify(profile, null, 2));
              return;
            }
            console.log(
              `AVDS Visual Style Profile: ${profile.summary.name} [${profile.summary.id}] (${profile.summary.family})\n`
            );
            console.log(profile.rawYaml);
            return;
          }

          const styles = await service.listStyles(options.family);
          if (options.json) {
            console.log(JSON.stringify(styles, null, 2));
            return;
          }

          console.log(`AVDS Visual Style Profiles (${styles.length}):\n`);
          for (const st of styles) {
            console.log(`  - [${st.id}] ${st.name} (Family: ${st.family})`);
            if (st.philosophy) {
              console.log(`      ${st.philosophy}`);
            }
          }
        } catch (err: unknown) {
          console.error(`Error reading visual styles: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  // 4. almudaya skill platforms
  skill
    .command('platforms [platformId]')
    .description('List the 13 AVDS target platform profiles or inspect a specific platform profile')
    .option('-p, --platform <platformId>', 'Inspect a specific platform profile ID')
    .option('--json', 'Output as JSON')
    .action(
      async (
        posPlatformId: string | undefined,
        options: { platform?: string; json?: boolean }
      ) => {
        try {
          const service = new SkillService();
          const targetPlatform = posPlatformId ?? options.platform;

          if (targetPlatform) {
            const prof = await service.getPlatformProfile(targetPlatform);
            if (options.json) {
              console.log(JSON.stringify(prof, null, 2));
              return;
            }
            console.log(prof.markdown);
            return;
          }

          const platforms = await service.listPlatforms();
          if (options.json) {
            console.log(JSON.stringify(platforms, null, 2));
            return;
          }

          console.log(`AVDS Target Platform Profiles (${platforms.length}):\n`);
          for (const p of platforms) {
            console.log(`  - [${p.id}] ${p.title}`);
            if (p.characteristics) {
              console.log(`      Characteristics: ${p.characteristics}`);
            }
          }
        } catch (err: unknown) {
          console.error(`Error reading platform profiles: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  // 5. almudaya skill modalities
  skill
    .command('modalities [modalityId]')
    .description('List the 10 AVDS interaction modalities or inspect a specific modality guide')
    .option('-m, --modality <modalityId>', 'Inspect a specific modality ID')
    .option('--json', 'Output as JSON')
    .action(
      async (
        posModalityId: string | undefined,
        options: { modality?: string; json?: boolean }
      ) => {
        try {
          const service = new SkillService();
          const targetMod = posModalityId ?? options.modality;

          if (targetMod) {
            const guide = await service.getModalityGuide(targetMod);
            if (options.json) {
              console.log(JSON.stringify(guide, null, 2));
              return;
            }
            console.log(guide.markdown);
            return;
          }

          const modalities = await service.listModalities();
          if (options.json) {
            console.log(JSON.stringify(modalities, null, 2));
            return;
          }

          console.log(`AVDS Interaction Modalities (${modalities.length}):\n`);
          for (const m of modalities) {
            console.log(`  - [${m.id}] ${m.name}`);
            console.log(`      ${m.description}`);
          }
        } catch (err: unknown) {
          console.error(`Error reading interaction modalities: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  // 6. almudaya skill resource <pathOrAlias>
  skill
    .command('resource <pathOrAlias>')
    .description(
      'Read a workflow guide or resource file inside a skill package (e.g. orchestrator, composition, implementation, qa, contract, handoff, benchmark)'
    )
    .option('--skill <skillId>', 'Target skill ID', 'almudaya-visual-design')
    .option('--json', 'Output as JSON')
    .action(
      async (
        pathOrAlias: string,
        options: { skill?: string; json?: boolean }
      ) => {
        try {
          const service = new SkillService();
          const res = await service.readResource(pathOrAlias, options.skill);
          if (options.json) {
            console.log(JSON.stringify(res, null, 2));
            return;
          }
          console.log(`# Resource: ${res.resolvedRelativePath}\n`);
          console.log(res.content);
        } catch (err: unknown) {
          console.error(`Error reading skill resource: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  // 7. almudaya skill enable [skillId]
  skill
    .command('enable [skillId]')
    .description('Enable and configure a skill module for a session or a specific bot')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-b, --bot <botId>', 'Optional specific Bot ID (if omitted, enables for all bots in the session)')
    .option('--style <styleId>', 'Primary AVDS visual style ID (e.g. quantum-futurism, swiss-international)')
    .option('--secondary-styles <styles...>', 'Up to 2 secondary AVDS visual style influences')
    .option('--platform <platformId>', 'Target AVDS platform profile (e.g. web, android, windows-desktop)')
    .option('--modalities <modalities...>', 'Target AVDS interaction modalities (e.g. keyboard, mouse-pointer, touch)')
    .option(
      '--entry-point <entryPoint>',
      'AVDS orchestrator entry point (design | compose | implement | audit | full-cycle | change)'
    )
    .option('--notes <notes>', 'Additional design constraints or notes for the bot')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output as JSON')
    .action(
      async (
        posSkillId: string | undefined,
        options: {
          session: string;
          bot?: string;
          style?: string;
          secondaryStyles?: string[];
          platform?: string;
          modalities?: string[];
          entryPoint?: string;
          notes?: string;
          workspace?: string;
          json?: boolean;
        }
      ) => {
        try {
          const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
          const storage = new FilesystemSessionStorage(workspaceRoot);
          const pkuStore = new LocalFilesystemPKUStore(path.join(workspaceRoot, 'pku'));
          const service = new SkillService({ storage, pkuStore });

          const binding = await service.enableSkill(options.session, {
            skillId: posSkillId,
            botId: options.bot,
            config: {
              primary_style: options.style,
              secondary_styles: options.secondaryStyles,
              platform: options.platform,
              modalities: options.modalities,
              entry_point: options.entryPoint as SkillEntryPoint | undefined,
              notes: options.notes,
            },
          });

          if (options.json) {
            console.log(JSON.stringify(binding, null, 2));
            return;
          }

          console.log(`Skill enabled successfully!`);
          console.log(`  Binding ID: ${binding.binding_id}`);
          console.log(`  Session ID: ${binding.session_id}`);
          console.log(`  Skill ID:   ${binding.skill_id}`);
          console.log(`  Scope:      ${binding.bot_id ? `Bot ${binding.bot_id}` : 'All Bots in Session'}`);
          console.log(`  Status:     ${binding.status}`);
          if (binding.config.primary_style) {
            console.log(`  Style:      ${binding.config.primary_style}`);
          }
          if (binding.config.platform) {
            console.log(`  Platform:   ${binding.config.platform}`);
          }
          if (binding.config.modalities?.length) {
            console.log(`  Modalities: ${binding.config.modalities.join(', ')}`);
          }
          if (binding.config.entry_point) {
            console.log(`  EntryPoint: ${binding.config.entry_point}`);
          }
        } catch (err: unknown) {
          console.error(`Error enabling skill: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  // 8. almudaya skill disable [skillId]
  skill
    .command('disable [skillId]')
    .description('Disable a skill binding for a session or specific bot')
    .requiredOption('-s, --session <sessionId>', 'Target session ID')
    .option('-b, --bot <botId>', 'Optional specific Bot ID')
    .option('-w, --workspace <path>', 'Workspace directory path')
    .option('--json', 'Output as JSON')
    .action(
      async (
        posSkillId: string | undefined,
        options: {
          session: string;
          bot?: string;
          workspace?: string;
          json?: boolean;
        }
      ) => {
        try {
          const workspaceRoot = resolveWorkspaceRoot({ workspace: options.workspace });
          const storage = new FilesystemSessionStorage(workspaceRoot);
          const pkuStore = new LocalFilesystemPKUStore(path.join(workspaceRoot, 'pku'));
          const service = new SkillService({ storage, pkuStore });

          const binding = await service.disableSkill(
            options.session,
            posSkillId,
            options.bot
          );

          if (options.json) {
            console.log(JSON.stringify(binding, null, 2));
            return;
          }

          console.log(`Skill disabled successfully!`);
          console.log(`  Binding ID: ${binding.binding_id}`);
          console.log(`  Session ID: ${binding.session_id}`);
          console.log(`  Skill ID:   ${binding.skill_id}`);
          console.log(`  Scope:      ${binding.bot_id ? `Bot ${binding.bot_id}` : 'All Bots in Session'}`);
          console.log(`  Status:     ${binding.status}`);
        } catch (err: unknown) {
          console.error(`Error disabling skill: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );

  // 9. almudaya skill validate <filePath>
  skill
    .command('validate <filePath>')
    .description(
      'Validate an AVDS JSON artifact (Design-to-Code Contract, Composition Plan, or Handoff Envelope)'
    )
    .option(
      '-t, --type <type>',
      'Artifact type hint (design-contract | composition-plan | handoff-envelope)'
    )
    .option('--json', 'Output validation result as JSON')
    .action(
      async (
        filePath: string,
        options: {
          type?: 'design-contract' | 'composition-plan' | 'handoff-envelope';
          json?: boolean;
        }
      ) => {
        try {
          const service = new SkillService();
          const resolved = path.resolve(filePath);
          const raw = await fs.readFile(resolved, 'utf-8');
          const parsedJson = JSON.parse(raw) as unknown;

          const validation = service.validateContractData(parsedJson, options.type);

          if (options.json) {
            console.log(JSON.stringify(validation, null, 2));
            if (!validation.valid) process.exitCode = 1;
            return;
          }

          console.log(`AVDS Artifact Validation (${validation.artifactType}): ${validation.valid ? 'VALID ✅' : 'INVALID ❌'}`);
          if (validation.errors.length > 0) {
            console.log(`  Errors (${validation.errors.length}):`);
            for (const e of validation.errors) {
              console.log(`    - ${e}`);
            }
          }
          if (validation.warnings.length > 0) {
            console.log(`  Warnings (${validation.warnings.length}):`);
            for (const w of validation.warnings) {
              console.log(`    - ${w}`);
            }
          }

          if (!validation.valid) {
            process.exitCode = 1;
          }
        } catch (err: unknown) {
          console.error(`Error validating artifact: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    );
}
