import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  atomicWriteJson,
  ensureDir,
  pathExists,
  readJsonValidated,
} from '../core/fs-utils.js';
import { isPathInsideRoot } from '../tools/sandbox.js';
import { ProtocolStore } from './store.js';

const CheckpointEntrySchema = z.object({
  relativePath: z.string(),
  rootId: z.string(),
  existedBefore: z.boolean(),
  snapshotRelativeFile: z.string(),
  capturedAt: z.string(),
});

const TaskCheckpointManifestSchema = z.object({
  taskId: z.string(),
  createdAt: z.string(),
  entries: z.array(CheckpointEntrySchema).default([]),
});

export type TaskCheckpointManifest = z.infer<typeof TaskCheckpointManifestSchema>;

/**
 * Manages lightweight pre-task file snapshots inside
 * `sessions/<sessionId>/protocol/checkpoints/<taskId>/` so `PrIterasi`
 * and `PrTransfer` can revert corrupted partial edits safely (Celah 2).
 */
export class TaskCheckpointManager {
  private readonly store: ProtocolStore;

  constructor(store: ProtocolStore) {
    this.store = store;
  }

  private getTaskCheckpointDir(sessionId: string, taskId: string): string {
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.store.getCheckpointsDir(sessionId), safeTaskId);
  }

  private getManifestPath(sessionId: string, taskId: string): string {
    return path.join(this.getTaskCheckpointDir(sessionId, taskId), 'manifest.json');
  }

  private normalizeRoots(
    projectRoots: Array<{ root_id: string; path: string } | string>
  ): Array<{ root_id: string; path: string }> {
    return projectRoots.map((r, idx) =>
      typeof r === 'string' ? { root_id: `ROOT_${idx + 1}`, path: r } : r
    );
  }

  /**
   * Captures a pre-modification snapshot of `targetPath` for `taskId` ONLY the first
   * time the file is touched within that task lifecycle (preserving clean pre-task state).
   */
  public async captureBeforeMutation(
    sessionId: string,
    taskId: string,
    projectRoots: Array<{ root_id: string; path: string } | string>,
    targetPath: string
  ): Promise<string | undefined> {
    const normalizedRoots = this.normalizeRoots(projectRoots);
    if (!taskId || !targetPath || normalizedRoots.length === 0) {
      return undefined;
    }

    let matchedRoot = normalizedRoots[0]!;
    let absTarget = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(matchedRoot.path, targetPath);

    for (const r of normalizedRoots) {
      const candidate = path.isAbsolute(targetPath)
        ? path.resolve(targetPath)
        : path.resolve(r.path, targetPath);
      if (isPathInsideRoot(r.path, candidate)) {
        matchedRoot = r;
        absTarget = candidate;
        break;
      }
    }

    if (!isPathInsideRoot(matchedRoot.path, absTarget)) {
      return undefined;
    }

    const relPath = path.relative(matchedRoot.path, absTarget).replace(/\\/g, '/');
    const dir = this.getTaskCheckpointDir(sessionId, taskId);
    const manifestPath = this.getManifestPath(sessionId, taskId);
    await ensureDir(dir);

    let manifest: TaskCheckpointManifest;
    if (await pathExists(manifestPath)) {
      manifest = await readJsonValidated(manifestPath, TaskCheckpointManifestSchema);
    } else {
      manifest = {
        taskId,
        createdAt: new Date().toISOString(),
        entries: [],
      };
    }

    const existing = manifest.entries.find(
      (e) => e.rootId === matchedRoot.root_id && e.relativePath === relPath
    );
    if (existing) {
      return path.join(dir, existing.snapshotRelativeFile);
    }

    const existedBefore = await pathExists(absTarget);
    const snapshotRelativeFile = `snap_${manifest.entries.length + 1}_${path.basename(relPath).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const snapshotAbsPath = path.join(dir, snapshotRelativeFile);

    if (existedBefore) {
      const content = await fs.readFile(absTarget);
      await fs.writeFile(snapshotAbsPath, content);
    } else {
      await fs.writeFile(snapshotAbsPath, '', 'utf-8');
    }

    manifest.entries.push({
      relativePath: relPath,
      rootId: matchedRoot.root_id,
      existedBefore,
      snapshotRelativeFile,
      capturedAt: new Date().toISOString(),
    });

    await atomicWriteJson(manifestPath, manifest);
    return snapshotAbsPath;
  }

  /**
   * Restores all files modified during `taskId` back to their clean pre-task state
   * (deleting files that did not exist before the task started).
   */
  public async restoreCheckpoint(
    sessionId: string,
    taskId: string,
    projectRoots: Array<{ root_id: string; path: string } | string>
  ): Promise<string[]> {
    const normalizedRoots = this.normalizeRoots(projectRoots);
    const manifestPath = this.getManifestPath(sessionId, taskId);
    if (!(await pathExists(manifestPath))) {
      return [];
    }

    const dir = this.getTaskCheckpointDir(sessionId, taskId);
    const manifest = await readJsonValidated(manifestPath, TaskCheckpointManifestSchema);
    const restored: string[] = [];

    for (const entry of manifest.entries) {
      const root = normalizedRoots.find((r) => r.root_id === entry.rootId) ?? normalizedRoots[0];
      if (!root) continue;

      const absTarget = path.resolve(root.path, entry.relativePath);
      if (!isPathInsideRoot(root.path, absTarget)) continue;

      if (entry.existedBefore) {
        const snapshotAbs = path.join(dir, entry.snapshotRelativeFile);
        if (await pathExists(snapshotAbs)) {
          await ensureDir(path.dirname(absTarget));
          const buf = await fs.readFile(snapshotAbs);
          await fs.writeFile(absTarget, buf);
          restored.push(entry.relativePath);
        }
      } else {
        if (await pathExists(absTarget)) {
          await fs.unlink(absTarget);
          restored.push(entry.relativePath);
        }
      }
    }

    return restored;
  }

  /**
   * Removes snapshot storage once a task reaches DONE (prevents disk bloat).
   */
  public async pruneCheckpoint(sessionId: string, taskId: string): Promise<void> {
    const dir = this.getTaskCheckpointDir(sessionId, taskId);
    if (await pathExists(dir)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
