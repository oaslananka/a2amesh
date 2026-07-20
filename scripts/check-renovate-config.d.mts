export interface RenovatePolicyInputs {
  config: Record<string, unknown>;
  globalConfig: Record<string, unknown>;
  workflow: string;
  repositoryLabels: Set<string>;
}

export function validateRenovatePolicy(inputs: RenovatePolicyInputs): string[];
