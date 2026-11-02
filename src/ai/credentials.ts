import process from 'node:process';
import { AlmudayaError } from '../core/errors.js';

export class MissingApiKeyError extends AlmudayaError {
  constructor(providerId: string, envVarName: string) {
    super(
      `API key for provider '${providerId}' not found. Please set environment variable '${envVarName}'.`
    );
  }
}

export interface CredentialOptions {
  providerId: string;
  customEnvVar?: string;
  explicitKey?: string;
}

/**
 * Returns the default environment variable name for a given AI provider.
 */
export function getDefaultEnvVarName(providerId: string): string {
  switch (providerId.toLowerCase()) {
    case 'gemini':
    case 'google':
      return 'GEMINI_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'anthropic':
    case 'claude':
      return 'ANTHROPIC_API_KEY';
    default:
      return `${providerId.toUpperCase()}_API_KEY`;
  }
}

/**
 * Resolves the API key for a provider following strict security isolation:
 * 1. Explicit key argument (memory-only)
 * 2. Custom environment variable if specified
 * 3. Default environment variable (e.g. GEMINI_API_KEY)
 *
 * Throws MissingApiKeyError if no key is present.
 */
export function resolveApiKey(options: CredentialOptions): string {
  if (options.explicitKey && options.explicitKey.trim().length > 0) {
    return options.explicitKey.trim();
  }

  const envVar = options.customEnvVar ?? getDefaultEnvVarName(options.providerId);
  const key = process.env[envVar];

  if (!key || key.trim().length === 0) {
    throw new MissingApiKeyError(options.providerId, envVar);
  }

  return key.trim();
}

/**
 * Safely masks an API key for diagnostic and log outputs (e.g. "AIzaSy...****3aBc").
 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 8) {
    return '****';
  }
  const prefix = key.slice(0, 6);
  const suffix = key.slice(-4);
  return `${prefix}...****${suffix}`;
}
