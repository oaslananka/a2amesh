export interface SecurityWorkflowSecretInventoryEntry {
  name: string;
  scope: string;
  owner: string;
  purpose: string;
  consumer: string;
  rotation: string;
}

export interface SecurityEnvironmentInventoryEntry {
  name: string;
  allowed_branches: string[];
  reviewers: string[];
  prevent_self_review: boolean;
  auth_model: string;
}

export interface SecurityCredentialInventory {
  observed_at: string;
  settings_owner: string;
  refresh_cadence_days: number;
  workflow_secrets: SecurityWorkflowSecretInventoryEntry[];
  environments: SecurityEnvironmentInventoryEntry[];
}

export interface SecurityToolingInputs {
  preCommit: string;
  semgrepConfig: string;
  securityWorkflow: string;
  dependencyFreshnessWorkflow: string;
  actionlintConfig: string;
  securityPolicy: string;
  packageJson: { scripts?: Record<string, string> };
  ruleset: string;
  workflows?: Record<string, string>;
  credentialInventory: SecurityCredentialInventory;
}

export function validateSecurityTooling(inputs: SecurityToolingInputs): string[];
