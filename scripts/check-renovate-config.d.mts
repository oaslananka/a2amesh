export interface RenovatePolicyInputs {
  config: Record<string, unknown>;
  repositoryLabels: Set<string>;
  ciWorkflow: string;
  mergify: string;
  hasLegacyRunner?: boolean;
}

export declare function validateRenovatePolicy(inputs: RenovatePolicyInputs): string[];
