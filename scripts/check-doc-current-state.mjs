import { fail, readText } from './check-utils.mjs';

const failures = [];
const readme = readText('README.md');
const historicalPath = 'docs/roadmap/open-issues-triage-2026-06-27.md';
const historical = readText(historicalPath);

const roadmapLink = /<a href="([^"]+)">Roadmap<\/a>/.exec(readme);
if (!roadmapLink || roadmapLink[1] !== 'ROADMAP.md') {
  failures.push('README.md: prominent Roadmap link must target ROADMAP.md');
}

const historicalRequirements = [
  '> **Historical snapshot — observed 2026-06-27.**',
  'is not the current roadmap or issue/milestone source of truth',
  '[current roadmap](../../ROADMAP.md)',
  '**Status**: Historical repository-backup triage snapshot',
];
if (!historicalRequirements.every((snippet) => historical.includes(snippet))) {
  failures.push(`${historicalPath}: historical snapshot must be explicitly marked non-current`);
}

if (failures.length > 0) fail('Current documentation state validation failed.', failures);
