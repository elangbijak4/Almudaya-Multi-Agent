import fs from 'node:fs/promises';
import path from 'node:path';
import type { IBlackboardStorage } from '../../blackboard/interface.js';
import { atomicWriteJson, ensureDir, pathExists } from '../../core/fs-utils.js';
import { withLock } from '../../core/lock.js';
import { redactSecrets } from '../../execution/environment.js';
import type { ProjectRootRecord } from '../../shared/schema.js';
import {
  computeContentHash,
  deriveIdempotencyKey,
  deriveKnowledgeId,
  deriveProjectUniverseId,
} from '../contracts/identity.js';
import {
  CURRENT_PKU_SCHEMA_VERSION,
  type KnowledgeObject,
  type KnowledgeRelation,
  type ProjectMemoryUniverse,
  type ProjectUniverseId,
} from '../contracts/types.js';
import type { IPKUStore } from '../ports/pku-store.js';

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-release',
  'coverage',
  '.almudaya_workspace',
  '.almudaya',
  '.next',
  '.nuxt',
  'build',
  'out',
  '__pycache__',
  '.venv',
  'venv',
]);

const BINARY_OR_MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.mp3',
  '.wav',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.lock',
]);

const MAX_INDEXABLE_FILE_BYTES = 512 * 1024; // 512 KB per text file

export interface IndexedFileRecord {
  relativePath: string;
  knowledgeId: string;
  contentHash: string;
  directory: string;
  language: string;
  lineCount: number;
  byteSize: number;
  symbols: string[];
  imports: string[];
  summary: string;
  updatedAt: string;
}

export interface CodebaseIndexManifest {
  schemaVersion: string;
  sessionId: string;
  rootId: string;
  rootPath: string;
  projectUniverseId: ProjectUniverseId;
  updatedAt: string;
  files: Record<string, IndexedFileRecord>;
}

export interface CodebaseSyncResult {
  rootId: string;
  addedCount: number;
  updatedCount: number;
  removedCount: number;
  unchangedCount: number;
  totalIndexedFiles: number;
}

function detectLanguage(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript-react',
    '.js': 'javascript',
    '.jsx': 'javascript-react',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.json': 'json',
    '.md': 'markdown',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.sql': 'sql',
    '.sh': 'shell',
    '.ps1': 'powershell',
  };
  return map[ext.toLowerCase()] ?? (ext.replace(/^\./, '') || 'text');
}

