import { getWorkspacePackages, readJson, readText, fail } from './check-utils.mjs';

const failures = [];

function readRequiredDoc(path) {
  try {
    return readText(path);
  } catch (error) {
    failures.push(`${path} is missing or unreadable: ${String(error)}`);
    return null;
  }
}

function requireIncludes(path, text, snippets) {
  if (text === null) return;
  for (const snippet of snippets) {
    if (!text.includes(snippet)) failures.push(`${path} missing required content: ${snippet}`);
  }
}

function requireNotIncludes(path, text, snippets) {
  if (text === null) return;
  for (const snippet of snippets) {
    if (text.includes(snippet)) failures.push(`${path} contains forbidden content: ${snippet}`);
  }
}

function requireDocsInSync(sourcePath, sourceText, mirrorPath, mirrorText) {
  if (sourceText === null || mirrorText === null) return;
  if (sourceText === mirrorText) return;

  const sourceLines = sourceText.split(/\r?\n/);
  const mirrorLines = mirrorText.split(/\r?\n/);
  const lineCount = Math.max(sourceLines.length, mirrorLines.length);
  for (let index = 0; index < lineCount; index += 1) {
    if (sourceLines[index] !== mirrorLines[index]) {
      failures.push(
        `${mirrorPath} must exactly match ${sourcePath}; first difference at line ${
          index + 1
        }: expected ${JSON.stringify(sourceLines[index] ?? '<EOF>')}, received ${JSON.stringify(
          mirrorLines[index] ?? '<EOF>',
        )}`,
      );
      return;
    }
  }
}

function stripInlineCode(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('`') && trimmed.endsWith('`') ? trimmed.slice(1, -1) : trimmed;
}

function splitMarkdownTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;

  const cells = [];
  let cell = '';
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const character = trimmed[index];
    if (character === '|' && trimmed[index - 1] !== '\\') {
      cells.push(stripInlineCode(cell.replace(/\\\|/g, '|')));
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(stripInlineCode(cell.replace(/\\\|/g, '|')));

  return cells;
}

function readSection(path, text, heading) {
  if (text === null) return '';
  const sectionStart = text.indexOf(`${heading}\n`);
  if (sectionStart === -1) {
    failures.push(`${path} missing required section: ${heading}`);
    return '';
  }

  const contentStart = sectionStart + heading.length + 1;
  const nextSectionStart = text.indexOf('\n## ', contentStart);
  return nextSectionStart === -1
    ? text.slice(contentStart)
    : text.slice(contentStart, nextSectionStart);
}

function parseMarkdownTable(path, text, heading) {
  const rows = [];
  const section = readSection(path, text, heading);
  for (const line of section.split(/\r?\n/)) {
    const cells = splitMarkdownTableRow(line);
    if (cells === null) continue;
    const isSeparator = cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
    const isHeader = cells.some((cell) => cell === 'Package' || cell === 'Peer dependency');
    if (!isSeparator && !isHeader) rows.push(cells);
  }
  return rows;
}

function requireTableRow(path, tableName, rows, expectedCells) {
  if (rows.some((row) => expectedCells.every((expected, index) => row[index] === expected))) return;
  failures.push(`${path} ${tableName} missing required row: ${expectedCells.join(' | ')}`);
}

const canonicalPath = 'docs/compatibility.md';
const sitePath = 'docs-site/guide/compatibility.md';
const canonicalDoc = readRequiredDoc(canonicalPath);
const siteDoc = readRequiredDoc(sitePath);
const rootReadme = readRequiredDoc('README.md');
const docsIndex = readRequiredDoc('docs/index.md');
const siteIndex = readRequiredDoc('docs-site/index.md');
const siteConfig = readRequiredDoc('docs-site/.vitepress/config.mts');
const protocolDoc = readRequiredDoc('docs/protocol/compatibility.md');
const protocolProfilesDoc = readRequiredDoc('docs/protocol/profiles.md');
const siteProtocolProfilesDoc = readRequiredDoc('docs-site/protocol/profiles.md');
const cliSource = readRequiredDoc('packages/cli/src/commands/conformance.ts');
const cliDoc = readRequiredDoc('docs/cli/conformance.md');
const siteCliDoc = readRequiredDoc('docs-site/cli/conformance.md');
const coreClient = readRequiredDoc('packages/runtime/src/client/A2AClient.ts');
const conformanceSource = readRequiredDoc('packages/runtime/src/testing/conformance.ts');
const conformanceProfilesSource = readRequiredDoc('packages/runtime/src/testing/profiles.ts');
const rootPackage = readJson('package.json');
const runtimeManifest = readJson('tools/runtime-versions.json');

