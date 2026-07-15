import OpenAI from 'openai';
import { OpenAIAdapter } from '@a2amesh/internal-adapter-openai';
import type { AgentCard } from '@a2amesh/runtime';

function createResearcherCard(url: string): AgentCard {
  return {
    protocolVersion: '1.0',
    name: 'Researcher Agent',
    description: 'Finds and synthesizes information on any topic using web search style reasoning.',
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
        id: 'research',
        name: 'Research',
        description: 'Researches a topic and returns structured findings.',
        tags: ['research', 'analysis', 'web'],
        examples: ['What is the A2A Protocol and why does it matter?'],
        inputModes: ['text'],
        outputModes: ['text'],
      },
    ],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    securitySchemes: [],
  };
}

export class ResearcherAgent extends OpenAIAdapter {
  constructor(url: string) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for Researcher Agent');
    }

    super(
      createResearcherCard(url),
      new OpenAI({ apiKey }),
      'gpt-5-mini',
      [
        'You are a precise research specialist.',
        'Cover the 3 most important aspects of the topic.',
        'For each aspect, provide 2 or 3 factual sentences.',
        'End with a one-sentence synthesis.',
        'Keep the total response under 300 words and avoid speculation.',
      ].join(' '),
    );
  }
}
