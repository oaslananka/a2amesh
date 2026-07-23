import { compareSemanticVersions } from './release-state-core.mjs';

export const REPOSITORY_EVIDENCE_START = '<!-- repository-evidence:start -->';
export const REPOSITORY_EVIDENCE_END = '<!-- repository-evidence:end -->';

const REQUIRED_PROVENANCE = [
  'repository',
  'issues',
  'pull_requests',
  'releases',
  'npm',
  'source_versions',
];
const LEGACY_VOLATILE_WORDING = [
  'Release Please PR remains open',
  'PR #41',
  'needs UI confirmation',
  'GitHub refresh pending',
  'No latest release reported',
  'No Docker image product',
];

export function validateRepositoryEvidence(snapshot, localState, now = new Date()) {
  const failures = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return ['Repository evidence must be a JSON object'];
  }
  if (snapshot.schema_version !== 1) failures.push('Repository evidence schema_version must be 1');

  validateFreshness(snapshot, now, failures);
  validateRepository(snapshot.repository, failures);
  validateRelease(snapshot.release, localState, failures);
  validateSettings(snapshot.settings, now, failures);
  validateProvenance(snapshot.provenance, failures);
  return failures;
}

function validateFreshness(snapshot, now, failures) {
  const cadence = snapshot.refresh_cadence_days;
  if (!Number.isInteger(cadence) || cadence < 1 || cadence > 30) {
    failures.push('Repository evidence refresh_cadence_days must be between 1 and 30');
    return;
  }
  const observedAt = parseIsoDateTime(snapshot.observed_at);
  if (!observedAt) {
    failures.push('Repository evidence observed_at must be a valid ISO timestamp');
    return;
  }
  if (observedAt.valueOf() > now.valueOf() + 300_000) {
    failures.push('Repository evidence observed_at must not be in the future');
    return;
  }
  const ageDays = (now.valueOf() - observedAt.valueOf()) / 86_400_000;
  if (ageDays > cadence) {
    failures.push(`Repository evidence is older than its ${cadence}-day refresh cadence`);
  }
}

function validateRepository(repository, failures) {
  if (!repository || typeof repository !== 'object') {
    failures.push('Repository evidence must include repository metadata');
    return;
  }
  for (const field of ['name', 'url', 'default_branch', 'visibility', 'license']) {
    requireNonEmpty(repository[field], `Repository ${field} must be recorded`, failures);
  }
  const openWork = repository.open_work;
  if (!openWork || typeof openWork !== 'object') {
    failures.push('Repository evidence must include open-work counts');
    return;
  }
  for (const field of ['issues', 'pull_requests', 'total']) {
    if (!Number.isInteger(openWork[field]) || openWork[field] < 0) {
      failures.push(`Open-work ${field} must be a non-negative integer`);
    }
  }
  if (
    Number.isInteger(openWork.issues) &&
    Number.isInteger(openWork.pull_requests) &&
    Number.isInteger(openWork.total) &&
    openWork.total !== openWork.issues + openWork.pull_requests
  ) {
    failures.push(
      `Open-work total ${openWork.total} must equal issues ${openWork.issues} plus pull requests ${openWork.pull_requests}`,
    );
  }
}

