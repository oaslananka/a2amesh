/**
 * @file sse.ts
 * Tenant-aware Server-Sent Events broadcaster for Fleet control-plane events.
 */

import type { Response } from 'express';

interface FleetSseClientScope {
  tenantId?: string;
  allTenants?: boolean;
}

interface FleetSseEventScope {
  tenantId?: string;
}

export interface FleetSseController {
  addClient(res: Response, scope?: FleetSseClientScope): void;
  broadcast(event: string, data: unknown, scope?: FleetSseEventScope): void;
  closeAllClients(): void;
}

interface FleetSseClient {
  response: Response;
  scope: FleetSseClientScope;
}

export function createFleetSse(): FleetSseController {
  const clients = new Set<FleetSseClient>();

  return {
    addClient(res: Response, scope: FleetSseClientScope = {}): void {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      const client = { response: res, scope };
      clients.add(client);
      res.on('close', () => clients.delete(client));
    },
    broadcast(event: string, data: unknown, scope: FleetSseEventScope = {}): void {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const client of clients) {
        if (!canReceiveEvent(client.scope, scope)) {
          continue;
        }
        client.response.write(payload);
      }
    },
    closeAllClients(): void {
      for (const client of clients) {
        client.response.end();
      }
      clients.clear();
    },
  };
}

function canReceiveEvent(client: FleetSseClientScope, event: FleetSseEventScope): boolean {
  if (client.allTenants) {
    return true;
  }
  return client.tenantId === event.tenantId;
}
