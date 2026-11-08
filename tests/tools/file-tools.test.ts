import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  executeReadFile,
  executeWriteFile,
  executeEditFile,
  executeListDir,
  executeSearchFiles,
  executeFileTool,
  FILE_TOOLS,
  FileAlreadyExistsError,
  TargetNotFoundError
} from '../../src/tools/file-tools.js';
import { PathTraversalSecurityError } from '../../src/tools/sandbox.js';

describe('Project Root File Tools (FR-206..210)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = path.join(
      os.tmpdir(),
      `almudaya_file_tools_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(projectRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe('read_file (FR-206)', () => {
    it('should read the entire text file content', async () => {
      const filePath = path.join(projectRoot, 'hello.txt');
      await fs.writeFile(filePath, 'Hello Almudaya\nLine 2\nLine 3', 'utf8');

      const res = await executeReadFile([projectRoot], { path: 'hello.txt' });
      expect(res.content).toBe('Hello Almudaya\nLine 2\nLine 3');
      expect(res.totalLines).toBe(3);
      expect(res.startLine).toBe(1);
      expect(res.endLine).toBe(3);
    });

    it('should read with line range slicing (1-based)', async () => {
      const filePath = path.join(projectRoot, 'numbers.txt');
      const lines = ['one', 'two', 'three', 'four', 'five'].join('\n');
      await fs.writeFile(filePath, lines, 'utf8');

      const res = await executeReadFile([projectRoot], {
        path: 'numbers.txt',
        start_line: 2,
        end_line: 4
      });
      expect(res.content).toBe('two\nthree\nfour');
      expect(res.startLine).toBe(2);
      expect(res.endLine).toBe(4);
      expect(res.totalLines).toBe(5);
    });

    it('should throw when trying to read outside project root', async () => {
      await expect(
        executeReadFile([projectRoot], { path: '../../secret.env' })
      ).rejects.toThrow(PathTraversalSecurityError);
    });

    it('should throw when target path is a directory', async () => {
      const subDir = path.join(projectRoot, 'sub');
      await fs.mkdir(subDir, { recursive: true });

      await expect(
        executeReadFile([projectRoot], { path: 'sub' })
      ).rejects.toThrow(/is a directory/);
    });
  });

  describe('write_file (FR-207)', () => {
    it('should create new file and create parent directories recursively', async () => {
      const res = await executeWriteFile([projectRoot], {
        path: 'src/components/Button.tsx',
        content: 'export const Button = () => <button>Click</button>;'
      });

      expect(res.created).toBe(true);
      expect(res.path).toBe('src/components/Button.tsx');
      expect(res.bytesWritten).toBeGreaterThan(0);

      const saved = await fs.readFile(
        path.join(projectRoot, 'src/components/Button.tsx'),
        'utf8'
      );
      expect(saved).toBe('export const Button = () => <button>Click</button>;');
    });

    it('should fail if file already exists and overwrite is false', async () => {
      await executeWriteFile([projectRoot], {
        path: 'test.txt',
        content: 'Initial'
      });

      await expect(
        executeWriteFile([projectRoot], {
          path: 'test.txt',
          content: 'New content',
          overwrite: false
        })
      ).rejects.toThrow(FileAlreadyExistsError);
    });

    it('should successfully overwrite file if overwrite is true', async () => {
      await executeWriteFile([projectRoot], {
        path: 'test.txt',
        content: 'Initial'
      });

      const res = await executeWriteFile([projectRoot], {
        path: 'test.txt',
        content: 'Replaced content',
        overwrite: true
      });

      expect(res.created).toBe(false);
      const saved = await fs.readFile(path.join(projectRoot, 'test.txt'), 'utf8');
      expect(saved).toBe('Replaced content');
    });

    it('should reject write outside project root', async () => {
      await expect(
        executeWriteFile([projectRoot], {
          path: '../escape.txt',
          content: 'malicious'
        })
      ).rejects.toThrow(PathTraversalSecurityError);
    });
  });

  describe('edit_file (FR-208)', () => {
    it('should perform exact string replacement in target file', async () => {
      const filePath = path.join(projectRoot, 'config.ts');
      await fs.writeFile(
        filePath,
        'export const PORT = 3000;\nexport const HOST = "localhost";\n',
        'utf8'
      );

      const res = await executeEditFile([projectRoot], {
        path: 'config.ts',
        target: 'export const PORT = 3000;',
        replacement: 'export const PORT = 8080;'
      });

      expect(res.occurrencesReplaced).toBe(1);

      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toBe(
        'export const PORT = 8080;\nexport const HOST = "localhost";\n'
      );
    });

    it('should throw TargetNotFoundError if target snippet is not found', async () => {
      const filePath = path.join(projectRoot, 'app.ts');
      await fs.writeFile(filePath, 'console.log("hello");', 'utf8');

      await expect(
        executeEditFile([projectRoot], {
          path: 'app.ts',
          target: 'console.log("non-existent");',
          replacement: 'console.log("world");'
        })
      ).rejects.toThrow(TargetNotFoundError);
    });

    it('should replace multiple exact occurrences', async () => {
      const filePath = path.join(projectRoot, 'multi.txt');
      await fs.writeFile(filePath, 'foo bar foo baz foo', 'utf8');

      const res = await executeEditFile([projectRoot], {
        path: 'multi.txt',
        target: 'foo',
        replacement: 'qux'
      });

      expect(res.occurrencesReplaced).toBe(3);
      const content = await fs.readFile(filePath, 'utf8');
      expect(content).toBe('qux bar qux baz qux');
    });
  });

  describe('list_dir & search_files (FR-209)', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(projectRoot, 'src/utils'), { recursive: true });
      await fs.mkdir(path.join(projectRoot, 'node_modules/fake-lib'), {
        recursive: true
      });
      await fs.mkdir(path.join(projectRoot, '.git/refs'), { recursive: true });

      await fs.writeFile(
        path.join(projectRoot, 'src/index.ts'),
        'import { helper } from "./utils/helper";\nconsole.log("main");'
      );
      await fs.writeFile(
        path.join(projectRoot, 'src/utils/helper.ts'),
        'export function helper() { return "almudaya_test"; }'
      );
      await fs.writeFile(
        path.join(projectRoot, 'node_modules/fake-lib/index.js'),
        'secret'
      );
    });

    it('should list directory entries and ignore node_modules and .git', async () => {
      const res = await executeListDir([projectRoot], { recursive: true });

      const paths = res.entries.map((e) => e.path);
      expect(paths).toContain('src');
      expect(paths).toContain('src/index.ts');
      expect(paths).toContain('src/utils');
      expect(paths).toContain('src/utils/helper.ts');

      // node_modules and .git must be ignored
      const hasNodeModules = paths.some((p) => p.includes('node_modules'));
      const hasGit = paths.some((p) => p.includes('.git'));
      expect(hasNodeModules).toBe(false);
      expect(hasGit).toBe(false);
    });

    it('should search files by name and content pattern', async () => {
      const res = await executeSearchFiles([projectRoot], {
        pattern: 'almudaya_test'
      });

      expect(res.matches.length).toBeGreaterThanOrEqual(1);
      const match = res.matches.find((m) => m.path === 'src/utils/helper.ts');
      expect(match).toBeDefined();
      expect(match?.line).toBe(1);
      expect(match?.matchText).toContain('almudaya_test');
    });
  });

  describe('executeFileTool Dispatcher & Tool Definitions', () => {
    it('should dispatch read_file correctly', async () => {
      await fs.writeFile(path.join(projectRoot, 'sample.txt'), 'Sample line');
      const res = (await executeFileTool([projectRoot], 'read_file', {
        path: 'sample.txt'
      })) as { content: string };
      expect(res.content).toBe('Sample line');
    });

    it('should throw for unknown file tool', async () => {
      await expect(
        executeFileTool([projectRoot], 'delete_everything', {})
      ).rejects.toThrow(/Unknown file tool/);
    });

    it('should export all 5 standard tool definitions conforming to ToolDefinition schema', () => {
      expect(FILE_TOOLS.length).toBe(5);
      const names = FILE_TOOLS.map((t) => t.name);
      expect(names).toEqual([
        'read_file',
        'write_file',
        'edit_file',
        'list_dir',
        'search_files'
      ]);

      for (const tool of FILE_TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters.type).toBe('object');
        expect(tool.parameters.properties).toBeDefined();
      }
    });
  });

  describe('AUD-17: Hardlink & TOCTOU Defense (FR-206..208)', () => {
    let outsideDir: string;

    beforeEach(async () => {
      outsideDir = path.join(
        os.tmpdir(),
        `almudaya_outside_test_${Date.now()}_${Math.random().toString(36).slice(2)}`
      );
      await fs.mkdir(outsideDir, { recursive: true });
    });

    afterEach(async () => {
      try {
        await fs.rm(outsideDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    it('should break hard links on write_file, preserving external file content', async () => {
      const outsideFile = path.join(outsideDir, 'sensitive_external.txt');
      await fs.writeFile(outsideFile, 'CRITICAL_OUTSIDE_SECRET', 'utf8');

      const insideFile = path.join(projectRoot, 'linked_target.txt');
      await fs.link(outsideFile, insideFile);

      const beforeStat = await fs.stat(insideFile);
      expect(beforeStat.nlink).toBeGreaterThan(1);

      // Overwrite the linked file inside the sandbox
      const res = await executeWriteFile([projectRoot], {
        path: 'linked_target.txt',
        content: 'COMPLETELY_NEW_SANDBOX_CONTENT',
        overwrite: true
      });
      expect(res.bytesWritten).toBeGreaterThan(0);

      // Verify sandbox file has the new content
      const insideContent = await fs.readFile(insideFile, 'utf8');
      expect(insideContent).toBe('COMPLETELY_NEW_SANDBOX_CONTENT');

      // Verify outside file was NOT modified (hard link broken)
      const outsideContent = await fs.readFile(outsideFile, 'utf8');
      expect(outsideContent).toBe('CRITICAL_OUTSIDE_SECRET');

      const afterStat = await fs.stat(insideFile);
      expect(afterStat.nlink).toBe(1);
    });

    it('should break hard links on edit_file, preserving external file content', async () => {
      const outsideFile = path.join(outsideDir, 'shared_external.txt');
      await fs.writeFile(outsideFile, 'const DB_PASS = "supersecret";', 'utf8');

      const insideFile = path.join(projectRoot, 'shared_link.txt');
      await fs.link(outsideFile, insideFile);

      // Edit the linked file inside the sandbox
      const res = await executeEditFile([projectRoot], {
        path: 'shared_link.txt',
        target: '"supersecret"',
        replacement: '"hacked_replacement"'
      });
      expect(res.occurrencesReplaced).toBe(1);

      // Verify sandbox file has the edited content
      const insideContent = await fs.readFile(insideFile, 'utf8');
      expect(insideContent).toBe('const DB_PASS = "hacked_replacement";');

      // Verify outside file was NOT modified
      const outsideContent = await fs.readFile(outsideFile, 'utf8');
      expect(outsideContent).toBe('const DB_PASS = "supersecret";');
    });

    it('should read file via file descriptor successfully', async () => {
      const filePath = path.join(projectRoot, 'descriptor_read.txt');
      await fs.writeFile(filePath, 'Descriptor content\nLine 2', 'utf8');

      const res = await executeReadFile([projectRoot], { path: 'descriptor_read.txt' });
      expect(res.content).toBe('Descriptor content\nLine 2');
      expect(res.totalLines).toBe(2);
    });
  });
});
