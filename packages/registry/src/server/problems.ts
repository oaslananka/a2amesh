import type { Response } from 'express';

export type RegistryProblemKind = 'bad-request' | 'unauthorized' | 'forbidden' | 'not-found';

const REGISTRY_PROBLEM_BASE = 'https://a2a-protocol.org/errors/registry';

const REGISTRY_PROBLEM_TITLES: Record<RegistryProblemKind, string> = {
  'bad-request': 'Bad Request',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  'not-found': 'Not Found',
};

const REGISTRY_PROBLEM_STATUSES: Record<RegistryProblemKind, number> = {
  'bad-request': 400,
  unauthorized: 401,
  forbidden: 403,
  'not-found': 404,
};

export interface RegistryProblemOptions {
  detail: string;
  extensions?: Record<string, unknown> | undefined;
}

export function writeRegistryProblem(
  res: Response,
  kind: RegistryProblemKind,
  options: RegistryProblemOptions,
): void {
  const status = REGISTRY_PROBLEM_STATUSES[kind];
  res
    .status(status)
    .type('application/problem+json')
    .json({
      type: `${REGISTRY_PROBLEM_BASE}/${kind}`,
      title: REGISTRY_PROBLEM_TITLES[kind],
      status,
      detail: options.detail,
      ...(options.extensions ?? {}),
    });
}
