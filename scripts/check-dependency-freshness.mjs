#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const MAX_FINDINGS = 20;

export function evaluateDependencyFreshness({
  audit,
  osv,
  dependabot,
  auditExitCode,
  osvExitCode,
  observedAt = new Date().toISOString(),
}) {
  const findings = [];
  const scannerFailures = [];

  collectAuditFindings(audit, findings, scannerFailures, auditExitCode);
  collectOsvFindings(osv, findings, scannerFailures, osvExitCode);
  collectDependabotFindings(dependabot, findings, scannerFailures);

  const deduped = dedupeFindings(findings).sort(compareFindings);
  const summary = renderSummary({ observedAt, findings: deduped, scannerFailures });
  return {
    exitCode: deduped.length > 0 || scannerFailures.length > 0 ? 1 : 0,
    findings: deduped,
    scannerFailures,
    summary,
  };
}

function collectAuditFindings(audit, findings, scannerFailures, exitCode) {
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
    scannerFailures.push('pnpm audit output was not valid JSON data');
    return;
  }

  const advisories = Object.values(audit.advisories ?? {});
  for (const advisory of advisories) {
    const severity = normalizeSeverity(advisory?.severity);
    if (!BLOCKING_SEVERITIES.has(severity)) continue;
    findings.push({
      source: 'pnpm audit',
      package: safePackageName(advisory?.module_name),
      severity,
      remediation: hasPatchedRange(advisory?.patched_versions) ? 'available' : 'not listed',
    });
  }

  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 1) {
    scannerFailures.push('pnpm audit did not complete successfully');
    return;
  }

  const counts = audit.metadata?.vulnerabilities ?? {};
  const expectedBlocking = Number(counts.high ?? 0) + Number(counts.critical ?? 0);
  if (
    exitCode === 1 &&
    expectedBlocking > 0 &&
    !findings.some((item) => item.source === 'pnpm audit')
  ) {
    scannerFailures.push(
      'pnpm audit reported blocking findings that could not be summarized safely',
    );
  } else if (exitCode === 1 && expectedBlocking === 0) {
    scannerFailures.push('pnpm audit did not complete successfully');
  }
}

function collectOsvFindings(osv, findings, scannerFailures, exitCode) {
  if (!osv || typeof osv !== 'object' || Array.isArray(osv) || !Array.isArray(osv.results)) {
    scannerFailures.push('OSV output was not valid JSON data');
    return;
  }

  const observations = collectOsvObservations(osv.results);
  let unknownSeverityCount = 0;
  for (const { packageName, vulnerability } of observations) {
    const severity = osvSeverity(vulnerability);
    if (severity === 'unknown') unknownSeverityCount += 1;
    if (!BLOCKING_SEVERITIES.has(severity)) continue;
    findings.push({
      source: 'OSV',
      package: packageName,
      severity,
      remediation: osvHasFix(vulnerability) ? 'available' : 'not listed',
    });
  }
  const vulnerabilityCount = observations.length;

  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 1) {
    scannerFailures.push('OSV-Scanner did not complete successfully');
    return;
  }
  if (exitCode === 1 && vulnerabilityCount === 0) {
    scannerFailures.push('OSV-Scanner reported findings that were missing from its JSON output');
  }
  if (unknownSeverityCount > 0) {
    scannerFailures.push('OSV-Scanner returned vulnerability data with unclassified severity');
  }
  if (exitCode === 0 && vulnerabilityCount > 0) {
    scannerFailures.push(
      'OSV-Scanner returned inconsistent success status with vulnerability data',
    );
  }
}

function collectOsvObservations(results) {
  return results.flatMap((result) =>
    (result?.packages ?? []).flatMap((entry) => {
      const packageName = safePackageName(entry?.package?.name);
      return (entry?.vulnerabilities ?? []).map((vulnerability) => ({
        packageName,
        vulnerability,
      }));
    }),
  );
}

function collectDependabotFindings(alerts, findings, scannerFailures) {
  if (!Array.isArray(alerts)) {
    scannerFailures.push('Dependabot alert output was not a JSON array');
    return;
  }
  for (const alert of alerts) {
    if (alert?.state !== 'open') continue;
    const severity = normalizeSeverity(alert?.security_advisory?.severity);
    if (!BLOCKING_SEVERITIES.has(severity)) continue;
    findings.push({
      source: 'Dependabot',
      package: safePackageName(alert?.dependency?.package?.name),
      severity,
      remediation: alert?.security_vulnerability?.first_patched_version?.identifier
        ? 'available'
        : 'not listed',
    });
  }
}

