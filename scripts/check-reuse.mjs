/**
 * @fileoverview
 * Check REUSE compliance deterministically by running a pinned `reuse`
 * version, matching the pin used in `.github/workflows/security.yml`
 * (`pipx run --spec reuse==<REUSE_VERSION> reuse lint`).
 *
 * `pnpm run security` must not silently report success when REUSE was
 * never actually checked. If no way to invoke the pinned version is
 * available, this script fails with a clear remediation message unless
 * the caller explicitly opts into a reported skip via
 * `A2AMESH_ALLOW_REUSE_SKIP=1`.
 *
 * Install options: `pipx install reuse==<version>` (recommended, isolated)
 * or `pip install --user reuse==<version>`.
 * Docs: https://reuse.software/docs/
 */

import { spawnSync } from 'node:child_process';

const REUSE_VERSION = '6.2.0';

/**
 * Runs a command without a shell (array argv, no string interpolation) and
 * without throwing. Distinguishes "the executable itself could not be
 * invoked" (`error` set, e.g. ENOENT) from "the tool ran and exited
 * non-zero" (reuse lint legitimately exits non-zero when it finds
 * violations — that is a result, not an infrastructure failure).
 */
function run(file, args) {
  return spawnSync(file, args, { encoding: 'utf-8', timeout: 60_000 });
}

function reportsExpectedVersion(versionOutput) {
  return typeof versionOutput === 'string' && versionOutput.includes(REUSE_VERSION);
}

// Prefer an already-installed `reuse` on PATH only when it matches the
// pinned version, so results stay reproducible across machines instead of
// silently drifting with whatever happens to be installed.
const pathVersionResult = run('reuse', ['--version']);
const useLocalReuse =
  !pathVersionResult.error && reportsExpectedVersion(pathVersionResult.stdout ?? '');

const attempts = useLocalReuse
  ? [{ file: 'reuse', args: ['lint'] }]
  : [{ file: 'pipx', args: ['run', '--spec', `reuse==${REUSE_VERSION}`, 'reuse', 'lint'] }];

let lintResult = null;
let usedCommand = null;
const invocationFailures = [];
for (const attempt of attempts) {
  const result = run(attempt.file, attempt.args);
  const commandLabel = [attempt.file, ...attempt.args].join(' ');
  if (result.error) {
    // The executable itself could not be started (e.g. ENOENT) — this is an
    // infrastructure gap, not a lint result.
    invocationFailures.push({ command: commandLabel, message: result.error.message });
    continue;
  }
  lintResult = result;
  usedCommand = commandLabel;
  break;
}

if (lintResult === null) {
  console.error(`✗ REUSE compliance check could not invoke pinned reuse==${REUSE_VERSION}.`);
  for (const failure of invocationFailures) {
    console.error(`  - \`${failure.command}\` failed to start: ${failure.message}`);
  }
  console.error('');
  console.error('  Remediation: install a matching reuse tool, for example:');
  console.error(`    pipx install reuse==${REUSE_VERSION}`);
  console.error(`    # or: pip install --user reuse==${REUSE_VERSION}`);
  console.error('');

  if (process.env['A2AMESH_ALLOW_REUSE_SKIP'] === '1') {
    console.error(
      '⚠ A2AMESH_ALLOW_REUSE_SKIP=1 set: reporting an explicit, visible skip instead of failing.',
    );
    console.error('⚠ REUSE license/copyright compliance was NOT verified in this run.');
    process.exit(0);
  }

  console.error('  Set A2AMESH_ALLOW_REUSE_SKIP=1 to explicitly skip this check with a reported warning.');
  process.exit(1);
}

const output = `${lintResult.stdout ?? ''}${lintResult.stderr ?? ''}`;

if (lintResult.status === 0 && output.includes('Congratulations')) {
  console.log(`✓ REUSE compliance check passed (via \`${usedCommand}\`, reuse==${REUSE_VERSION})`);
  process.exit(0);
}

console.error(output);
console.error(`✗ REUSE compliance check failed (via \`${usedCommand}\`, reuse==${REUSE_VERSION})`);
process.exit(1);
