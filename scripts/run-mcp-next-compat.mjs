import { appendFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { evaluateMcpNextProbeResult, validateMcpNextProbePayload } from './mcp-compatibility.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harness = resolve(root, 'tests/compat/mcp-2026-07-28/sdk-v2');
const reportOnly = process.argv.includes('--report-only');
const commands = [
  ['install', ['pnpm', 'install', '--dir', harness, '--frozen-lockfile']],
  ['test', ['pnpm', '--dir', harness, 'test']],
  ['probe', ['pnpm', '--dir', harness, 'probe']],
];

let report;
try {
  for (const [name, args] of commands) {
    const result = runCorepack(args);
    if (result.status !== 0) {
      report = evaluateMcpNextProbeResult({
        exitCode: result.status ?? 1,
        stdout: result.stdout,
        stderr: `${name} failed\n${result.stderr}`,
      });
      break;
    }
    if (name === 'probe') {
      report = evaluateProbeOutput(result.stdout, result.stderr);
    }
  }
} finally {
  rmSync(resolve(harness, 'node_modules'), { recursive: true, force: true });
}

report ??= {
  status: 'incompatible',
  exitCode: 1,
  summary: 'candidate probe did not produce a report',
};
writeSummary(report);
process.stdout.write(`${JSON.stringify(report)}\n`);
if (reportOnly && report.status !== 'compatible') {
  process.stderr.write(
    '::warning title=MCP next compatibility::Candidate SDK probe is incompatible; stable MCP support remains unchanged.\n',
  );
}
process.exitCode = reportOnly ? 0 : report.exitCode;

function runCorepack(args) {
  return spawnSync('corepack', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
    maxBuffer: 5 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
}

function evaluateProbeOutput(stdout, stderr) {
  try {
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const payload = JSON.parse(lines.at(-1) ?? '');
    const failures = validateMcpNextProbePayload(payload);
    if (failures.length === 0) {
      return {
        status: 'compatible',
        exitCode: 0,
        summary: `Exact SDK v2 probe passed: ${payload.methods.join(' -> ')}; auth=${payload.unauthorizedStatus}; tools=${payload.tools.names.join(',')}.`,
      };
    }
    return evaluateMcpNextProbeResult({
      exitCode: 1,
      stdout: failures.join('\n'),
      stderr,
    });
  } catch (error) {
    return evaluateMcpNextProbeResult({
      exitCode: 1,
      stdout,
      stderr: `${stderr}\nInvalid candidate probe JSON: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
  }
}

function writeSummary(result) {
  const markdown = [
    '## MCP 2026-07-28 candidate compatibility',
    '',
    `- Status: **${result.status}**`,
    '- Stable package path: `@modelcontextprotocol/sdk ^1.29.0` (unchanged)',
    '- Candidate package set: split SDK `2.0.0` (isolated harness)',
    `- Evidence: ${result.summary.replaceAll('\n', ' ')}`,
    '',
    result.status === 'compatible'
      ? 'This is pre-adoption evidence only; it does not change the published support claim.'
      : 'The candidate lane is report-only; the stable required lane remains authoritative.',
    '',
  ].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}
