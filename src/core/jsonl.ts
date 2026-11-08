import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CorruptedDataError } from './errors.js';
import { pathExists, ensureDir } from './fs-utils.js';

export interface CorruptRecordDiagnostic {
  lineNumber: number;
  rawLine: string;
  error: string;
}

export interface JsonlParseResult<T> {
  records: T[];
  corruptRecords: CorruptRecordDiagnostic[];
  totalLines: number;
  validCount: number;
}

export interface JsonlReadOptions {
  strict?: boolean;
  quarantineFilePath?: string;
  onErrorRecord?: (diagnostic: CorruptRecordDiagnostic) => void;
}

/**
 * Parses JSONL formatted text into typed schema-validated records.
 * Provides resilient parsing: isolates corrupted records, captures raw evidence,
 * and prevents a single bad record from breaking stream consumption unless strict=true.
 */
export function parseJsonl<T>(
  content: string,
  schema: z.ZodType<T>,
  sourceFilePath = 'in-memory',
  options: JsonlReadOptions = {}
): JsonlParseResult<T> {
  const lines = content.split('\n');
  const records: T[] = [];
  const corruptRecords: CorruptRecordDiagnostic[] = [];
  let totalNonEmptyLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;

    totalNonEmptyLines++;
    const lineNumber = i + 1;

    try {
      const parsedJson = JSON.parse(trimmed);
      const validated = schema.parse(parsedJson);
      records.push(validated);
    } catch (err: unknown) {
      const errorMsg = (err as Error).message;
      const diagnostic: CorruptRecordDiagnostic = {
        lineNumber,
        rawLine: trimmed,
        error: errorMsg,
      };

      corruptRecords.push(diagnostic);
      if (options.onErrorRecord) {
        options.onErrorRecord(diagnostic);
      }

      if (options.strict) {
        throw new CorruptedDataError(
          sourceFilePath,
          `Invalid JSONL record at line ${lineNumber}: ${errorMsg}`
        );
      }
    }
  }

  return {
    records,
    corruptRecords,
    totalLines: totalNonEmptyLines,
    validCount: records.length,
  };
}

/**
 * Reads and parses a JSONL file from disk with resilient per-record isolation.
 * Automatically preserves malformed raw lines to a quarantine file if specified.
 */
export async function readJsonlFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  options: JsonlReadOptions = {}
): Promise<JsonlParseResult<T>> {
  if (!(await pathExists(filePath))) {
    return {
      records: [],
      corruptRecords: [],
      totalLines: 0,
      validCount: 0,
    };
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const result = parseJsonl(content, schema, filePath, options);

  // If quarantine preservation is configured and corrupt records exist, write evidence to disk
  if (result.corruptRecords.length > 0 && options.quarantineFilePath) {
    try {
      await ensureDir(path.dirname(options.quarantineFilePath));
      const quarantineEntries = result.corruptRecords.map((c) =>
        JSON.stringify({
          source_file: filePath,
          quarantined_at: new Date().toISOString(),
          line_number: c.lineNumber,
          raw_line: c.rawLine,
          error: c.error,
        })
      );
      await fs.appendFile(options.quarantineFilePath, quarantineEntries.join('\n') + '\n', 'utf-8');
    } catch {
      // Best-effort quarantine preservation
    }
  }

  return result;
}

/**
 * Appends a validated typed record as a single JSON line to a file.
 */
export async function appendJsonlRecord<T>(
  filePath: string,
  record: T,
  schema?: z.ZodType<T>
): Promise<void> {
  const validated = schema ? schema.parse(record) : record;
  await ensureDir(path.dirname(filePath));
  const line = JSON.stringify(validated) + '\n';
  await fs.appendFile(filePath, line, 'utf-8');
}
