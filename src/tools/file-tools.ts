import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '../ai/provider.js';
import {
  validateSandboxedPath,
  getRelativeSandboxedPath
} from './sandbox.js';

export class FileAlreadyExistsError extends Error {
  constructor(filePath: string) {
    super(`File '${filePath}' already exists. Pass overwrite: true to overwrite.`);
    this.name = 'FileAlreadyExistsError';
  }
}

export class TargetNotFoundError extends Error {
  constructor(targetSnippet: string, filePath: string) {
    const preview =
      targetSnippet.length > 60
        ? `${targetSnippet.slice(0, 60)}...`
        : targetSnippet;
    super(
      `Target string not found in '${filePath}'. Target: "${preview}". Ensure exact indentation, whitespace, and line breaks match.`
    );
    this.name = 'TargetNotFoundError';
  }
}

export class FileSizeLimitExceededError extends Error {
  constructor(filePath: string, sizeBytes: number, limitBytes: number) {
    super(
      `File '${filePath}' size (${sizeBytes} bytes) exceeds safety limit (${limitBytes} bytes).`
    );
    this.name = 'FileSizeLimitExceededError';
  }
}

const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB safety limit for text reading
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.almudaya']);

export interface ReadFileArgs {
  path: string;
  start_line?: number;
  end_line?: number;
}

export interface ReadFileResult {
  path: string;
  content: string;
  totalLines: number;
  startLine: number;
  endLine: number;
}

export interface WriteFileArgs {
  path: string;
  content: string;
  overwrite?: boolean;
}

export interface WriteFileResult {
  path: string;
  bytesWritten: number;
  created: boolean;
}

export interface EditFileArgs {
  path: string;
  target: string;
  replacement: string;
}

export interface EditFileResult {
  path: string;
  occurrencesReplaced: number;
}

export interface ListDirArgs {
  path?: string;
  recursive?: boolean;
  max_depth?: number;
}

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

export interface ListDirResult {
  path: string;
  entries: DirEntry[];
}

export interface SearchFilesArgs {
  pattern: string;
  path?: string;
}

export interface SearchMatch {
  path: string;
  line?: number;
  matchText?: string;
}

export interface SearchFilesResult {
  pattern: string;
  matches: SearchMatch[];
}

/**
 * Reads the content of a text file within project roots.
 * Supports line slicing (1-indexed).
 */
export async function executeReadFile(
  projectRoots: string[],
  args: ReadFileArgs
): Promise<ReadFileResult> {
  const fullPath = validateSandboxedPath(projectRoots, args.path);
  const relPath = getRelativeSandboxedPath(projectRoots, fullPath);

  const stat = await fs.stat(fullPath);
  if (stat.isDirectory()) {
    throw new Error(`Path '${args.path}' is a directory, not a file.`);
  }

  if (stat.size > DEFAULT_MAX_FILE_SIZE_BYTES) {
    throw new FileSizeLimitExceededError(
      args.path,
      stat.size,
      DEFAULT_MAX_FILE_SIZE_BYTES
    );
  }

  const rawContent = await fs.readFile(fullPath, 'utf8');
  const lines = rawContent.split(/\r?\n/);
  const totalLines = lines.length;

  const startLine = Math.max(1, args.start_line ?? 1);
  const endLine = Math.min(totalLines, args.end_line ?? totalLines);

  const selectedLines =
    startLine > totalLines
      ? []
      : lines.slice(startLine - 1, endLine);

  return {
    path: relPath,
    content: selectedLines.join('\n'),
    totalLines,
    startLine,
    endLine
  };
}

/**
 * Atomically writes content to a file inside project roots.
 * Creates parent directories if they do not exist.
 */
export async function executeWriteFile(
  projectRoots: string[],
  args: WriteFileArgs
): Promise<WriteFileResult> {
  const fullPath = validateSandboxedPath(projectRoots, args.path);
  const relPath = getRelativeSandboxedPath(projectRoots, fullPath);

  const parentDir = path.dirname(fullPath);
  await fs.mkdir(parentDir, { recursive: true });

  const exists = existsSync(fullPath);
  if (exists && !args.overwrite) {
    throw new FileAlreadyExistsError(relPath);
  }

  // Atomic write via temporary file
  const tmpPath = path.join(parentDir, `.tmp_${randomUUID()}`);
  await fs.writeFile(tmpPath, args.content, 'utf8');

  try {
    await fs.rename(tmpPath, fullPath);
  } catch (err: unknown) {
    // On Windows, rename may fail if target file is locked or exists; fallback to replace
    try {
      await fs.copyFile(tmpPath, fullPath);
      await fs.unlink(tmpPath);
    } catch {
      // Re-throw original rename error if fallback fails
      throw err;
    }
  }

  const bytesWritten = Buffer.byteLength(args.content, 'utf8');

  return {
    path: relPath,
    bytesWritten,
    created: !exists
  };
}

