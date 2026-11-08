import { AlmudayaError } from '../core/errors.js';

/**
 * Thrown when an AI provider hits an API rate limit / quota throttle (HTTP 429).
 * Carries the duration in seconds requested by the server before the next attempt.
 * Enforces NT-05, NT-06 & FR-322.
 */
export class RateLimitPauseError extends AlmudayaError {
  constructor(
    message: string,
    public readonly retryDelaySeconds: number,
    public readonly cause?: unknown
  ) {
    super(`Rate Limit Pause: ${message} (retry in ${retryDelaySeconds}s)`);
    this.name = 'RateLimitPauseError';
  }
}

/**
 * Core AI Model Provider Interface and Schema Definitions.
 * Implements vendor-agnostic abstraction for Multi-Provider AI integration (ADR-201).
 */

export interface ToolPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  items?: ToolPropertySchema;
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolPropertySchema>;
    required?: string[];
  };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  result?: unknown;
  error?: string;
}

export interface AIMessage {
  role: 'user' | 'model' | 'tool';
  content?: string;
  toolCalls?: ToolCallRequest[];
  toolResult?: ToolCallResult;
}

export interface AIRequest {
  systemPrompt?: string;
  messages: AIMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AIResponse {
  text?: string;
  toolCalls?: ToolCallRequest[];
  usage?: {
    promptTokens?: number;
    candidateTokens?: number;
    totalTokens?: number;
  };
}

export interface IAIModelProvider {
  readonly providerId: string;
  readonly modelName: string;
  generateResponse(request: AIRequest): Promise<AIResponse>;
}
