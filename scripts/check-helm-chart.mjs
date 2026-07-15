#!/usr/bin/env node
import { accessSync, constants, lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';

const chartPath = 'deploy/helm/a2amesh';
const profiles = [
  undefined,
  `${chartPath}/values-dev.yaml`,
  `${chartPath}/values-single-node.yaml`,
  `${chartPath}/values-production.yaml`,
  `${chartPath}/ci/values-kind.yaml`,
];

function resolveHelmBinary() {
  const configured = process.env.HELM_BIN;
  if (!configured || !isAbsolute(configured)) {
    throw new Error('HELM_BIN must point to an absolute Helm executable path.');
  }

  const resolved = realpathSync(configured);
  const file = lstatSync(resolved);
  if (!file.isFile() || file.isSymbolicLink()) {
    throw new Error('HELM_BIN must resolve to a regular executable file.');
  }
  if (!['helm', 'helm3'].includes(basename(resolved).toLowerCase())) {
    throw new Error('HELM_BIN must resolve to an executable named helm or helm3.');
  }
  accessSync(resolved, constants.X_OK);
  return resolved;
}

function runHelm(helm, args, options = {}) {
  const result = spawnSync(helm, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });

  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (options.expectFailure) {
    if (result.status === 0) {
      throw new Error(`Expected Helm command to fail: helm ${args.join(' ')}`);
    }
    if (options.messagePattern && !options.messagePattern.test(output)) {
      throw new Error(
        `Helm failed for an unexpected reason: helm ${args.join(' ')}\n${output.slice(-4000)}`,
      );
    }
    return output;
  }

  if (result.status !== 0) {
    throw new Error(`Helm command failed: helm ${args.join(' ')}\n${output.slice(-4000)}`);
  }
  return output;
}

function profileName(profile) {
  return profile?.split('/').at(-1) ?? 'values.yaml';
}

const helm = resolveHelmBinary();
for (const profile of profiles) {
  const valueArgs = profile ? ['--values', profile] : [];
  runHelm(helm, ['lint', chartPath, '--strict', ...valueArgs]);
  const rendered = runHelm(helm, [
    'template',
    'a2amesh-check',
    chartPath,
    '--namespace',
    'a2amesh-check',
    ...valueArgs,
  ]);

  if (!rendered.includes('kind: Service')) {
    throw new Error(`${profileName(profile)} did not render a Service.`);
  }
  if (!rendered.includes('runAsNonRoot: true')) {
    throw new Error(`${profileName(profile)} is missing non-root pod security.`);
  }
  if (!rendered.includes('readOnlyRootFilesystem: true')) {
    throw new Error(`${profileName(profile)} is missing a read-only root filesystem.`);
  }
  if (!rendered.includes('drop:\n            - ALL')) {
    throw new Error(`${profileName(profile)} is missing dropped Linux capabilities.`);
  }
  if (profile) {
    for (const required of [
      'REGISTRY_URL: "http://a2amesh-check-registry.a2amesh-check.svc.cluster.local:3099"',
      'RESEARCHER_URL: "http://a2amesh-check-runtime.a2amesh-check.svc.cluster.local:3001"',
      'REGISTRY_ALLOWED_HOSTNAMES: "a2amesh-check-registry.a2amesh-check.svc.cluster.local"',
    ]) {
      if (!rendered.includes(required)) {
        throw new Error(`${profileName(profile)} is missing cluster DNS contract: ${required}`);
      }
    }
  }
  if (profile?.endsWith('values-production.yaml')) {
    for (const required of [
      'kind: StatefulSet',
      'serviceName: a2amesh-check-registry-headless',
      'clusterIP: None',
      'publishNotReadyAddresses: true',
    ]) {
      if (!rendered.includes(required)) {
        throw new Error(`Production profile is missing StatefulSet service contract: ${required}`);
      }
    }
  }
}

const defaultRendered = runHelm(helm, [
  'template',
  'a2amesh-defaults',
  chartPath,
  '--namespace',
  'a2amesh-defaults',
]);
for (const forbidden of ['kind: Ingress', 'app.kubernetes.io/component: runtime']) {
  if (defaultRendered.includes(forbidden)) {
    throw new Error(`Secure defaults unexpectedly rendered: ${forbidden}`);
  }
}
for (const required of [
  'type: ClusterIP',
  'REGISTRY_REQUIRE_AUTH: "true"',
  'automountServiceAccountToken: false',
  'kind: NetworkPolicy',
]) {
  if (!defaultRendered.includes(required)) {
    throw new Error(`Secure defaults are missing: ${required}`);
  }
}

