import { accessSync, constants, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SIMPLE_WINDOWS_ARGUMENT = new RegExp(String.raw`^[A-Za-z0-9_./:=@+\\-]+$`);

export function resolveExecutable(command, env = process.env, platform = process.platform) {
  if (path.isAbsolute(command)) return executableCandidate(command, platform) ? command : null;

  const extensions =
    platform === 'win32'
      ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean)
          .map((extension) => extension.toLowerCase())
      : [''];
  const hasExtension = platform === 'win32' && path.extname(command) !== '';
  const pathDelimiter = platform === 'win32' ? ';' : ':';

  for (const directory of readPath(env).split(pathDelimiter).filter(Boolean)) {
    const candidates = hasExtension
      ? [path.join(directory, command)]
      : extensions.map((extension) => path.join(directory, `${command}${extension}`));
    for (const candidate of candidates) {
      if (executableCandidate(candidate, platform)) return candidate;
    }
  }
  return null;
}

function resolveCorepackExecutable(nodeExecutable = process.execPath, platform = process.platform) {
  const directory = path.dirname(nodeExecutable);
  const names = platform === 'win32' ? ['corepack.cmd', 'corepack.exe', 'corepack'] : ['corepack'];
  for (const name of names) {
    const candidate = path.join(directory, name);
    if (executableCandidate(candidate, platform)) return candidate;
  }
  return null;
}

export function resolveCorepackInvocation(
  nodeExecutable = process.execPath,
  platform = process.platform,
) {
  const corepackPath = resolveCorepackExecutable(nodeExecutable, platform);
  if (!corepackPath) return null;
  if (platform === 'win32') {
    return { executable: corepackPath, argsPrefix: [], corepackPath };
  }
  return { executable: nodeExecutable, argsPrefix: [corepackPath], corepackPath };
}

export function spawnCommand(executable, args, options = {}) {
  const env = options.env || process.env;
  const spawnOptions = { ...options, env, windowsHide: true };
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executable)) {
    return spawnSync(executable, args, spawnOptions);
  }

  const commandProcessor = resolveExecutable(env.ComSpec || 'cmd.exe', env, 'win32');
  if (!commandProcessor) {
    return {
      status: 1,
      signal: null,
      stdout: emptyOutput(options.encoding),
      stderr: encodedOutput('Windows command processor was not found.', options.encoding),
      error: undefined,
      pid: 0,
      output: [],
    };
  }
  const command = [executable, ...args].map(quoteWindowsArgument).join(' ');
  return spawnSync(commandProcessor, ['/d', '/s', '/c', command], {
    ...spawnOptions,
    windowsVerbatimArguments: true,
  });
}

function readPath(env = process.env) {
  return env.PATH || env.Path || env.path || '';
}

export function withPrependedPath(env, directory, platform = process.platform) {
  const result = { ...env };
  const existingKey = Object.keys(result).find((key) => key.toLowerCase() === 'path');
  const key = existingKey || (platform === 'win32' ? 'Path' : 'PATH');
  const separator = platform === 'win32' ? ';' : ':';
  result[key] = [directory, readPath(result)].filter(Boolean).join(separator);
  return result;
}

function executableCandidate(candidate, platform) {
  if (!existsSync(candidate)) return false;
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function quoteWindowsArgument(value) {
  if (SIMPLE_WINDOWS_ARGUMENT.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

function emptyOutput(encoding) {
  return encoding ? '' : Buffer.alloc(0);
}

function encodedOutput(value, encoding) {
  return encoding ? value : Buffer.from(value);
}
