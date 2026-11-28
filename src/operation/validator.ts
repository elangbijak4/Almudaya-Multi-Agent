import fs from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from '../core/fs-utils.js';
import {
  AgenticOperationV03Schema,
  type AgenticOperationV03,
} from './schema.js';
import { parseOperationDocument } from './yaml-lite.js';

export interface LoadedOperationPackage {
  op: AgenticOperationV03;
  opDir: string;
  definitionFile: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

function parseSemver(ver: string): [number, number, number] | null {
  const parts = ver.trim().split('.');
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    return null;
  }
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function cmpTuple(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return 0;
}

export function satisfiesSemverConstraint(version: string, constraint: string): boolean {
  const v = parseSemver(version);
  if (!v) return false;
  const tokens = constraint
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return true;

  for (const tok of tokens) {
    if (tok === '*') continue;
    if (tok.endsWith('.x')) {
      const major = Number(tok.slice(0, -2));
      if (!Number.isFinite(major) || v[0] !== major) return false;
      continue;
    }
    const m = /^(>=|<=|==|>|<)?(\d+\.\d+\.\d+)$/.exec(tok);
    if (!m) return false;
    const op = m[1] ?? '==';
    const target = parseSemver(m[2]!);
    if (!target) return false;
    const diff = cmpTuple(v, target);
    if (op === '==' && diff !== 0) return false;
    if (op === '>' && !(diff > 0)) return false;
    if (op === '>=' && !(diff >= 0)) return false;
    if (op === '<' && !(diff < 0)) return false;
    if (op === '<=' && !(diff <= 0)) return false;
  }
  return true;
}

function detectCycle(adj: Map<string, string[]>): string[] | null {
  const color = new Map<string, number>();
  for (const k of adj.keys()) color.set(k, 0);
  const stack: string[] = [];

  const dfs = (node: string): string[] | null => {
    color.set(node, 1);
    stack.push(node);
    for (const nxt of adj.get(node) ?? []) {
      if (!color.has(nxt)) continue;
      const c = color.get(nxt)!;
      if (c === 1) {
        const idx = stack.indexOf(nxt);
        return [...stack.slice(idx), nxt];
      }
      if (c === 0) {
        const found = dfs(nxt);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, 2);
    return null;
  };

  for (const node of adj.keys()) {
    if (color.get(node) === 0) {
      const cy = dfs(node);
      if (cy) return cy;
    }
  }
  return null;
}

function extractOutputFieldNames(outputSchema: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const props = outputSchema['properties'];
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    const propsRec = props as Record<string, unknown>;
    for (const k of Object.keys(propsRec)) {
      names.add(k);
    }
    const artifacts = propsRec['artifacts'];
    if (artifacts && typeof artifacts === 'object' && !Array.isArray(artifacts)) {
      const artProps = (artifacts as Record<string, unknown>)['properties'];
      if (artProps && typeof artProps === 'object' && !Array.isArray(artProps)) {
        for (const k of Object.keys(artProps as Record<string, unknown>)) {
          names.add(k);
        }
      }
    }
  }
  return names;
}

export function validateJsonAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  at = '<root>'
): string[] {
  const errors: string[] = [];
  if (Array.isArray(schema['enum'])) {
    if (!schema['enum'].includes(value)) {
      errors.push(`${at}: value ${JSON.stringify(value)} is not in enum ${JSON.stringify(schema['enum'])}`);
    }
    return errors;
  }

  const expectedType = schema['type'];
  if (expectedType === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${at}: expected string, got ${typeof value}`);
      return errors;
    }
    if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) {
      errors.push(`${at}: string length ${value.length} < minLength ${schema['minLength']}`);
    }
    return errors;
  }
  if (expectedType === 'integer' || expectedType === 'number') {
    if (typeof value !== 'number' || (expectedType === 'integer' && !Number.isInteger(value))) {
      errors.push(`${at}: expected ${expectedType}`);
      return errors;
    }
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) {
      errors.push(`${at}: value ${value} < minimum ${schema['minimum']}`);
    }
    return errors;
  }
  if (expectedType === 'boolean') {
    if (typeof value !== 'boolean') {
      errors.push(`${at}: expected boolean`);
    }
    return errors;
  }
  if (expectedType === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${at}: expected array`);
      return errors;
    }
    if (typeof schema['minItems'] === 'number' && value.length < schema['minItems']) {
      errors.push(`${at}: array length ${value.length} < minItems ${schema['minItems']}`);
    }
    const itemSchema = schema['items'];
    if (itemSchema && typeof itemSchema === 'object' && !Array.isArray(itemSchema)) {
      value.forEach((item, idx) => {
        errors.push(...validateJsonAgainstSchema(item, itemSchema as Record<string, unknown>, `${at}[${idx}]`));
      });
    }
    return errors;
  }
  if (expectedType === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${at}: expected object`);
      return errors;
    }
    const obj = value as Record<string, unknown>;
    const req = Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];
    for (const r of req) {
      if (!(r in obj)) {
        errors.push(`${at}: missing required property "${r}"`);
      }
    }
    const props =
      schema['properties'] && typeof schema['properties'] === 'object'
        ? (schema['properties'] as Record<string, Record<string, unknown>>)
        : {};
    for (const [k, v] of Object.entries(obj)) {
      if (k in props) {
        errors.push(...validateJsonAgainstSchema(v, props[k]!, `${at}.${k}`));
      } else if (schema['additionalProperties'] === false) {
        errors.push(`${at}: unexpected additional property "${k}"`);
      }
    }
  }
  return errors;
}

export function validateLoadedOperation(
  op: AgenticOperationV03,
  options: {
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    registry?: Map<string, LoadedOperationPackage>;
  } = {}
): string[] {
  const errors: string[] = [];
  const opId = op.identity.id;
  const { inputSchema, outputSchema, registry } = options;

  // 1. Deliverables parity with output_schema
  if (outputSchema) {
    const avail = extractOutputFieldNames(outputSchema);
    for (const d of op.mission.deliverables) {
      if (!avail.has(d)) {
        errors.push(`[${opId}] deliverable "${d}" missing from output_schema properties/artifacts`);
      }
    }
  }

  // 2. Role cardinality, REVIEW_ONLY least-privilege, and anti_affinity satisfiability
  const roleMap = new Map<string, AgenticOperationV03['manifold']['roles'][number]>();
  for (const role of op.manifold.roles) {
    if (roleMap.has(role.id)) {
      errors.push(`[${opId}] duplicate role id "${role.id}"`);
    }
    roleMap.set(role.id, role);
    if (role.lifecycle.cardinality.min > role.lifecycle.cardinality.max) {
      errors.push(
        `[${opId}] role "${role.id}" cardinality min (${role.lifecycle.cardinality.min}) > max (${role.lifecycle.cardinality.max})`
      );
    }
    if (role.default_access_mode === 'REVIEW_ONLY') {
      if (role.allowed_path_globs.length > 0) {
        errors.push(`[${opId}] REVIEW_ONLY role "${role.id}" must have empty allowed_path_globs`);
      }
      const forbidden = role.acg_capabilities.filter(
        (c) => c === 'filesystem.write_external' || c === 'filesystem.delete_external'
      );
      if (forbidden.length > 0) {
        errors.push(
          `[${opId}] REVIEW_ONLY role "${role.id}" cannot grant write/delete ACG capabilities: ${forbidden.join(', ')}`
        );
      }
    }
  }

  const l1Fallback = op.manifold.continuity.l1_single_agent_fallback;
  for (const rule of op.manifold.anti_affinity ?? []) {
    const [r1, r2] = rule.roles;
    if (r1 === r2) {
      errors.push(`[${opId}] anti_affinity cannot pair role "${r1}" with itself`);
    }
    for (const rn of [r1, r2]) {
      if (!roleMap.has(rn)) {
        errors.push(`[${opId}] anti_affinity references unknown role "${rn}"`);
      }
    }
    if (
      l1Fallback &&
      rule.enforcement === 'strict_distinct_bot' &&
      roleMap.has(r1) &&
      roleMap.has(r2) &&
      roleMap.get(r1)!.lifecycle.cardinality.min >= 1 &&
      roleMap.get(r2)!.lifecycle.cardinality.min >= 1
    ) {
      errors.push(
        `[${opId}] l1_single_agent_fallback=true conflicts with strict_distinct_bot anti_affinity between mandatory roles "${r1}" and "${r2}"`
      );
    }
  }

  // 3. Cross-section role & resource references
  for (const acl of op.communication.blackboard_acl ?? []) {
    if (!roleMap.has(acl.role_id)) {
      errors.push(`[${opId}] blackboard_acl references unknown role "${acl.role_id}"`);
    }
  }

  const resourceIds = new Set<string>();
  for (const res of op.resources.contracts) {
    if (resourceIds.has(res.id)) {
      errors.push(`[${opId}] duplicate resource contract id "${res.id}"`);
    }
    resourceIds.add(res.id);
    for (const ar of res.authorized_roles) {
      if (!roleMap.has(ar)) {
        errors.push(`[${opId}] resource "${res.id}" authorizes unknown role "${ar}"`);
      }
    }
  }

  for (const gate of op.governance.hitl_gates) {
    if (!roleMap.has(gate.approver_role)) {
      errors.push(
        `[${opId}] hitl_gate "${gate.action}" references unknown approver_role "${gate.approver_role}"`
      );
    }
  }

  // 4. Loop feedback_sources type isolation
  for (const loop of op.behavior.loops) {
    for (const src of loop.feedback_sources) {
      if (src.kind === 'role' && !roleMap.has(src.ref)) {
        errors.push(`[${opId}] loop "${loop.id}" feedback_source kind=role unknown: "${src.ref}"`);
      }
      if (src.kind === 'resource_evaluator' && !resourceIds.has(src.ref)) {
        errors.push(
          `[${opId}] loop "${loop.id}" feedback_source kind=resource_evaluator unknown: "${src.ref}"`
        );
      }
    }
  }

  // 5. Sub-operations local DAG & budget checks
  const subMap = new Map<string, NonNullable<AgenticOperationV03['manifold']['sub_operations']>[number]>();
  let totalShare = 0;
  for (const sub of op.manifold.sub_operations ?? []) {
    if (subMap.has(sub.id)) {
      errors.push(`[${opId}] duplicate sub_operation id "${sub.id}"`);
    }
    subMap.set(sub.id, sub);
    totalShare += sub.budget_share_percent;
  }
  if (totalShare > 100 + 1e-9) {
    errors.push(`[${opId}] sub_operations budget_share_percent sum (${totalShare}) exceeds 100`);
  }

  const subAdj = new Map<string, string[]>();
  for (const [sid, sub] of subMap.entries()) {
    for (const dep of sub.depends_on) {
      if (!subMap.has(dep)) {
        errors.push(`[${opId}] sub_operation "${sid}" depends_on unknown "${dep}"`);
      }
    }
    subAdj.set(sid, [...sub.depends_on]);
  }
  const subCycle = detectCycle(subAdj);
  if (subCycle) {
    errors.push(`[${opId}] sub_operations dependency cycle detected: ${subCycle.join(' -> ')}`);
  }

  // 6. Workflow seed_stages checks
  if (op.manifold.orchestration_regime === 'stage_gated' && op.workflow.seed_stages.length === 0) {
    errors.push(`[${opId}] stage_gated regime requires non-empty workflow.seed_stages`);
  }
  const stageIds = new Set<string>();
  const stageAdj = new Map<string, string[]>();
  for (const st of op.workflow.seed_stages) {
    if (stageIds.has(st.id)) {
      errors.push(`[${opId}] duplicate workflow stage id "${st.id}"`);
    }
    stageIds.add(st.id);
    if (st.owner_kind === 'role' && !roleMap.has(st.owner_ref)) {
      errors.push(`[${opId}] stage "${st.id}" references unknown owner role "${st.owner_ref}"`);
    }
    if (st.owner_kind === 'sub_operation' && !subMap.has(st.owner_ref)) {
      errors.push(`[${opId}] stage "${st.id}" references unknown sub_operation "${st.owner_ref}"`);
    }
  }
  for (const st of op.workflow.seed_stages) {
    for (const dep of st.depends_on) {
      if (!stageIds.has(dep)) {
        errors.push(`[${opId}] stage "${st.id}" depends_on unknown stage "${dep}"`);
      }
    }
    stageAdj.set(st.id, [...st.depends_on]);
  }
  const stageCycle = detectCycle(stageAdj);
  if (stageCycle) {
    errors.push(`[${opId}] workflow stage dependency cycle detected: ${stageCycle.join(' -> ')}`);
  }

  // 7. Cross-operation contract validation
  if (registry && subMap.size > 0) {
    const parentInProps = new Set(
      inputSchema && typeof inputSchema['properties'] === 'object' && inputSchema['properties']
        ? Object.keys(inputSchema['properties'] as Record<string, unknown>)
        : []
    );
    const parentOutProps = outputSchema ? extractOutputFieldNames(outputSchema) : new Set<string>();

    for (const [sid, sub] of subMap.entries()) {
      const childEntry = registry.get(sub.operation_ref);
      if (!childEntry) {
        errors.push(`[${opId}] sub_operation "${sid}" references unregistered operation_ref "${sub.operation_ref}"`);
        continue;
      }
      if (!satisfiesSemverConstraint(childEntry.op.identity.version, sub.version_constraint)) {
        errors.push(
          `[${opId}] sub_operation "${sid}" child version "${childEntry.op.identity.version}" does not satisfy "${sub.version_constraint}"`
        );
      }
      if (childEntry.inputSchema) {
        const reqFields = Array.isArray(childEntry.inputSchema['required'])
          ? (childEntry.inputSchema['required'] as string[])
          : [];
        const mapped = new Set(Object.keys(sub.input_mapping));
        for (const req of reqFields) {
          if (!mapped.has(req)) {
            errors.push(`[${opId}] sub_operation "${sid}" input_mapping omits required child field "${req}"`);
          }
        }
        for (const [targetField, srcExpr] of Object.entries(sub.input_mapping)) {
          if (srcExpr.startsWith('$.mission.')) {
            const pField = srcExpr.slice('$.mission.'.length);
            if (!parentInProps.has(pField)) {
              errors.push(
                `[${opId}] sub_operation "${sid}" input_mapping "${targetField}" references missing parent input "${pField}"`
              );
            }
          } else if (srcExpr.startsWith('$.child_outputs.')) {
            const parts = srcExpr.slice('$.child_outputs.'.length).split('.');
            const sibId = parts[0]!;
            const sibSpec = subMap.get(sibId);
            if (!sibSpec) {
              errors.push(
                `[${opId}] sub_operation "${sid}" input_mapping references unknown sibling "${sibId}"`
              );
            } else if (parts.length === 2 && registry.has(sibSpec.operation_ref)) {
              const sibOut = registry.get(sibSpec.operation_ref)!.outputSchema;
              if (sibOut && !extractOutputFieldNames(sibOut).has(parts[1]!)) {
                errors.push(
                  `[${opId}] sub_operation "${sid}" input_mapping references missing field "${parts[1]}" on sibling "${sibId}"`
                );
              }
            }
          }
        }
      }
      if (childEntry.outputSchema) {
        const childOutFields = extractOutputFieldNames(childEntry.outputSchema);
        for (const [parentField, childExpr] of Object.entries(sub.output_mapping)) {
          if (outputSchema && !parentOutProps.has(parentField)) {
            errors.push(
              `[${opId}] sub_operation "${sid}" output_mapping target "${parentField}" missing in parent output_schema`
            );
          }
          if (childExpr.startsWith('$.outputs.')) {
            const cf = childExpr.slice('$.outputs.'.length);
            if (!childOutFields.has(cf)) {
              errors.push(
                `[${opId}] sub_operation "${sid}" output_mapping source "${cf}" missing in child "${sub.operation_ref}" output_schema`
              );
            }
          }
        }
      }
    }
  }

  return errors;
}

export async function loadOperationPackage(opDir: string): Promise<LoadedOperationPackage> {
  const yamlPath = path.join(opDir, 'operation.yaml');
  const jsonPath = path.join(opDir, 'operation.json');
  const defPath = (await pathExists(yamlPath))
    ? yamlPath
    : (await pathExists(jsonPath))
      ? jsonPath
      : '';
  if (!defPath) {
    throw new Error(`No operation.yaml or operation.json found in "${opDir}".`);
  }

  const rawText = await fs.readFile(defPath, 'utf-8');
  const parsedDoc = parseOperationDocument(rawText);
  const op = AgenticOperationV03Schema.parse(parsedDoc);

  const inPath = path.resolve(opDir, op.mission.input_schema);
  const outPath = path.resolve(opDir, op.mission.output_schema);
  const inputSchema = (await pathExists(inPath))
    ? (JSON.parse(await fs.readFile(inPath, 'utf-8')) as Record<string, unknown>)
    : undefined;
  const outputSchema = (await pathExists(outPath))
    ? (JSON.parse(await fs.readFile(outPath, 'utf-8')) as Record<string, unknown>)
    : undefined;

  return {
    op,
    opDir,
    definitionFile: defPath,
    inputSchema,
    outputSchema,
  };
}

export async function validateOperationPackage(
  opDir: string,
  registry?: Map<string, LoadedOperationPackage>
): Promise<string[]> {
  let pkg: LoadedOperationPackage;
  try {
    pkg = await loadOperationPackage(opDir);
  } catch (err: unknown) {
    return [`[${opDir}] parse/schema error: ${(err as Error).message}`];
  }

  const errors: string[] = [];
  const opId = pkg.op.identity.id;
  if (!pkg.inputSchema) {
    errors.push(`[${opId}] missing mission.input_schema "${pkg.op.mission.input_schema}"`);
  }
  if (!pkg.outputSchema) {
    errors.push(`[${opId}] missing mission.output_schema "${pkg.op.mission.output_schema}"`);
  }

  const samplePath = path.join(opDir, 'examples', 'sample-input.json');
  if ((await pathExists(samplePath)) && pkg.inputSchema) {
    try {
      const sampleData = JSON.parse(await fs.readFile(samplePath, 'utf-8')) as unknown;
      errors.push(...validateJsonAgainstSchema(sampleData, pkg.inputSchema, `[${opId}] sample-input.json`));
    } catch (err: unknown) {
      errors.push(`[${opId}] invalid sample-input.json: ${(err as Error).message}`);
    }
  }

  errors.push(
    ...validateLoadedOperation(pkg.op, {
      inputSchema: pkg.inputSchema,
      outputSchema: pkg.outputSchema,
      registry,
    })
  );
  return errors;
}

export async function validateOperationRegistry(
  entries: LoadedOperationPackage[]
): Promise<{ valid: boolean; errors: string[]; checkedCount: number }> {
  const errors: string[] = [];
  const regMap = new Map<string, LoadedOperationPackage>();
  for (const entry of entries) {
    if (regMap.has(entry.op.identity.id)) {
      errors.push(`Duplicate Operation id "${entry.op.identity.id}" in registry.`);
    } else {
      regMap.set(entry.op.identity.id, entry);
    }
  }

  for (const entry of entries) {
    const pkgErrors = await validateOperationPackage(entry.opDir, regMap);
    errors.push(...pkgErrors);
  }

  // Cross-operation cycle & max_nesting_depth
  const refAdj = new Map<string, string[]>();
  for (const [oid, entry] of regMap.entries()) {
    refAdj.set(
      oid,
      (entry.op.manifold.sub_operations ?? []).map((s) => s.operation_ref)
    );
  }
  const cycle = detectCycle(refAdj);
  if (cycle) {
    errors.push(`Cross-operation reference cycle detected: ${cycle.join(' -> ')}`);
  } else {
    const computeDepth = (oid: string): number => {
      const children = (refAdj.get(oid) ?? []).filter((c) => regMap.has(c));
      if (children.length === 0) return 1;
      return 1 + Math.max(...children.map((c) => computeDepth(c)));
    };
    for (const [oid, entry] of regMap.entries()) {
      const maxD = entry.op.governance.hierarchy_safety?.max_nesting_depth;
      if (maxD !== undefined) {
        const actual = computeDepth(oid);
        if (actual > maxD) {
          errors.push(`[${oid}] nesting depth (${actual}) exceeds max_nesting_depth (${maxD})`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    checkedCount: entries.length,
  };
}
