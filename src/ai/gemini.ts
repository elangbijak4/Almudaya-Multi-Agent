import { GoogleGenAI } from '@google/genai';
import type { IAIModelProvider, AIRequest, AIResponse, ToolCallRequest } from './provider.js';
import { RateLimitPauseError } from './provider.js';
import { resolveApiKey } from './credentials.js';
import { AlmudayaError } from '../core/errors.js';

export { RateLimitPauseError };

export class GeminiProviderError extends AlmudayaError {
  constructor(message: string, public readonly cause?: unknown) {
    super(`Google Gemini Provider Error: ${message}`, 'GEMINI_PROVIDER_ERROR');
  }
}

export class GeminiAuthenticationError extends AlmudayaError {
  constructor(message: string, public readonly cause?: unknown) {
    super(`Google Gemini Authentication Error: ${message}`, 'GEMINI_AUTHENTICATION_ERROR');
  }
}

export class GeminiAbortError extends AlmudayaError {
  constructor(message: string = 'Gemini operation was cancelled') {
    super(message, 'GEMINI_ABORT_ERROR');
  }
}

/**
 * Extracts retry delay duration in seconds from Google API error details or error message.
 * Enforces NT-05, NT-06, FR-322 & NT-01.
 */
export function parseRetryDelay(errorObj: any): number | null {
  try {
    // 1. Google GenAI errorDetails array (RetryInfo format)
    const details = errorObj?.errorDetails || errorObj?.cause?.errorDetails;
    if (Array.isArray(details)) {
      for (const d of details) {
        if (d?.retryDelay) {
          const m = String(d.retryDelay).match(/^([\d.]+)s?$/);
          if (m) return parseFloat(m[1]!);
        }
      }
    }

    // 2. Message regex: "retry in 39.61s" or "wait 40s"
    const text = String(errorObj?.message || errorObj || '');
    const m = text.match(/retry in ([\d.]+)s/i) || text.match(/wait ([\d.]+)s/i);
    if (m) {
      return parseFloat(m[1]!);
    }
  } catch {
    // Ignore parsing error
  }
  return null;
}

export type GeminiErrorCategory =
  | 'RATE_LIMIT'
  | 'TRANSIENT'
  | 'AUTH'
  | 'CLIENT'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface ClassifiedGeminiError {
  category: GeminiErrorCategory;
  isRetryable: boolean;
  message: string;
  serverDelay: number | null;
}

/**
 * Classifies an error thrown by the Gemini SDK into actionable reliability categories.
 */
export function classifyGeminiError(err: unknown): ClassifiedGeminiError {
  if (!err) {
    return {
      category: 'UNKNOWN',
      isRetryable: false,
      message: 'Unknown error',
      serverDelay: null,
    };
  }

  const rawMsg = (err as Error)?.message ?? String(err);
  const serverDelay = parseRetryDelay(err);
  const errObj = (typeof err === 'object' && err !== null ? err : {}) as Record<string, unknown>;
  const causeObj = (typeof errObj['cause'] === 'object' && errObj['cause'] !== null
    ? errObj['cause']
    : {}) as Record<string, unknown>;

  const status = (errObj['status'] ?? errObj['statusCode'] ?? causeObj['status']) as number | undefined;

  // 1. Cancellation check
  if (
    (err as Error)?.name === 'AbortError' ||
    errObj['code'] === 'ABORT_ERR' ||
    err instanceof GeminiAbortError
  ) {
    return {
      category: 'CANCELLED',
      isRetryable: false,
      message: 'Request was cancelled',
      serverDelay: null,
    };
  }

  // 2. Authentication failure check (401, 403, API_KEY_INVALID, PERMISSION_DENIED)
  if (
    status === 401 ||
    status === 403 ||
    rawMsg.includes('401') ||
    rawMsg.includes('403') ||
    rawMsg.includes('UNAUTHENTICATED') ||
    rawMsg.includes('PERMISSION_DENIED') ||
    rawMsg.includes('API_KEY_INVALID') ||
    rawMsg.toLowerCase().includes('api key not valid') ||
    rawMsg.toLowerCase().includes('invalid api key')
  ) {
    return {
      category: 'AUTH',
      isRetryable: false,
      message: rawMsg,
      serverDelay: null,
    };
  }

  // 3. Client / bad request errors (400, 404, INVALID_ARGUMENT, NOT_FOUND)
  if (
    status === 400 ||
    status === 404 ||
    rawMsg.includes('400') ||
    rawMsg.includes('404') ||
    rawMsg.includes('INVALID_ARGUMENT') ||
    rawMsg.includes('NOT_FOUND')
  ) {
    return {
      category: 'CLIENT',
      isRetryable: false,
      message: rawMsg,
      serverDelay: null,
    };
  }

  // 4. Rate limit / quota errors (429, RESOURCE_EXHAUSTED, RATE_LIMIT_EXCEEDED, quota)
  if (
    status === 429 ||
    rawMsg.includes('429') ||
    rawMsg.includes('RESOURCE_EXHAUSTED') ||
    rawMsg.includes('RATE_LIMIT_EXCEEDED') ||
    rawMsg.toLowerCase().includes('quota')
  ) {
    return {
      category: 'RATE_LIMIT',
      isRetryable: true,
      message: rawMsg,
      serverDelay,
    };
  }

  // 5. Transient service / network errors (503, 504, 502, 500, UNAVAILABLE, timeouts)
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    rawMsg.includes('503') ||
    rawMsg.includes('504') ||
    rawMsg.includes('502') ||
    rawMsg.includes('500') ||
    rawMsg.includes('UNAVAILABLE') ||
    rawMsg.includes('DEADLINE_EXCEEDED') ||
    rawMsg.includes('ETIMEDOUT') ||
    rawMsg.includes('ECONNRESET') ||
    rawMsg.includes('ECONNREFUSED') ||
    rawMsg.includes('ENOTFOUND') ||
    rawMsg.includes('UND_ERR_CONNECT_TIMEOUT') ||
    rawMsg.includes('fetch failed') ||
    rawMsg.toLowerCase().includes('timeout')
  ) {
    return {
      category: 'TRANSIENT',
      isRetryable: true,
      message: rawMsg,
      serverDelay,
    };
  }

  return {
    category: 'UNKNOWN',
    isRetryable: false,
    message: rawMsg,
    serverDelay,
  };
}

