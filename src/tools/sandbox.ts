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
 * Normalizes an absolute filesystem path for deterministic comparison.
 * On Windows, normalizes drive letters and case insensitivity.
 */
export function normalizeFsPath(rawPath: string): string {
  const resolved = path.resolve(rawPath);
  if (process.platform === 'win32') {
    // Standardize drive letter to uppercase on Windows (e.g. "d:\" -> "D:\")
    if (/^[a-zA-Z]:/.test(resolved)) {
      return resolved.charAt(0).toUpperCase() + resolved.slice(1);
    }
  }
  return resolved;
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

  // Check if resolved path falls inside ANY registered root
  const isInside = normalizedRoots.some((root) => isPathInsideRoot(root, resolved));

  if (!isInside) {
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
  return normFull.replace(/\\/g, '/');
}
