import { GoogleGenAI } from '@google/genai';
import type { IAIModelProvider, AIRequest, AIResponse, ToolCallRequest } from './provider.js';
import { RateLimitPauseError } from './provider.js';
import { resolveApiKey } from './credentials.js';
import { AlmudayaError } from '../core/errors.js';

export { RateLimitPauseError };

export class GeminiProviderError extends AlmudayaError {
  constructor(message: string, public readonly cause?: unknown) {
    super(`Google Gemini Provider Error: ${message}`);
  }
}

/**
 * Extracts retry delay duration in seconds from Google API error details or error message.
 * Enforces NT-05, NT-06 & FR-322.
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

export interface GeminiProviderOptions {
  apiKey?: string;
  modelName?: string;
  customEnvVar?: string;
}

export class GeminiProvider implements IAIModelProvider {
  public readonly providerId: string = 'gemini';
  public readonly modelName: string;

  private readonly client: GoogleGenAI;

  constructor(options: GeminiProviderOptions = {}) {
    const key = options.apiKey ?? resolveApiKey({
      providerId: 'gemini',
      customEnvVar: options.customEnvVar,
    });

    this.modelName = options.modelName ?? 'gemini-2.5-flash';
    this.client = new GoogleGenAI({ apiKey: key });
  }

  public async generateResponse(request: AIRequest): Promise<AIResponse> {
    const contents = this.formatContents(request);
    const config = this.formatConfig(request);

    let lastError: unknown;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
        const errMsg = (err as Error)?.message ?? String(err);
        const serverDelay = parseRetryDelay(err);

        // If server explicitly requested a significant delay (e.g. > 5s), immediately throw RateLimitPauseError
        // to let the agent loop pause adaptively and inform the user/console.
        if (serverDelay && serverDelay > 5) {
          throw new RateLimitPauseError(errMsg, serverDelay, err);
        }

        // Check if retryable (e.g. rate limit, 429, 503, network transient)
        const isTransient =
          errMsg.includes('429') ||
          errMsg.includes('503') ||
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('quota') ||
          errMsg.includes('ETIMEDOUT') ||
          errMsg.includes('ECONNRESET');

        if (isTransient && attempt < maxRetries) {
          const delay = serverDelay
            ? Math.ceil(serverDelay * 1000)
            : Math.pow(2, attempt) * 500 + Math.floor(Math.random() * 200);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (
          errMsg.includes('429') ||
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('quota')
        ) {
          const fallbackDelay = serverDelay ?? 15;
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
