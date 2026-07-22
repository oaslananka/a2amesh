export type ReleaseState =
  | 'published'
  | 'release-pr-open'
  | 'prepared-unpublished'
  | 'partial-publication'
  | 'superseded'
  | 'drifted'
  | 'unavailable';

export interface SourcePackageObservation {
  name: string;
  path: string;
  version: string | null;
}

export interface CanonicalTagObservation {
  name: string | null;
  commit: string | null;
}

export interface ReleasePullRequestObservation {
  number: number;
  title?: string;
  url: string;
  versions: Array<string | null | undefined>;
}

export interface NpmPackageObservation {
  name: string;
  versionExists: boolean;
  distTags: Record<string, string | undefined>;
}

export interface ReleaseSupersessionObservation {
  version: string;
  releaseCommit: string;
  successorVersion: string;
  decisionDate: string;
  issue: string;
  reason: string;
}

export interface ReleaseObservation {
  repository: string;
  checkedOutCommit: string | null;
  sourcePackages: SourcePackageObservation[];
  canonicalTag: CanonicalTagObservation;
  supersession?: ReleaseSupersessionObservation | null;
  releasePrs: ReleasePullRequestObservation[];
  npmPackages: NpmPackageObservation[];
  errors?: string[];
  drift?: string[];
}

export interface EvaluatedPackage {
  name: string;
  path: string;
  version: string | null;
  versionExists: boolean;
  expectedDistTag: string | null;
  expectedDistTagVersion: string | null;
  expectedDistTagMatches: boolean;
  latest: string | null;
  complete: boolean;
}

export interface ReleaseEvaluation {
  state: ReleaseState;
  version: string | null;
  expectedTag: string | null;
  expectedDistTag: string | null;
  blockers: string[];
  warnings: string[];
  gates: {
    releasePlease: boolean;
    publish: boolean;
  };
  packages: EvaluatedPackage[];
  nextSafeAction: string;
}

export function expectedDistTag(version: string): string;
export function compareSemanticVersions(left: string, right: string): number | null;
export function evaluateReleaseState(observation: ReleaseObservation): ReleaseEvaluation;
