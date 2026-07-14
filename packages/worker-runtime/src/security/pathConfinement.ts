import { constants, type Stats } from 'node:fs';
import { access, lstat, open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';
import { TextDecoder } from 'node:util';

const READ_CHUNK_BYTES = 64 * 1024;

export class PathConfinementError extends Error {
  override readonly name = 'PathConfinementError';
}

export interface ResolvedWorkerExecution {
  workspaceRoot: string;
  cwd: string;
  executable: string;
}

interface ConfinedFileReadHooks {
  /** Internal test hook used to deterministically exercise replacement races. */
  beforeOpen?: () => void | Promise<void>;
}

export interface ConfinedFileReadOptions {
  maxBytes: number;
  allowBinary: boolean;
  hooks?: ConfinedFileReadHooks;
}

export interface ConfinedFileReadResult {
  canonicalPath: string;
  content: Buffer;
}

export async function resolveWorkerExecution(
  workspaceRoot: string,
  cwd: string | undefined,
  command: string,
  commandAllowlist: readonly string[],
): Promise<ResolvedWorkerExecution> {
  const canonicalWorkspace = await resolveCanonicalDirectory(workspaceRoot, 'workspace root');
  const canonicalCwd = await resolveConfinedDirectory(canonicalWorkspace, cwd);
  const executable = await resolveAllowedExecutable(command, commandAllowlist);
  return { workspaceRoot: canonicalWorkspace, cwd: canonicalCwd, executable };
}

export async function readConfinedRegularFile(
  canonicalRoot: string,
  declaredPath: string,
  options: ConfinedFileReadOptions,
): Promise<ConfinedFileReadResult | undefined> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new PathConfinementError('artifact maxBytes must be a positive safe integer');
  }
  if (declaredPath.length === 0 || declaredPath.includes('\0')) {
    throw new PathConfinementError('artifact path must be a non-empty path without NUL bytes');
  }
  if (isAbsolute(declaredPath)) {
    throw new PathConfinementError(`artifact path "${declaredPath}" must be relative`);
  }

  const candidate = resolvePath(canonicalRoot, declaredPath);
  assertContained(canonicalRoot, candidate, 'artifact path');

  const initial = await inspectPathWithoutLinks(canonicalRoot, candidate, declaredPath);
  if (!initial) return undefined;

  if (!initial.isFile()) {
    throw new PathConfinementError(`artifact "${declaredPath}" is not a regular file`);
  }
  if (initial.size > options.maxBytes) {
    throw new PathConfinementError(
      `artifact "${declaredPath}" exceeds the ${options.maxBytes}-byte per-file limit`,
    );
  }

  const canonicalPath = await canonicalizeExisting(candidate, `artifact "${declaredPath}"`);
  assertContained(canonicalRoot, canonicalPath, 'resolved artifact path');
  assertCanonicalInput(candidate, canonicalPath, `artifact "${declaredPath}"`);

  await options.hooks?.beforeOpen?.();

  let handle: FileHandle | undefined;
  try {
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
    handle = await open(candidate, constants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    assertRegularAndSameFile(initial, opened, declaredPath);

    const canonicalAfterOpen = await canonicalizeExisting(
      candidate,
      `artifact "${declaredPath}" after open`,
    );
    assertContained(canonicalRoot, canonicalAfterOpen, 'artifact path after open');
    if (!samePath(canonicalPath, canonicalAfterOpen)) {
      throw new PathConfinementError(
        `artifact "${declaredPath}" changed location while being opened`,
      );
    }

    const content = await readBounded(handle, options.maxBytes, declaredPath);
    const final = await handle.stat();
    assertStableFile(opened, final, declaredPath);
    assertArtifactContent(content, options.allowBinary, declaredPath);
    return { canonicalPath, content };
  } catch (error) {
    if (error instanceof PathConfinementError) throw error;
    throw confinementFailure(`cannot safely read artifact "${declaredPath}"`, error);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function inspectPathWithoutLinks(
  canonicalRoot: string,
  candidate: string,
  declaredPath: string,
): Promise<Stats | undefined> {
  const rel = relative(canonicalRoot, candidate);
  const segments = rel.split(sep).filter((segment) => segment.length > 0);
  let current = canonicalRoot;
  let details: Stats | undefined;
  for (const [index, segment] of segments.entries()) {
    current = resolvePath(current, segment);
    try {
      details = await lstat(current);
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return undefined;
      throw confinementFailure(`cannot inspect artifact "${declaredPath}"`, error);
    }
    if (details.isSymbolicLink()) {
      throw new PathConfinementError(
        `artifact "${declaredPath}" traverses a symbolic link or junction`,
      );
    }
    if (index < segments.length - 1 && !details.isDirectory()) {
      throw new PathConfinementError(
        `artifact "${declaredPath}" has a non-directory parent component`,
      );
    }
  }
  return details;
}

async function resolveCanonicalDirectory(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new PathConfinementError(`${label} "${path}" must be an absolute path`);
  }
  const canonical = await canonicalizeExisting(path, label);
  const details = await stat(canonical);
  if (!details.isDirectory()) {
    throw new PathConfinementError(`${label} "${path}" is not a directory`);
  }
  return canonical;
}

async function resolveConfinedDirectory(
  canonicalWorkspace: string,
  configuredCwd: string | undefined,
): Promise<string> {
  const candidate = configuredCwd
    ? isAbsolute(configuredCwd)
      ? resolvePath(configuredCwd)
      : resolvePath(canonicalWorkspace, configuredCwd)
    : canonicalWorkspace;
  assertContained(canonicalWorkspace, candidate, 'working directory');

  const canonical = await canonicalizeExisting(candidate, 'working directory');
  assertContained(canonicalWorkspace, canonical, 'resolved working directory');
  assertCanonicalInput(candidate, canonical, 'working directory');

  const details = await stat(canonical);
  if (!details.isDirectory()) {
    throw new PathConfinementError(`working directory "${candidate}" is not a directory`);
  }
  return canonical;
}

async function resolveAllowedExecutable(
  command: string,
  commandAllowlist: readonly string[],
): Promise<string> {
  if (!isAbsolute(command)) {
    throw new PathConfinementError(
      `command "${command}" must be an absolute executable path; ambient PATH lookup is disabled`,
    );
  }
  if (commandAllowlist.length === 0) {
    throw new PathConfinementError('command allowlist must contain at least one absolute path');
  }

  const canonicalCommand = await canonicalizeExisting(command, 'command');
  assertCanonicalInput(resolvePath(command), canonicalCommand, 'command');
  const details = await stat(canonicalCommand);
  if (!details.isFile()) {
    throw new PathConfinementError(`command "${command}" is not a regular file`);
  }
  try {
    await access(canonicalCommand, constants.X_OK);
  } catch (error) {
    throw confinementFailure(`command "${command}" is not executable`, error);
  }

  const canonicalAllowlist: string[] = [];
  for (const entry of commandAllowlist) {
    if (!isAbsolute(entry)) {
      throw new PathConfinementError(
        `command allowlist entry "${entry}" must be an absolute executable path`,
      );
    }
    const canonicalEntry = await canonicalizeExisting(entry, 'command allowlist entry');
    assertCanonicalInput(resolvePath(entry), canonicalEntry, `command allowlist entry "${entry}"`);
    canonicalAllowlist.push(canonicalEntry);
  }

  if (!canonicalAllowlist.some((entry) => samePath(entry, canonicalCommand))) {
    throw new PathConfinementError(
      `resolved command "${canonicalCommand}" is not in the executable allowlist`,
    );
  }
  return canonicalCommand;
}

async function canonicalizeExisting(path: string, label: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    throw confinementFailure(`${label} "${path}" cannot be resolved`, error);
  }
}

