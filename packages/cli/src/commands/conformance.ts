import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import {
  hasRequiredConformanceFailures,
  parseConformanceProfileId,
  parseConformanceProtocolVersion,
  runConformanceSuite,
  type ConformanceCaseResult,
  type ConformanceReport,
} from '@a2amesh/runtime/testing';
import {
  emitResult,
  withSpinner,
  writeError,
  type CliOptions,
  type RootOptionsProvider,
} from '../io.js';
import { addNetworkOptions, createA2AClient, type NetworkCommandOptions } from '../network.js';
import { getLocalReleaseGates } from '../release-gates.js';
import { CLI_VERSION } from '../version.js';
import { applyCommandDoc, type CliCommandDoc } from './doc-metadata.js';

export const conformanceCommandDoc = {
  path: ['conformance'],
  summary: 'Run the A2A conformance fixture suite.',
  description:
    'Runs the A2A conformance fixture suite against an endpoint, emits a machine-readable report, and can write JUnit XML for CI systems.',
  examples: [
    {
      title: 'Run conformance fixtures and emit JSON.',
      bash: [
        'a2amesh conformance http://127.0.0.1:3000 --profile official-a2a-v1.0 --strict --json',
      ],
      powershell: [
        'a2amesh conformance http://127.0.0.1:3000 --profile official-a2a-v1.0 --strict --json',
      ],
    },
    {
      title: 'Write a JUnit report.',
      bash: ['a2amesh conformance http://127.0.0.1:3000 --junit ./reports/a2a-conformance.xml'],
      powershell: [
        'a2amesh conformance http://127.0.0.1:3000 --junit .\\reports\\a2a-conformance.xml',
      ],
    },
  ],
  additionalMarkdown: [
    '## Report Behavior',
    '',
    '`--json` emits a stable conformance report with package metadata, endpoint capability metadata, pass/fail/skip counts, case results, and skipped optional capabilities.',
    '',
    'Case `status` is one of `pass`, `fail`, or `skip`. Required failures increment `summary.requiredFailed` and make the command return a nonzero exit code.',
    '',
    'Use `--profile official-a2a-v1.0 --strict` to run the official strict compatibility profile. The JSON report includes a `profile` summary and a `coverage` matrix with supported, partial, legacy-alias, and unsupported rows.',
    '',
    '`--protocol-version 1.2` and `--profile experimental-a2a-v1.2` are a2amesh experimental fixture profiles and require `--experimental-profiles`; official conformance defaults to A2A `1.0`.',
    '',
    '## JUnit Output',
    '',
    'Use `--junit <path>` to write CI-compatible JUnit XML. The XML includes one `<testcase>` per report case, `<failure>` entries for failed cases, and `<skipped>` entries for skipped optional capabilities.',
  ].join('\n'),
} satisfies CliCommandDoc;

interface ConformanceCommandOptions extends NetworkCommandOptions {
  protocolVersion?: string;
  profile?: string;
  strict?: boolean;
  experimentalProfiles?: boolean;
  json?: boolean;
  junit?: string;
  gate?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeXml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderJUnitCase(testCase: ConformanceCaseResult): string {
  const base = `  <testcase name="${escapeXml(
    testCase.id,
  )}" classname="a2amesh.conformance" time="${(testCase.durationMs / 1000).toFixed(3)}">`;

  if (testCase.status === 'fail') {
    const message = testCase.message ?? 'Conformance case failed';
    return [
      base,
      `    <failure message="${escapeXml(message)}" type="ConformanceFailure">${escapeXml(
        message,
      )}</failure>`,
      '  </testcase>',
    ].join('\n');
  }

  if (testCase.status === 'skip') {
    return [
      base,
      `    <skipped message="${escapeXml(testCase.message ?? 'Skipped')}" />`,
      '  </testcase>',
    ].join('\n');
  }

  return `  <testcase name="${escapeXml(
    testCase.id,
  )}" classname="a2amesh.conformance" time="${(testCase.durationMs / 1000).toFixed(3)}" />`;
}

function renderConformanceJUnit(report: ConformanceReport): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="a2amesh-conformance" tests="${report.summary.total}" failures="${report.summary.failed}" skipped="${report.summary.skipped}" time="${(
      report.summary.durationMs / 1000
    ).toFixed(3)}">`,
    '  <properties>',
    `    <property name="endpoint" value="${escapeXml(report.endpoint.url)}" />`,
    `    <property name="protocolVersion" value="${escapeXml(report.protocolVersion)}" />`,
    `    <property name="profile" value="${escapeXml(report.profile?.id ?? 'unknown')}" />`,
    `    <property name="packageVersion" value="${escapeXml(report.package.version)}" />`,
    '  </properties>',
    ...report.cases.map(renderJUnitCase),
    '</testsuite>',
    '',
  ].join('\n');
}

