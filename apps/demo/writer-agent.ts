import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AnthropicAdapter } from '@a2amesh/internal-adapter-anthropic';
import { OpenAIAdapter } from '@a2amesh/internal-adapter-openai';
import type { AgentCard } from '@a2amesh/runtime';

function createWriterCard(url: string): AgentCard {
  return {
    protocolVersion: '1.0',
    name: 'Writer Agent',
    description: 'Turns research output into a polished, concise final report.',
    url,
    version: '1.0.0',
    provider: { name: 'a2amesh demo', url: 'https://github.com/oaslananka/a2amesh' },
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
      extendedAgentCard: false,
    },
    skills: [
      {
        id: 'write',
        name: 'Write',
        description: 'Rewrites findings into a polished final answer.',
        tags: ['writing', 'report', 'summary'],
        examples: ['Turn these findings into a crisp executive summary.'],
        inputModes: ['text'],
        outputModes: ['text'],
      },
    ],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    securitySchemes: [],
  };
}

class AnthropicWriterAgent extends AnthropicAdapter {
  constructor(url: string) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for Anthropic Writer Agent');
    }

    const client = new Anthropic({ apiKey });

    super(
      createWriterCard(url),
      {
        messages: {
          create(payload: Record<string, unknown>) {
            return client.messages.create(payload as never) as unknown as
              | Promise<{
                  content: Array<
                    | { type: 'text'; text: string }
                    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
                  >;
                  usage: {
                    input_tokens: number;
                    output_tokens: number;
                  };
                }>
              | AsyncIterable<{
                  type: 'content_block_delta';
                  delta: {
                    type: 'text_delta';
                    text: string;
                  };
                }>;
          },
        },
      },
      'claude-sonnet-4-20250514',
      [
        'You are an elite technical writer.',
        'Transform the provided research into a polished answer with a clear structure.',
        'Stay concise, concrete, and readable.',
        'Preserve factual content while improving clarity and flow.',
      ].join(' '),
    );
  }
}

class OpenAIWriterAgent extends OpenAIAdapter {
  constructor(url: string) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required when Anthropic is not configured');
    }

    super(
      createWriterCard(url),
      new OpenAI({ apiKey }),
      'gpt-5-mini',
      [
        'You are an elite technical writer.',
        'Transform the provided research into a polished answer with a clear structure.',
        'Stay concise, concrete, and readable.',
        'Preserve factual content while improving clarity and flow.',
      ].join(' '),
    );
  }
}

export function createWriterAgent(url: string): AnthropicAdapter | OpenAIAdapter {
  if (process.env['ANTHROPIC_API_KEY']) {
    return new AnthropicWriterAgent(url);
  }

  return new OpenAIWriterAgent(url);
}
