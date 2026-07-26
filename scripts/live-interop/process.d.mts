export const MAX_CAPTURE_BYTES: number;

export interface ParticipantDiagnostics {
  participant: string;
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  stdout: string;
  stderr: string;
}

export interface ParticipantHandle {
  pid: number | undefined;
  waitUntilReady(): Promise<Record<string, unknown>>;
  stop(): Promise<void>;
  diagnostics(): ParticipantDiagnostics;
}

export interface StartParticipantOptions {
  name: string;
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  secrets?: string[];
  startupTimeoutMs?: number;
}

export class ParticipantStartupError extends Error {
  participant: string;
  reason: 'startup-timeout' | 'exited-before-ready' | 'spawn-error';
  diagnostics: ParticipantDiagnostics;
}

export function startParticipant(options: StartParticipantOptions): ParticipantHandle;
