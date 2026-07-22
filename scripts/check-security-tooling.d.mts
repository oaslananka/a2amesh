export interface SecurityToolingInputs {
  preCommit: string;
  semgrepConfig: string;
  securityWorkflow: string;
  packageJson: { scripts?: Record<string, string> };
  ruleset: string;
}

export function validateSecurityTooling(inputs: SecurityToolingInputs): string[];
