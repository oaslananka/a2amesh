export interface CodecovPolicyInputs {
  codecovYaml: string;
  ciWorkflow: string;
  packageJson: string;
  ruleset: string;
  bundleUploader: string;
  documentation: string;
}

export function validateCodecovPolicy(inputs: CodecovPolicyInputs): string[];
