import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BUNDLED_OPERATIONS_ROOT,
  OperationRegistry,
  evaluatePredicateExpr,
  loadOperationPackage,
  parseOperationDocument,
  stringifyOperationYaml,
  validateOperationPackage,
} from '../../src/operation/index.js';

describe('Operation v0.3 YAML Parser, PredicateExpr & 9-Layer Semantic Validator', () => {
  let tmpRoot: string | undefined;

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = undefined;
    }
  });

  it('parses and validates all 7 bundled Dynamic Swarm Manifold Operations with zero errors', async () => {
    const registry = new OperationRegistry({ bundledRoot: DEFAULT_BUNDLED_OPERATIONS_ROOT });
    const list = await registry.listOperations();
    expect(list.length).toBe(7);

    const validation = await registry.validateAll();
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(validation.checkedCount).toBe(7);
  });

  it('round-trips YAML serialization cleanly through parseOperationDocument', async () => {
    const pkg = await loadOperationPackage(
      path.join(DEFAULT_BUNDLED_OPERATIONS_ROOT, '04_research_pipeline')
    );
    const serialized = stringifyOperationYaml(pkg.op);
    const reparsed = parseOperationDocument(serialized);
    expect(reparsed).toEqual(pkg.op);
  });

  it('evaluates PaperOrchestra acceptance and rollback PredicateExpr ASTs deterministically', async () => {
    const pkg = await loadOperationPackage(
      path.join(DEFAULT_BUNDLED_OPERATIONS_ROOT, '04_research_pipeline')
    );
    const loop = pkg.op.behavior.loops.find((l) => l.id === 'manuscript_refinement_loop')!;
    const acc = loop.acceptance_predicate;
    const rb = loop.rollback_predicate!;

    expect(
      evaluatePredicateExpr(acc, {
        candidate: {
          overall_score: 8.6,
          net_subscore_delta: -0.1,
          required_subscore_regression: false,
          hard_constraint_violated: false,
        },
        accepted: { overall_score: 8.2 },
      })
    ).toBe(true);

    expect(
      evaluatePredicateExpr(acc, {
        candidate: {
          overall_score: 8.2,
          net_subscore_delta: 0.3,
          required_subscore_regression: false,
          hard_constraint_violated: false,
        },
        accepted: { overall_score: 8.2 },
      })
    ).toBe(true);

    expect(
      evaluatePredicateExpr(acc, {
        candidate: {
          overall_score: 8.2,
          net_subscore_delta: 0.1,
          required_subscore_regression: true,
          hard_constraint_violated: false,
        },
        accepted: { overall_score: 8.2 },
      })
    ).toBe(false);

    expect(
      evaluatePredicateExpr(rb, {
        candidate: {
          overall_score: 7.5,
          net_subscore_delta: -0.5,
          required_subscore_regression: true,
          hard_constraint_violated: false,
        },
        accepted: { overall_score: 8.2 },
      })
    ).toBe(true);
  });

  it('rejects workflow cycles, L=1 anti_affinity contradictions, REVIEW_ONLY write leaks, role/resource conflation, and missing deliverables', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-opval-'));
    const fixtureBase = path.join(tmpRoot, 'ops');
    await fs.cp(DEFAULT_BUNDLED_OPERATIONS_ROOT, fixtureBase, { recursive: true });

    // 1. Workflow cycle
    const loopYamlPath = path.join(fixtureBase, '02_iterative_quality_loop', 'operation.yaml');
    const loopPkg = await loadOperationPackage(path.dirname(loopYamlPath));
    const cyclicOp = structuredClone(loopPkg.op);
    cyclicOp.workflow.seed_stages[0]!.depends_on = ['evaluate'];
    await fs.writeFile(loopYamlPath, stringifyOperationYaml(cyclicOp), 'utf-8');
    const cycleErrors = await validateOperationPackage(path.dirname(loopYamlPath));
    expect(cycleErrors.some((e) => e.includes('cycle detected'))).toBe(true);

    // 2. L=1 fallback vs strict_distinct_bot conflict
    const conflictOp = structuredClone(loopPkg.op);
    conflictOp.manifold.continuity.l1_single_agent_fallback = true;
    await fs.writeFile(loopYamlPath, stringifyOperationYaml(conflictOp), 'utf-8');
    const conflictErrors = await validateOperationPackage(path.dirname(loopYamlPath));
    expect(conflictErrors.some((e) => e.includes('l1_single_agent_fallback=true conflicts'))).toBe(
      true
    );

    // 3. REVIEW_ONLY role with filesystem.write_external leak
    const leakOp = structuredClone(loopPkg.op);
    const revRole = leakOp.manifold.roles.find((r) => r.id === 'reviewer')!;
    revRole.acg_capabilities.push('filesystem.write_external');
    await fs.writeFile(loopYamlPath, stringifyOperationYaml(leakOp), 'utf-8');
    const leakErrors = await validateOperationPackage(path.dirname(loopYamlPath));
    expect(leakErrors.some((e) => e.includes('REVIEW_ONLY role "reviewer"'))).toBe(true);

    // 4. Resource ID placed into feedback_sources kind=role
    const rpPath = path.join(fixtureBase, '04_research_pipeline', 'operation.yaml');
    const rpPkg = await loadOperationPackage(path.dirname(rpPath));
    const badFbOp = structuredClone(rpPkg.op);
    badFbOp.behavior.loops[0]!.feedback_sources = [{ kind: 'role', ref: 'visual_critic' }];
    await fs.writeFile(rpPath, stringifyOperationYaml(badFbOp), 'utf-8');
    const fbErrors = await validateOperationPackage(path.dirname(rpPath));
    expect(fbErrors.some((e) => e.includes('feedback_source kind=role unknown: "visual_critic"'))).toBe(
      true
    );

    // 5. Missing deliverable in output_schema
    const missingDelivOp = structuredClone(rpPkg.op);
    missingDelivOp.mission.deliverables.push('non_existent_deliverable');
    await fs.writeFile(rpPath, stringifyOperationYaml(missingDelivOp), 'utf-8');
    const delivErrors = await validateOperationPackage(path.dirname(rpPath));
    expect(delivErrors.some((e) => e.includes('non_existent_deliverable'))).toBe(true);

    // 6. Cross-operation reference cycle
    const childYamlPath = path.join(
      fixtureBase,
      '03_multi_hierarchy_manifold',
      'sub_operations',
      'research_branch',
      'operation.yaml'
    );
    const childPkg = await loadOperationPackage(path.dirname(childYamlPath));
    const cyclicChild = structuredClone(childPkg.op);
    cyclicChild.manifold.sub_operations = [
      {
        id: 'parent_cycle',
        operation_ref: 'almudaya.operation.multi-hierarchy',
        version_constraint: '>=0.3.0 <1.0.0',
        delegate_moderator: true,
        depends_on: [],
        execution_mode: 'sequential',
        required: true,
        budget_share_percent: 10,
        input_mapping: {},
        output_mapping: {},
      },
    ];
    await fs.writeFile(childYamlPath, stringifyOperationYaml(cyclicChild), 'utf-8');
    const regCheck = await new OperationRegistry({
      bundledRoot: fixtureBase,
    }).validateAll();
    expect(regCheck.valid).toBe(false);
    expect(regCheck.errors.some((e) => e.includes('Cross-operation reference cycle'))).toBe(true);
  });
});