const unauthenticatedRendered = runHelm(helm, [
  'template',
  'a2amesh-unauthenticated',
  chartPath,
  '--namespace',
  'a2amesh-unauthenticated',
  '--set',
  'registry.auth.require=false',
  '--set',
  'registry.auth.createSecret=false',
]);
for (const forbidden of ['kind: Secret', 'name: REGISTRY_TOKEN']) {
  if (unauthenticatedRendered.includes(forbidden)) {
    throw new Error(`Unauthenticated registry unexpectedly rendered: ${forbidden}`);
  }
}
if (!unauthenticatedRendered.includes('REGISTRY_REQUIRE_AUTH: "false"')) {
  throw new Error('Unauthenticated registry did not render REGISTRY_REQUIRE_AUTH=false.');
}

const negativeCases = [
  {
    name: 'disabled registry auth with configured credentials',
    args: ['--set', 'registry.auth.require=false'],
    pattern: /cannot be combined with static or OIDC credentials/i,
  },
  {
    name: 'inline registry token without managed secret',
    args: ['--set', 'registry.auth.createSecret=false', '--set', 'registry.auth.token=test-only'],
    pattern: /registry\.auth\.token requires registry\.auth\.createSecret=true/i,
  },
  {
    name: 'runtime without provider credentials',
    args: ['--set', 'runtime.enabled=true'],
    pattern: /runtime requires an existing provider secret/i,
  },
  {
    name: 'runtime ingress without explicit acknowledgement',
    args: [
      '--set',
      'runtime.enabled=true',
      '--set',
      'runtime.providerSecrets.createSecret=true',
      '--set',
      'runtime.providerSecrets.openAIKey=test-only',
      '--set',
      'ingress.runtime.enabled=true',
      '--set',
      'ingress.runtime.hosts[0].host=runtime.example.test',
      '--set',
      'ingress.runtime.hosts[0].paths[0].path=/',
      '--set',
      'ingress.runtime.hosts[0].paths[0].pathType=Prefix',
    ],
    pattern: /acknowledgeUnauthenticatedEndpoint/i,
  },
  {
    name: 'registry ingress without TLS',
    args: [
      '--set',
      'ingress.registry.enabled=true',
      '--set',
      'ingress.registry.hosts[0].host=registry.example.test',
      '--set',
      'ingress.registry.hosts[0].paths[0].path=/',
      '--set',
      'ingress.registry.hosts[0].paths[0].pathType=Prefix',
    ],
    pattern: /registry ingress requires TLS/i,
  },
  {
    name: 'runtime multi-replica deployment without state acknowledgement',
    args: [
      '--set',
      'runtime.enabled=true',
      '--set',
      'runtime.providerSecrets.createSecret=true',
      '--set',
      'runtime.providerSecrets.openAIKey=test-only',
      '--set',
      'runtime.replicaCount=2',
    ],
    pattern: /runtime replicas share no task storage/i,
  },
  {
    name: 'runtime autoscaling without state acknowledgement',
    args: [
      '--set',
      'runtime.enabled=true',
      '--set',
      'runtime.providerSecrets.createSecret=true',
      '--set',
      'runtime.providerSecrets.openAIKey=test-only',
      '--set',
      'runtime.autoscaling.enabled=true',
    ],
    pattern: /runtime autoscaling requires runtime\.autoscaling\.allowEphemeralReplicas=true/i,
  },
  {
    name: 'sqlite multi-replica deployment',
    args: ['--set', 'registry.storage.backend=sqlite', '--set', 'registry.replicaCount=2'],
    pattern: /sqlite registry storage supports exactly one replica/i,
  },
];

for (const testCase of negativeCases) {
  runHelm(
    helm,
    [
      'template',
      'a2amesh-negative',
      chartPath,
      '--namespace',
      'a2amesh-negative',
      ...testCase.args,
    ],
    { expectFailure: true, messagePattern: testCase.pattern },
  );
}

console.log(
  `Helm chart check passed with ${profiles.length} profiles and ${negativeCases.length} negative cases.`,
);