function assertCanonicalInput(input: string, canonical: string, label: string): void {
  if (!samePath(resolvePath(input), canonical)) {
    throw new PathConfinementError(
      `${label} resolves through a symbolic link or junction and is not permitted`,
    );
  }
}

function assertContained(root: string, candidate: string, label: string): void {
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PathConfinementError(`${label} "${candidate}" escapes workspace root "${root}"`);
  }
}

function assertRegularAndSameFile(initial: Stats, opened: Stats, declaredPath: string): void {
  if (!opened.isFile()) {
    throw new PathConfinementError(`artifact "${declaredPath}" is not a regular file`);
  }
  if (!sameIdentity(initial, opened)) {
    throw new PathConfinementError(
      `artifact "${declaredPath}" was replaced between inspection and open`,
    );
  }
}

function assertStableFile(opened: Stats, final: Stats, declaredPath: string): void {
  if (
    !sameIdentity(opened, final) ||
    opened.size !== final.size ||
    opened.mtimeMs !== final.mtimeMs ||
    opened.ctimeMs !== final.ctimeMs
  ) {
    throw new PathConfinementError(`artifact "${declaredPath}" changed while being read`);
  }
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function readBounded(
  handle: FileHandle,
  maxBytes: number,
  declaredPath: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const remaining = maxBytes + 1 - total;
    if (remaining <= 0) {
      throw new PathConfinementError(
        `artifact "${declaredPath}" exceeds the ${maxBytes}-byte per-file limit`,
      );
    }
    const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) {
      throw new PathConfinementError(
        `artifact "${declaredPath}" exceeds the ${maxBytes}-byte per-file limit`,
      );
    }
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

function assertArtifactContent(content: Buffer, allowBinary: boolean, declaredPath: string): void {
  if (allowBinary) return;
  if (content.includes(0)) {
    throw new PathConfinementError(
      `artifact "${declaredPath}" contains binary NUL bytes but binary artifacts are disabled`,
    );
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new PathConfinementError(
      `artifact "${declaredPath}" is not valid UTF-8 but binary artifacts are disabled`,
    );
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right;
}

function confinementFailure(message: string, cause: unknown): PathConfinementError {
  const code =
    cause instanceof Error &&
    'code' in cause &&
    typeof (cause as NodeJS.ErrnoException).code === 'string'
      ? (cause as NodeJS.ErrnoException).code
      : undefined;
  return new PathConfinementError(code ? `${message} (${code})` : message);
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as NodeJS.ErrnoException).code === 'string' &&
    (error as NodeJS.ErrnoException).code === code
  );
}