function validateRelease(release, localState, failures) {
  if (!release || typeof release !== 'object') {
    failures.push('Repository evidence must include release metadata');
    return;
  }
  const manifest = localState?.manifest ?? {};
  const releaseConfig = localState?.releaseConfig ?? {};
  const packageVersions = localState?.packageVersions ?? {};
  const configuredPaths = Object.keys(releaseConfig.packages ?? {}).sort();
  const manifestPaths = Object.keys(manifest).sort();
  const evidencePaths = Array.isArray(release.package_paths)
    ? [...release.package_paths].sort()
    : [];
  const manifestVersions = uniqueValues(Object.values(manifest));

  if (manifestVersions.length !== 1) {
    failures.push(
      `Linked release manifest versions must agree; found: ${manifestVersions.join(', ') || '<none>'}`,
    );
  }
  if (JSON.stringify(manifestPaths) !== JSON.stringify(configuredPaths)) {
    failures.push('Release manifest paths must match release configuration paths');
  }
  if (JSON.stringify(evidencePaths) !== JSON.stringify(configuredPaths)) {
    failures.push('Evidence package paths must match release configuration paths');
  }
  if (manifestVersions.length === 1 && release.source_version !== manifestVersions[0]) {
    failures.push(
      `Evidence source version ${release.source_version ?? '<missing>'} does not match release manifest ${manifestVersions[0]}`,
    );
  }
  for (const path of configuredPaths) {
    if (packageVersions[path] !== release.source_version) {
      failures.push(
        `${path}: package version ${packageVersions[path] ?? '<missing>'} does not match evidence source version ${release.source_version ?? '<missing>'}`,
      );
    }
  }

  const expectedTag = release.source_version ? `@a2amesh/runtime-v${release.source_version}` : null;
  if (release.latest_canonical_tag?.name !== expectedTag) {
    failures.push(
      `Latest canonical tag ${release.latest_canonical_tag?.name ?? '<missing>'} must match ${expectedTag ?? '<unknown>'}`,
    );
  }
  if (release.npm?.alpha !== release.source_version) {
    failures.push(
      `npm alpha version ${release.npm?.alpha ?? '<missing>'} must match source version ${release.source_version ?? '<missing>'}`,
    );
  }
  validateReleasePullRequest(release.active_release_pr, release.source_version, failures);
}

function validateReleasePullRequest(releasePr, sourceVersion, failures) {
  if (releasePr == null) return;
  for (const field of ['number', 'title', 'url', 'proposed_version']) {
    if (field === 'number') {
      if (!Number.isInteger(releasePr.number) || releasePr.number < 1) {
        failures.push('Active release PR number must be a positive integer');
      }
    } else {
      requireNonEmpty(releasePr[field], `Active release PR ${field} must be recorded`, failures);
    }
  }
  const comparison = compareSemanticVersions(releasePr.proposed_version, sourceVersion);
  if (comparison == null || comparison <= 0) {
    failures.push(
      `Active release PR version ${releasePr.proposed_version ?? '<missing>'} must advance source version ${sourceVersion ?? '<missing>'}`,
    );
  }
}

function validateSettings(settings, now, failures) {
  if (!Array.isArray(settings) || settings.length === 0) {
    failures.push('Repository evidence must include manually verified settings');
    return;
  }
  for (const setting of settings) validateSetting(setting, now, failures);
}

function validateSetting(setting, now, failures) {
  const name = nonEmpty(setting?.name) ? setting.name : '<unnamed setting>';
  if (!nonEmpty(setting?.owner)) failures.push(`${name}: settings evidence must include an owner`);
  if (!nonEmpty(setting?.value)) failures.push(`${name}: settings evidence must include a value`);
  if (!nonEmpty(setting?.source)) failures.push(`${name}: settings evidence must include a source`);
  const cadence = setting?.refresh_cadence_days;
  if (!Number.isInteger(cadence) || cadence < 1 || cadence > 180) {
    failures.push(`${name}: settings refresh cadence must be between 1 and 180 days`);
    return;
  }
  const observedAt = parseIsoDate(setting?.observed_at);
  if (!observedAt) {
    failures.push(`${name}: settings observed_at must be a valid YYYY-MM-DD date`);
    return;
  }
  const ageDays = (now.valueOf() - observedAt.valueOf()) / 86_400_000;
  if (ageDays > cadence) {
    failures.push(`${name}: settings evidence is older than its ${cadence}-day refresh cadence`);
  }
}

function validateProvenance(provenance, failures) {
  if (!provenance || typeof provenance !== 'object') {
    failures.push('Repository evidence must include provenance');
    return;
  }
  for (const field of REQUIRED_PROVENANCE) {
    requireNonEmpty(
      provenance[field],
      `Repository evidence provenance ${field} must be recorded`,
      failures,
    );
  }
}

