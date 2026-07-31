import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedSkills = ['a2a-endpoint-validation', 'a2a-task-operations', 'a2a-mcp-consumption'];

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const repoRoot = resolve(
  rootIndex >= 0 ? (args[rootIndex + 1] ?? '') : fileURLToPath(new URL('..', import.meta.url)),
);
const runClaudeLifecycle = args.includes('--claude-lifecycle');
const runClaudeValidation = args.includes('--claude') || runClaudeLifecycle;
const failures = [];

async function readRequired(path) {
  try {
    return await readFile(join(repoRoot, path), 'utf8');
  } catch (error) {
    failures.push(`${path} is missing or unreadable: ${String(error)}`);
    return '';
  }
}

function parseJson(path, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`${path} is not valid JSON: ${String(error)}`);
    return {};
  }
}

function parseFrontmatter(path, text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) {
    failures.push(`${path} must start with YAML frontmatter`);
    return {};
  }
  const values = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files.sort();
}

async function digestTree(root) {
  const hash = createHash('sha256');
  for (const path of await listFiles(root)) {
    hash.update(relative(root, path));
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function replaceDirectory(source, destination) {
  const temporary = `${destination}.next`;
  await rm(temporary, { force: true, recursive: true });
  await cp(source, temporary, { recursive: true });
  await rm(destination, { force: true, recursive: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(temporary, destination, { recursive: true });
  await rm(temporary, { force: true, recursive: true });
}

async function validateInstalledBundle(bundleRoot, expectedVersion) {
  const manifest = JSON.parse(
    await readFile(join(bundleRoot, '.claude-plugin/plugin.json'), 'utf8'),
  );
  if (manifest.name !== 'a2amesh') throw new Error('installed plugin name differs');
  if (manifest.version !== expectedVersion) throw new Error('installed plugin version differs');
  for (const skill of expectedSkills) {
    await stat(join(bundleRoot, 'skills', skill, 'SKILL.md'));
  }
}

async function copySourceBundle(destination) {
  await mkdir(join(destination, '.claude-plugin'), { recursive: true });
  await cp(
    join(repoRoot, '.claude-plugin/plugin.json'),
    join(destination, '.claude-plugin/plugin.json'),
  );
  await cp(join(repoRoot, 'skills'), join(destination, 'skills'), { recursive: true });
}

function adjacentPrereleaseVersion(version, delta) {
  const match = /^(.*?)(\d+)$/.exec(version);
  if (!match) throw new Error(`cannot derive adjacent version from ${version}`);
  const numeric = Number(match[2]) + delta;
  if (numeric < 0) throw new Error(`cannot derive a lower version from ${version}`);
  return `${match[1]}${numeric}`;
}

async function validateLifecycle(currentVersion) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'a2amesh-plugin-lifecycle-'));
  try {
    const source = join(temporaryRoot, 'source');
    const previous = join(temporaryRoot, 'previous');
    const installed = join(temporaryRoot, 'installed', 'a2amesh');
    const backup = join(temporaryRoot, 'backup');

    await copySourceBundle(source);
    await cp(source, previous, { recursive: true });
    const previousVersion = adjacentPrereleaseVersion(currentVersion, -1);
    const previousManifestPath = join(previous, '.claude-plugin/plugin.json');
    const previousManifest = JSON.parse(await readFile(previousManifestPath, 'utf8'));
    previousManifest.version = previousVersion;
    await writeFile(previousManifestPath, `${JSON.stringify(previousManifest, null, 2)}\n`);
    const previousSkillPath = join(previous, 'skills/a2a-endpoint-validation/SKILL.md');
    await writeFile(
      previousSkillPath,
      `${await readFile(previousSkillPath, 'utf8')}\n<!-- previous lifecycle fixture -->\n`,
    );

    await replaceDirectory(previous, installed);
    await validateInstalledBundle(installed, previousVersion);
    await cp(installed, backup, { recursive: true });
    const previousDigest = await digestTree(installed);

    await replaceDirectory(source, installed);
    await validateInstalledBundle(installed, currentVersion);
    if ((await digestTree(installed)) !== (await digestTree(source))) {
      throw new Error('clean upgrade did not reproduce the source bundle');
    }

    await replaceDirectory(backup, installed);
    await validateInstalledBundle(installed, previousVersion);
    if ((await digestTree(installed)) !== previousDigest) {
      throw new Error('rollback did not restore the previous bundle');
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

async function writeClaudeMarketplace(path, version) {
  const marketplace = {
    name: 'a2amesh-lifecycle-test',
    description: 'Isolated A2A Mesh plugin lifecycle validation marketplace.',
    owner: { name: 'oaslananka' },
    plugins: [
      {
        name: 'a2amesh',
        description: 'A2A Mesh lifecycle validation fixture.',
        version,
        source: './plugins/a2amesh',
      },
    ],
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(marketplace, null, 2)}\n`);
}

async function setBundleVersion(bundleRoot, version, marker) {
  const manifestPath = join(bundleRoot, '.claude-plugin/plugin.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (marker) {
    const skillPath = join(bundleRoot, 'skills/a2a-endpoint-validation/SKILL.md');
    await writeFile(skillPath, `${await readFile(skillPath, 'utf8')}\n<!-- ${marker} -->\n`);
  }
}

async function validateClaudeLifecycle(currentVersion) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'a2amesh-claude-plugin-'));
  const marketplaceRoot = join(temporaryRoot, 'marketplace');
  const pluginRoot = join(marketplaceRoot, 'plugins', 'a2amesh');
  const marketplacePath = join(marketplaceRoot, '.claude-plugin', 'marketplace.json');
  const environment = { ...process.env, HOME: join(temporaryRoot, 'home') };
  const pluginId = 'a2amesh@a2amesh-lifecycle-test';

  const runClaude = (commandArgs, capture = false) =>
    execFileSync('claude', commandArgs, {
      cwd: repoRoot,
      env: environment,
      encoding: capture ? 'utf8' : undefined,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });

  try {
    await copySourceBundle(pluginRoot);
    await writeClaudeMarketplace(marketplacePath, currentVersion);
    runClaude(['plugin', 'validate', '--strict', marketplaceRoot]);
    runClaude(['plugin', 'marketplace', 'add', marketplaceRoot, '--scope', 'user']);
    runClaude(['plugin', 'install', pluginId, '--scope', 'user']);
    const installed = runClaude(['plugin', 'list'], true);
    if (!installed.includes(`Version: ${currentVersion}`)) {
      throw new Error(`Claude Code clean install did not report ${currentVersion}`);
    }

    const nextVersion = adjacentPrereleaseVersion(currentVersion, 1);
    await setBundleVersion(pluginRoot, nextVersion, 'lifecycle upgrade fixture');
    await writeClaudeMarketplace(marketplacePath, nextVersion);
    runClaude(['plugin', 'marketplace', 'update', 'a2amesh-lifecycle-test']);
    runClaude(['plugin', 'update', pluginId]);
    const upgraded = runClaude(['plugin', 'list'], true);
    if (!upgraded.includes(`Version: ${nextVersion}`)) {
      throw new Error(`Claude Code upgrade did not report ${nextVersion}`);
    }

    await rm(pluginRoot, { force: true, recursive: true });
    await copySourceBundle(pluginRoot);
    await writeClaudeMarketplace(marketplacePath, currentVersion);
    runClaude(['plugin', 'marketplace', 'update', 'a2amesh-lifecycle-test']);
    runClaude(['plugin', 'uninstall', pluginId, '--scope', 'user']);
    runClaude(['plugin', 'install', pluginId, '--scope', 'user']);
    const rolledBack = runClaude(['plugin', 'list'], true);
    if (!rolledBack.includes(`Version: ${currentVersion}`)) {
      throw new Error(`Claude Code rollback did not restore ${currentVersion}`);
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

const manifestPath = '.claude-plugin/plugin.json';
const manifest = parseJson(manifestPath, await readRequired(manifestPath));
const cliPackage = parseJson(
  'packages/cli/package.json',
  await readRequired('packages/cli/package.json'),
);
const expectedManifestSkills = expectedSkills.map((skill) => `./skills/${skill}`);

if (manifest.$schema !== 'https://anthropic.com/claude-code/plugin.schema.json') {
  failures.push(`${manifestPath} must use the official Claude Code plugin schema`);
}
if (manifest.name !== 'a2amesh') failures.push(`${manifestPath} name must be a2amesh`);
if (manifest.version !== cliPackage.version) {
  failures.push(`${manifestPath} version must match @a2amesh/cli`);
}
if (!manifest.description?.includes('security-bounded')) {
  failures.push(`${manifestPath} description must state the security-bounded scope`);
}
if (JSON.stringify(manifest.skills) !== JSON.stringify(expectedManifestSkills)) {
  failures.push(`${manifestPath} must list exactly the canonical first-phase skills`);
}
if (manifest.author?.name !== 'oaslananka') {
  failures.push(`${manifestPath} author must preserve the product owner identity`);
}

const requiredHeadings = [
  '## When to use',
  '## Required context',
  '## Workflow',
  '## Safety boundaries',
  '## Failure modes',
  '## Output format',
];
const requiredSkillTerms = {
  'a2a-endpoint-validation': ['read-only', '--allow-private-network', 'credentials'],
  'a2a-task-operations': ['explicit approval', 'Idempotency-Key', 'cancel'],
  'a2a-mcp-consumption': [
    'a2a_discover',
    'a2a_send_message',
    'a2a_get_task',
    'allowlist',
    'audit',
    'SSRF',
  ],
};

for (const skill of expectedSkills) {
  const canonicalPath = `skills/${skill}/SKILL.md`;
  const mirrorPath = `.opencode/skills/${skill}/SKILL.md`;
  const canonical = await readRequired(canonicalPath);
  const mirror = await readRequired(mirrorPath);
  const frontmatter = parseFrontmatter(canonicalPath, canonical);

  if (frontmatter.name !== skill) failures.push(`${canonicalPath} frontmatter name differs`);
  if (!frontmatter.description) failures.push(`${canonicalPath} needs a description`);
  for (const heading of requiredHeadings) {
    if (!canonical.includes(heading)) failures.push(`${canonicalPath} missing heading: ${heading}`);
  }
  for (const term of requiredSkillTerms[skill]) {
    if (!canonical.includes(term)) failures.push(`${canonicalPath} missing safety term: ${term}`);
  }
  if (canonical !== mirror)
    failures.push(`${mirrorPath}: OpenCode mirror differs from ${canonicalPath}`);
}

const planPath = 'docs/agent-plugin.md';
const plan = await readRequired(planPath);
for (const heading of [
  '## Status',
  '## Plugin identity',
  '## First-phase workflow matrix',
  '## Non-goals',
  '## Installation',
  '## Upgrade',
  '## Rollback',
  '## Validation',
  '## Safety and privacy',
  '## Marketplace activation gate',
]) {
  if (!plan.includes(heading)) failures.push(`${planPath} missing heading: ${heading}`);
}
for (const term of [
  'skills-only alpha bundle',
  'planned_plugins',
  cliPackage.version,
  '@a2amesh/cli@alpha',
  'examples/openclaw-mcp',
  'Claude Code',
  'OpenCode',
  'Codex',
  'VS Code',
  'Fleet',
]) {
  if (!plan.includes(term)) failures.push(`${planPath} missing publication term: ${term}`);
}

try {
  await validateLifecycle(cliPackage.version);
} catch (error) {
  failures.push(`isolated install/upgrade/rollback validation failed: ${String(error)}`);
}

if (runClaudeValidation && failures.length === 0) {
  try {
    execFileSync('claude', ['plugin', 'validate', '--strict', repoRoot], {
      stdio: 'inherit',
    });
    if (runClaudeLifecycle) await validateClaudeLifecycle(cliPackage.version);
  } catch (error) {
    failures.push(`Claude Code validation failed: ${String(error)}`);
  }
}

if (failures.length > 0) {
  console.error('Agent plugin validation failed.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Agent plugin validation passed.');
