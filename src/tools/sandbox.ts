import fs from 'node:fs';
import path from 'node:path';

/**
 * Security exception thrown whenever an agent or tool attempts
 * to access or mutate files outside registered project roots.
 * Enforces Invariant 5 (Sandbox Boundary) and FR-210.
 */
export class PathTraversalSecurityError extends Error {
  public readonly requestedPath: string;
  public readonly projectRoots: string[];

  constructor(message: string, requestedPath: string, projectRoots: string[]) {
    super(message);
    this.name = 'PathTraversalSecurityError';
    this.requestedPath = requestedPath;
    this.projectRoots = projectRoots;
  }
}

/**
 * Allowlist of standard OS environment variables safe to inherit by child processes.
 * Prevents credential exfiltration (Invariant 7, SEC-01, FR-319).
 */
export const SAFE_ENV_ALLOWLIST = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'HOME',
  'HOMEPATH',
  'HOMEDRIVE',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'SHELL',
  'NODE_ENV',
  'PYTHONPATH',
  'PYTHONHOME',
  'PROMPT',
  'PSMODULEPATH',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
  'OS',
  'CI',
  'FORCE_COLOR',
]);

const SENSITIVE_KEY_PATTERNS = [
  /KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /AUTH/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
  /PRIVATE/i,
];

/**
 * Sanitizes the environment for child processes spawned by run_command.
 * Enforces Invariant 7 (Zero credential leakage, FR-319).
 */
export function sanitizeChildEnv(rawEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const cleanEnv: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(rawEnv)) {
    if (value === undefined) continue;

    const upperKey = key.toUpperCase();

    // 1. Must be in the safe allowlist
    const isAllowlisted = SAFE_ENV_ALLOWLIST.has(upperKey);

    // 2. Must NOT match any sensitive substring pattern
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));

    if (isAllowlisted && !isSensitive) {
      cleanEnv[key] = value;
    }
  }

  // Ensure standard execution defaults
  cleanEnv.FORCE_COLOR = '0';
  cleanEnv.CI = 'true';

  return cleanEnv;
}

/**
 * Redacts any detected secrets (e.g. Gemini API keys, GitHub tokens) from command output.
 */
export function redactSensitiveOutput(text: string): string {
  if (!text) return text;
  return text
    .replace(/AIzaSy[a-zA-Z0-9_\-]{25,}/g, '[REDACTED_API_KEY]')
    .replace(/AQ\.[a-zA-Z0-9_\-]{25,}/g, '[REDACTED_API_KEY]')
    .replace(/ghp_[a-zA-Z0-9]{30,}/g, '[REDACTED_TOKEN]')
    .replace(/github_pat_[a-zA-Z0-9_]{30,}/g, '[REDACTED_TOKEN]');
}

/**
 * Normalizes an absolute filesystem path for deterministic comparison.
 * On Windows, normalizes drive letters, removes \\?\ prefixes, and ensures case standardization.
 */
export function normalizeFsPath(rawPath: string): string {
  let resolved = path.resolve(rawPath);
  if (resolved.startsWith('\\\\?\\')) {
    resolved = resolved.slice(4);
  }
  if (process.platform === 'win32') {
    // Standardize drive letter to uppercase on Windows (e.g. "d:\" -> "D:\")
    if (/^[a-zA-Z]:/.test(resolved)) {
      return resolved.charAt(0).toUpperCase() + resolved.slice(1);
    }
  }
  return resolved;
}

/**
 * Resolves the canonical physical path of targetPath, traversing any symbolic links
 * or Windows directory junctions. If targetPath or some subpaths do not exist yet,
 * resolves the deepest existing ancestor directory and reconstructs the path.
 * Enforces Invariant 5 & FR-320.
 */
export function getCanonicalPath(rawPath: string): string {
  const resolved = normalizeFsPath(rawPath);

  // If the path exists on disk, resolve its real physical canonical path directly
  try {
    const real = fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
    return normalizeFsPath(real);
  } catch {
    // Path doesn't exist. Find the deepest ancestor directory that exists.
    const parent = path.dirname(resolved);
    if (parent === resolved) {
      return normalizeFsPath(resolved);
    }
    const canonicalParent = getCanonicalPath(parent);
    return normalizeFsPath(path.join(canonicalParent, path.basename(resolved)));
  }
}

/**
 * Checks whether targetPath is strictly inside (or equal to) rootDirectory.
 * Handles Windows case-insensitivity and prevents root prefix collisions
 * (e.g. /app/project vs /app/project-sibling).
 */