function osvSeverity(vulnerability) {
  const databaseSeverity = normalizeSeverity(vulnerability?.database_specific?.severity);
  if (databaseSeverity !== 'unknown') return databaseSeverity;
  const scores = Array.isArray(vulnerability?.severity) ? vulnerability.severity : [];
  for (const entry of scores) {
    const numeric = Number(entry?.score);
    if (Number.isFinite(numeric)) return severityFromScore(numeric);
  }
  return 'unknown';
}

function severityFromScore(score) {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'moderate';
  if (score > 0) return 'low';
  return 'unknown';
}

function osvHasFix(vulnerability) {
  return (vulnerability?.affected ?? []).some((affected) =>
    (affected?.ranges ?? []).some((range) =>
      (range?.events ?? []).some(
        (event) => typeof event?.fixed === 'string' && event.fixed.length > 0,
      ),
    ),
  );
}

function hasPatchedRange(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length > 0 && normalized !== '<0.0.0' && normalized !== '<=0.0.0';
}

function normalizeSeverity(value) {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'medium') return 'moderate';
  return ['info', 'low', 'moderate', 'high', 'critical'].includes(normalized)
    ? normalized
    : 'unknown';
}

function safePackageName(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return '<unknown-package>';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replaceAll('|', '/')
    .trim()
    .slice(0, 100);
}

function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.source}\u0000${finding.package}\u0000${finding.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareFindings(left, right) {
  const rank = { critical: 0, high: 1 };
  return (
    (rank[left.severity] ?? 9) - (rank[right.severity] ?? 9) ||
    left.package.localeCompare(right.package) ||
    left.source.localeCompare(right.source)
  );
}

function renderSummary({ observedAt, findings, scannerFailures }) {
  const lines = [
    '## Dependency advisory freshness',
    '',
    `Observed at: \`${safeTimestamp(observedAt)}\``,
    '',
    'Blocking threshold: **high / critical**.',
    '',
  ];

  if (findings.length === 0) {
    lines.push('No high or critical dependency advisories observed.');
  } else {
    lines.push(
      '| Source | Package | Severity | Remediation |',
      '| ------ | ------- | -------- | ----------- |',
    );
    for (const finding of findings.slice(0, MAX_FINDINGS)) {
      lines.push(
        `| ${finding.source} | \`${finding.package}\` | ${finding.severity.toUpperCase()} | ${finding.remediation} |`,
      );
    }
    if (findings.length > MAX_FINDINGS) {
      lines.push('', `_${findings.length - MAX_FINDINGS} additional findings omitted._`);
    }
  }

  if (scannerFailures.length > 0) {
    lines.push('', 'Scanner status:');
    for (const failure of scannerFailures.slice(0, 5)) lines.push(`- ${failure}`);
  }

  return `${lines.join('\n')}\n`.slice(0, 6000);
}

function safeTimestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '<invalid-observation-time>' : parsed.toISOString();
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${label} must be readable JSON`);
  }
}

function readStatus(path, label) {
  const value = Number(readFileSync(path, 'utf8').trim());
  if (!Number.isInteger(value)) throw new Error(`${label} status must be an integer`);
  return value;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith('--')) throw new Error(`Unknown argument: ${key ?? '<missing>'}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    options[key.slice(2)] = value;
    index += 1;
  }
  for (const required of ['audit', 'audit-status', 'osv', 'osv-status', 'dependabot']) {
    if (!options[required]) throw new Error(`--${required} is required`);
  }
  return options;
}

function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const result = evaluateDependencyFreshness({
    audit: readJson(options.audit, 'pnpm audit output'),
    auditExitCode: readStatus(options['audit-status'], 'pnpm audit'),
    osv: readJson(options.osv, 'OSV output'),
    osvExitCode: readStatus(options['osv-status'], 'OSV'),
    dependabot: readJson(options.dependabot, 'Dependabot alert output'),
    observedAt: process.env.DEPENDENCY_FRESHNESS_OBSERVED_AT ?? new Date().toISOString(),
  });

  process.stdout.write(result.summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.summary);
  process.exitCode = result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
