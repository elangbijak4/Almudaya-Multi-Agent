import {
  DynamicRuleSchema,
  generateProtocolId,
  type DynamicRule,
} from './schema.js';
import { ProtocolStore } from './store.js';

export interface AddDynamicRuleInput {
  statement: string;
  severity?: 'ADVISORY' | 'MANDATORY' | 'HARD_STOP';
  scope?: 'ALL_BOTS' | 'SPECIFIC_BOT' | 'TASK';
  targetId?: string;
  createdBy?: string;
}

/**
 * Manages runtime-authored Dynamic Rules stored in `protocol/dynamic_rules.json`
 * and formats active rules for direct prompt injection.
 */
export class DynamicRulesService {
  private readonly store: ProtocolStore;

  constructor(store: ProtocolStore) {
    this.store = store;
  }

  public async addRule(sessionId: string, input: AddDynamicRuleInput): Promise<DynamicRule> {
    const now = new Date().toISOString();
    const rule = DynamicRuleSchema.parse({
      ruleId: generateProtocolId('RULE'),
      createdBy: input.createdBy ?? 'MASTER',
      severity: input.severity ?? 'MANDATORY',
      scope: input.scope ?? 'ALL_BOTS',
      targetId: input.targetId,
      statement: input.statement.trim(),
      active: true,
      createdAt: now,
    });

    await this.store.updateDynamicRulesStore(sessionId, (current) => ({
      ...current,
      rules: [...current.rules, rule],
      updatedAt: now,
    }));

    return rule;
  }

  public async deactivateRule(sessionId: string, ruleId: string): Promise<boolean> {
    let found = false;
    const now = new Date().toISOString();

    await this.store.updateDynamicRulesStore(sessionId, (current) => ({
      ...current,
      rules: current.rules.map((rule) => {
        if (rule.ruleId !== ruleId) {
          return rule;
        }
        found = true;
        return { ...rule, active: false };
      }),
      updatedAt: now,
    }));

    return found;
  }

  public async listRules(
    sessionId: string,
    options?: { activeOnly?: boolean; botId?: string; taskId?: string }
  ): Promise<DynamicRule[]> {
    const store = await this.store.getDynamicRulesStore(sessionId);
    const activeOnly = options?.activeOnly ?? true;

    return store.rules.filter((rule) => {
      if (activeOnly && !rule.active) {
        return false;
      }
      if (rule.scope === 'SPECIFIC_BOT' && options?.botId) {
        return rule.targetId === options.botId;
      }
      if (rule.scope === 'TASK' && options?.taskId) {
        return rule.targetId === options.taskId;
      }
      if (rule.scope === 'SPECIFIC_BOT' && !options?.botId && options?.taskId) {
        return false;
      }
      return true;
    });
  }

  public async formatRulesForPrompt(
    sessionId: string,
    botId?: string,
    taskId?: string
  ): Promise<string> {
    const rules = await this.listRules(sessionId, {
      activeOnly: true,
      botId,
      taskId,
    });
    if (rules.length === 0) {
      return '';
    }

    const order: Record<DynamicRule['severity'], number> = {
      HARD_STOP: 0,
      MANDATORY: 1,
      ADVISORY: 2,
    };

    const sorted = [...rules].sort((a, b) => order[a.severity] - order[b.severity]);
    return sorted
      .map(
        (rule, idx) =>
          `${idx + 1}. [${rule.severity}] (${rule.ruleId}) ${rule.statement}`
      )
      .join('\n');
  }
}
