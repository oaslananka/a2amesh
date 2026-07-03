import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Walks up from `start` looking for the pnpm workspace root marker file. */
export function findWorkspaceRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (let i = 0; i < 20; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
