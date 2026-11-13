import { GeminiProvider } from './gemini.js';
import {
  OpenAICompatibleProvider,
  resolveProviderBaseUrl,
} from './openai-compatible.js';
import type { IAIModelProvider } from './provider.js';

export type CatalogProviderId = '9router' | 'openrouter' | 'gemini';

export interface ModelCatalogEntry {
  id: string;
  name: string;
  provider: CatalogProviderId;
  tier: 'router' | 'free' | 'byok';
  requiresApiKey: boolean;
  baseUrl?: string;
  description?: string;
}

export interface DiscoverModelsOptions {
  provider?: CatalogProviderId | 'all';
  nineRouterBaseUrl?: string;
  openRouterBaseUrl?: string;
  includeLiveDiscovery?: boolean;
  timeoutMs?: number;
}

export const BUILTIN_MODEL_CATALOG: ModelCatalogEntry[] = [
  // OpenRouter Free (:free) coding & reasoning models
  {
    id: 'deepseek/deepseek-chat-v3-0324:free',
    name: 'DeepSeek V3 0324 (Free)',
    provider: 'openrouter',
    tier: 'free',
    requiresApiKey: true,
    description: 'OpenRouter free coding & general reasoning model',
  },
  {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1 (Free)',
    provider: 'openrouter',
    tier: 'free',
    requiresApiKey: true,
    description: 'OpenRouter free deep reasoning model',
  },
  {
    id: 'qwen/qwen3-coder:free',
    name: 'Qwen3 Coder (Free)',
    provider: 'openrouter',
    tier: 'free',
    requiresApiKey: true,
    description: 'OpenRouter free code generation & audit model',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B Instruct (Free)',
    provider: 'openrouter',
    tier: 'free',
    requiresApiKey: true,
    description: 'OpenRouter free general instruction model',
  },
  {
    id: 'mistralai/mistral-small-3.1-24b-instruct:free',
    name: 'Mistral Small 3.1 24B (Free)',
    provider: 'openrouter',
    tier: 'free',
    requiresApiKey: true,
    description: 'OpenRouter free fast instruction & tool-calling model',
  },
  {
    id: 'google/gemma-3-27b-it:free',
    name: 'Gemma 3 27B IT (Free)',
    provider: 'openrouter',
    tier: 'free',
    requiresApiKey: true,
    description: 'OpenRouter free Google open-weights model',
  },
  // Google Gemini models
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    tier: 'byok',
    requiresApiKey: true,
    description: 'Fast multimodal & tool-calling Gemini model',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'gemini',
    tier: 'byok',
    requiresApiKey: true,
    description: 'High-capability Gemini model for complex architecture & audits',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'gemini',
    tier: 'byok',
    requiresApiKey: true,
    description: 'Lightweight Gemini Flash model',
  },
];

async function fetchOpenAIModelsEndpoint(
  baseUrl: string,
  timeoutMs: number
): Promise<Array<{ id: string; name?: string; pricing?: { prompt?: string; completion?: string } }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const payload = (await res.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    if (!Array.isArray(payload.data)) return [];
    return payload.data
      .filter((m): m is { id: string; name?: string; pricing?: { prompt?: string; completion?: string } } =>
        typeof m.id === 'string' && m.id.trim().length > 0
      );
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discovers available AI models across 9router (live local/remote router),
 * OpenRouter (`:free` models), and Gemini. Never throws if remote/local endpoints are offline.
 */
export async function discoverModels(
  options: DiscoverModelsOptions = {}
): Promise<ModelCatalogEntry[]> {
  const filter = options.provider ?? 'all';
  const timeoutMs = options.timeoutMs ?? 1800;
  const includeLive = options.includeLiveDiscovery ?? true;
  const entries: ModelCatalogEntry[] = [];
  const seen = new Set<string>();

  const pushUnique = (entry: ModelCatalogEntry) => {
    const key = `${entry.provider}:${entry.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  // 1. 9router live discovery (no API key required)
  if ((filter === 'all' || filter === '9router') && includeLive) {
    const nineRouterUrl = resolveProviderBaseUrl('9router', options.nineRouterBaseUrl);
    const live9Router = await fetchOpenAIModelsEndpoint(nineRouterUrl, timeoutMs);
    for (const m of live9Router) {
      pushUnique({
        id: m.id,
        name: m.name ?? m.id,
        provider: '9router',
        tier: 'router',
        requiresApiKey: false,
        baseUrl: nineRouterUrl,
        description: `9router live model (${nineRouterUrl})`,
      });
    }
  }

  // 2. OpenRouter live free discovery (falls back to curated built-ins)
  if (filter === 'all' || filter === 'openrouter') {
    if (includeLive) {
      const openRouterUrl = resolveProviderBaseUrl('openrouter', options.openRouterBaseUrl);
      const liveOpenRouter = await fetchOpenAIModelsEndpoint(openRouterUrl, timeoutMs);
      for (const m of liveOpenRouter) {
        const isFree =
          m.id.endsWith(':free') ||
          (m.pricing?.prompt === '0' && m.pricing?.completion === '0');
        if (!isFree) continue;
        pushUnique({
          id: m.id,
          name: m.name ?? m.id,
          provider: 'openrouter',
          tier: 'free',
          requiresApiKey: true,
          baseUrl: openRouterUrl,
          description: 'OpenRouter live free model',
        });
      }
    }

    for (const item of BUILTIN_MODEL_CATALOG) {
      if (item.provider === 'openrouter') {
        pushUnique(item);
      }
    }
  }

  // 3. Gemini models
  if (filter === 'all' || filter === 'gemini') {
    for (const item of BUILTIN_MODEL_CATALOG) {
      if (item.provider === 'gemini') {
        pushUnique(item);
      }
    }
  }

  return entries;
}

export function inferProviderForModel(
  modelId: string,
  catalog: ModelCatalogEntry[] = BUILTIN_MODEL_CATALOG
): CatalogProviderId {
  const matched = catalog.find((m) => m.id === modelId);
  if (matched) {
    return matched.provider;
  }
  if (modelId.startsWith('gemini-')) {
    return 'gemini';
  }
  if (modelId.includes(':free') || modelId.includes('/')) {
    return 'openrouter';
  }
  return '9router';
}

export function createAIProvider(params: {
  provider: CatalogProviderId;
  modelName: string;
  apiKey?: string;
  baseUrl?: string;
}): IAIModelProvider {
  if (params.provider === 'gemini') {
    return new GeminiProvider({
      apiKey: params.apiKey,
      modelName: params.modelName,
    });
  }

  return new OpenAICompatibleProvider({
    providerId: params.provider,
    modelName: params.modelName,
    apiKey: params.apiKey,
    baseUrl: params.baseUrl,
  });
}
