import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { CorruptedDataError, ValidationError } from './errors.js';
import type { ZodType, ZodError } from 'zod';

/**
 * Ensures a directory exists, creating parents recursively.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Checks if a file or directory exists.
 */
export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically writes data to a file by writing to a temporary file first,
 * then renaming it to the target path. Includes retry logic for Windows
 * transient file handle lockups (EPERM / EBUSY).
 */
export async function atomicWriteJson(targetPath: string, data: unknown): Promise<void> {
  const dir = path.dirname(targetPath);
  await ensureDir(dir);

  const serialized = JSON.stringify(data, null, 2);
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${randomSuffix}.tmp`;

  try {
    await fs.writeFile(tempPath, serialized, 'utf-8');

    // Windows atomic rename retry loop for transient locks
    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      try {
        await fs.rename(tempPath, targetPath);
        return;
      } catch (err: unknown) {
        attempts++;
        const code = (err as { code?: string })?.code;
        if ((code === 'EPERM' || code === 'EBUSY') && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempts * 25));
          continue;
        }
        throw err;
      }
    }
  } catch (error) {
    try {
      if (await pathExists(tempPath)) {
        await fs.unlink(tempPath);
      }
    } catch {
      // Ignore cleanup error to preserve primary error
    }
    throw error;
  }
}

/**
 * Reads a JSON file and validates its schema using a Zod validator.
 * Throws CorruptedDataError if the file is invalid JSON or fails schema validation.
 */
export async function readJsonValidated<T>(filePath: string, schema: ZodType<T>): Promise<T> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'ENOENT') {
      throw err;
    }
    throw new CorruptedDataError(filePath, (err as Error).message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err: unknown) {
    throw new CorruptedDataError(filePath, `Invalid JSON syntax: ${(err as Error).message}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const zodError = result.error as ZodError;
    const issues = zodError.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ValidationError(`Schema validation failed for "${filePath}": ${issues}`);
  }

  return result.data;
}
