import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import {
  parseJsonl,
  readJsonlFile,
  appendJsonlRecord,
} from '../../src/core/jsonl.js';
import { CorruptedDataError } from '../../src/core/errors.js';

const TestItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  val: z.number(),
});
type TestItem = z.infer<typeof TestItemSchema>;

describe('Resilient JSONL Engine & Quarantine (RELIA-03)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-jsonl-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('parseJsonl', () => {
    it('should parse valid JSONL lines into typed objects', () => {
      const content = [
        JSON.stringify({ id: '1', name: 'Alpha', val: 10 }),
        JSON.stringify({ id: '2', name: 'Beta', val: 20 }),
      ].join('\n');

      const result = parseJsonl(content, TestItemSchema);
      expect(result.validCount).toBe(2);
      expect(result.corruptRecords.length).toBe(0);
      expect(result.records).toEqual([
        { id: '1', name: 'Alpha', val: 10 },
        { id: '2', name: 'Beta', val: 20 },
      ]);
    });

    it('should resiliently isolate corrupted lines while preserving valid records in default mode', () => {
      const content = [
        JSON.stringify({ id: '1', name: 'Alpha', val: 10 }),
        'THIS IS NOT VALID JSON AT ALL',
        JSON.stringify({ id: '2', name: 'Beta', val: 'INVALID_TYPE_EXPECTED_NUMBER' }),
        JSON.stringify({ id: '3', name: 'Gamma', val: 30 }),
      ].join('\n');

      const result = parseJsonl(content, TestItemSchema, 'test.jsonl', { strict: false });

      expect(result.records.length).toBe(2);
      expect(result.records[0]!.name).toBe('Alpha');
      expect(result.records[1]!.name).toBe('Gamma');

      expect(result.corruptRecords.length).toBe(2);
      expect(result.corruptRecords[0]!.lineNumber).toBe(2);
      expect(result.corruptRecords[0]!.rawLine).toBe('THIS IS NOT VALID JSON AT ALL');
      expect(result.corruptRecords[1]!.lineNumber).toBe(3);
    });

    it('should throw CorruptedDataError in strict mode upon encountering bad syntax', () => {
      const content = [
        JSON.stringify({ id: '1', name: 'Alpha', val: 10 }),
        'CORRUPT_LINE_SYNTAX',
      ].join('\n');

      expect(() => {
        parseJsonl(content, TestItemSchema, 'test.jsonl', { strict: true });
      }).toThrow(CorruptedDataError);
    });
  });

  describe('readJsonlFile & appendJsonlRecord with Quarantine', () => {
    it('should append records and read them back cleanly', async () => {
      const testFile = path.join(tmpDir, 'data.jsonl');
      await appendJsonlRecord(testFile, { id: 'item1', name: 'First', val: 100 }, TestItemSchema);
      await appendJsonlRecord(testFile, { id: 'item2', name: 'Second', val: 200 }, TestItemSchema);

      const result = await readJsonlFile(testFile, TestItemSchema);
      expect(result.validCount).toBe(2);
      expect(result.records[0]!.id).toBe('item1');
      expect(result.records[1]!.id).toBe('item2');
    });

    it('should quarantine corrupt lines to quarantineFilePath to preserve raw evidence', async () => {
      const testFile = path.join(tmpDir, 'events.jsonl');
      const quarantineFile = path.join(tmpDir, 'events.corrupt.jsonl');

      const rawContent = [
        JSON.stringify({ id: '1', name: 'Valid', val: 1 }),
        'CORRUPT_RAW_RECORD_LINE_HERE',
        JSON.stringify({ id: '2', name: 'Valid2', val: 2 }),
      ].join('\n');

      await fs.writeFile(testFile, rawContent, 'utf-8');

      const result = await readJsonlFile(testFile, TestItemSchema, {
        strict: false,
        quarantineFilePath: quarantineFile,
      });

      expect(result.validCount).toBe(2);
      expect(result.corruptRecords.length).toBe(1);

      // Verify quarantine file on disk exists and contains raw corrupt line
      const quarantineContent = await fs.readFile(quarantineFile, 'utf-8');
      const parsedQuarantine = JSON.parse(quarantineContent.trim());
      expect(parsedQuarantine.source_file).toBe(testFile);
      expect(parsedQuarantine.raw_line).toBe('CORRUPT_RAW_RECORD_LINE_HERE');
      expect(parsedQuarantine.line_number).toBe(2);
    });
  });
});