/**
 * Performs exact string replacement in a sandboxed file atomically.
 */
export async function executeEditFile(
  projectRoots: string[],
  args: EditFileArgs
): Promise<EditFileResult> {
  const fullPath = validateSandboxedPath(projectRoots, args.path);
  const relPath = getRelativeSandboxedPath(projectRoots, fullPath);

  const stat = await fs.stat(fullPath);
  if (stat.isDirectory()) {
    throw new Error(`Path '${args.path}' is a directory, not a file.`);
  }

  const originalContent = await fs.readFile(fullPath, 'utf8');

  if (!originalContent.includes(args.target)) {
    throw new TargetNotFoundError(args.target, relPath);
  }

  // Count occurrences
  const occurrencesReplaced = originalContent.split(args.target).length - 1;
  const newContent = originalContent.split(args.target).join(args.replacement);

  // Write atomically
  const parentDir = path.dirname(fullPath);
  const tmpPath = path.join(parentDir, `.tmp_${randomUUID()}`);
  await fs.writeFile(tmpPath, newContent, 'utf8');

  try {
    await fs.rename(tmpPath, fullPath);
  } catch (err: unknown) {
    try {
      await fs.copyFile(tmpPath, fullPath);
      await fs.unlink(tmpPath);
    } catch {
      throw err;
    }
  }

  return {
    path: relPath,
    occurrencesReplaced
  };
}

/**
 * Lists files and directories within the sandboxed project root.
 */
export async function executeListDir(
  projectRoots: string[],
  args: ListDirArgs = {}
): Promise<ListDirResult> {
  const requested = args.path || '.';
  const fullPath = validateSandboxedPath(projectRoots, requested);
  const relRoot = getRelativeSandboxedPath(projectRoots, fullPath);

  const maxDepth = args.max_depth ?? 5;
  const entries: DirEntry[] = [];

  async function walk(currentDir: string, currentDepth: number) {
    if (currentDepth > maxDepth) return;

    let items: string[];
    try {
      items = await fs.readdir(currentDir);
    } catch {
      return;
    }

    for (const item of items) {
      if (IGNORED_DIRECTORIES.has(item)) continue;

      const itemFullPath = path.join(currentDir, item);
      let isDir = false;
      let size: number | undefined;

      try {
        const itemStat = await fs.stat(itemFullPath);
        isDir = itemStat.isDirectory();
        size = isDir ? undefined : itemStat.size;
      } catch {
        continue;
      }

      const itemRelPath = getRelativeSandboxedPath(projectRoots, itemFullPath);
      entries.push({
        name: item,
        path: itemRelPath,
        isDirectory: isDir,
        size
      });

      if (isDir && args.recursive) {
        await walk(itemFullPath, currentDepth + 1);
      }
    }
  }

  await walk(fullPath, 1);

  return {
    path: relRoot,
    entries
  };
}

/**
 * Searches file names and content matching pattern within project roots.
 */
export async function executeSearchFiles(
  projectRoots: string[],
  args: SearchFilesArgs
): Promise<SearchFilesResult> {
  const requested = args.path || '.';
  const fullPath = validateSandboxedPath(projectRoots, requested);
  const matches: SearchMatch[] = [];
  const patternLower = args.pattern.toLowerCase();

  async function searchWalk(currentDir: string, currentDepth: number) {
    if (currentDepth > 10) return;

    let items: string[];
    try {
      items = await fs.readdir(currentDir);
    } catch {
      return;
    }

    for (const item of items) {
      if (IGNORED_DIRECTORIES.has(item)) continue;

      const itemFullPath = path.join(currentDir, item);
      let isDir = false;
      let fileSize = 0;

      try {
        const itemStat = await fs.stat(itemFullPath);
        isDir = itemStat.isDirectory();
        fileSize = itemStat.size;
      } catch {
        continue;
      }

      const itemRelPath = getRelativeSandboxedPath(projectRoots, itemFullPath);

      if (isDir) {
        if (item.toLowerCase().includes(patternLower)) {
          matches.push({ path: itemRelPath });
        }
        await searchWalk(itemFullPath, currentDepth + 1);
      } else {
        // Name matches pattern?
        const nameMatches = item.toLowerCase().includes(patternLower);
        if (nameMatches) {
          matches.push({ path: itemRelPath });
        }

        // Search text content if file is <= 2MB
        if (fileSize <= 2 * 1024 * 1024) {
          try {
            const content = await fs.readFile(itemFullPath, 'utf8');
            const lines = content.split(/\r?\n/);
            lines.forEach((line, index) => {
              if (line.toLowerCase().includes(patternLower)) {
                matches.push({
                  path: itemRelPath,
                  line: index + 1,
                  matchText: line.trim().slice(0, 120)
                });
              }
            });
          } catch {
            // Ignore binary/unreadable files
          }
        }
      }
    }
  }

  await searchWalk(fullPath, 1);

  return {
    pattern: args.pattern,
    matches
  };
}