function extractSymbolsAndImports(
  content: string,
  ext: string
): { symbols: string[]; imports: string[]; firstComment?: string } {
  const symbols = new Set<string>();
  const imports = new Set<string>();
  const lines = content.split(/\r?\n/);
  let firstComment: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!firstComment && (line.startsWith('//') || line.startsWith('# ') || line.startsWith('* '))) {
      const cleaned = line.replace(/^(\/\/|#|\*)\s*/, '').trim();
      if (cleaned.length > 8 && !cleaned.startsWith('!')) {
        firstComment = cleaned.slice(0, 140);
      }
    }

    // JS / TS exports & declarations
    const tsMatch = line.match(
      /^(?:export\s+(?:default\s+)?(?:async\s+)?)?(?:function|class|interface|type|enum|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/
    );
    if (tsMatch?.[1] && symbols.size < 30) {
      symbols.add(tsMatch[1]);
    }

    // Python def / class
    const pyMatch = line.match(/^(?:async\s+)?(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (pyMatch?.[1] && symbols.size < 30) {
      symbols.add(pyMatch[1]);
    }

    // Markdown headings
    if (ext.toLowerCase() === '.md') {
      const mdMatch = line.match(/^#{1,3}\s+(.+)$/);
      if (mdMatch?.[1] && symbols.size < 20) {
        symbols.add(mdMatch[1].trim().slice(0, 80));
      }
    }

    // HTML title / ids
    if (ext.toLowerCase() === '.html' || ext.toLowerCase() === '.htm') {
      const titleMatch = line.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch?.[1] && symbols.size < 20) {
        symbols.add(`title:${titleMatch[1].trim()}`);
      }
      const scriptMatch = line.match(/<script[^>]+src=["']([^"']+)["']/i);
      if (scriptMatch?.[1]) imports.add(scriptMatch[1]);
      const linkMatch = line.match(/<link[^>]+href=["']([^"']+)["']/i);
      if (linkMatch?.[1]) imports.add(linkMatch[1]);
    }

    // JS/TS imports & requires
    const importMatch = line.match(/from\s+['"]([^'"]+)['"]/);
    if (importMatch?.[1]) imports.add(importMatch[1]);
    const requireMatch = line.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch?.[1]) imports.add(requireMatch[1]);
  }

  // JSON top-level keys
  if (ext.toLowerCase() === '.json') {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const key of Object.keys(parsed as Record<string, unknown>).slice(0, 20)) {
          symbols.add(key);
        }
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  return {
    symbols: Array.from(symbols),
    imports: Array.from(imports),
    firstComment,
  };
}

function resolveRelativeImport(
  fromRelPath: string,
  importTarget: string,
  knownFiles: Set<string>
): string | null {
  if (!importTarget.startsWith('.')) {
    return null;
  }
  const baseDir = path.posix.dirname(fromRelPath);
  const joined = path.posix.normalize(path.posix.join(baseDir, importTarget));
  const candidates = [
    joined,
    joined.replace(/\.js$/, '.ts'),
    joined.replace(/\.jsx$/, '.tsx'),
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}/index.ts`,
    `${joined}/index.js`,
  ];
  for (const c of candidates) {
    if (knownFiles.has(c)) {
      return c;
    }
  }
  return null;
}

/**
 * Incremental Project Codebase Indexer (PKU Compressed Knowledge Layer).
 *
 * Converts project target files into compact L0 (Project Map), L1 (Module Summaries),
 * L2 (File & Symbol Summaries), and `depends_on` Knowledge Graph relations in PKU.
 * Only re-indexes files whose SHA-256 content hash has changed.
 */
export class ProjectCodebaseIndexer {
  private readonly pkuStore: IPKUStore;
  private readonly manifestBaseDir: string;

  constructor(pkuStore: IPKUStore, pkuRootDir: string) {
    this.pkuStore = pkuStore;
    this.manifestBaseDir = path.join(pkuRootDir, 'codebase-index');
  }

  private getManifestPath(pmuId: ProjectUniverseId, rootId: string): string {
    return path.join(this.manifestBaseDir, `${pmuId}__${rootId}.json`);
  }

  private async loadManifest(
    sessionId: string,
    root: ProjectRootRecord,
    pmuId: ProjectUniverseId
  ): Promise<CodebaseIndexManifest> {
    const manifestPath = this.getManifestPath(pmuId, root.root_id);
    if (await pathExists(manifestPath)) {
      try {
        const raw = await fs.readFile(manifestPath, 'utf-8');
        return JSON.parse(raw) as CodebaseIndexManifest;
      } catch {
        // Rebuild manifest cleanly if corrupted
      }
    }
    return {
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      sessionId,
      rootId: root.root_id,
      rootPath: root.path,
      projectUniverseId: pmuId,
      updatedAt: new Date().toISOString(),
      files: {},
    };
  }

  private async saveManifest(manifest: CodebaseIndexManifest): Promise<void> {
    await ensureDir(this.manifestBaseDir);
    manifest.updatedAt = new Date().toISOString();
    await atomicWriteJson(
      this.getManifestPath(manifest.projectUniverseId, manifest.rootId),
      manifest
    );
  }

  private async ensureUniverse(
    sessionId: string,
    pmuId: ProjectUniverseId
  ): Promise<void> {
    const existing = await this.pkuStore.getUniverse(pmuId);
    if (existing) return;

    const now = new Date().toISOString();
    const universe: ProjectMemoryUniverse = {
      id: pmuId,
      projectKey: `session_${sessionId.toLowerCase()}`,
      displayName: `Session ${sessionId}`,
      rootNodeId: `root_${pmuId}`,
      status: 'active',
      reusable: false,
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      metadata: { sessionId },
    };
    await this.pkuStore.createUniverse(universe);
  }

  private async collectIndexableFiles(rootPath: string): Promise<string[]> {
    const results: string[] = [];
    if (!(await pathExists(rootPath))) {
      return results;
    }

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (BINARY_OR_MEDIA_EXTENSIONS.has(ext)) continue;
          try {
            const stat = await fs.stat(fullPath);
            if (stat.size <= MAX_INDEXABLE_FILE_BYTES) {
              results.push(fullPath);
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    };

    await walk(rootPath);
    return results;
  }

  private async upsertFileKnowledge(
    sessionId: string,
    root: ProjectRootRecord,
    pmuId: ProjectUniverseId,
    fullPath: string,
    manifest: CodebaseIndexManifest
  ): Promise<{ status: 'added' | 'updated' | 'unchanged'; record?: IndexedFileRecord }> {
    const relPath = path.relative(root.path, fullPath).replace(/\\/g, '/');
    let rawContent: string;
    let byteSize: number;
    try {
      const buf = await fs.readFile(fullPath);
      byteSize = buf.byteLength;
      if (byteSize > MAX_INDEXABLE_FILE_BYTES) {
        return { status: 'unchanged' };
      }
      rawContent = buf.toString('utf-8');
    } catch {
      return { status: 'unchanged' };
    }

    const sanitizedContent = redactSecrets(rawContent);
    const contentHash = computeContentHash(sanitizedContent);
    const existing = manifest.files[relPath];

    if (existing && existing.contentHash === contentHash) {
      return { status: 'unchanged', record: existing };
    }

    const ext = path.extname(relPath);
    const language = detectLanguage(ext);
    const lineCount = sanitizedContent.split(/\r?\n/).length;
    const { symbols, imports, firstComment } = extractSymbolsAndImports(sanitizedContent, ext);
    const dir = path.posix.dirname(relPath) === '.' ? '(root)' : path.posix.dirname(relPath);
    const now = new Date().toISOString();

    const knowledgeId = deriveKnowledgeId({
      sourceSystem: 'almudaya.codebase',
      projectUniverseId: pmuId,
      sessionId,
      sourceType: 'codebase.file_summary',
      sourceRecordId: `${root.root_id}:${relPath}`,
    });

    const summaryParts = [
      `[${language}] ${relPath} (${lineCount} lines)`,
      symbols.length > 0 ? `Symbols: ${symbols.slice(0, 12).join(', ')}` : undefined,
      imports.length > 0 ? `Imports: ${imports.slice(0, 8).join(', ')}` : undefined,
      firstComment ? `Note: ${firstComment}` : undefined,
    ].filter(Boolean);

    const summary = summaryParts.join(' | ');
    const record: IndexedFileRecord = {
      relativePath: relPath,
      knowledgeId,
      contentHash,
      directory: dir,
      language,
      lineCount,
      byteSize,
      symbols,
      imports,
      summary,
      updatedAt: now,
    };

    const ko: KnowledgeObject = {
      id: knowledgeId,
      projectUniverseId: pmuId,
      type: 'codebase.file_summary',
      scope: 'project',
      ownerId: root.root_id,
      title: `${root.root_id}:${relPath}`,
      summary,
      hierarchyLevel: 'L2',
      content: {
        rootId: root.root_id,
        relativePath: relPath,
        directory: dir,
        language,
        lineCount,
        byteSize,
        symbols,
        imports,
        firstComment,
      },
      provenance: {
        sourceSystem: 'almudaya.codebase',
        sourceType: 'ProjectFile',
        sourceId: `${root.root_id}:${relPath}`,
        sourcePath: fullPath,
        createdAt: existing?.updatedAt ?? now,
        ingestedAt: now,
        contentHash,
      },
      relationIds: [],
      validationStatus: 'validated',
      lifecycleStatus: 'active',
      reusable: true,
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      version: 1,
      createdAt: existing?.updatedAt ?? now,
      updatedAt: now,
      tags: ['codebase', language, root.root_id, dir],
    };

    const idemKey = deriveIdempotencyKey({
      sourceSystem: 'almudaya.codebase',
      scopeId: sessionId,
      sourceType: 'codebase.file_summary',
      sourceRecordId: `${root.root_id}:${relPath}`,
      contentHash,
    });

    await this.pkuStore.putKnowledge(ko, idemKey);
    manifest.files[relPath] = record;

    return {
      status: existing ? 'updated' : 'added',
      record,
    };
  }

  private async updateRelationsForFile(
    sessionId: string,
    pmuId: ProjectUniverseId,
    record: IndexedFileRecord,
    manifest: CodebaseIndexManifest
  ): Promise<void> {
    const knownFiles = new Set(Object.keys(manifest.files));
    const now = new Date().toISOString();

    for (const imp of record.imports) {
      const targetRel = resolveRelativeImport(record.relativePath, imp, knownFiles);
      if (!targetRel) continue;
      const targetRecord = manifest.files[targetRel];
      if (!targetRecord || targetRecord.knowledgeId === record.knowledgeId) continue;

      const relationId = `rel_${computeContentHash(`${record.knowledgeId}->${targetRecord.knowledgeId}:depends_on`).slice(0, 16)}`;
      const relation: KnowledgeRelation = {
        relationId,
        projectUniverseId: pmuId,
        fromId: record.knowledgeId,
        toId: targetRecord.knowledgeId,
        relationType: 'depends_on',
        createdAt: now,
        metadata: {
          importSpecifier: imp,
          fromFile: record.relativePath,
          toFile: targetRecord.relativePath,
        },
      };
      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.codebase',
        scopeId: sessionId,
        sourceType: 'codebase.relation',
        sourceRecordId: relationId,
        contentHash: computeContentHash(relation),
      });
      await this.pkuStore.putRelation(relation, idemKey);
    }
  }

  private async upsertModuleAndProjectSummaries(
    sessionId: string,
    root: ProjectRootRecord,
    pmuId: ProjectUniverseId,
    manifest: CodebaseIndexManifest,
    affectedDirectories?: Set<string>
  ): Promise<void> {
    const now = new Date().toISOString();
    const byDir = new Map<string, IndexedFileRecord[]>();
    for (const rec of Object.values(manifest.files)) {
      const list = byDir.get(rec.directory) ?? [];
      list.push(rec);
      byDir.set(rec.directory, list);
    }

    // Update affected L1 module summaries
    for (const [dir, records] of byDir.entries()) {
      if (affectedDirectories && !affectedDirectories.has(dir)) {
        continue;
      }
      const modId = deriveKnowledgeId({
        sourceSystem: 'almudaya.codebase',
        projectUniverseId: pmuId,
        sessionId,
        sourceType: 'codebase.module_summary',
        sourceRecordId: `${root.root_id}:${dir}`,
      });
      const fileList = records.map((r) => `${r.relativePath} (${r.language}, ${r.lineCount}L)`).sort();
      const summary = `Module "${dir}" in ${root.root_id}: ${records.length} files — ${fileList.slice(0, 10).join(', ')}${fileList.length > 10 ? ', ...' : ''}`;
      const content = {
        rootId: root.root_id,
        directory: dir,
        fileCount: records.length,
        files: records.map((r) => ({
          relativePath: r.relativePath,
          language: r.language,
          lineCount: r.lineCount,
          symbols: r.symbols.slice(0, 8),
        })),
      };
      const contentHash = computeContentHash(content);
      const ko: KnowledgeObject = {
        id: modId,
        projectUniverseId: pmuId,
        type: 'codebase.module_summary',
        scope: 'project',
        ownerId: root.root_id,
        title: `Module ${root.root_id}/${dir}`,
        summary,
        hierarchyLevel: 'L1',
        content,
        provenance: {
          sourceSystem: 'almudaya.codebase',
          sourceType: 'ModuleSummary',
          sourceId: `${root.root_id}:${dir}`,
          sourcePath: path.join(root.path, dir === '(root)' ? '' : dir),
          createdAt: now,
          ingestedAt: now,
          contentHash,
        },
        relationIds: [],
        validationStatus: 'validated',
        lifecycleStatus: 'active',
        reusable: true,
        schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
        version: 1,
        createdAt: now,
        updatedAt: now,
        tags: ['codebase', 'module', root.root_id, dir],
      };
      const idemKey = deriveIdempotencyKey({
        sourceSystem: 'almudaya.codebase',
        scopeId: sessionId,
        sourceType: 'codebase.module_summary',
        sourceRecordId: `${root.root_id}:${dir}`,
        contentHash,
      });
      await this.pkuStore.putKnowledge(ko, idemKey);
    }

    // Update L0 Project Map
    const mapId = deriveKnowledgeId({
      sourceSystem: 'almudaya.codebase',
      projectUniverseId: pmuId,
      sessionId,
      sourceType: 'codebase.project_map',
      sourceRecordId: root.root_id,
    });
    const allFiles = Object.values(manifest.files);
    const languages = Array.from(new Set(allFiles.map((f) => f.language))).sort();
    const dirs = Array.from(byDir.keys()).sort();
    const mapContent = {
      rootId: root.root_id,
      name: root.name,
      rootPath: root.path,
      totalFiles: allFiles.length,
      languages,
      directories: dirs.map((d) => ({
        directory: d,
        fileCount: byDir.get(d)?.length ?? 0,
      })),
    };
    const mapHash = computeContentHash(mapContent);
    const mapSummary = `Project Map [${root.root_id}] "${root.name}": ${allFiles.length} indexed files across ${dirs.length} modules (${languages.join(', ')}).`;
    const mapKo: KnowledgeObject = {
      id: mapId,
      projectUniverseId: pmuId,
      type: 'codebase.project_map',
      scope: 'project',
      ownerId: root.root_id,
      title: `Project Map: ${root.name} (${root.root_id})`,
      summary: mapSummary,
      hierarchyLevel: 'L0',
      content: mapContent,
      provenance: {
        sourceSystem: 'almudaya.codebase',
        sourceType: 'ProjectMap',
        sourceId: root.root_id,
        sourcePath: root.path,
        createdAt: now,
        ingestedAt: now,
        contentHash: mapHash,
      },
      relationIds: [],
      validationStatus: 'validated',
      lifecycleStatus: 'active',
      reusable: true,
      schemaVersion: CURRENT_PKU_SCHEMA_VERSION,
      version: 1,
      createdAt: now,
      updatedAt: now,
      tags: ['codebase', 'project_map', root.root_id],
    };
    const mapIdemKey = deriveIdempotencyKey({
      sourceSystem: 'almudaya.codebase',
      scopeId: sessionId,
      sourceType: 'codebase.project_map',
      sourceRecordId: root.root_id,
      contentHash: mapHash,
    });
    await this.pkuStore.putKnowledge(mapKo, mapIdemKey);
  }

  /**
   * Incrementally synchronizes all indexable files in a `ProjectRootRecord`.
   * Unchanged files (matching SHA-256 contentHash) are skipped completely.
   */
  public async syncProjectRoot(
    sessionId: string,
    root: ProjectRootRecord
  ): Promise<CodebaseSyncResult> {
    const pmuId = deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);
    await ensureDir(this.manifestBaseDir);

    return await withLock(this.manifestBaseDir, async () => {
      await this.ensureUniverse(sessionId, pmuId);
      const manifest = await this.loadManifest(sessionId, root, pmuId);
      const diskFiles = await this.collectIndexableFiles(root.path);
      const diskRelSet = new Set(
        diskFiles.map((f) => path.relative(root.path, f).replace(/\\/g, '/'))
      );

      let addedCount = 0;
      let updatedCount = 0;
      let removedCount = 0;
      let unchangedCount = 0;
      const changedRecords: IndexedFileRecord[] = [];
      const affectedDirs = new Set<string>();

      for (const fullPath of diskFiles) {
        const res = await this.upsertFileKnowledge(sessionId, root, pmuId, fullPath, manifest);
        if (res.status === 'added') {
          addedCount++;
          if (res.record) {
            changedRecords.push(res.record);
            affectedDirs.add(res.record.directory);
          }
        } else if (res.status === 'updated') {
          updatedCount++;
          if (res.record) {
            changedRecords.push(res.record);
            affectedDirs.add(res.record.directory);
          }
        } else {
          unchangedCount++;
        }
      }

      // Archive deleted files
      for (const [relPath, oldRec] of Object.entries(manifest.files)) {
        if (!diskRelSet.has(relPath)) {
          removedCount++;
          affectedDirs.add(oldRec.directory);
          const existingKo = await this.pkuStore.getKnowledge(oldRec.knowledgeId);
          if (existingKo && existingKo.lifecycleStatus !== 'archived') {
            await this.pkuStore.putKnowledge(
              {
                ...existingKo,
                lifecycleStatus: 'archived',
                updatedAt: new Date().toISOString(),
              },
              deriveIdempotencyKey({
                sourceSystem: 'almudaya.codebase',
                scopeId: sessionId,
                sourceType: 'codebase.file_archived',
                sourceRecordId: `${root.root_id}:${relPath}`,
                contentHash: `${oldRec.contentHash}:archived`,
              })
            );
          }
          delete manifest.files[relPath];
        }
      }

      if (changedRecords.length > 0 || removedCount > 0) {
        for (const rec of changedRecords) {
          await this.updateRelationsForFile(sessionId, pmuId, rec, manifest);
        }
        await this.upsertModuleAndProjectSummaries(sessionId, root, pmuId, manifest, affectedDirs);
        await this.saveManifest(manifest);
      }

      return {
        rootId: root.root_id,
        addedCount,
        updatedCount,
        removedCount,
        unchangedCount,
        totalIndexedFiles: Object.keys(manifest.files).length,
      };
    });
  }

  /**
   * Incrementally indexes ONLY a single modified/created file without scanning or
   * re-converting the rest of the project.
   */
  public async indexSingleFile(
    sessionId: string,
    root: ProjectRootRecord,
    filePath: string
  ): Promise<{ updated: boolean; relativePath: string }> {
    const pmuId = deriveProjectUniverseId(`session_${sessionId.toLowerCase()}`);
    await ensureDir(this.manifestBaseDir);

    return await withLock(this.manifestBaseDir, async () => {
      await this.ensureUniverse(sessionId, pmuId);
      const manifest = await this.loadManifest(sessionId, root, pmuId);
      const res = await this.upsertFileKnowledge(sessionId, root, pmuId, filePath, manifest);
      const relPath = path.relative(root.path, filePath).replace(/\\/g, '/');

      if (res.status === 'unchanged' || !res.record) {
        return { updated: false, relativePath: relPath };
      }

      await this.updateRelationsForFile(sessionId, pmuId, res.record, manifest);
      await this.upsertModuleAndProjectSummaries(
        sessionId,
        root,
        pmuId,
        manifest,
        new Set([res.record.directory])
      );
      await this.saveManifest(manifest);

      return { updated: true, relativePath: relPath };
    });
  }
}

export function createCodebaseIndexerForStorage(
  storage: IBlackboardStorage,
  pkuStore?: IPKUStore
): ProjectCodebaseIndexer | null {
  const workspaceRoot = (storage as { workspaceRoot?: unknown }).workspaceRoot;
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim().length === 0) {
    return null;
  }
  const pkuRootDir = path.join(workspaceRoot, 'pku');
  if (!pkuStore) {
    return null;
  }
  return new ProjectCodebaseIndexer(pkuStore, pkuRootDir);
}
