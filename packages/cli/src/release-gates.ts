export interface LocalReleaseGate {
  id: string;
  command: string;
  ciEquivalent: string;
  purpose: string;
  remediation: string;
}

export const LOCAL_RELEASE_GATES: readonly LocalReleaseGate[] = [
  {
    id: 'doctor',
    command: 'a2amesh doctor --json --release-gates',
    ciEquivalent: 'CI / identity, CI / workspace-graph, CI / command-surface',
    purpose: 'Report local CLI, Node.js, workspace, package-manager, and release-gate coverage.',
    remediation: 'Run from the repository root with the pinned Node.js and pnpm versions.',
  },
  {
    id: 'conformance',
    command: 'a2amesh conformance <url> --gate --json',
    ciEquivalent: 'CI / conformance',
    purpose: 'Run the strict official A2A v1.0 conformance profile as a local release gate.',
    remediation: 'Fix required conformance failures before relying on the endpoint for release validation.',
  },
  {
    id: 'release-check',
    command: 'a2amesh release-check --json',
    ciEquivalent: 'CI / package-dry-run, CI / schemas, Docs / build, Security / audit',
    purpose: 'Run local release readiness checks for artifacts, docs, schemas, package parity, and public surfaces.',
    remediation: 'Inspect failed check remediation text, fix the failing gate, and rerun release-check.',
  },
];

export function getLocalReleaseGates(): readonly LocalReleaseGate[] {
  return LOCAL_RELEASE_GATES;
}