const requiredHeadings = [
  '## Runtime Compatibility',
  '## Package Version Matrix',
  '## Protocol Version Matrix',
  '## Transport Feature Matrix',
  '## Adapter Optional Peer Ranges',
  '## Deprecation Policy',
  '## Validation Commands',
];

requireIncludes(canonicalPath, canonicalDoc, requiredHeadings);
requireIncludes(sitePath, siteDoc, requiredHeadings);
requireDocsInSync(canonicalPath, canonicalDoc, sitePath, siteDoc);
const packageMatrixRows = parseMarkdownTable(
  canonicalPath,
  canonicalDoc,
  '## Package Version Matrix',
);
const peerRangeRows = parseMarkdownTable(
  canonicalPath,
  canonicalDoc,
  '## Adapter Optional Peer Ranges',
);

requireIncludes(canonicalPath, canonicalDoc, [
  rootPackage.engines.node,
  `pnpm ${rootPackage.engines.pnpm}`,
  runtimeManifest.node,
  runtimeManifest.nodeCompatibility[0],
  runtimeManifest.nodeCompatibility[1],
  'Jod',
  'Krypton',
  '2027-04-30',
  '2028-04-30',
  'Node 25',
  'pnpm run docs:check',
  'pnpm run docs:build',
  'pnpm run lint:md',
]);

requireIncludes(canonicalPath, canonicalDoc, [
  '`0.3`',
  '`1.0`',
  '`1.2`',
  'HTTP+JSON',
  'SSE',
  'WebSocket',
  'gRPC',
]);
requireIncludes(canonicalPath, canonicalDoc, [
  'a2amesh experimental profile fixtures (opt-in)',
  'do not prefer this profile unless the caller opts in',
]);
requireNotIncludes(canonicalPath, canonicalDoc, [
  'Conformance fixture and client selection support',
]);

const publicPackages = getWorkspacePackages()
  .filter(
    ({ dir, packageJson }) =>
      packageJson.private !== true && dir.startsWith('packages/') && packageJson.name,
  )
  .sort((a, b) => a.packageJson.name.localeCompare(b.packageJson.name));

for (const { dir, packageJson } of publicPackages) {
  requireTableRow(canonicalPath, 'Package Version Matrix', packageMatrixRows, [
    packageJson.name,
    packageJson.version,
    packageJson.engines?.node ?? rootPackage.engines.node,
  ]);

  const readmePath = `${dir}/README.md`;
  const readme = readRequiredDoc(readmePath);
  const expectedLink = '[Compatibility](../../docs/compatibility.md)';
  requireIncludes(readmePath, readme, [expectedLink]);

  for (const [peerName, range] of Object.entries(packageJson.peerDependencies ?? {})) {
    requireTableRow(canonicalPath, 'Adapter Optional Peer Ranges', peerRangeRows, [
      packageJson.name,
      peerName,
      range,
    ]);
  }
}

