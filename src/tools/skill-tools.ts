import type { ToolDefinition } from '../ai/provider.js';
import type { IBlackboardStorage } from '../blackboard/interface.js';
import { SkillService } from '../skills/service.js';

export const USE_SKILL_TOOL: ToolDefinition = {
  name: 'use_skill',
  description:
    'Mengakses modul Almudaya Visual Design Skills (AVDS v1.0.1) untuk melihat daftar skill, 40 profil gaya visual, 13 profil platform, 10 modalitas interaksi, panduan workflow (orchestrator, composition, implementation, qa, contract, handoff, benchmark), atau memvalidasi kontrak desain.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          'Aksi yang dijalankan: "list_skills" | "inspect_skill" | "list_styles" | "get_style" | "list_platforms" | "get_platform" | "list_modalities" | "get_modality" | "get_workflow" | "read_resource" | "validate_contract"',
      },
      skill_id: {
        type: 'string',
        description: 'ID skill target (default: "almudaya-visual-design").',
      },
      target_id: {
        type: 'string',
        description:
          'ID style (misal "quantum-futurism", "swiss-international"), platform (misal "web", "android", "windows-desktop"), modality (misal "touch", "keyboard"), atau workflow alias ("orchestrator", "composition", "implementation", "qa", "contract", "handoff", "benchmark").',
      },
      family: {
        type: 'string',
        description:
          'Filter keluarga gaya visual untuk action "list_styles" (minimalist, futuristic, premium, editorial, organic, corporate, playful, specialized).',
      },
      resource_path: {
        type: 'string',
        description:
          'Path relatif berkas di dalam paket skill untuk action "read_resource" (misal "composition-engine/ARCHETYPE_LIBRARY.md").',
      },
      contract_data: {
        type: 'object',
        description: 'Objek JSON kontrak untuk divalidasi pada action "validate_contract".',
      },
    },
    required: ['action'],
  },
};

export async function executeUseSkill(
  storage: IBlackboardStorage,
  sessionId: string,
  botId: string,
  args: Record<string, unknown>,
  skillRootDir?: string
): Promise<unknown> {
  const service = new SkillService({ storage, skillRootDir });
  const action = String(args['action'] ?? 'list_skills').trim().toLowerCase();
  const skillId = typeof args['skill_id'] === 'string' ? args['skill_id'] : undefined;
  const targetId = typeof args['target_id'] === 'string' ? args['target_id'].trim() : '';
  const family = typeof args['family'] === 'string' ? args['family'].trim() : undefined;
  const resourcePath =
    typeof args['resource_path'] === 'string' ? args['resource_path'].trim() : '';

  switch (action) {
    case 'list_skills': {
      const installed = await service.listSkills();
      const activeBindings = await service.getSessionSkills(sessionId, botId, true);
      return {
        installed_skills: installed,
        active_bindings: activeBindings,
      };
    }

    case 'inspect_skill': {
      const metadata = await service.inspectSkill(skillId);
      const activeBindings = await service.getSessionSkills(sessionId, botId, true);
      return {
        skill: metadata,
        active_bindings: activeBindings,
      };
    }

    case 'list_styles': {
      const styles = await service.listStyles(family, skillId);
      return {
        total: styles.length,
        family_filter: family ?? null,
        styles,
      };
    }

    case 'get_style': {
      if (!targetId) {
        throw new Error('Parameter "target_id" wajib diisi untuk action "get_style" (misal "quantum-futurism").');
      }
      return await service.getStyleProfile(targetId, skillId);
    }

    case 'list_platforms': {
      const platforms = await service.listPlatforms(skillId);
      return {
        total: platforms.length,
        platforms,
      };
    }

    case 'get_platform': {
      if (!targetId) {
        throw new Error('Parameter "target_id" wajib diisi untuk action "get_platform" (misal "web" atau "android").');
      }
      return await service.getPlatformProfile(targetId, skillId);
    }

    case 'list_modalities': {
      const modalities = await service.listModalities(skillId);
      return {
        total: modalities.length,
        modalities,
      };
    }

    case 'get_modality': {
      if (!targetId) {
        throw new Error('Parameter "target_id" wajib diisi untuk action "get_modality" (misal "touch" atau "keyboard").');
      }
      return await service.getModalityGuide(targetId, skillId);
    }

    case 'get_workflow': {
      const wfKey = targetId || 'orchestrator';
      return await service.readResource(wfKey, skillId);
    }

    case 'read_resource': {
      const pathOrTarget = resourcePath || targetId;
      if (!pathOrTarget) {
        throw new Error('Parameter "resource_path" atau "target_id" wajib diisi untuk action "read_resource".');
      }
      return await service.readResource(pathOrTarget, skillId);
    }

    case 'validate_contract': {
      const contractData = args['contract_data'];
      if (!contractData || typeof contractData !== 'object') {
        throw new Error('Parameter "contract_data" (object) wajib diisi untuk action "validate_contract".');
      }
      return service.validateContractData(contractData);
    }

    default:
      throw new Error(
        `Action "${action}" tidak dikenal pada tool use_skill. Pilihan valid: list_skills, inspect_skill, list_styles, get_style, list_platforms, get_platform, list_modalities, get_modality, get_workflow, read_resource, validate_contract.`
      );
  }
}
