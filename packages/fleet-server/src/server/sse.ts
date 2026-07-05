/**
 * @file sse.ts
 * Minimal Server-Sent Events broadcaster for Fleet control-plane events
 * (run created/updated, approval decided). Mirrors the shape of
 * `@a2amesh/runtime`'s `SSEStreamer` but broadcasts to every connected
 * client rather than per-task-id subscribers, since Mission Control watches
 * the whole fleet, not a single task.
 */

import type { Response } from 'express';

export interface FleetSseController {
  addClient(res: Response): void;
  broadcast(event: string, data: unknown): void;
  closeAllClients(): void;
}

export function createFleetSse(): FleetSseController {
  const clients = new Set<Response>();

  return {
    addClient(res: Response): void {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      res.on('close', () => clients.delete(res));
    },
    broadcast(event: string, data: unknown): void {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const client of clients) {
        client.write(payload);
      }
    },
    closeAllClients(): void {
      for (const client of clients) {
        client.end();
      }
      clients.clear();
    },
  };
}
