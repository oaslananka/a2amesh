export interface RepositoryOpenWork {
  issues: number;
  pull_requests: number;
  total: number;
}

export interface RepositoryMetadataEvidence {
  name: string;
  url: string;
  default_branch: string;
  visibility: string;
  archived: boolean;
  license: string;
  open_work: RepositoryOpenWork;
}

export interface CanonicalTagEvidence {
  name: string;
  commit: string;
}

export interface GithubReleaseEvidence {
  tag: string;
  name: string | null;
  url: string;
  published_at: string;
  prerelease: boolean;
}

export interface ActiveReleasePullRequestEvidence {
  number: number;
  title: string;
  url: string;
  proposed_version: string;
}

export interface ReleaseEvidence {
  source_version: string;
  package_paths: string[];
  latest_github_release: GithubReleaseEvidence | null;
  latest_canonical_tag: CanonicalTagEvidence;
  npm: {
    package: string;
    alpha: string;
    latest: string;
  };
  active_release_pr: ActiveReleasePullRequestEvidence | null;
}

export interface RepositorySettingEvidence {
  name: string;
  value: string;
  owner: string;
  observed_at: string;
  refresh_cadence_days: number;
  source: string;
}

export interface RepositoryEvidenceSnapshot {
  schema_version: number;
  observed_at: string;
  refresh_cadence_days: number;
  repository: RepositoryMetadataEvidence;
  release: ReleaseEvidence;
  settings: RepositorySettingEvidence[];
  provenance: Record<string, string>;
}

export interface RepositoryEvidenceLocalState {
  manifest: Record<string, string>;
  releaseConfig: {
    packages?: Record<string, unknown>;
  };
  packageVersions: Record<string, string>;
}

export const REPOSITORY_EVIDENCE_START: string;
export const REPOSITORY_EVIDENCE_END: string;

export function validateRepositoryEvidence(
  snapshot: RepositoryEvidenceSnapshot,
  localState: RepositoryEvidenceLocalState,
  now?: Date,
): string[];

export function renderRepositoryEvidence(snapshot: RepositoryEvidenceSnapshot): string;
export function injectRepositoryEvidence(report: string, renderedSection: string): string;
export function validateMaturityReport(report: string): string[];