// ============================================================================
// Tool Definitions (Function Calling Schema)
// ============================================================================

export const READ_FILE_TOOL: ToolDefinition = {
  name: 'read_file',
  description:
    'Read the contents of a text file inside the sandboxed project root. Supports optional start_line and end_line for line-range reading.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path of the file to read within the project root.'
      },
      start_line: {
        type: 'number',
        description: 'Optional 1-based start line number (inclusive).'
      },
      end_line: {
        type: 'number',
        description: 'Optional 1-based end line number (inclusive).'
      }
    },
    required: ['path']
  }
};

export const WRITE_FILE_TOOL: ToolDefinition = {
  name: 'write_file',
  description:
    'Create a new file or replace the entire content of an existing file atomically inside the project root.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path of the file to write within the project root.'
      },
      content: {
        type: 'string',
        description: 'The complete text content to write into the file.'
      },
      overwrite: {
        type: 'boolean',
        description: 'Whether to overwrite an existing file (defaults to false).'
      }
    },
    required: ['path', 'content']
  }
};

export const EDIT_FILE_TOOL: ToolDefinition = {
  name: 'edit_file',
  description:
    'Replace an exact contiguous block of text with replacement text in a sandboxed file. Ensures precise surgical code edits.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path of the file to edit within the project root.'
      },
      target: {
        type: 'string',
        description:
          'Exact text block to be replaced. Must match indentation, whitespace, and line breaks precisely.'
      },
      replacement: {
        type: 'string',
        description: 'New replacement text to insert in place of the target.'
      }
    },
    required: ['path', 'target', 'replacement']
  }
};

export const LIST_DIR_TOOL: ToolDefinition = {
  name: 'list_dir',
  description:
    'List files and directories within the sandboxed project root, excluding ignored directories like node_modules and .git.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative directory path to inspect (defaults to project root ".").'
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to recursively list subdirectories (defaults to false).'
      }
    }
  }
};

export const SEARCH_FILES_TOOL: ToolDefinition = {
  name: 'search_files',
  description:
    'Search file names and file content matching a keyword pattern in the sandboxed project root.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Keyword or substring to search for.'
      },
      path: {
        type: 'string',
        description: 'Relative directory to search within (defaults to project root ".").'
      }
    },
    required: ['pattern']
  }
};

export const FILE_TOOLS: ToolDefinition[] = [
  READ_FILE_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  LIST_DIR_TOOL,
  SEARCH_FILES_TOOL
];

/**
 * Dispatches a tool execution by name to the corresponding file operation.
 */
export async function executeFileTool(
  projectRoots: string[],
  toolName: string,
  rawArgs: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case 'read_file': {
      const args: ReadFileArgs = {
        path: String(rawArgs['path'] ?? ''),
        start_line:
          typeof rawArgs['start_line'] === 'number'
            ? rawArgs['start_line']
            : undefined,
        end_line:
          typeof rawArgs['end_line'] === 'number'
            ? rawArgs['end_line']
            : undefined
      };
      return await executeReadFile(projectRoots, args);
    }

    case 'write_file': {
      const args: WriteFileArgs = {
        path: String(rawArgs['path'] ?? ''),
        content: String(rawArgs['content'] ?? ''),
        overwrite: Boolean(rawArgs['overwrite'])
      };
      return await executeWriteFile(projectRoots, args);
    }

    case 'edit_file': {
      const args: EditFileArgs = {
        path: String(rawArgs['path'] ?? ''),
        target: String(rawArgs['target'] ?? ''),
        replacement: String(rawArgs['replacement'] ?? '')
      };
      return await executeEditFile(projectRoots, args);
    }

    case 'list_dir': {
      const args: ListDirArgs = {
        path: rawArgs['path'] ? String(rawArgs['path']) : undefined,
        recursive: Boolean(rawArgs['recursive'])
      };
      return await executeListDir(projectRoots, args);
    }

    case 'search_files': {
      const args: SearchFilesArgs = {
        pattern: String(rawArgs['pattern'] ?? ''),
        path: rawArgs['path'] ? String(rawArgs['path']) : undefined
      };
      return await executeSearchFiles(projectRoots, args);
    }

    default:
      throw new Error(`Unknown file tool: '${toolName}'`);
  }
}