/**
 * Delays execution with immediate interrupt support on AbortSignal cancellation.
 */
export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new GeminiAbortError('Request was aborted during retry backoff'));
    }

    let timer: NodeJS.Timeout | undefined;

    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(new GeminiAbortError('Request was cancelled during retry backoff'));
    };

    timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export interface GeminiProviderOptions {
  apiKey?: string;
  modelName?: string;
  customEnvVar?: string;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  totalTimeoutMs?: number;
  signal?: AbortSignal;
}

export class GeminiProvider implements IAIModelProvider {
  public readonly providerId: string = 'gemini';
  public readonly modelName: string;

  public readonly maxRetries: number;
  public readonly initialRetryDelayMs: number;
  public readonly maxRetryDelayMs: number;
  public readonly totalTimeoutMs: number;
  public readonly signal?: AbortSignal;

  private readonly client: GoogleGenAI;

  constructor(options: GeminiProviderOptions = {}) {
    const key = options.apiKey ?? resolveApiKey({
      providerId: 'gemini',
      customEnvVar: options.customEnvVar,
    });

    this.modelName = options.modelName ?? 'gemini-2.5-flash';
    this.maxRetries = options.maxRetries ?? 3;
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 1000;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 32000;
    this.totalTimeoutMs = options.totalTimeoutMs ?? 60000;
    this.signal = options.signal;

    this.client = new GoogleGenAI({ apiKey: key });
  }