function writeJUnitReport(path: string, report: ConformanceReport): void {
  const targetPath = resolve(path);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, renderConformanceJUnit(report), 'utf8');
}

interface ConformanceGateMetadata {
  id: 'conformance';
  command: string;
  ciEquivalent: string;
  required: true;
  actionable: true;
}

function conformanceGateMetadata(endpointUrl: string): ConformanceGateMetadata {
  const gate = getLocalReleaseGates().find((entry) => entry.id === 'conformance');
  return {
    id: 'conformance',
    command:
      gate?.command.replace('<url>', endpointUrl) ??
      `a2amesh conformance ${endpointUrl} --gate --json`,
    ciEquivalent: gate?.ciEquivalent ?? 'CI / conformance',
    required: true,
    actionable: true,
  };
}

function attachConformanceGateMetadata(
  report: ConformanceReport,
  endpointUrl: string,
  enabled: boolean,
): ConformanceReport | (ConformanceReport & { localGate: ConformanceGateMetadata }) {
  return enabled ? { ...report, localGate: conformanceGateMetadata(endpointUrl) } : report;
}

function mergeCliOptions(
  rootOptions: CliOptions,
  commandOptions: ConformanceCommandOptions,
): CliOptions {
  return { json: Boolean(rootOptions.json || commandOptions.json) };
}

export function createConformanceCommand(getOptions: RootOptionsProvider): Command {
  const command = addNetworkOptions(
    applyCommandDoc(new Command('conformance'), conformanceCommandDoc)
      .argument('<url>')
      .option(
        '--profile <id>',
        'Compatibility profile to run: official-a2a-v1.0, legacy-a2amesh, or experimental-a2a-v1.2',
      )
      .option(
        '--strict',
        'Run the strict official compatibility profile when --profile is not supplied',
      )
      .option(
        '--protocol-version <version>',
        'Protocol fixture version to run: 1.0 (or 1.2 with --experimental-profiles)',
        '1.0',
      )
      .option(
        '--experimental-profiles',
        'Allow a2amesh experimental protocol fixture profiles such as 1.2',
      )
      .option('--json', 'Machine-readable JSON output')
      .option('--gate', 'Run as the local release gate using the strict official A2A v1.0 profile')
      .option('--junit <path>', 'Write a JUnit XML report to a path'),
  );

  return command.action(
    async (url: string, commandOptions: ConformanceCommandOptions, actionCommand: Command) => {
      const mergedCommandOptions = actionCommand.optsWithGlobals<ConformanceCommandOptions>();
      const outputOptions = mergeCliOptions(getOptions(), mergedCommandOptions);

      try {
        const experimentalProfiles = Boolean(mergedCommandOptions.experimentalProfiles);
        const gateMode = Boolean(mergedCommandOptions.gate);
        const profile = mergedCommandOptions.profile
          ? parseConformanceProfileId(mergedCommandOptions.profile)
          : gateMode
            ? parseConformanceProfileId('official-a2a-v1.0')
            : undefined;
        const protocolVersion = parseConformanceProtocolVersion(
          gateMode ? '1.0' : (mergedCommandOptions.protocolVersion ?? '1.0'),
          { allowExperimental: experimentalProfiles },
        );
        const client = createA2AClient(url, mergedCommandOptions);
        const report = await withSpinner('Running conformance suite', outputOptions, () =>
          runConformanceSuite({
            client,
            endpointUrl: url,
            packageVersion: CLI_VERSION,
            protocolVersion,
            profile,
            strict: gateMode || Boolean(mergedCommandOptions.strict),
            experimentalProfiles,
          }),
        );

        if (mergedCommandOptions.junit) {
          writeJUnitReport(mergedCommandOptions.junit, report);
        }

        emitResult(attachConformanceGateMetadata(report, url, gateMode), outputOptions);
        if (hasRequiredConformanceFailures(report)) {
          process.exitCode = 1;
        }
      } catch (error) {
        writeError(`Conformance failed: ${errorMessage(error)}`);
        process.exitCode = 1;
      }
    },
  );
}