requireIncludes('README.md', rootReadme, [
  '[Compatibility](docs/compatibility.md)',
  'a2amesh conformance http://127.0.0.1:3000 --protocol-version 1.0 --json',
]);
requireNotIncludes('README.md', rootReadme, [
  'a2amesh conformance http://127.0.0.1:3000 --protocol-version 1.2 --json',
]);
requireIncludes('docs/index.md', docsIndex, ['[Compatibility](compatibility.md)']);
requireIncludes('docs-site/index.md', siteIndex, ['[Compatibility](guide/compatibility.md)']);
requireIncludes('docs-site/.vitepress/config.mts', siteConfig, [
  "{ text: 'Compatibility', link: '/guide/compatibility' }",
]);
requireDocsInSync('docs/cli/conformance.md', cliDoc, 'docs-site/cli/conformance.md', siteCliDoc);
requireDocsInSync(
  'docs/protocol/profiles.md',
  protocolProfilesDoc,
  'docs-site/protocol/profiles.md',
  siteProtocolProfilesDoc,
);
requireIncludes('docs/cli/conformance.md', cliDoc, [
  '--protocol-version <version>  Protocol fixture version to run: 1.0 (or 1.2 with',
  '--experimental-profiles) (default: "1.0")',
  '--experimental-profiles',
  '--profile <id>',
  '--strict',
  'official conformance defaults to A2A `1.0`',
]);
requireIncludes('docs-site/cli/conformance.md', siteCliDoc, [
  '--protocol-version <version>  Protocol fixture version to run: 1.0 (or 1.2 with',
  '--experimental-profiles) (default: "1.0")',
  '--experimental-profiles',
  '--profile <id>',
  '--strict',
  'official conformance defaults to A2A `1.0`',
]);
requireNotIncludes('docs/cli/conformance.md', cliDoc, ['default: "1.2"']);
requireNotIncludes('docs-site/cli/conformance.md', siteCliDoc, ['default: "1.2"']);
requireIncludes('packages/cli/src/commands/conformance.ts', cliSource, [
  '--experimental-profiles',
  '--profile <id>',
  '--strict',
  'Protocol fixture version to run: 1.0 (or 1.2 with --experimental-profiles)',
  'parseConformanceProfileId',
  'allowExperimental: experimentalProfiles',
  'experimentalProfiles,',
]);
requireIncludes('packages/runtime/src/client/A2AClient.ts', coreClient, [
  "public static readonly supportedVersions = ['1.0'] as const;",
  "public static readonly experimentalProtocolVersions = ['1.2'] as const;",
  'preferredProtocolVersion',
  'allowExperimentalProtocolVersions',
]);
requireIncludes('packages/runtime/src/testing/conformance.ts', conformanceSource, [
  "export const officialConformanceProtocolVersion = '1.0' as const;",
  "export const experimentalConformanceProtocolVersions = ['1.2'] as const;",
  'experimentalProfiles?: boolean | undefined;',
  'profile?: ConformanceProfileId | undefined;',
  'allowExperimental?: boolean;',
  'resolveConformanceProfile',
  'profile: summarizeConformanceProfile(profile)',
]);

requireIncludes('packages/runtime/src/testing/profiles.ts', conformanceProfilesSource, [
  'official-a2a-v1.0',
  'legacy-a2amesh',
  'experimental-a2a-v1.2',
  'legacy-alias',
  'unsupported',
  'binding.http-json-rest',
  '#14',
]);
requireIncludes('docs/protocol/profiles.md', protocolProfilesDoc, [
  '# Protocol Profiles',
  'official-a2a-v1.0',
  'legacy-a2amesh',
  'experimental-a2a-v1.2',
  'legacy-alias',
]);
requireIncludes('docs-site/protocol/profiles.md', siteProtocolProfilesDoc, [
  '# Protocol Profiles',
  'official-a2a-v1.0',
  'legacy-a2amesh',
  'experimental-a2a-v1.2',
]);

requireIncludes('docs/protocol/compatibility.md', protocolDoc, [
  '## Official Target',
  '## Legacy Normalization',
  '## Experimental Profiles',
  'a2amesh experimental',
  'https://github.com/a2aproject/A2A/releases/tag/v1.0.0',
  '173695755607e884aa9acf8ce4feed90e32727a1',
  '7095fc0bad3d5a05edb6cfaf92e67d96bf91290c',
  'requires `--experimental-profiles`',
]);

requireIncludes(canonicalPath, canonicalDoc, [
  'minimum 90 days',
  'one minor release',
  'Removal conditions',
]);
requireIncludes(sitePath, siteDoc, ['minimum 90 days', 'one minor release', 'Removal conditions']);

if (failures.length > 0) fail('Compatibility documentation validation failed.', failures);
