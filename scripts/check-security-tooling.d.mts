export interface SecurityToolingInputs {
  preCommit: string;
  semgrepConfig: string;
  securityWorkflow: string;
  packageJson: { scripts?: Record<string, string> };
}

export function validateSecurityTooling(inputs: SecurityToolingInputs): string[];
