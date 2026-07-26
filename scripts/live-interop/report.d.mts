export function redactText(input: unknown, secrets?: string[]): string;
export function redactDiagnostic<T>(value: T, secrets?: string[], key?: string): T;
export function writeLiveInteropReport(
  root: string,
  report: unknown,
  outputPath?: string,
): Promise<string>;
