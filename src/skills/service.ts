import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import { ValidationError } from '../core/errors.js';
import { atomicWriteJson, pathExists } from '../core/fs-utils.js';
import { withLock } from '../core/lock.js';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  deriveKnowledgeId,
  deriveProjectUniverseId,
  type IPKUStore,
} from '../memory_modules/index.js';
import {
  AVDSCompositionPlanSchema,
  AVDSDesignContractSchema,
  AVDSHandoffEnvelopeSchema,
  SessionSkillRegistryFileSchema,
  SkillBindingConfigSchema,
  type ModalitySummary,
  type PlatformSummary,
  type SessionSkillBinding,
  type SessionSkillRegistryFile,
  type SkillBindingConfig,
  type SkillContractValidationResult,
  type SkillEntryPoint,
  type SkillMetadata,
  type StyleSummary,
  type SubSkillDescriptor,
} from './schema.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILL_ROOT = path.resolve(MODULE_DIR, '..', '..', 'skill');

export interface SkillServiceOptions {
  skillRootDir?: string;
  storage?: IBlackboardStorage;
  pkuStore?: IPKUStore;
}

export interface EnableSkillInput {
  skillId?: string;
  botId?: string;
  config?: SkillBindingConfig;
  updatedBy?: string;
}

function parseFrontmatter(markdown: string): { name?: string; description?: string; body: string } {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { body: markdown };
  }
  const endIdx = normalized.indexOf('\n---\n', 4);
  if (endIdx === -1) {
    return { body: markdown };
  }
  const fmBlock = normalized.slice(4, endIdx);
  const body = normalized.slice(endIdx + 5);
  let name: string | undefined;
  let description: string | undefined;

  for (const line of fmBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key === 'name') name = val;
    if (key === 'description') description = val;
  }

  return { name, description, body };
}

function parseSimpleYamlFields(yamlText: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of yamlText.replace(/\r\n/g, '\n').split('\n')) {
    if (!rawLine || rawLine.startsWith(' ') || rawLine.startsWith('\t') || rawLine.startsWith('#')) {
      continue;
    }
    const colonIdx = rawLine.indexOf(':');
    if (colonIdx === -1) continue;
    const key = rawLine.slice(0, colonIdx).trim();
    const val = rawLine
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    result[key] = val;
  }
  return result;
}

export class SkillService {
  private static readonly skillMetadataCache = new Map<string, SkillMetadata>();
  private static readonly listSkillsCache = new Map<string, SkillMetadata[]>();
  public readonly skillRootDir: string;
  private readonly storage?: IBlackboardStorage;
  private readonly pkuStore?: IPKUStore;

  constructor(options: SkillServiceOptions = {}) {
    this.skillRootDir = options.skillRootDir ?? DEFAULT_SKILL_ROOT;
    this.storage = options.storage;
    this.pkuStore = options.pkuStore;
  }

  /**
   * Resolves a skill alias (e.g. "avds" -> "almudaya-visual-design").
   */
  public normalizeSkillId(skillId?: string): string {
    if (!skillId || !skillId.trim()) {
      return 'almudaya-visual-design';
    }
    const lower = skillId.trim().toLowerCase();
    if (lower === 'avds' || lower === 'visual-design' || lower === 'almudaya-visual-design-skills') {
      return 'almudaya-visual-design';
    }
    return lower;
  }

  /**
   * Locates the filesystem root directory of an installed skill package.
   */
  public async resolveSkillPackageDir(skillId?: string): Promise<string> {
    const canonicalId = this.normalizeSkillId(skillId);

    const candidates = [
      path.join(this.skillRootDir, canonicalId),
      path.join(
        this.skillRootDir,
        'interface',
        'almudaya-visual-design-skills-v1.0.1-benchmark-kit',
        'almudaya-visual-design-skills-v0.4.0'
      ),
    ];

    for (const candidate of candidates) {
      if (await pathExists(path.join(candidate, 'SKILL.md'))) {
        const raw = await fs.readFile(path.join(candidate, 'SKILL.md'), 'utf-8');
        const fm = parseFrontmatter(raw);
        if ((fm.name ?? path.basename(candidate)).toLowerCase() === canonicalId) {
          return candidate;
        }
      }
    }

    throw new ValidationError(`Skill package "${skillId ?? canonicalId}" not found in ${this.skillRootDir}.`);
  }

