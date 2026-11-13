import { RateLimitPauseError } from './provider.js';
import type {
  AIRequest,
  AIResponse,
  IAIModelProvider,
  ToolCallRequest,
  ToolDefinition,
} from './provider.js';
import { registerSecret, unregisterSecret } from '../execution/environment.js';

export type OpenAICompatibleProviderId = 'openrouter' | '9router' | 'openai-compatible';

export interface OpenAICompatibleOptions {
  providerId?: OpenAICompatibleProviderId;
  baseUrl?: string;
  apiKey?: string;
  modelName: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_9ROUTER_BASE_URL = 'http://localhost:20128/v1';

export function resolveProviderBaseUrl(
  providerId: OpenAICompatibleProviderId,
  explicitBaseUrl?: string
): string {
  if (explicitBaseUrl && explicitBaseUrl.trim().length > 0) {
    return explicitBaseUrl.trim().replace(/\/+$/, '');
  }
  if (providerId === 'openrouter') {
    return (process.env['OPENROUTER_BASE_URL'] ?? DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, '');
  }
  if (providerId === '9router') {
    return (process.env['NINEROUTER_BASE_URL'] ?? DEFAULT_9ROUTER_BASE_URL).replace(/\/+$/, '');
  }
  return (process.env['OPENAI_BASE_URL'] ?? DEFAULT_9ROUTER_BASE_URL).replace(/\/+$/, '');
}

function parseRetryAfterSeconds(headerValue: string | null): number {
  if (!headerValue) return 15;
  const numeric = Number(headerValue);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.ceil(numeric);
  }
  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) {
    const diff = Math.ceil((dateMs - Date.now()) / 1000);
    if (diff > 0) return diff;
  }
  return 15;
}

interface OpenAIMessagePayload {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

function toOpenAIMessages(request: AIRequest): OpenAIMessagePayload[] {
  const result: OpenAIMessagePayload[] = [];
  if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
    result.push({ role: 'system', content: request.systemPrompt });
  }

  for (const msg of request.messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content ?? '' });
    } else if (msg.role === 'model') {
      const payload: OpenAIMessagePayload = {
        role: 'assistant',
        content: msg.content ?? null,
      };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        payload.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments ?? {}),
          },
        }));
      }
      result.push(payload);
    } else if (msg.role === 'tool' && msg.toolResult) {
      result.push({
        role: 'tool',
        tool_call_id: msg.toolResult.toolCallId,
        name: msg.toolResult.name,
        content: JSON.stringify(
          msg.toolResult.error
            ? { error: msg.toolResult.error }
            : msg.toolResult.result ?? { ok: true }
        ),
      });
    }
  }

  return result;
}

function toOpenAITools(tools?: ToolDefinition[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * OpenAI-Compatible AI Provider supporting OpenRouter, 9router, and custom
 * `/v1/chat/completions` gateways with tool-calling, AbortSignal, and 429 handling.
 */
export class OpenAICompatibleProvider implements IAIModelProvider {
  public readonly providerId: OpenAICompatibleProviderId;
  public readonly modelName: string;
  public readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpenAICompatibleOptions) {
    this.providerId = options.providerId ?? 'openrouter';
    this.modelName = options.modelName;
    this.baseUrl = resolveProviderBaseUrl(this.providerId, options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.extraHeaders = options.headers ?? {};

    const resolvedKey =
      options.apiKey ??
      (this.providerId === 'openrouter'
        ? process.env['OPENROUTER_API_KEY']
        : this.providerId === '9router'
          ? process.env['NINEROUTER_API_KEY']
          : process.env['OPENAI_API_KEY']);

    if (resolvedKey && resolvedKey.trim().length > 0) {
      this.apiKey = resolvedKey.trim();
      registerSecret(this.apiKey);
    }
  }

  public dispose(): void {
    if (this.apiKey) {
      unregisterSecret(this.apiKey);
    }
  }

  public async generateResponse(request: AIRequest): Promise<AIResponse> {
    if (request.signal?.aborted) {
      throw new Error('Operation aborted');
    }

    if (this.providerId === 'openrouter' && !this.apiKey) {
      throw new Error(
        'OpenRouter API key is missing. Set OPENROUTER_API_KEY or switch to 9router / gemini.'
      );
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    const onExternalAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      if (this.providerId === 'openrouter') {
        headers['HTTP-Referer'] ??= 'https://github.com/elangbijak4/Almudaya-Multi-Agent';
        headers['X-Title'] ??= 'Almudaya Multi-Agent';
      }

      const body: Record<string, unknown> = {
        model: this.modelName,
        messages: toOpenAIMessages(request),
      };
      const tools = toOpenAITools(request.tools);
      if (tools) {
        body['tools'] = tools;
      }
      if (request.temperature !== undefined) {
        body['temperature'] = request.temperature;
      }
      if (request.maxTokens !== undefined) {
        body['max_tokens'] = request.maxTokens;
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 429) {
        const retrySeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
        throw new RateLimitPauseError(
          `${this.providerId} rate limit (429) for model ${this.modelName}`,
          retrySeconds
        );
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(
          `${this.providerId} request failed (${response.status}): ${errBody.slice(0, 300)}`
        );
      }

      const json = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const message = json.choices?.[0]?.message;
      const toolCalls: ToolCallRequest[] = [];
      if (message?.tool_calls && Array.isArray(message.tool_calls)) {
        for (let i = 0; i < message.tool_calls.length; i++) {
          const tc = message.tool_calls[i];
          const fnName = tc?.function?.name;
          if (!fnName) continue;
          let parsedArgs: Record<string, unknown> = {};
          if (tc.function?.arguments) {
            try {
              parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            } catch {
              parsedArgs = { raw: tc.function.arguments };
            }
          }
          toolCalls.push({
            id: tc.id ?? `call_${i}_${Date.now()}`,
            name: fnName,
            arguments: parsedArgs,
          });
        }
      }

      return {
        text: message?.content ?? undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: json.usage
          ? {
              promptTokens: json.usage.prompt_tokens,
              candidateTokens: json.usage.completion_tokens,
              totalTokens: json.usage.total_tokens,
            }
          : undefined,
      };
    } finally {
      clearTimeout(timeoutHandle);
      request.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}
