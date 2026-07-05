import { vi } from 'vitest';

interface FetchRoute {
  method?: string;
  path: string;
  status?: number;
  body?: unknown;
  error?: Error;
}

function routeKey(method: string, input: RequestInfo | URL): string {
  const raw = input instanceof Request ? input.url : input.toString();
  const url = new URL(raw, 'http://localhost');
  return `${method} ${url.pathname}${url.search}`;
}

export function installFetchMock(routes: FetchRoute[]) {
  const calls: string[] = [];

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const key = routeKey(method, input);
      calls.push(key);

      const route = routes.find(
        (candidate) => routeKey(candidate.method ?? 'GET', candidate.path) === key,
      );
      if (!route) {
        throw new Error(`Unexpected mission-control fetch: ${key}`);
      }
      if (route.error) {
        throw route.error;
      }

      const body = route.body === undefined ? null : JSON.stringify(route.body);
      return new Response(body, {
        status: route.status ?? 200,
        headers: body === null ? undefined : { 'Content-Type': 'application/json' },
      });
    },
  );

  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}
