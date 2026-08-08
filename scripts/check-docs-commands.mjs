import { execFileSync } from 'node:child_process';
import { readJson, readText, fail } from './check-utils.mjs';
import { expectedDistTag } from './release-state-core.mjs';

execFileSync(process.execPath, ['scripts/generate-command-docs.mjs', '--check'], {
  stdio: 'inherit',
});

const commandIndex = readText('docs/cli/index.md');
const requiredCommands = [
  ...new Set([...commandIndex.matchAll(/`a2amesh ([a-z][a-z0-9-]*)`/g)].map((match) => match[1])),
].sort();

const PUBLIC_INSTALL_PACKAGES = ['runtime', 'protocol', 'registry', 'cli', 'mcp', 'create-a2amesh'];
const PUBLIC_PACKAGE_PATTERN = new RegExp(
  `@a2amesh/(?:${PUBLIC_INSTALL_PACKAGES.join('|')})(?:@([0-9A-Za-z][0-9A-Za-z._-]*))?`,
  'g',
);
const INSTALL_COMMAND_PATTERN =
  /\b(?:pnpm\s+(?:add|dlx)|npm\s+(?:install|exec)|yarn\s+(?:add|dlx)|npx\b)/;
const UNSCOPED_CREATE_PATTERN = /\b(?:npm|pnpm|yarn)\s+create\s+a2amesh(?:\s|$)/;

const PUBLIC_INSTALL_DOC_PATHS = [
  'README.md',
  'docs/install.md',
  'docs/quickstart.md',
  'docs/faq.md',
  'docs/distribution.md',
  'docs/packages/runtime.md',
  'docs/packages/protocol.md',
  'docs/packages/registry.md',
  'docs/packages/cli.md',
  'docs/packages/mcp.md',
  'docs/packages/create-a2amesh.md',
  'packages/runtime/README.md',
  'packages/protocol/README.md',
  'packages/registry/README.md',
  'packages/cli/README.md',
  'packages/mcp/README.md',
  'packages/create-a2amesh/README.md',
  'docs-site/guide/installation.md',
  'docs-site/guide/quick-start.md',
  'docs-site/guide/demo.md',
  'docs-site/packages/runtime.md',
  'docs-site/packages/protocol.md',
  'docs-site/packages/registry.md',
  'docs-site/packages/cli.md',
  'docs-site/packages/mcp.md',
  'docs-site/packages/create-a2amesh.md',
  'docs-site/public/screenshots/quick-demo-flow.svg',
];

export function validatePublicInstallPolicy(documents, activeVersion = '0.0.0-alpha.0') {
  const channel = expectedDistTag(activeVersion);
  const prerelease = channel !== 'latest';
  const failures = [];
  for (const [path, text] of Object.entries(documents)) {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (UNSCOPED_CREATE_PATTERN.test(line)) {
        failures.push(
          `${path}: unscoped create shorthand cannot select the supported @a2amesh alpha package: ${line}`,
        );
        continue;
      }
      const commandMatch = INSTALL_COMMAND_PATTERN.exec(line);
      if (!commandMatch) continue;
      const command = line.slice(commandMatch.index);

      PUBLIC_PACKAGE_PATTERN.lastIndex = 0;
      for (const match of command.matchAll(PUBLIC_PACKAGE_PATTERN)) {
        const selector = match[1];
        const supported = prerelease
          ? selector === channel || selector === activeVersion
          : selector === undefined || selector === 'latest' || selector === activeVersion;
        if (supported) continue;
        failures.push(
          prerelease
            ? `${path}: public prerelease command must select @${channel} or an exact version: ${line}`
            : `${path}: stable public command must resolve latest or exact active version: ${line}`,
        );
        break;
      }
    }
  }
  return failures;
}

const failures = [];
const releaseManifest = readJson('.release-please-manifest.json');
const activeVersion = releaseManifest['packages/runtime'];
if (
  typeof activeVersion !== 'string' ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(activeVersion)
) {
  failures.push('.release-please-manifest.json: packages/runtime must provide the active semver');
} else {
  const publicInstallDocuments = Object.fromEntries(
    PUBLIC_INSTALL_DOC_PATHS.map((path) => [path, readText(path)]),
  );
  failures.push(...validatePublicInstallPolicy(publicInstallDocuments, activeVersion));
}

for (const command of requiredCommands) {
  const path = `docs/cli/${command}.md`;
  const text = readText(path);
  if (!text.includes(`a2amesh ${command}`)) failures.push(`${path}: missing command example`);
  if (!text.includes('```bash')) failures.push(`${path}: missing bash example block`);
  if (!text.includes('```powershell')) failures.push(`${path}: missing PowerShell example block`);
}

const readme = readText('README.md');
for (const command of requiredCommands) {
  if (!readme.includes(`a2amesh ${command}`)) {
    failures.push(`README.md: missing ${command} example`);
  }
}

if (failures.length > 0) fail('Command documentation validation failed.', failures);
