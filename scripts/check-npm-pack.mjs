import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { getWorkspacePackages, fail, runCommandSync, runPnpmSync } from './check-utils.mjs';

const require = createRequire(import.meta.url);
const failures = [];
const scriptPath = fileURLToPath(import.meta.url);

function runCommand(file, args, options = {}) {
  return runCommandSync(file, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
}

function runPnpm(args, options = {}) {
  return runPnpmSync(args, {
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
}

function formatError(error) {
  if (!(error instanceof Error)) return String(error);
  const status = 'status' in error ? ` status ${error.status ?? 'unknown'}` : '';
  const stdout = formatCommandOutput('stdout' in error ? error.stdout : undefined);
  const stderr = formatCommandOutput('stderr' in error ? error.stderr : undefined);
  const details = [stdout, stderr].filter(Boolean).join('\n');
  return details ? `${error.message}${status}:\n${details}` : `${error.message}${status}`;
}

function formatCommandOutput(output) {
  if (Buffer.isBuffer(output)) return output.toString('utf8').trim();
  if (typeof output === 'string') return output.trim();
  return '';
}

function normalizePath(path) {
  return path.split('\\').join('/');
}

function quoteSpecifier(value) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function isRunnableExportPath(exportPath) {
  return exportPath === '.' || (exportPath.startsWith('./') && !exportPath.includes('*'));
}

export function listExportSpecifiers(packageJson) {
  const exportMap = packageJson.exports;
  if (!exportMap) return [packageJson.name];
  if (typeof exportMap === 'string') return [packageJson.name];
  if (!exportMap || typeof exportMap !== 'object' || Array.isArray(exportMap)) {
    return [packageJson.name];
  }

  const exportPaths = Object.keys(exportMap).filter(isRunnableExportPath).sort();
  if (exportPaths.length === 0) return [packageJson.name];

  return exportPaths.map((exportPath) =>
    exportPath === '.' ? packageJson.name : `${packageJson.name}/${exportPath.slice(2)}`,
  );
}

function isExportJson(packageJson, specifier) {
  const exportMap = packageJson.exports;
  if (!exportMap || typeof exportMap !== 'object') return false;
  for (const [key, value] of Object.entries(exportMap)) {
    const target = typeof value === 'string' ? value : (value?.import ?? value?.default ?? '');
    if (target.endsWith('.json')) {
      const exportName = key === '.' ? packageJson.name : `${packageJson.name}/${key.slice(2)}`;
      if (exportName === specifier) return true;
    }
  }
  return false;
}

export function createImportSmokeSource(packages) {
  const imports = [];
  const body = ['const modules = [];'];
  let index = 0;

  for (const entry of packages) {
    for (const specifier of listExportSpecifiers(entry.packageJson)) {
      const binding = `module${index}`;
      const jsonAttr = isExportJson(entry.packageJson, specifier) ? " with { type: 'json' }" : '';
      imports.push(`import * as ${binding} from ${quoteSpecifier(specifier)}${jsonAttr};`);
      body.push(`modules.push(${binding});`);
      index += 1;
    }
  }

  body.push(`if (modules.length !== ${index}) {`);
  body.push(
    `  throw new Error('Expected ${index} package export imports, got ' + modules.length);`,
  );
  body.push('}');
  body.push(
    `console.log('Imported ' + modules.length + ' package exports from packed tarballs.');`,
  );

  return `${imports.join('\n')}\n\n${body.join('\n')}\n`;
}

export function createTypecheckSmokeSource(packages) {
  const imports = [];
  const body = ['const modules: unknown[] = [];'];
  let index = 0;

  for (const entry of packages) {
    for (const specifier of listExportSpecifiers(entry.packageJson)) {
      const binding = `module${index}`;
      const jsonAttr = isExportJson(entry.packageJson, specifier) ? " with { type: 'json' }" : '';
      imports.push(`import * as ${binding} from ${quoteSpecifier(specifier)}${jsonAttr};`);
      body.push(`modules.push(${binding});`);
      index += 1;
    }
  }

  body.push(`if (modules.length !== ${index}) {`);
  body.push(
    `  throw new Error('Expected ${index} package export imports, got ' + modules.length);`,
  );
  body.push('}');

  return `${imports.join('\n')}\n\n${body.join('\n')}\n`;
}

function toFileDependency(relativeTarball) {
  const normalized = normalizePath(relativeTarball);
  const path = normalized.startsWith('.') ? normalized : `./${normalized}`;
  return `file:${path}`;
}

export function createConsumerPackageJson(packages, options) {
  const dependencies = Object.fromEntries(
    packages.map((entry) => [entry.packageJson.name, toFileDependency(entry.relativeTarball)]),
  );

  return {
    private: true,
    type: 'module',
    packageManager: options.packageManager,
    dependencies,
    devDependencies: {
      typescript: options.typescriptVersion,
    },
  };
}

export function createConsumerWorkspaceYaml(packages) {
  const lines = ['packages: []', 'overrides:'];
  for (const entry of packages) {
    lines.push(
      `  ${JSON.stringify(entry.packageJson.name)}: ${JSON.stringify(toFileDependency(entry.relativeTarball))}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function getBinEntries(packageJson) {
  if (!packageJson.bin) return [];
  if (typeof packageJson.bin === 'string') return [[packageJson.name, packageJson.bin]];
  if (typeof packageJson.bin === 'object' && !Array.isArray(packageJson.bin)) {
    return Object.entries(packageJson.bin);
  }
  return [];
}

export function getBinarySmokeCommand(_packageJson, binName) {
  if (binName === 'a2amesh') return ['doctor', '--json'];
  return ['--help'];
}

function getBinaryPath(consumerDir, binName) {
  const extension = process.platform === 'win32' ? '.cmd' : '';
  return join(consumerDir, 'node_modules', '.bin', `${binName}${extension}`);
}

function parsePackFilename(output) {
  const payload = JSON.parse(output);
  const packResult = Array.isArray(payload) ? payload[0] : payload;
  if (typeof packResult?.filename !== 'string') {
    throw new Error('pnpm pack --json did not report a tarball filename');
  }
  return packResult.filename;
}

function resolvePackFilename(filename, packDestination) {
  return isAbsolute(filename) ? filename : join(packDestination, filename);
}

function validateDryRunOutput(entry, output) {
  if (!output.includes('package.json')) {
    failures.push(`${entry.dir}: dry-run output did not list package.json`);
  }
  if (/node_modules|coverage|test-results|\.env|\.tsbuildinfo/.test(output)) {
    failures.push(`${entry.dir}: dry-run output includes forbidden artifact`);
  }
}

export function packPackage(entry, packDestination) {
  if (typeof entry.packageJson.scripts?.build === 'string') {
    runPnpm(['--dir', entry.dir, 'run', 'build']);
  }

  const dryRunOutput = runPnpm(['--dir', entry.dir, 'pack', '--dry-run']);
  validateDryRunOutput(entry, dryRunOutput);

  const packOutput = runPnpm([
    '--dir',
    entry.dir,
    'pack',
    '--json',
    '--pack-destination',
    packDestination,
  ]);
  return resolvePackFilename(parsePackFilename(packOutput), packDestination);
}

function isAttwTarballExtractionBug(error) {
  return formatError(error).includes("Cannot read properties of undefined (reading 'filename')");
}

let attwCoreModule;
let attwCoreEntry;

async function loadAttwCore() {
  if (attwCoreModule) return attwCoreModule;
  const attwRequire = createRequire(require.resolve('@arethetypeswrong/packages/cli/package.json'));
  attwCoreEntry = attwRequire.resolve('@arethetypeswrong/core');
  attwCoreModule = await import(pathToFileURL(attwCoreEntry).href);
  return attwCoreModule;
}

async function createAttwPackageFromTarball(tarball) {
  const { Package } = await loadAttwCore();
  const coreRequire = createRequire(attwCoreEntry);
  const { untar } = coreRequire('@andrewbranch/untar.js');
  const archive = untar(new Uint8Array(gunzipSync(readFileSync(tarball))));
  const firstFile = archive[0];
  if (!firstFile?.filename) {
    throw new Error('attw fallback could not read tarball entries');
  }

  const prefix = firstFile.filename.slice(0, firstFile.filename.indexOf('/') + 1);
  const packageJsonText = archive.find(
    (file) => file.filename === `${prefix}package.json`,
  )?.fileData;
  if (!packageJsonText) {
    throw new Error('attw fallback could not read package.json from tarball');
  }

  const packageJson = JSON.parse(new TextDecoder().decode(packageJsonText));
  const files = archive.reduce((acc, file) => {
    acc[`/node_modules/${packageJson.name}/${file.filename.slice(prefix.length)}`] = file.fileData;
    return acc;
  }, {});

  return new Package(files, packageJson.name, packageJson.version);
}

function filterAttwProblemsForEsmOnly(analysis) {
  if (!analysis.types) return [];
  return analysis.problems.filter(
    (problem) =>
      !('resolutionKind' in problem) ||
      (problem.resolutionKind !== 'node10' && problem.resolutionKind !== 'node16-cjs'),
  );
}

function describeAttwProblem(problem) {
  const entrypoint = 'entrypoint' in problem ? ` ${problem.entrypoint}` : '';
  const resolution = 'resolutionKind' in problem ? ` ${problem.resolutionKind}` : '';
  return `${problem.kind}${entrypoint}${resolution}`.trim();
}

async function runAttwFallback(tarball) {
  const { checkPackage } = await loadAttwCore();
  const pkg = await createAttwPackageFromTarball(tarball);
  const analysis = await checkPackage(pkg);
  const problems = filterAttwProblemsForEsmOnly(analysis);
  if (problems.length > 0) {
    throw new Error(
      `attw fallback reported ${problems.length} problem(s): ${problems
        .map(describeAttwProblem)
        .join(', ')}`,
    );
  }
}

async function runPackageLinters(entry, tarball) {
  try {
    runPnpm(['exec', 'publint', 'run', tarball]);
  } catch (error) {
    failures.push(`${entry.dir}: publint failed: ${formatError(error)}`);
  }

  try {
    runPnpm(['exec', 'attw', tarball, '--profile', 'esm-only', '--no-emoji', '--no-color']);
  } catch (error) {
    if (!isAttwTarballExtractionBug(error)) {
      failures.push(`${entry.dir}: attw failed: ${formatError(error)}`);
      return;
    }

    try {
      await runAttwFallback(tarball);
    } catch (fallbackError) {
      failures.push(`${entry.dir}: attw fallback failed: ${formatError(fallbackError)}`);
    }
  }
}

function writeConsumerProject(consumerDir, packedPackages) {
  const rootPackageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const manifest = createConsumerPackageJson(packedPackages, {
    packageManager: rootPackageJson.packageManager,
    typescriptVersion: rootPackageJson.devDependencies.typescript,
  });

  writeFileSync(join(consumerDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(consumerDir, 'pnpm-workspace.yaml'),
    createConsumerWorkspaceYaml(packedPackages),
  );
  writeFileSync(
    join(consumerDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          noEmit: true,
        },
        include: ['smoke-types.ts'],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(consumerDir, 'smoke-imports.mjs'), createImportSmokeSource(packedPackages));
  writeFileSync(join(consumerDir, 'smoke-types.ts'), createTypecheckSmokeSource(packedPackages));
}

function installConsumerProject(consumerDir) {
  runPnpm(['--dir', consumerDir, 'install', '--ignore-scripts']);
}

function smokeConsumerImports(consumerDir) {
  runCommand(process.execPath, [join(consumerDir, 'smoke-imports.mjs')], {
    cwd: consumerDir,
  });
}

function typecheckConsumerProject(consumerDir) {
  runPnpm(['--dir', consumerDir, 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.json']);
}

function smokeConsumerBinaries(consumerDir, packages) {
  for (const entry of packages) {
    for (const [binName] of getBinEntries(entry.packageJson)) {
      const args = getBinarySmokeCommand(entry.packageJson, binName);
      const stdout = runCommand(getBinaryPath(consumerDir, binName), args, {
        cwd: consumerDir,
        env: {
          ...process.env,
          NO_COLOR: '1',
        },
      });

      if (binName === 'a2amesh') {
        const payload = JSON.parse(stdout);
        if (payload.cli !== 'a2amesh') {
          failures.push(`cli: packed binary reported unexpected cli value ${String(payload.cli)}`);
        }
        if (typeof payload.version !== 'string' || payload.version.length === 0) {
          failures.push('cli: packed binary did not report a version');
        }
      }
    }
  }
}

export async function runNpmPackValidation() {
  const publishablePackages = getWorkspacePackages().filter(
    (entry) => entry.packageJson.private !== true && entry.path !== 'package.json',
  );
  const tempDir = mkdtempSync(join(tmpdir(), 'a2amesh-pack-smoke-'));
  const tarballDir = join(tempDir, 'tarballs');
  const consumerDir = join(tempDir, 'consumer');
  mkdirSync(tarballDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  try {
    const packedPackages = [];

    for (const entry of publishablePackages) {
      try {
        const tarball = packPackage(entry, tarballDir);
        packedPackages.push({
          ...entry,
          tarball,
          relativeTarball: normalizePath(relative(consumerDir, tarball)),
        });
        await runPackageLinters(entry, tarball);
      } catch (error) {
        failures.push(`${entry.dir}: tarball validation failed: ${formatError(error)}`);
      }
    }

    try {
      writeConsumerProject(consumerDir, packedPackages);
      installConsumerProject(consumerDir);
      smokeConsumerImports(consumerDir);
      typecheckConsumerProject(consumerDir);
      smokeConsumerBinaries(consumerDir, packedPackages);
    } catch (error) {
      failures.push(`consumer: packed tarball install smoke failed: ${formatError(error)}`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const results = await runNpmPackValidation();
  if (results.length > 0) fail('npm pack dry-run validation failed.', results);
}
