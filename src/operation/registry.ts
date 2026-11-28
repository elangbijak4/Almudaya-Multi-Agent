import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationError } from '../core/errors.js';
import { pathExists } from '../core/fs-utils.js';
import {
  loadOperationPackage,
  validateOperationRegistry,
  type LoadedOperationPackage,
} from './validator.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BUNDLED_OPERATIONS_ROOT = path.resolve(MODULE_DIR, '..', '..', 'operations');

export interface OperationRegistryOptions {
  workspaceRoot?: string;
  bundledRoot?: string;
  extraDirs?: string[];
}

export class OperationRegistry {
  public readonly workspaceRoot?: string;
  public readonly bundledRoot: string;
  public readonly extraDirs: string[];

  constructor(options: OperationRegistryOptions = {}) {
    this.workspaceRoot = options.workspaceRoot;
    this.bundledRoot = options.bundledRoot ?? DEFAULT_BUNDLED_OPERATIONS_ROOT;
    this.extraDirs = options.extraDirs ?? [];
  }

  private async collectOperationDirs(rootDir: string): Promise<string[]> {
    const found: string[] = [];
    if (!(await pathExists(rootDir))) {
      return found;
    }

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const hasDef = entries.some(
        (e) => e.isFile() && (e.name === 'operation.yaml' || e.name === 'operation.json')
      );
      if (hasDef) {
        found.push(dir);
      }
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) {
          await walk(path.join(dir, e.name));
        }
      }
    };

    await walk(rootDir);
    return found.sort();
  }

  public async listOperations(): Promise<LoadedOperationPackage[]> {
    const roots: string[] = [];
    if (this.bundledRoot) roots.push(this.bundledRoot);
    for (const d of this.extraDirs) {
      if (d) roots.push(path.resolve(d));
    }
    if (this.workspaceRoot) {
      roots.push(path.join(this.workspaceRoot, 'operations'));
    }

    const byId = new Map<string, LoadedOperationPackage>();
    for (const r of roots) {
      const dirs = await this.collectOperationDirs(r);
      for (const dir of dirs) {
        try {
          const pkg = await loadOperationPackage(dir);
          // Workspace or later roots override earlier bundled definitions of same ID
          byId.set(pkg.op.identity.id, pkg);
        } catch {
          // Invalid directories will still be surfaced by validateAll() if loaded explicitly
        }
      }
    }

    return Array.from(byId.values()).sort((a, b) =>
      a.op.identity.id.localeCompare(b.op.identity.id)
    );
  }

  public async resolveOperation(idOrAlias: string): Promise<LoadedOperationPackage> {
    const query = idOrAlias.trim();
    if (!query) {
      throw new ValidationError('Operation identifier or alias cannot be empty.');
    }

    const all = await this.listOperations();
    const lower = query.toLowerCase();
    const stripHash = lower.startsWith('#operation-') ? lower.slice('#operation-'.length) : lower;

    const exact = all.find(
      (pkg) =>
        pkg.op.identity.id.toLowerCase() === lower ||
        (pkg.op.identity.alias && pkg.op.identity.alias.toLowerCase() === lower)
    );
    if (exact) return exact;

    const slugMatch = all.find((pkg) => {
      const idTail = pkg.op.identity.id.split('.').pop()?.toLowerCase() ?? '';
      const compactTail = idTail.replace(/-/g, '');
      const dirBase = path.basename(pkg.opDir).toLowerCase();
      return (
        idTail === lower ||
        idTail === stripHash ||
        compactTail === stripHash.replace(/-/g, '') ||
        dirBase === lower
      );
    });
    if (slugMatch) return slugMatch;

    throw new ValidationError(
      `Operation "${idOrAlias}" not found in bundled or workspace catalogs (${all.length} available).`
    );
  }

  public async validateAll(): Promise<{ valid: boolean; errors: string[]; checkedCount: number }> {
    const roots: string[] = [];
    if (this.bundledRoot) roots.push(this.bundledRoot);
    for (const d of this.extraDirs) {
      if (d) roots.push(path.resolve(d));
    }
    if (this.workspaceRoot) {
      roots.push(path.join(this.workspaceRoot, 'operations'));
    }

    const byId = new Map<string, LoadedOperationPackage>();
    const loadErrors: string[] = [];
    for (const r of roots) {
      const dirs = await this.collectOperationDirs(r);
      for (const dir of dirs) {
        try {
          const pkg = await loadOperationPackage(dir);
          byId.set(pkg.op.identity.id, pkg);
        } catch (err: unknown) {
          loadErrors.push(`[${dir}] ${(err as Error).message}`);
        }
      }
    }

    const res = await validateOperationRegistry(Array.from(byId.values()));
    return {
      valid: loadErrors.length === 0 && res.valid,
      errors: [...loadErrors, ...res.errors],
      checkedCount: res.checkedCount + loadErrors.length,
    };
  }
}
