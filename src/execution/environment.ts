import path from 'node:path';
import process from 'node:process';

/**
 * Standard allowlist of system environment variable names deemed safe for subprocess execution.
 * Any key matching sensitive patterns (e.g. KEY, SECRET, TOKEN, AUTH) is excluded even if in this list.
 */
export const SAFE_ENV_ALLOWLIST = new Set<string>([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TERM',
  'LANG',
  'LC_ALL',
  'USER',
  'USERNAME',
  'LOGNAME',
  'SHELL',
  'COMPUTERNAME',
  'USERDOMAIN',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'CI',
  'FORCE_COLOR',
]);

/**
 * Dangerous variables that can alter interpreter runtime semantics, hijack library loading,
 * or load arbitrary code into child processes. These are unconditionally stripped from host inheritance.
 */
export const DANGEROUS_ENV_VARS = new Set<string>([
  'PYTHONPATH',
  'PYTHONHOME',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PERL5LIB',
  'PERLLIB',
  'RUBYOPT',
  'RUBYLIB',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'BASH_ENV',
  'ENV',
]);

/**
 * Regex patterns identifying secret, credential, token, or authentication keys.
 */
export const SENSITIVE_KEY_PATTERNS = [
  /KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /AUTH/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
  /PRIVATE/i,
  /CERT/i,
];

/**
 * Global dynamic secret registry for centralized output redaction.
 */
const dynamicSecretRegistry = new Set<string>();

export function registerSecret(secret: string): void {
  if (secret && typeof secret === 'string' && secret.trim().length >= 6) {
    dynamicSecretRegistry.add(secret.trim());
  }
}

export function unregisterSecret(secret: string): void {
  dynamicSecretRegistry.delete(secret);
}

export function clearRegisteredSecrets(): void {
  dynamicSecretRegistry.clear();
}

/**
 * Sanitizes PATH to exclude relative path components (e.g. '.', './bin')
 * which can cause DLL or binary hijacking during command execution.
 */
export function sanitizePath(rawPath?: string): string {
  if (!rawPath) return '';
  const delimiter = path.delimiter;
  const segments = rawPath.split(delimiter);
  const safeSegments = segments.filter((seg) => {
    const trimmed = seg.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..') return false;
    // Only accept absolute filesystem paths
    return path.isAbsolute(trimmed);
  });
  return safeSegments.join(delimiter);
}

/**
 * Validates and canonicalizes COMSPEC on Windows to ensure it points to the genuine system cmd.exe.
 */
export function sanitizeComspec(rawComspec?: string): string {
  if (process.platform !== 'win32') return rawComspec ?? '';
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
  const defaultCmd = path.join(systemRoot, 'System32', 'cmd.exe');

  if (!rawComspec) return defaultCmd;

  const normalized = path.normalize(rawComspec).toLowerCase();
  const validSys32 = path.normalize(path.join(systemRoot, 'System32', 'cmd.exe')).toLowerCase();
  const validSysWow = path.normalize(path.join(systemRoot, 'SysWOW64', 'cmd.exe')).toLowerCase();

  if (normalized === validSys32 || normalized === validSysWow) {
    return rawComspec;
  }

  return defaultCmd;
}

/**
 * Redacts any detected secrets (Gemini keys, GitHub tokens, Anthropic/OpenAI keys, Bearer tokens, URLs with credentials,
 * and dynamically registered secrets) from logs, exceptions, outputs, and persisted records.
 */
export function redactSecrets(text: string, customSecrets: string[] = []): string {
  if (!text || typeof text !== 'string') return text;

  let redacted = text
    // Google / Gemini API keys
    .replace(/AIzaSy[a-zA-Z0-9_\-]{25,}/g, '[REDACTED_API_KEY]')
    .replace(/AQ\.[a-zA-Z0-9_\-]{25,}/g, '[REDACTED_API_KEY]')
    // Anthropic API keys
    .replace(/sk-ant-[a-zA-Z0-9_\-]{20,}/g, '[REDACTED_API_KEY]')
    // OpenAI API keys
    .replace(/sk-[a-zA-Z0-9_\-]{20,}/g, '[REDACTED_API_KEY]')
    // GitHub Personal Access Tokens and OAuth
    .replace(/ghp_[a-zA-Z0-9]{30,}/g, '[REDACTED_TOKEN]')
    .replace(/github_pat_[a-zA-Z0-9_]{30,}/g, '[REDACTED_TOKEN]')
    .replace(/gho_[a-zA-Z0-9]{30,}/g, '[REDACTED_TOKEN]')
    // GitLab tokens
    .replace(/glpat-[a-zA-Z0-9_\-]{20,}/g, '[REDACTED_TOKEN]')
    // Slack tokens
    .replace(/xox[baprs]-[a-zA-Z0-9_\-]{10,}/g, '[REDACTED_TOKEN]')
    // Bearer tokens
    .replace(/(Bearer\s+)[a-zA-Z0-9\-_\.]{20,}/gi, '$1[REDACTED_BEARER_TOKEN]')
    // Basic Auth embedded in URLs
    .replace(/(https?:\/\/[^\s:@]+:)[^\s:@]+(@)/gi, '$1[REDACTED_PASSWORD]$2');

  // Redact all dynamically registered secrets
  const allSecrets = [...dynamicSecretRegistry, ...customSecrets];
  for (const secret of allSecrets) {
    if (secret && secret.length >= 6) {
      redacted = redacted.replaceAll(secret, '[REDACTED_SECRET]');
    }
  }

  return redacted;
}

