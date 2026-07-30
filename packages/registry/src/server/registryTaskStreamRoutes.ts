import type { EventEmitter } from 'node:events';
import type { Express, Request, Response } from 'express';
import type { RegistryAuthController } from './auth.js';
import type { RegistryPollingController } from './polling.js';
import type { RegistrySseController } from './sse.js';
import type { RegistryTaskProjectionController } from './taskProjection.js';
import type { RegistryServerContext } from './types.js';

export function registerRegistryTaskStreamRoutes(
  app: Express,
  context: RegistryServerContext,
  auth: RegistryAuthController,
  polling: Pick<RegistryPollingController, 'refreshTaskSnapshots'>,
  sse: RegistrySseController,
  taskProjection: RegistryTaskProjectionController,
): void {
  app.get('/events', async (req, res) => {
    await handleSseStream(req, res, {
      auth,
      sse,
      emitter: context.events,
      event: 'registry_update',
      listener: (payload) => {
        sse.writeData(res, payload, 'registry_update');
      },
    });
  });

  app.get('/agents/stream', async (req, res) => {
    await handleSseStream(req, res, {
      auth,
      sse,
      emitter: context.events,
      event: 'registry_update',
      listener: (payload) => {
        const normalized = sse.normalizeAgentStreamPayload(payload);
        if (normalized) {
          sse.writeData(res, normalized);
        }
      },
    });
  });

  app.get('/tasks/recent', async (req, res) => {
    if (await auth.rejectUnauthenticatedControlPlane(req, res)) {
      return;
    }
    if (context.recentTasks.size === 0) {
      await polling.refreshTaskSnapshots();
    }

    const limitParam = Number(req.query['limit']);
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? limitParam
        : (context.options.maxRecentTasks ?? 50);

    res.json(taskProjection.getRecentTasks(limit));
  });

  app.get('/tasks/stream', async (req, res) => {
    await handleSseStream(req, res, {
      auth,
      sse,
      emitter: context.taskEvents,
      event: 'task_updated',
      listener: (payload) => {
        sse.writeData(res, payload);
      },
      onConfigure: () => {
        for (const taskEvent of taskProjection.getRecentTasks(10)) {
          sse.writeData(res, taskEvent);
        }
      },
    });
  });
}

function setupSseListener(
  res: Response,
  emitter: EventEmitter,
  event: string,
  listener: (payload: unknown) => void,
): void {
  emitter.on(event, listener);
  res.on('close', () => {
    emitter.off(event, listener);
  });
}

interface SseStreamOptions {
  auth: RegistryAuthController;
  sse: RegistrySseController;
  emitter: EventEmitter;
  event: string;
  listener: (payload: unknown) => void;
  onConfigure?: () => void;
}

async function handleSseStream(
  req: Request,
  res: Response,
  options: SseStreamOptions,
): Promise<void> {
  if (await options.auth.rejectUnauthenticatedControlPlane(req, res)) {
    return;
  }
  options.sse.configure(res);
  options.onConfigure?.();
  setupSseListener(res, options.emitter, options.event, options.listener);
}
