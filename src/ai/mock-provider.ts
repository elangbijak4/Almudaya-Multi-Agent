import type { IAIModelProvider, AIRequest, AIResponse, ToolCallRequest } from './provider.js';

export interface MockScriptedStep {
  text?: string;
  toolCalls?: ToolCallRequest[];
  error?: Error;
}

/**
 * Deterministic Mock AI Provider for offline testing without network or API keys.
 */
export class MockAIProvider implements IAIModelProvider {
  public readonly providerId: string = 'mock';
  public readonly modelName: string;
  public readonly calls: AIRequest[] = [];

  private scriptedSteps: MockScriptedStep[] = [];
  private stepIndex: number = 0;

  constructor(modelName: string = 'mock-model-v1', steps?: MockScriptedStep[]) {
    this.modelName = modelName;
    if (steps) {
      this.scriptedSteps = [...steps];
    }
  }

  public setScriptedSteps(steps: MockScriptedStep[]): void {
    this.scriptedSteps = [...steps];
    this.stepIndex = 0;
  }

  public addStep(step: MockScriptedStep): void {
    this.scriptedSteps.push(step);
  }

  public async generateResponse(request: AIRequest): Promise<AIResponse> {
    this.calls.push(request);

    if (this.stepIndex < this.scriptedSteps.length) {
      const step = this.scriptedSteps[this.stepIndex++];
      if (step) {
        if (step.error) {
          throw step.error;
        }

        return {
          text: step.text,
          toolCalls: step.toolCalls,
          usage: {
            promptTokens: 100,
            candidateTokens: 50,
            totalTokens: 150,
          },
        };
      }
    }

    // Default fallback response if no scripted steps remain
    return {
      text: 'Mock default response',
      usage: {
        promptTokens: 50,
        candidateTokens: 20,
        totalTokens: 70,
      },
    };
  }

  public reset(): void {
    this.calls.length = 0;
    this.scriptedSteps.length = 0;
    this.stepIndex = 0;
  }
}
