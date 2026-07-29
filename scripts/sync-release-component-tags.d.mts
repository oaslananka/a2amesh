export interface ReleaseComponentTag {
  component: string;
  path: string;
  tag: string;
}

export interface ReleasePleaseConfig {
  packages: Record<string, { component?: string }>;
}

export type ReleaseManifest = Record<string, string>;

export interface GitHubRequestClient {
  request(method: string, path: string, body?: unknown): Promise<unknown>;
}

export interface ComponentTagResult {
  tag: string;
  commit: string;
  status: 'created' | 'verified';
}

export interface ReleaseComponentTagCliOptions {
  verifyOnly: boolean;
  repo?: string;
  version?: string;
  commit: string;
}

export function parseArgs(argv: string[]): ReleaseComponentTagCliOptions;

export function buildReleaseComponentTagPlan(options: {
  config: ReleasePleaseConfig;
  manifest: ReleaseManifest;
  version: string;
}): ReleaseComponentTag[];

export function syncReleaseComponentTags(options: {
  repository: string;
  commit: string;
  version: string;
  tags: ReleaseComponentTag[];
  github: GitHubRequestClient;
  verifyOnly?: boolean;
}): Promise<ComponentTagResult[]>;

export function createGitHubClient(options: {
  token: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}): GitHubRequestClient;
