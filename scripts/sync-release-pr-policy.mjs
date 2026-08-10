import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_INSTALL_DOC_PATHS, rewritePublicInstallPolicy } from './check-docs-commands.mjs';
import { releaseChannelForVersion } from './public-surface-policy.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const supportedChannels = new Set(['alpha', 'beta', 'rc', 'stable']);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function syncReleasePrPolicy(repoRoot, options = {}) {
  const configPath = resolve(repoRoot, 'release-please-config.json');
  const config = await readJson(configPath);
  const updatedSurfaces = [];
  const updatedInstallDocs = [];

  for (const packagePath of Object.keys(config.packages ?? {}).sort()) {
    const packageJsonPath = resolve(repoRoot, packagePath, 'package.json');
    const inventoryPath = resolve(repoRoot, packagePath, 'public-surface.json');
    const packageJson = await readJson(packageJsonPath);
    const inventory = await readJson(inventoryPath);
    const channel = releaseChannelForVersion(packageJson.version);

    if (!supportedChannels.has(channel)) {
      throw new Error(
        `${packagePath}: unsupported release channel for version ${packageJson.version}`,
      );
    }

    if (inventory.status !== channel) {
      inventory.status = channel;
      await writeJson(inventoryPath, inventory);
      updatedSurfaces.push(`${packagePath}/public-surface.json`);
    }
  }

  if (options.syncInstallDocs) {
    const runtimePackage = await readJson(resolve(repoRoot, 'packages/runtime/package.json'));
    const activeVersion = runtimePackage.version;
    if (!releaseChannelForVersion(activeVersion)) {
      throw new Error(`packages/runtime: unsupported release version ${activeVersion}`);
    }

    const installDocumentPaths = options.installDocumentPaths ?? PUBLIC_INSTALL_DOC_PATHS;
    for (const documentPath of installDocumentPaths) {
      const absolutePath = resolve(repoRoot, documentPath);
      const original = await readFile(absolutePath, 'utf8');
      const rewritten = rewritePublicInstallPolicy(original, activeVersion);
      if (rewritten === original) continue;
      await writeFile(absolutePath, rewritten);
      updatedInstallDocs.push(documentPath);
    }
  }

  let clearedReleaseAs = false;
  if (options.clearReleaseAs && Object.hasOwn(config, 'release-as')) {
    delete config['release-as'];
    await writeJson(configPath, config);
    clearedReleaseAs = true;
  }

  return { updatedSurfaces, updatedInstallDocs, clearedReleaseAs };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const result = await syncReleasePrPolicy(process.cwd(), {
    clearReleaseAs: process.argv.includes('--clear-release-as'),
    syncInstallDocs: process.argv.includes('--sync-install-docs'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