  public async generateResponse(request: AIRequest): Promise<AIResponse> {
    const effectiveSignal = request.signal ?? this.signal;
    if (effectiveSignal?.aborted) {
      throw new GeminiAbortError('Request was aborted prior to execution');
    }

    const contents = this.formatContents(request);
    const config = this.formatConfig(request);

    const maxRetries = this.maxRetries;
    const initialDelay = this.initialRetryDelayMs;
    const maxDelay = this.maxRetryDelayMs;
    const totalDeadline = this.totalTimeoutMs;
    const startTime = Date.now();

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (effectiveSignal?.aborted) {
        throw new GeminiAbortError('Request was aborted during retry sequence');
      }

      try {
        const response = await this.client.models.generateContent({
          model: this.modelName,
          contents,
          config,
        });

        const toolCalls: ToolCallRequest[] = [];
        if (response.functionCalls && response.functionCalls.length > 0) {
          for (let i = 0; i < response.functionCalls.length; i++) {
            const fc = response.functionCalls[i];
            if (!fc) continue;
            toolCalls.push({
              id: fc.id ?? `call_${Date.now()}_${i}`,
              name: fc.name ?? '',
              arguments: (fc.args as Record<string, unknown>) ?? {},
            });
          }
        }

        // Extract text safely without triggering SDK getter warning for functionCall parts
        let extractedText: string | undefined;
        const candidateParts = response.candidates?.[0]?.content?.parts;
        if (candidateParts && Array.isArray(candidateParts)) {
          const textParts = candidateParts
            .filter((p) => p && typeof p.text === 'string')
            .map((p) => p.text as string);
          if (textParts.length > 0) {
            extractedText = textParts.join('');
          }
        } else {
          try {
            extractedText = response.text ?? undefined;
          } catch {
            extractedText = undefined;
          }
        }

        const usage = response.usageMetadata
          ? {
              promptTokens: response.usageMetadata.promptTokenCount,
              candidateTokens: response.usageMetadata.candidatesTokenCount,
              totalTokens: response.usageMetadata.totalTokenCount,
            }
          : undefined;

        return {
          text: extractedText,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage,
        };
      } catch (err: unknown) {
        lastError = err;
        const classification = classifyGeminiError(err);
        const errMsg = classification.message;

        // If cancelled, fail immediately
        if (classification.category === 'CANCELLED') {
          throw new GeminiAbortError(errMsg);
        }

        // Permanent authentication failure: fail-fast immediately (no retry)
        if (classification.category === 'AUTH') {
          throw new GeminiAuthenticationError(errMsg, err);
        }

        // Permanent client error: fail-fast immediately (no retry)
        if (classification.category === 'CLIENT') {
          throw new GeminiProviderError(errMsg, err);
        }

        // If server explicitly requested a significant delay (e.g. > 5s), immediately throw RateLimitPauseError
        // to let the agent loop pause adaptively and inform the user/console.
        if (classification.serverDelay && classification.serverDelay > 5) {
          throw new RateLimitPauseError(errMsg, classification.serverDelay, err);
        }

        // Check if retryable (RATE_LIMIT or TRANSIENT)
        if (classification.isRetryable && attempt < maxRetries) {
          let delayMs: number;
          if (classification.serverDelay) {
            delayMs = Math.ceil(classification.serverDelay * 1000);
          } else {
            const baseDelay = initialDelay * Math.pow(2, attempt - 1);
            const jitter = Math.floor(Math.random() * (baseDelay * 0.2));
            delayMs = Math.min(baseDelay + jitter, maxDelay);
          }

          // Check if overall retry deadline would be exceeded
          const elapsed = Date.now() - startTime;
          if (elapsed + delayMs > totalDeadline) {
            throw new GeminiProviderError(
              `Total retry deadline (${totalDeadline}ms) exceeded after ${attempt} attempts: ${errMsg}`,
              err
            );
          }

          await sleepWithSignal(delayMs, effectiveSignal);
          continue;
        }

        // If exhausted attempts (attempt === maxRetries)
        if (attempt === maxRetries) {
          if (classification.category === 'RATE_LIMIT') {
            const fallbackDelay = classification.serverDelay ?? 15;
            throw new RateLimitPauseError(errMsg, fallbackDelay, err);
          }
          throw new GeminiProviderError(
            `Failed after ${maxRetries} attempts: ${errMsg}`,
            err
          );
        }

        // Non-retryable error
        if (classification.category === 'RATE_LIMIT') {
          const fallbackDelay = classification.serverDelay ?? 15;
          throw new RateLimitPauseError(errMsg, fallbackDelay, err);
        }

        throw new GeminiProviderError(errMsg, err);
      }
    }

    throw new GeminiProviderError(
      `Failed after ${maxRetries} attempts: ${(lastError as Error)?.message ?? 'Unknown error'}`
    );
  }

  private formatContents(request: AIRequest): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];

    for (const msg of request.messages) {
      if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content ?? '' }],
        });
      } else if (msg.role === 'model') {
        const parts: Array<Record<string, unknown>> = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                id: tc.id,
                name: tc.name,
                args: tc.arguments,
              },
            });
          }
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool' && msg.toolResult) {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.toolResult.name,
                response: {
                  output: msg.toolResult.result ?? msg.toolResult.error ?? 'success',
                },
              },
            },
          ],
        });
      }
    }

    return contents;
  }

  private formatConfig(request: AIRequest): Record<string, unknown> {
    const config: Record<string, unknown> = {};

    if (request.systemPrompt) {
      config.systemInstruction = request.systemPrompt;
    }

    if (request.temperature !== undefined) {
      config.temperature = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      config.maxOutputTokens = request.maxTokens;
    }

    if (request.tools && request.tools.length > 0) {
      config.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    return config;
  }
}