  /**
   * Lists all installed top-level skill packages in the repository.
   */
  public async listSkills(): Promise<SkillMetadata[]> {
    const cachedList = SkillService.listSkillsCache.get(this.skillRootDir);
    if (cachedList) {
      return cachedList;
    }

    if (!(await pathExists(this.skillRootDir))) {
      return [];
    }

    const discovered = new Map<string, SkillMetadata>();
    const candidateDirs = [
      path.join(this.skillRootDir, 'almudaya-visual-design'),
      path.join(
        this.skillRootDir,
        'interface',
        'almudaya-visual-design-skills-v1.0.1-benchmark-kit',
        'almudaya-visual-design-skills-v0.4.0'
      ),
    ];

    // Also check direct subdirectories of skillRootDir
    try {
      const entries = await fs.readdir(this.skillRootDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidateDirs.push(path.join(this.skillRootDir, entry.name));
        }
      }
    } catch {
      // Ignore directory read error
    }

    for (const dir of candidateDirs) {
      const skillFile = path.join(dir, 'SKILL.md');
      if (!(await pathExists(skillFile))) continue;

      const meta = await this.inspectSkillDir(dir);
      if (!discovered.has(meta.skill_id)) {
        discovered.set(meta.skill_id, meta);
      }
    }

    const result = Array.from(discovered.values());
    SkillService.listSkillsCache.set(this.skillRootDir, result);
    return result;
  }

  /**
   * Inspects a specific skill package and returns its full metadata, sub-skills, and asset counts.
   */
  public async inspectSkill(skillId?: string): Promise<SkillMetadata> {
    const dir = await this.resolveSkillPackageDir(skillId);
    return this.inspectSkillDir(dir);
  }

  private async inspectSkillDir(dir: string): Promise<SkillMetadata> {
    const normalizedDir = path.resolve(dir);
    const cached = SkillService.skillMetadataCache.get(normalizedDir);
    if (cached) {
      return cached;
    }

    const skillMdPath = path.join(dir, 'SKILL.md');
    const skillMdRaw = await fs.readFile(skillMdPath, 'utf-8');
    const fm = parseFrontmatter(skillMdRaw);
    const skillId = (fm.name ?? path.basename(dir)).toLowerCase();

    let version = '1.0.0';
    const versionPath = path.join(dir, 'VERSION');
    if (await pathExists(versionPath)) {
      version = (await fs.readFile(versionPath, 'utf-8')).trim() || '1.0.0';
    }

    const styles = await this.listStylesFromDir(dir);
    const platforms = await this.listPlatformsFromDir(dir);
    const modalities = await this.listModalitiesFromDir(dir);
    const subSkills = await this.discoverSubSkills(dir);
    const schemas = await this.discoverSchemas(dir);
    const benchmarkScenarios = await this.discoverBenchmarkScenarios(dir);

    const entryPoints: SkillEntryPoint[] = [
      'design',
      'compose',
      'implement',
      'audit',
      'full-cycle',
      'change',
    ];

    const meta: SkillMetadata = {
      skill_id: skillId,
      name: fm.name ?? skillId,
      description:
        fm.description ??
        'Cross-platform adaptive UI/UX design and implementation orchestrator.',
      version,
      root_path: dir,
      entry_points: entryPoints,
      sub_skills: subSkills,
      styles_count: styles.length,
      platforms_count: platforms.length,
      modalities_count: modalities.length,
      schemas,
      benchmark_scenarios: benchmarkScenarios,
    };
    SkillService.skillMetadataCache.set(normalizedDir, meta);
    return meta;
  }

  private async discoverSubSkills(dir: string): Promise<SubSkillDescriptor[]> {
    const subSkillRelPaths = [
      'core/SKILL.md',
      'unified-orchestrator/SKILL.md',
      'composition-engine/SKILL.md',
      'implementation-skills/platform-implementation/SKILL.md',
      'skills/design-token-synthesis/SKILL.md',
      'skills/frontend-implementation/SKILL.md',
      'skills/visual-quality-audit/SKILL.md',
      'quality-assurance/composition-audit/SKILL.md',
      'quality-assurance/cross-platform-audit/SKILL.md',
      'quality-assurance/cross-platform-qa/SKILL.md',
      'quality-assurance/platform-implementation-audit/SKILL.md',
    ];

    const results: SubSkillDescriptor[] = [];
    for (const rel of subSkillRelPaths) {
      const fullPath = path.join(dir, rel);
      if (!(await pathExists(fullPath))) continue;
      const content = await fs.readFile(fullPath, 'utf-8');
      const fm = parseFrontmatter(content);
      const id = path.basename(path.dirname(rel));
      const firstHeading = content
        .split(/\r?\n/)
        .find((l) => l.startsWith('# '))
        ?.replace(/^#\s+/, '')
        .trim();

      results.push({
        id,
        name: fm.name ?? firstHeading ?? id,
        description: fm.description ?? firstHeading ?? `AVDS sub-skill (${id})`,
        relativePath: rel,
      });
    }
    return results;
  }

  private async discoverSchemas(dir: string): Promise<string[]> {
    const schemaDirs = ['core/schemas', 'schemas', 'design-contract', 'agent-handoff', 'benchmark'];
    const found: string[] = [];
    for (const sub of schemaDirs) {
      const target = path.join(dir, sub);
      if (!(await pathExists(target))) continue;
      const entries = await fs.readdir(target, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.schema.json')) {
          found.push(`${sub}/${e.name}`);
        }
      }
    }
    return found.sort();
  }

  private async discoverBenchmarkScenarios(dir: string): Promise<string[]> {
    const scenDir = path.join(dir, 'benchmark', 'scenarios');
    if (!(await pathExists(scenDir))) return [];
    const entries = await fs.readdir(scenDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => `benchmark/scenarios/${e.name}`)
      .sort();
  }

  /**
   * Lists the 40 AVDS visual style profiles, optionally filtered by family.
   */
  public async listStyles(familyFilter?: string, skillId?: string): Promise<StyleSummary[]> {
    const dir = await this.resolveSkillPackageDir(skillId);
    return this.listStylesFromDir(dir, familyFilter);
  }

  private async listStylesFromDir(dir: string, familyFilter?: string): Promise<StyleSummary[]> {
    const stylesDir = path.join(dir, 'styles');
    if (!(await pathExists(stylesDir))) return [];

    const entries = await fs.readdir(stylesDir, { withFileTypes: true });
    const summaries: StyleSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profileRel = `styles/${entry.name}/profile.yaml`;
      const profileFull = path.join(dir, profileRel);
      if (!(await pathExists(profileFull))) continue;

      const raw = await fs.readFile(profileFull, 'utf-8');
      const fields = parseSimpleYamlFields(raw);
      const summary: StyleSummary = {
        id: fields['id'] || entry.name,
        name: fields['name'] || entry.name,
        family: fields['family'] || 'general',
        philosophy: fields['philosophy'],
        relativePath: profileRel,
      };

      if (
        !familyFilter ||
        summary.family.toLowerCase() === familyFilter.trim().toLowerCase()
      ) {
        summaries.push(summary);
      }
    }

    return summaries.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Reads a specific AVDS visual style profile YAML and metadata.
   */
  public async getStyleProfile(
    styleId: string,
    skillId?: string
  ): Promise<{ summary: StyleSummary; rawYaml: string }> {
    const dir = await this.resolveSkillPackageDir(skillId);
    const cleanId = styleId.trim().toLowerCase();
    const profileRel = `styles/${cleanId}/profile.yaml`;
    const profileFull = path.join(dir, profileRel);

    if (!(await pathExists(profileFull))) {
      throw new ValidationError(
        `Visual style profile "${styleId}" not found. Use listStyles() to see the 40 available styles.`
      );
    }

    const rawYaml = await fs.readFile(profileFull, 'utf-8');
    const fields = parseSimpleYamlFields(rawYaml);
    return {
      summary: {
        id: fields['id'] || cleanId,
        name: fields['name'] || cleanId,
        family: fields['family'] || 'general',
        philosophy: fields['philosophy'],
        relativePath: profileRel,
      },
      rawYaml,
    };
  }

  /**
   * Lists the 13 AVDS target platform profiles.
   */
  public async listPlatforms(skillId?: string): Promise<PlatformSummary[]> {
    const dir = await this.resolveSkillPackageDir(skillId);
    return this.listPlatformsFromDir(dir);
  }

  private async listPlatformsFromDir(dir: string): Promise<PlatformSummary[]> {
    const platDir = path.join(dir, 'platform-design');
    if (!(await pathExists(platDir))) return [];

    const entries = await fs.readdir(platDir, { withFileTypes: true });
    const summaries: PlatformSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relPath = `platform-design/${entry.name}/PROFILE.md`;
      const fullPath = path.join(dir, relPath);
      if (!(await pathExists(fullPath))) continue;

      const raw = await fs.readFile(fullPath, 'utf-8');
      const lines = raw.replace(/\r\n/g, '\n').split('\n');
      const titleLine = lines.find((l) => l.startsWith('# '))?.replace(/^#\s+/, '').trim();
      const charIdx = lines.findIndex((l) =>
        l.toLowerCase().startsWith('## native interaction characteristics')
      );
      const characteristics =
        charIdx !== -1 ? lines.slice(charIdx + 1, charIdx + 3).join(' ').trim() : undefined;

      summaries.push({
        id: entry.name,
        title: titleLine ?? entry.name,
        characteristics,
        relativePath: relPath,
      });
    }

    return summaries.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Reads the full markdown profile for a specific target platform.
   */
  public async getPlatformProfile(
    platformId: string,
    skillId?: string
  ): Promise<{ summary: PlatformSummary; markdown: string }> {
    const dir = await this.resolveSkillPackageDir(skillId);
    const cleanId = platformId.trim().toLowerCase();
    const relPath = `platform-design/${cleanId}/PROFILE.md`;
    const fullPath = path.join(dir, relPath);

    if (!(await pathExists(fullPath))) {
      throw new ValidationError(
        `Platform profile "${platformId}" not found. Use listPlatforms() to see the 13 available platforms.`
      );
    }

    const markdown = await fs.readFile(fullPath, 'utf-8');
    const platforms = await this.listPlatformsFromDir(dir);
    const summary = platforms.find((p) => p.id === cleanId) ?? {
      id: cleanId,
      title: cleanId,
      relativePath: relPath,
    };

    return { summary, markdown };
  }

  /**
   * Lists the 10 AVDS interaction modalities.
   */
  public async listModalities(skillId?: string): Promise<ModalitySummary[]> {
    const dir = await this.resolveSkillPackageDir(skillId);
    return this.listModalitiesFromDir(dir);
  }

  private async listModalitiesFromDir(dir: string): Promise<ModalitySummary[]> {
    const modDir = path.join(dir, 'interaction-design');
    if (!(await pathExists(modDir))) return [];

    const entries = await fs.readdir(modDir, { withFileTypes: true });
    const summaries: ModalitySummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relPath = `interaction-design/${entry.name}/SKILL.md`;
      const fullPath = path.join(dir, relPath);
      if (!(await pathExists(fullPath))) continue;

      const raw = await fs.readFile(fullPath, 'utf-8');
      const fm = parseFrontmatter(raw);
      summaries.push({
        id: entry.name,
        name: fm.name ?? entry.name,
        description: fm.description ?? `Interaction modality skill for ${entry.name}`,
        relativePath: relPath,
      });
    }

    return summaries.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Reads the full markdown guide for a specific interaction modality.
   */
  public async getModalityGuide(
    modalityId: string,
    skillId?: string
  ): Promise<{ summary: ModalitySummary; markdown: string }> {
    const dir = await this.resolveSkillPackageDir(skillId);
    const cleanId = modalityId.trim().toLowerCase();
    const relPath = `interaction-design/${cleanId}/SKILL.md`;
    const fullPath = path.join(dir, relPath);

    if (!(await pathExists(fullPath))) {
      throw new ValidationError(
        `Interaction modality "${modalityId}" not found. Use listModalities() to see the 10 available modalities.`
      );
    }

    const markdown = await fs.readFile(fullPath, 'utf-8');
    const modalities = await this.listModalitiesFromDir(dir);
    const summary = modalities.find((m) => m.id === cleanId) ?? {
      id: cleanId,
      name: cleanId,
      description: cleanId,
      relativePath: relPath,
    };

    return { summary, markdown };
  }

  /**
   * Safely reads a named workflow or relative resource file inside the skill directory.
   * Enforces strict path containment within the skill package directory.
   */
  public async readResource(relativePathOrAlias: string, skillId?: string): Promise<{
    resolvedRelativePath: string;
    content: string;
  }> {
    const dir = await this.resolveSkillPackageDir(skillId);

    const aliasMap: Record<string, string> = {
      root: 'SKILL.md',
      readme: 'README.md',
      core: 'core/SKILL.md',
      architecture: 'core/ARCHITECTURE.md',
      orchestrator: 'unified-orchestrator/SKILL.md',
      'full-cycle': 'unified-orchestrator/FULL_CYCLE_WORKFLOW.md',
      routing: 'unified-orchestrator/ROUTING_AND_HANDOFF.md',
      composition: 'composition-engine/SKILL.md',
      archetypes: 'composition-engine/ARCHETYPE_LIBRARY.md',
      'layout-grammar': 'composition-engine/LAYOUT_GRAMMAR.md',
      implementation: 'implementation-engineering/IMPLEMENTATION_WORKFLOW.md',
      'token-contract': 'implementation-engineering/SEMANTIC_TOKEN_CONTRACT.md',
      'component-mapping': 'implementation-engineering/COMPONENT_MAPPING.md',
      'capability-matrix': 'implementation-engineering/PLATFORM_CAPABILITY_MATRIX.md',
      'stack-guides': 'implementation-engineering/STACK_GUIDES.md',
      qa: 'quality-assurance/cross-platform-qa/SKILL.md',
      'qa-workflow': 'quality-assurance/cross-platform-qa/QA_WORKFLOW.md',
      'release-gate': 'quality-assurance/RELEASE_GATE.md',
      contract: 'design-contract/CONTRACT_RULES.md',
      handoff: 'agent-handoff/HANDOFF_PROTOCOL.md',
      governance: 'governance/DESIGN_CONSISTENCY_RULES.md',
      'change-impact': 'governance/CHANGE_IMPACT_WORKFLOW.md',
      benchmark: 'benchmark/BENCHMARK_PROTOCOL.md',
      rubric: 'benchmark/SCORING_RUBRIC.md',
    };

    const key = relativePathOrAlias.trim().toLowerCase();
    const relTarget = aliasMap[key] ?? relativePathOrAlias.trim().replace(/\\/g, '/');

    const resolvedFull = path.resolve(dir, relTarget);
    const normalizedDir = path.resolve(dir);

    if (
      resolvedFull !== normalizedDir &&
      !resolvedFull.startsWith(normalizedDir + path.sep)
    ) {
      throw new ValidationError(
        `Access denied: Resource path "${relativePathOrAlias}" escapes skill root directory.`
      );
    }

    if (!(await pathExists(resolvedFull))) {
      throw new ValidationError(`Skill resource "${relTarget}" does not exist.`);
    }

    const content = await fs.readFile(resolvedFull, 'utf-8');
    return {
      resolvedRelativePath: path.relative(normalizedDir, resolvedFull).replace(/\\/g, '/'),
      content,
    };
  }

  /**
   * Validates an AVDS Design-to-Code Contract, Composition Plan, or Handoff Envelope against schema and invariants.
   */
  public validateContractData(
    payload: unknown,
    typeHint?: 'design-contract' | 'composition-plan' | 'handoff-envelope'
  ): SkillContractValidationResult {
    const obj = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const inferredType: 'design-contract' | 'composition-plan' | 'handoff-envelope' =
      typeHint ??
      ('contract_id' in obj
        ? 'design-contract'
        : 'plan_id' in obj
          ? 'composition-plan'
          : 'handoff-envelope');

    const errors: string[] = [];
    const warnings: string[] = [];

    if (inferredType === 'design-contract') {
      const parsed = AVDSDesignContractSchema.safeParse(payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push(`${issue.path.join('.') || 'root'}: ${issue.message}`);
        }
      } else {
        const data = parsed.data;
        const artifactIds = new Set<string>();
        for (const art of data.artifacts) {
          if (artifactIds.has(art.artifact_id)) {
            errors.push(`Duplicate artifact_id "${art.artifact_id}" violates Invariant 1.`);
          }
          artifactIds.add(art.artifact_id);
        }
        for (const art of data.artifacts) {
          for (const depId of art.depends_on ?? []) {
            if (!artifactIds.has(depId)) {
              errors.push(
                `Artifact "${art.artifact_id}" depends on unknown artifact_id "${depId}" (Invariant 2).`
              );
            }
          }
        }
        if (data.open_assumptions && data.open_assumptions.length > 0 && data.status === 'verified') {
          warnings.push(
            `Contract status is "verified" while ${data.open_assumptions.length} open_assumptions remain.`
          );
        }
      }
    } else if (inferredType === 'composition-plan') {
      const parsed = AVDSCompositionPlanSchema.safeParse(payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push(`${issue.path.join('.') || 'root'}: ${issue.message}`);
        }
      } else {
        const data = parsed.data;
        const regionIds = new Set<string>();
        for (const r of data.regions) {
          if (regionIds.has(r.id)) {
            errors.push(`Duplicate region id "${r.id}" in composition plan.`);
          }
          regionIds.add(r.id);
        }
        if (data.visual_identity?.influences && data.visual_identity.influences.length > 2) {
          warnings.push(
            `AVDS recommends at most 2 secondary visual style influences (found ${data.visual_identity.influences.length}).`
          );
        }
      }
    } else {
      const parsed = AVDSHandoffEnvelopeSchema.safeParse(payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push(`${issue.path.join('.') || 'root'}: ${issue.message}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      artifactType: inferredType,
      errors,
      warnings,
    };
  }

  // ============================================================================
  // SESSION & BOT SKILL BINDING MANAGEMENT + PKU PERSISTENT MEMORY SYNC
  // ============================================================================

  private getSessionSkillsFilePath(sessionId: string): string {
    if (!this.storage) {
      throw new ValidationError('Blackboard storage is required for session skill management.');
    }
    return path.join(this.storage.getSessionDir(sessionId), 'skills.json');
  }

  private getSessionSkillsLockDir(sessionId: string): string {
    if (!this.storage) {
      throw new ValidationError('Blackboard storage is required for session skill management.');
    }
    return path.join(this.storage.getSessionDir(sessionId), 'locks', 'skills');
  }

  /**
   * Enables and configures a skill for a whole session or a specific bot in the session.
   * Also records a deterministic KnowledgeObject in PKU if a PKU store is attached.
   */
  public async enableSkill(
    sessionId: string,
    input: EnableSkillInput = {}
  ): Promise<SessionSkillBinding> {
    if (!this.storage) {
      throw new ValidationError('Blackboard storage is required to enable skills in a session.');
    }
    if (!(await this.storage.sessionExists(sessionId))) {
      throw new ValidationError(`Session "${sessionId}" does not exist.`);
    }

    const canonicalSkillId = this.normalizeSkillId(input.skillId);
    // Verify the skill exists on disk
    await this.resolveSkillPackageDir(canonicalSkillId);

    const validatedConfig = SkillBindingConfigSchema.parse(input.config ?? {});
    if (validatedConfig.primary_style) {
      await this.getStyleProfile(validatedConfig.primary_style, canonicalSkillId);
    }
    if (validatedConfig.platform) {
      await this.getPlatformProfile(validatedConfig.platform, canonicalSkillId);
    }
    if (validatedConfig.modalities) {
      for (const mod of validatedConfig.modalities) {
        await this.getModalityGuide(mod, canonicalSkillId);
      }
    }

    const targetBotId = input.botId?.trim() ? input.botId.trim() : undefined;
    const bindingId = targetBotId
      ? `skill_${canonicalSkillId}_${targetBotId}`
      : `skill_${canonicalSkillId}_session`;
    const nowIso = new Date().toISOString();

    const binding: SessionSkillBinding = {
      binding_id: bindingId,
      session_id: sessionId,
      skill_id: canonicalSkillId,
      bot_id: targetBotId,
      status: 'enabled',
      config: validatedConfig,
      updated_at: nowIso,
      updated_by: input.updatedBy ?? 'OPERATOR',
    };

    const filePath = this.getSessionSkillsFilePath(sessionId);
    const lockDir = this.getSessionSkillsLockDir(sessionId);

    await withLock(lockDir, async () => {
      const existing = await this.readRegistryUnlocked(sessionId, filePath);
      const idx = existing.bindings.findIndex((b) => b.binding_id === bindingId);
      if (idx !== -1) {
        existing.bindings[idx] = binding;
      } else {
        existing.bindings.push(binding);
      }
      existing.updated_at = nowIso;
      await atomicWriteJson(filePath, existing);
    });

    await this.syncBindingToPKU(binding);
    return binding;
  }

  /**
   * Disables a skill binding for a session or specific bot.
   */
  public async disableSkill(
    sessionId: string,
    skillId?: string,
    botId?: string,
    updatedBy = 'OPERATOR'
  ): Promise<SessionSkillBinding> {
    if (!this.storage) {
      throw new ValidationError('Blackboard storage is required to disable skills in a session.');
    }
    if (!(await this.storage.sessionExists(sessionId))) {
      throw new ValidationError(`Session "${sessionId}" does not exist.`);
    }

    const canonicalSkillId = this.normalizeSkillId(skillId);
    const targetBotId = botId?.trim() ? botId.trim() : undefined;
    const bindingId = targetBotId
      ? `skill_${canonicalSkillId}_${targetBotId}`
      : `skill_${canonicalSkillId}_session`;
    const nowIso = new Date().toISOString();

    const filePath = this.getSessionSkillsFilePath(sessionId);
    const lockDir = this.getSessionSkillsLockDir(sessionId);

    let updatedBinding: SessionSkillBinding | undefined;

    await withLock(lockDir, async () => {
      const existing = await this.readRegistryUnlocked(sessionId, filePath);
      const idx = existing.bindings.findIndex((b) => b.binding_id === bindingId);
      if (idx !== -1) {
        existing.bindings[idx] = {
          ...existing.bindings[idx]!,
          status: 'disabled',
          updated_at: nowIso,
          updated_by: updatedBy,
        };
        updatedBinding = existing.bindings[idx];
      } else {
        updatedBinding = {
          binding_id: bindingId,
          session_id: sessionId,
          skill_id: canonicalSkillId,
          bot_id: targetBotId,
          status: 'disabled',
          config: {},
          updated_at: nowIso,
          updated_by: updatedBy,
        };
        existing.bindings.push(updatedBinding);
      }
      existing.updated_at = nowIso;
      await atomicWriteJson(filePath, existing);
    });

    if (updatedBinding) {
      await this.syncBindingToPKU(updatedBinding);
    }

    return updatedBinding!;
  }

  /**
   * Lists skill bindings in a session. If botId is provided, returns both session-wide bindings and bot-specific bindings.
   */
  public async getSessionSkills(
    sessionId: string,
    botId?: string,
    onlyEnabled = false
  ): Promise<SessionSkillBinding[]> {
    if (!this.storage) return [];
    const filePath = this.getSessionSkillsFilePath(sessionId);
    const reg = await this.readRegistryUnlocked(sessionId, filePath);

    return reg.bindings.filter((b) => {
      if (onlyEnabled && b.status !== 'enabled') return false;
      if (botId) {
        return !b.bot_id || b.bot_id === botId;
      }
      return true;
    });
  }

  private async readRegistryUnlocked(
    sessionId: string,
    filePath: string
  ): Promise<SessionSkillRegistryFile> {
    if (!(await pathExists(filePath))) {
      return {
        session_id: sessionId,
        updated_at: new Date().toISOString(),
        bindings: [],
      };
    }
    const rawText = await fs.readFile(filePath, 'utf-8');
    const raw = JSON.parse(rawText) as unknown;
    const parsed = SessionSkillRegistryFileSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        session_id: sessionId,
        updated_at: new Date().toISOString(),
        bindings: [],
      };
    }
    return parsed.data;
  }

  private async syncBindingToPKU(binding: SessionSkillBinding): Promise<void> {
    if (!this.pkuStore) return;
    try {
      const pmuId = deriveProjectUniverseId(`session_${binding.session_id.toLowerCase()}`);
      const existingPmu = await this.pkuStore.getUniverse(pmuId);
      if (!existingPmu) {
        await this.pkuStore.createUniverse({
          id: pmuId,
          projectKey: `session_${binding.session_id.toLowerCase()}`,
          displayName: `Session ${binding.session_id} Universe`,
          rootNodeId: 'pku_tree_root',
          status: 'active',
          reusable: true,
          schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
          createdAt: binding.updated_at,
          updatedAt: binding.updated_at,
          metadata: { sessionId: binding.session_id },
        });
      }

      const koId = deriveKnowledgeId({
        sourceSystem: 'almudaya_skill_service',
        projectUniverseId: pmuId,
        sourceType: 'skill.binding',
        sourceRecordId: binding.binding_id,
      });

      await this.pkuStore.putKnowledge(
        {
          id: koId,
          projectUniverseId: pmuId,
          type: 'skill.binding',
          scope: binding.bot_id ? 'agent' : 'session',
          ownerId: binding.bot_id,
          title: `Skill Binding: ${binding.skill_id} (${binding.bot_id ?? 'All Bots'})`,
          summary: `Skill ${binding.skill_id} is ${binding.status} for ${binding.bot_id ?? 'session'} (style: ${binding.config.primary_style ?? 'auto'}, platform: ${binding.config.platform ?? 'auto'})`,
          content: binding as unknown as Record<string, unknown>,
          provenance: {
            sourceSystem: 'almudaya_skill_service',
            sourceType: 'skill.binding',
            sourceId: binding.binding_id,
            createdBy: binding.bot_id ?? binding.updated_by,
            createdAt: binding.updated_at,
            ingestedAt: binding.updated_at,
          },
          relationIds: [],
          validationStatus: 'validated',
          lifecycleStatus: binding.status === 'enabled' ? 'active' : 'dormant',
          schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
          version: 1,
          createdAt: binding.updated_at,
          updatedAt: binding.updated_at,
        },
        `idem_${binding.binding_id}_${binding.updated_at}`
      );
    } catch {
      // Never block operational execution if PKU sync fails (PKU-004)
    }
  }

  /**
   * Builds a concise, token-efficient system prompt section describing available skills
   * and any active AVDS skill configuration for the bot.
   */
  public async buildBotSkillPromptSection(sessionId: string, botId: string): Promise<string> {
    try {
      const installed = await this.listSkills();
      if (installed.length === 0) return '';

      const activeBindings = await this.getSessionSkills(sessionId, botId, true);
      const lines: string[] = [
        '\n## Kapabilitas Modul Skill & Desain Adaptif (AVDS v1.0.1):',
        'Anda memiliki akses ke perkakas `use_skill` untuk membaca panduan arsitektur UI/UX lintas-platform Almudaya Visual Design Skills (AVDS):',
      ];

      for (const s of installed) {
        lines.push(
          `- Skill Terpasang: \`${s.skill_id}\` (v${s.version}) — ${s.styles_count} profil gaya visual, ${s.platforms_count} profil platform, ${s.modalities_count} modalitas interaksi.`
        );
      }

      if (activeBindings.length > 0) {
        lines.push('\n### Konfigurasi Skill Aktif untuk Bot Anda:');
        for (const b of activeBindings) {
          const scopeLabel = b.bot_id ? `Khusus Bot ${b.bot_id}` : 'Seluruh Sesi';
          const parts: string[] = [`Skill: \`${b.skill_id}\` (${scopeLabel})`];
          if (b.config.entry_point) parts.push(`Entry Point: ${b.config.entry_point}`);
          if (b.config.primary_style) parts.push(`Primary Style: ${b.config.primary_style}`);
          if (b.config.secondary_styles?.length) {
            parts.push(`Secondary Influences: ${b.config.secondary_styles.join(', ')}`);
          }
          if (b.config.platform) parts.push(`Target Platform: ${b.config.platform}`);
          if (b.config.modalities?.length) {
            parts.push(`Modalities: ${b.config.modalities.join(', ')}`);
          }
          if (b.config.notes) parts.push(`Catatan: ${b.config.notes}`);
          lines.push(`- ${parts.join(' | ')}`);
        }
        lines.push(
          'Saat mengerjakan antarmuka pengguna (UI/UX) atau arsitektur frontend/mobile/desktop, panggil tool `use_skill` untuk memuat profil gaya, profil platform, dan kontrak komposisi yang sesuai.'
        );
      } else {
        lines.push(
          '- Anda dapat memanggil tool `use_skill` kapan saja jika tugas melibatkan pembuatan, perancangan, atau audit UI/UX lintas platform.'
        );
      }

      return lines.join('\n');
    } catch {
      return '';
    }
  }
}
