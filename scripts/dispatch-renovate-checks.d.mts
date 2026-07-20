export interface RenovatePullRequest {
  number: number;
  author: { login: string } | null;
  headRefName: string;
  headRefOid: string;
  baseRefOid: string;
}

export interface WorkflowDispatch {
  prNumber: number;
  workflow: string;
  ref: string;
  headSha: string;
  fields: Record<string, string>;
}

export interface RepositoryRuleset {
  rules?: Array<{
    type: string;
    parameters?: {
      required_status_checks?: Array<{ context: string }>;
    };
  }>;
}

export function groupRequiredContexts(ruleset: RepositoryRuleset): Record<string, string[]>;

export const REQUIRED_WORKFLOW_MARKERS: Readonly<Record<string, readonly string[]>>;

export function createDispatchPlan(input: {
  pullRequests: RenovatePullRequest[];
  checkRunsBySha: Map<string, Set<string>>;
}): WorkflowDispatch[];
