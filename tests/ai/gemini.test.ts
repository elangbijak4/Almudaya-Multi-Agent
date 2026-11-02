import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider, GeminiProviderError } from '../../src/ai/gemini.js';
import type { AIRequest } from '../../src/ai/provider.js';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
      };
      constructor(_opts?: unknown) {}
    },
  };
});

describe('GeminiProvider Adapter', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it('should initialize with explicit apiKey and default model', () => {
    const provider = new GeminiProvider({
      apiKey: 'test-api-key-12345',
    });

    expect(provider.providerId).toBe('gemini');
    expect(provider.modelName).toBe('gemini-2.5-flash');
  });

  it('should format contents and config, and parse text response', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Hello from Gemini',
      functionCalls: undefined,
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 8,
        totalTokenCount: 23,
      },
    });

    const provider = new GeminiProvider({
      apiKey: 'test-api-key-12345',
      modelName: 'gemini-2.5-pro',
    });

    const req: AIRequest = {
      systemPrompt: 'System instruction here',
      temperature: 0.2,
      maxTokens: 500,
      messages: [
        { role: 'user', content: 'What is the architecture?' },
      ],
      tools: [
        {
          name: 'read_file',
          description: 'Read file content',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path' },
            },
            required: ['path'],
          },
        },
      ],
    };

    const res = await provider.generateResponse(req);
    expect(res.text).toBe('Hello from Gemini');
    expect(res.toolCalls).toBeUndefined();
    expect(res.usage?.totalTokens).toBe(23);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArg = mockGenerateContent.mock.calls[0][0];
    expect(callArg.model).toBe('gemini-2.5-pro');
    expect(callArg.config.systemInstruction).toBe('System instruction here');
    expect(callArg.config.temperature).toBe(0.2);
    expect(callArg.config.maxOutputTokens).toBe(500);
    expect(callArg.config.tools[0].functionDeclarations[0].name).toBe('read_file');
    expect(callArg.contents[0].role).toBe('user');
    expect(callArg.contents[0].parts[0].text).toBe('What is the architecture?');
  });

  it('should parse function calls into ToolCallRequest array', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: undefined,
      functionCalls: [
        {
          id: 'call_99',
          name: 'write_file',
          args: { path: 'src/main.ts', content: 'console.log("hi");' },
        },
      ],
    });

    const provider = new GeminiProvider({
      apiKey: 'test-api-key-12345',
    });

    const res = await provider.generateResponse({
      messages: [{ role: 'user', content: 'write the code' }],
    });

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls?.[0]?.id).toBe('call_99');
    expect(res.toolCalls?.[0]?.name).toBe('write_file');
    expect(res.toolCalls?.[0]?.arguments).toEqual({
      path: 'src/main.ts',
      content: 'console.log("hi");',
    });
  });

  it('should format tool result messages properly in contents', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Acknowledged tool result',
    });

    const provider = new GeminiProvider({
      apiKey: 'test-api-key-12345',
    });

    await provider.generateResponse({
      messages: [
        {
          role: 'model',
          toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'file.txt' } }],
        },
        {
          role: 'tool',
          toolResult: {
            toolCallId: 'call_1',
            name: 'read_file',
            result: 'file content here',
          },
        },
      ],
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const contents = mockGenerateContent.mock.calls[0][0].contents;
    expect(contents).toHaveLength(2);
    expect(contents[0].role).toBe('model');
    expect(contents[0].parts[0].functionCall.name).toBe('read_file');
    expect(contents[1].role).toBe('user');
    expect(contents[1].parts[0].functionResponse.name).toBe('read_file');
    expect(contents[1].parts[0].functionResponse.response.output).toBe('file content here');
  });

  it('should retry on transient errors and succeed', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(new Error('429 RESOURCE_EXHAUSTED: Rate limit reached'))
      .mockResolvedValueOnce({
        text: 'Success after retry',
      });

    const provider = new GeminiProvider({
      apiKey: 'test-api-key-12345',
    });

    const res = await provider.generateResponse({
      messages: [{ role: 'user', content: 'test retry' }],
    });

    expect(res.text).toBe('Success after retry');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('should throw GeminiProviderError on non-transient fatal errors', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('400 INVALID_ARGUMENT: Bad request'));

    const provider = new GeminiProvider({
      apiKey: 'test-api-key-12345',
    });

    await expect(
      provider.generateResponse({
        messages: [{ role: 'user', content: 'bad request' }],
      })
    ).rejects.toThrow(GeminiProviderError);
  });
});