/**
 * Recursively redacts secrets from any data structure (strings, arrays, nested objects).
 * Central recursive redaction boundary enforcing REQ-07.
 */
export function redactRecursively<T>(value: T, customSecrets: string[] = []): T {
  if (typeof value === 'string') {
    return redactSecrets(value, customSecrets) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactRecursively(item, customSecrets)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      sanitized[k] = redactRecursively(v, customSecrets);
    }
    return sanitized as unknown as T;
  }
  return value;
}

export interface EnvironmentBuilderOptions {
  baseEnv?: NodeJS.ProcessEnv;
  allowlist?: Set<string>;
  approvedVars?: Record<string, string>;
  secrets?: Record<string, string>;
  executionSpecific?: Record<string, string>;
}

/**
 * Dedicated Execution Environment Builder (SEC-01).
 * Separates base runtime, approved variables, injected secrets, and execution-specific variables.
 */
export class ExecutionEnvironmentBuilder {
  private baseEnv: NodeJS.ProcessEnv;
  private allowlist: Set<string>;
  private approvedVars: Record<string, string> = {};
  private injectedSecrets: Record<string, string> = {};
  private executionSpecific: Record<string, string> = {};

  constructor(options: EnvironmentBuilderOptions = {}) {
    this.baseEnv = options.baseEnv ?? process.env;
    this.allowlist = options.allowlist ?? SAFE_ENV_ALLOWLIST;
    if (options.approvedVars) this.approvedVars = { ...options.approvedVars };
    if (options.secrets) this.injectedSecrets = { ...options.secrets };
    if (options.executionSpecific) this.executionSpecific = { ...options.executionSpecific };
  }

  public withApprovedVar(key: string, value: string): this {
    this.approvedVars[key] = value;
    return this;
  }

  public withSecret(key: string, secretValue: string): this {
    this.injectedSecrets[key] = secretValue;
    registerSecret(secretValue);
    return this;
  }

  public withExecutionSpecific(key: string, value: string): this {
    this.executionSpecific[key] = value;
    return this;
  }

  public build(): NodeJS.ProcessEnv {
    const cleanEnv: NodeJS.ProcessEnv = {};

    // 1. Process base runtime variables from host
    for (const [key, value] of Object.entries(this.baseEnv)) {
      if (value === undefined) continue;

      const upperKey = key.toUpperCase();

      // Disallow dangerous runtime variables unconditionally
      if (DANGEROUS_ENV_VARS.has(upperKey)) {
        continue;
      }

      // Check allowlist
      if (!this.allowlist.has(upperKey)) {
        continue;
      }

      // Disallow sensitive keys
      if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(key))) {
        continue;
      }

      // Apply variable-specific sanitizers
      if (upperKey === 'PATH') {
        cleanEnv[key] = sanitizePath(value);
      } else if (upperKey === 'COMSPEC') {
        cleanEnv[key] = sanitizeComspec(value);
      } else {
        cleanEnv[key] = value;
      }
    }

    // 2. Overlay approved variables
    for (const [key, value] of Object.entries(this.approvedVars)) {
      cleanEnv[key] = value;
    }

    // 3. Inject explicit secrets safely
    for (const [key, value] of Object.entries(this.injectedSecrets)) {
      cleanEnv[key] = value;
    }

    // 4. Overlay execution-specific variables
    for (const [key, value] of Object.entries(this.executionSpecific)) {
      cleanEnv[key] = value;
    }

    // 5. Ensure non-interactive deterministic execution standards
    if (!cleanEnv.FORCE_COLOR) cleanEnv.FORCE_COLOR = '0';
    if (!cleanEnv.CI) cleanEnv.CI = 'true';

    return cleanEnv;
  }
}

/**
 * Standard utility function replacing the monolithic sanitizeChildEnv in sandbox.ts.
 */
export function sanitizeChildEnv(rawEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return new ExecutionEnvironmentBuilder({ baseEnv: rawEnv }).build();
}
