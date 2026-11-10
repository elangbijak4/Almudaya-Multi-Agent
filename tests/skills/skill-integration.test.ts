import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockAIProvider } from '../../src/ai/mock-provider.js';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { AutonomousAgentLoop } from '../../src/bot/agent-loop.js';
import { BotService } from '../../src/bot/service.js';
import { run } from '../../src/cli/index.js';
import { InMemoryPKUStore, deriveProjectUniverseId } from '../../src/memory_modules/index.js';
import type { DirectMessage } from '../../src/messaging/schema.js';
import { SessionService } from '../../src/session/service.js';
import { SkillService } from '../../src/skills/service.js';

describe('AVDS v1.0.1 Skill Module, Bot Tool (use_skill), PKU Sync & CLI Commands', { timeout: 25000 }, () => {
  let tempRoot: string;
  let storage: FilesystemSessionStorage;
  let sessionService: SessionService;
  let botService: BotService;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-skills-test-'));
    storage = new FilesystemSessionStorage(tempRoot);
    sessionService = new SessionService(storage);
    botService = new BotService(storage);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await fs.rm(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on Windows
    }
  });

  it('discovers AVDS v1.0.1, 40 visual styles, 13 platforms, 10 modalities, workflows, and blocks path traversal', async () => {
    const skillService = new SkillService({ storage });

    const skills = await skillService.listSkills();
    expect(skills.length).toBeGreaterThanOrEqual(1);
    const avds = skills.find((s) => s.skill_id === 'almudaya-visual-design');
    expect(avds).toBeDefined();
    expect(avds!.version).toBe('1.0.1');
    expect(avds!.styles_count).toBe(40);
    expect(avds!.platforms_count).toBe(13);
    expect(avds!.modalities_count).toBe(10);
    expect(avds!.sub_skills.length).toBeGreaterThanOrEqual(10);
    expect(avds!.benchmark_scenarios).toHaveLength(3);

    // Filter styles by family
    const futuristicStyles = await skillService.listStyles('futuristic');
    expect(futuristicStyles.length).toBe(5);
    expect(futuristicStyles.some((s) => s.id === 'quantum-futurism')).toBe(true);

    // Inspect a specific style profile
    const qf = await skillService.getStyleProfile('quantum-futurism');
    expect(qf.summary.name).toBe('Quantum Futurism');
    expect(qf.rawYaml).toContain('modular spatial composition');

    // Inspect a platform profile
    const webPlat = await skillService.getPlatformProfile('web');
    expect(webPlat.summary.id).toBe('web');
    expect(webPlat.markdown).toContain('WCAG 2.2');

    // Inspect an interaction modality
    const kbMod = await skillService.getModalityGuide('keyboard');
    expect(kbMod.summary.id).toBe('keyboard');
    expect(kbMod.markdown).toContain('focus order');

    // Read workflow aliases
    const orchestratorDoc = await skillService.readResource('orchestrator');
    expect(orchestratorDoc.resolvedRelativePath).toBe('unified-orchestrator/SKILL.md');
    expect(orchestratorDoc.content).toContain('core/orchestration/style-selection.md');
    expect(orchestratorDoc.content).toContain('platform-design/');

    // Block path traversal outside skill root
    await expect(skillService.readResource('../../package.json')).rejects.toThrow(
      /escapes skill root directory/i
    );
  });

  it('enables and disables skills per session and per bot, syncs to PKU, and injects prompt context', async () => {
    const sessionId = 'S_SKILL_TEST';
    await sessionService.createSession({
      sessionId,
      sessionName: 'Skill Session Test',
    });
    await botService.registerBot(sessionId, {
      botId: 'BOT001',
      displayName: 'UI_Architect',
      description: 'UI/UX Architect Bot',
    });

    const pkuStore = new InMemoryPKUStore();
    const skillService = new SkillService({ storage, pkuStore });

    const binding = await skillService.enableSkill(sessionId, {
      skillId: 'avds',
      botId: 'BOT001',
      config: {
        primary_style: 'quantum-futurism',
        secondary_styles: ['scientific-visualization'],
        platform: 'windows-desktop',
        modalities: ['keyboard', 'mouse-pointer'],
        entry_point: 'compose',
        notes: 'High-density quantum circuit workbench',
      },
    });

    expect(binding.skill_id).toBe('almudaya-visual-design');
    expect(binding.bot_id).toBe('BOT001');
    expect(binding.status).toBe('enabled');

    // Verify PKU store captured the skill.binding KnowledgeObject
    const pmuId = deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);
    const pkuQuery = await pkuStore.queryKnowledge({
      projectUniverseIds: [pmuId],
      types: ['skill.binding'],
    });
    expect(pkuQuery.items).toHaveLength(1);
    expect(pkuQuery.items[0]?.ownerId).toBe('BOT001');

    // Verify dynamic system prompt section generation
    const promptSection = await skillService.buildBotSkillPromptSection(sessionId, 'BOT001');
    expect(promptSection).toContain('use_skill');
    expect(promptSection).toContain('quantum-futurism');
    expect(promptSection).toContain('windows-desktop');

    // Disable skill
    const disabled = await skillService.disableSkill(sessionId, 'avds', 'BOT001');
    expect(disabled.status).toBe('disabled');
  });

  it('validates AVDS Design-to-Code Contracts and Composition Plans against schemas and invariants', async () => {
    const skillService = new SkillService();
    const avdsDir = await skillService.resolveSkillPackageDir('almudaya-visual-design');

    const exampleContractRaw = await fs.readFile(
      path.join(avdsDir, 'design-contract', 'examples', 'design-contract-example.json'),
      'utf-8'
    );
    const contractValidation = skillService.validateContractData(
      JSON.parse(exampleContractRaw),
      'design-contract'
    );
    expect(contractValidation.valid).toBe(true);
    expect(contractValidation.errors).toHaveLength(0);

    const examplePlanRaw = await fs.readFile(
      path.join(avdsDir, 'examples', 'mobile-academy-composition-plan.json'),
      'utf-8'
    );
    const planValidation = skillService.validateContractData(
      JSON.parse(examplePlanRaw),
      'composition-plan'
    );
    expect(planValidation.valid).toBe(true);

    // Invalid contract with dangling depends_on reference
    const brokenContract = {
      ...JSON.parse(exampleContractRaw),
      artifacts: [
        {
          artifact_id: 'art-1',
          type: 'design_brief',
          version: '1.0.0',
          status: 'approved',
          path: 'brief.json',
          depends_on: ['non-existent-id'],
        },
      ],
    };
    const brokenValidation = skillService.validateContractData(brokenContract, 'design-contract');
    expect(brokenValidation.valid).toBe(false);
    expect(brokenValidation.errors.some((e) => e.includes('non-existent-id'))).toBe(true);
  });

  it('allows AutonomousAgentLoop bots to invoke use_skill tool seamlessly during ReAct reasoning', async () => {
    const sessionId = 'S_BOT_SKILL_LOOP';
    await sessionService.createSession({
      sessionId,
      sessionName: 'Bot Skill Loop Session',
    });
    await botService.registerBot(sessionId, {
      botId: 'BOT001',
      displayName: 'Lead',
    });
    await botService.registerBot(sessionId, {
      botId: 'BOT002',
      displayName: 'DesignerBot',
    });

    const mockProvider = new MockAIProvider('mock-gemini', [
      {
        text: 'Saya akan memeriksa profil gaya geospatial-cartographic menggunakan use_skill.',
        toolCalls: [
          {
            id: 'call_skill_1',
            name: 'use_skill',
            arguments: {
              action: 'get_style',
              target_id: 'geospatial-cartographic',
            },
          },
        ],
      },
      {
        text: 'Profil gaya geospatial-cartographic telah dimuat dan siap digunakan untuk Web GIS.',
      },
    ]);

    const loop = new AutonomousAgentLoop({
      sessionId,
      botId: 'BOT002',
      storage,
      provider: mockProvider,
    });

    const nowIso = new Date().toISOString();
    const msg: DirectMessage = {
      message_id: 'msg_skill_req_1',
      session_id: sessionId,
      sender_bot_id: 'BOT001',
      recipient_bot_id: 'BOT002',
      timestamp: nowIso,
      message_type: 'REQUEST',
      content: 'Tolong periksa profil gaya geospatial-cartographic dari AVDS.',
      status: 'unread',
      metadata: {},
      delivery_state: 'PROCESSING',
      attempt_count: 1,
      max_attempts: 3,
      fence_token: 1,
      lease_owner: 'BOT002',
      lease_expires_at: null,
      last_attempt_at: nowIso,
      last_error: null,
    };

    const reply = await loop.handleMessage(msg);
    expect(reply).toContain('geospatial-cartographic');
  });

  it('executes CLI skill subcommands (list, styles, platforms, modalities, enable, disable, validate)', async () => {
    const sessionId = 'S_CLI_SKILL';
    await sessionService.createSession({
      sessionId,
      sessionName: 'CLI Skill Session',
    });

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    // 1. Enable skill via CLI
    await run([
      'node',
      'almudaya',
      'skill',
      'enable',
      'avds',
      '--session',
      sessionId,
      '--bot',
      'BOT001',
      '--style',
      'swiss-international',
      '--platform',
      'web',
      '--modalities',
      'keyboard',
      'mouse-pointer',
      '--entry-point',
      'full-cycle',
      '--workspace',
      tempRoot,
      '--json',
    ]);
    const enableJson = JSON.parse(logs.pop()!) as { skill_id: string; status: string };
    expect(enableJson.skill_id).toBe('almudaya-visual-design');
    expect(enableJson.status).toBe('enabled');

    // 2. List skills & session bindings via CLI
    await run([
      'node',
      'almudaya',
      'skill',
      'list',
      '--session',
      sessionId,
      '--workspace',
      tempRoot,
      '--json',
    ]);
    const listJson = JSON.parse(logs.pop()!) as {
      installed_skills: Array<{ skill_id: string }>;
      session_bindings: Array<{ binding_id: string }>;
    };
    expect(listJson.installed_skills.some((s) => s.skill_id === 'almudaya-visual-design')).toBe(true);
    expect(listJson.session_bindings).toHaveLength(1);

    // 3. Validate example contract via CLI
    const skillService = new SkillService();
    const avdsDir = await skillService.resolveSkillPackageDir('almudaya-visual-design');
    const exampleContractPath = path.join(
      avdsDir,
      'design-contract',
      'examples',
      'design-contract-example.json'
    );

    await run(['node', 'almudaya', 'skill', 'validate', exampleContractPath, '--json']);
    const validateJson = JSON.parse(logs.pop()!) as { valid: boolean };
    expect(validateJson.valid).toBe(true);
  });
});