export function isPathInsideRoot(rootDirectory: string, targetPath: string): boolean {
  const normRoot = normalizeFsPath(rootDirectory);
  const normTarget = normalizeFsPath(targetPath);

  if (process.platform === 'win32') {
    const rootLower = normRoot.toLowerCase();
    const targetLower = normTarget.toLowerCase();

    if (rootLower === targetLower) {
      return true;
    }

    const rel = path.relative(rootLower, targetLower);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  if (normRoot === normTarget) {
    return true;
  }

  const rel = path.relative(normRoot, normTarget);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Validates that requestedPath resides within at least one registered project root.
 * Resolves relative paths against the primary root (or rootHint).
 * Enforces both lexical boundary AND physical canonical realpath boundary
 * (blocking symlink & junction escape, FR-320).
 *
 * @throws PathTraversalSecurityError if the path breaches sandbox boundaries.
 * @returns The resolved, normalized, safe absolute path.
 */
export function validateSandboxedPath(
  projectRoots: string[],
  requestedPath: string,
  rootHint?: string
): string {
  if (!projectRoots || projectRoots.length === 0) {
    throw new PathTraversalSecurityError(
      'Access denied: No registered project roots configured for this session.',
      requestedPath,
      []
    );
  }

  if (!requestedPath || requestedPath.trim().length === 0) {
    throw new PathTraversalSecurityError(
      'Access denied: File path cannot be empty.',
      requestedPath,
      projectRoots
    );
  }

  const normalizedRoots = projectRoots.map((r) => normalizeFsPath(r));

  // Determine base root for relative paths
  let baseRoot = normalizedRoots[0]!;
  if (rootHint) {
    const matchedHint = normalizedRoots.find(
      (r) =>
        r.toLowerCase() === normalizeFsPath(rootHint).toLowerCase() ||
        r.toLowerCase().endsWith(rootHint.toLowerCase())
    );
    if (matchedHint) {
      baseRoot = matchedHint;
    }
  }

  const resolved = path.isAbsolute(requestedPath)
    ? normalizeFsPath(requestedPath)
    : normalizeFsPath(path.resolve(baseRoot, requestedPath));

  // Canonicalize target path (resolving any symlinks or directory junctions)
  const canonicalTarget = getCanonicalPath(resolved);

  // Canonicalize all registered project roots
  const canonicalRoots = normalizedRoots.map((r) => getCanonicalPath(r));

  // 1. Physical check: Target physical location must fall inside at least one registered root's physical location
  const isPhysicallyInside = canonicalRoots.some((root) => isPathInsideRoot(root, canonicalTarget));

  if (!isPhysicallyInside) {
    throw new PathTraversalSecurityError(
      `Access denied: Path '${requestedPath}' resolves to '${canonicalTarget}', which is outside registered project roots: [${normalizedRoots.join(', ')}].`,
      requestedPath,
      normalizedRoots
    );
  }

  // 2. Lexical check: Target lexical resolution must not escape outside registered roots via ".." or absolute path
  const isLexicallyInside =
    normalizedRoots.some((root) => isPathInsideRoot(root, resolved)) ||
    canonicalRoots.some((root) => isPathInsideRoot(root, resolved));

  if (!isLexicallyInside) {
    throw new PathTraversalSecurityError(
      `Access denied: Path '${requestedPath}' resolves to '${resolved}', which is outside registered project roots: [${normalizedRoots.join(', ')}].`,
      requestedPath,
      normalizedRoots
    );
  }

  return resolved;
}

/**
 * Converts a sandboxed full path to a clean relative path for display/logging.
 */
export function getRelativeSandboxedPath(projectRoots: string[], fullPath: string): string {
  const normFull = normalizeFsPath(fullPath);
  for (const root of projectRoots) {
    const normRoot = normalizeFsPath(root);
    if (isPathInsideRoot(normRoot, normFull)) {
      const rel = path.relative(normRoot, normFull);
      return rel ? rel.replace(/\\/g, '/') : '.';
    }
  }

  // Also try against canonical roots
  const canonicalFull = getCanonicalPath(fullPath);
  for (const root of projectRoots) {
    const canonicalRoot = getCanonicalPath(root);
    if (isPathInsideRoot(canonicalRoot, canonicalFull)) {
      const rel = path.relative(canonicalRoot, canonicalFull);
      return rel ? rel.replace(/\\/g, '/') : '.';
    }
  }

  return normFull.replace(/\\/g, '/');
}