export function renderRepositoryEvidence(snapshot) {
  const releasePr = snapshot.release.active_release_pr;
  const githubRelease = snapshot.release.latest_github_release;
  const openWork = snapshot.repository.open_work;
  const lines = [
    REPOSITORY_EVIDENCE_START,
    '## Live repository evidence',
    '',
    `Observed at **${snapshot.observed_at}**. This generated section must be refreshed within ${snapshot.refresh_cadence_days} days from the machine-readable snapshot in [\`docs/governance/repository-evidence.json\`](governance/repository-evidence.json).`,
    '',
    'Refresh with `pnpm run repository:evidence:write`; CI validates freshness and local release parity through `pnpm run repository:evidence:check` in `docs:check`.',
    '',
    '| Fact | Observed value | Authoritative source |',
    '| ---- | -------------- | -------------------- |',
    `| Repository | [\`${snapshot.repository.name}\`](${snapshot.repository.url}); ${snapshot.repository.visibility}; default branch \`${snapshot.repository.default_branch}\`; license \`${snapshot.repository.license}\` | ${snapshot.provenance.repository} |`,
    `| Linked source version | \`${snapshot.release.source_version}\` across ${snapshot.release.package_paths.length} public packages | ${snapshot.provenance.source_versions} |`,
    `| npm publication | \`alpha\` → \`${snapshot.release.npm.alpha}\`; \`latest\` → \`${snapshot.release.npm.latest}\` | ${snapshot.provenance.npm} |`,
    `| Latest canonical release tag | \`${snapshot.release.latest_canonical_tag.name}\` at \`${shortCommit(snapshot.release.latest_canonical_tag.commit)}\` | ${snapshot.provenance.releases} |`,
    `| Latest GitHub Release | ${githubRelease ? `[\`${githubRelease.tag}\`](${githubRelease.url})` : 'None published'} | ${snapshot.provenance.releases} |`,
    `| Active Release Please PR | ${releasePr ? `[#${releasePr.number}](${releasePr.url}) proposes \`${releasePr.proposed_version}\`` : 'None'} | ${snapshot.provenance.pull_requests} |`,
    `| Open work | ${openWork.issues} issues and ${openWork.pull_requests} pull request${openWork.pull_requests === 1 ? '' : 's'} (${openWork.total} total) | ${snapshot.provenance.issues}; ${snapshot.provenance.pull_requests} |`,
    '',
    '### Manually verified repository settings',
    '',
    '| Setting | Observed value | Owner | Observation and cadence | Source |',
    '| ------- | -------------- | ----- | ----------------------- | ------ |',
    ...snapshot.settings.map(
      (setting) =>
        `| ${escapeTable(setting.name)} | ${escapeTable(setting.value)} | ${escapeTable(setting.owner)} | ${setting.observed_at}; refresh every ${setting.refresh_cadence_days} days | ${escapeTable(setting.source)} |`,
    ),
    '',
    REPOSITORY_EVIDENCE_END,
  ];
  return `${lines.join('\n')}\n`;
}

export function injectRepositoryEvidence(report, renderedSection) {
  const start = report.indexOf(REPOSITORY_EVIDENCE_START);
  const end = report.indexOf(REPOSITORY_EVIDENCE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Maturity report must contain one repository-evidence marker pair');
  }
  const afterEnd = end + REPOSITORY_EVIDENCE_END.length;
  return `${report.slice(0, start)}${renderedSection.trimEnd()}${report.slice(afterEnd)}`;
}

export function validateMaturityReport(report) {
  const failures = [];
  const startCount = countOccurrences(report, REPOSITORY_EVIDENCE_START);
  const endCount = countOccurrences(report, REPOSITORY_EVIDENCE_END);
  if (startCount !== 1 || endCount !== 1) {
    failures.push('Maturity report must contain exactly one repository-evidence marker pair');
  }
  const narrative = removeGeneratedSection(report);
  const lower = narrative.toLowerCase();
  for (const wording of LEGACY_VOLATILE_WORDING) {
    if (lower.includes(wording.toLowerCase())) {
      failures.push(`Maturity report contains stale volatile wording: ${wording}`);
    }
  }
  return failures;
}

function removeGeneratedSection(report) {
  const start = report.indexOf(REPOSITORY_EVIDENCE_START);
  const end = report.indexOf(REPOSITORY_EVIDENCE_END);
  if (start === -1 || end === -1 || end < start) return report;
  return `${report.slice(0, start)}${report.slice(end + REPOSITORY_EVIDENCE_END.length)}`;
}

function parseIsoDateTime(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value ? null : parsed;
}

function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function requireNonEmpty(value, message, failures) {
  if (!nonEmpty(value)) failures.push(message);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function countOccurrences(text, value) {
  return text.split(value).length - 1;
}

function shortCommit(commit) {
  return typeof commit === 'string' ? commit.slice(0, 12) : '<missing>';
}

function escapeTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}
