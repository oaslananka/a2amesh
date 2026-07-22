import type {
  SpawnSyncOptionsWithBufferEncoding,
  SpawnSyncOptionsWithStringEncoding,
} from 'node:child_process';

export function renderPnpmShim(platform?: NodeJS.Platform): string;
export function runPnpmWithShimSync(
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding & { platform?: NodeJS.Platform },
): string | null;
export function runPnpmWithShimSync(
  args: string[],
  options?: SpawnSyncOptionsWithBufferEncoding & { platform?: NodeJS.Platform },
): Buffer | null;
