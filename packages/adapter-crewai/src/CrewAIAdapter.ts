/**
 * @file CrewAIAdapter.ts
 * Thin HTTP bridge adapter for CrewAI Python services.
 *
 * @beta
 */

import { BaseAdapter } from '@a2amesh/internal-adapter-base';
import { logger, normalizeAgentCard, validateAndFetch } from '@a2amesh/runtime';
import type {
  AnyAgentCard,
  ExtensibleArtifact,
  Message,
  OutboundPolicyOptions,
  Task,
} from '@a2amesh/runtime';
import {
  createTextArtifact,
  extractRequiredText,
  extractText,
} from '@a2amesh/internal-adapter-base';

/**
 * Thin HTTP bridge adapter for CrewAI Python services.
 *
 * @beta
 * @since 1.0.0
 */
export interface CrewAIAdapterOptions {
  outboundPolicy?: OutboundPolicyOptions;
}

export class CrewAIAdapter extends BaseAdapter {
  constructor(
    card: AnyAgentCard,
    private readonly bridgeUrl: string,
    private readonly bridgeOptions: CrewAIAdapterOptions = {},
  ) {
    super(normalizeAgentCard(card));
  }

  async handleTask(task: Task, message: Message): Promise<ExtensibleArtifact[]> {
    logger.info('CrewAI bridge processing task', {
      taskId: task.id,
      ...(task.contextId ? { contextId: task.contextId } : {}),
    });

    const response = await validateAndFetch(
      this.bridgeUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': task.id,
        },
        body: JSON.stringify({
          taskId: task.id,
          contextId: task.contextId,
          message: extractRequiredText(message.parts, 'CrewAI'),
          history: task.history.map((entry) => ({
            role: entry.role,
            content: extractText(entry.parts),
          })),
        }),
      },
      { timeoutMs: 60000, retries: 2, ...(this.bridgeOptions.outboundPolicy ?? {}) },
    );

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`CrewAI bridge failed with status ${response.status}`);
    }

    const json = (await response.json()) as {
      output?: string;
      metadata?: Record<string, unknown>;
    };

    const artifact = createTextArtifact(task, {
      artifactId: `crewai-${Date.now()}`,
      name: 'CrewAI Response',
      text: json.output ?? '',
      provider: 'crewai',
      compatibility: 'beta',
      supportsStreaming: false,
      metadata: {
        ...(json.metadata ?? {}),
      },
    }) as ExtensibleArtifact;
    return [artifact];
  }
}
