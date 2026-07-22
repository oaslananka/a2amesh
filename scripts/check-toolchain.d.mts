export interface ToolchainManifest {
  node: string;
  nodeCompatibility: string[];
  pnpm: string;
}

export interface CommandDiagnostic {
  version: string | null;
  executable: string | null;
  error?: string;
}

export interface ToolchainDiagnostics {
  node: { version: string; executable: string };
  packageManager?: string;
  directPnpm: CommandDiagnostic;
  corepackPnpm: CommandDiagnostic;
  childPnpm: CommandDiagnostic;
}

export function validateToolchainDiagnostics(
  manifest: ToolchainManifest,
  diagnostics: ToolchainDiagnostics,
): string[];
export function resolveExecutable(
  command: string,
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): string | null;
export function collectToolchainDiagnostics(input?: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): ToolchainDiagnostics;
