import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { basename, join } from 'node:path';

const PRIVATE_KEY =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;
const PRIVATE_KEY_HEADER = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const AUTHORIZATION_BEARER = /(Authorization\s*[:=]\s*Bearer\s+)\S+/gi;
const BEARER_VALUE = /\bBearer\s+\S+/gi;
const QUERY_SECRET = /([?&](?:token|access_token|api_key|key|secret|password)=)[^&#\s"']+/gi;
const URL_CANDIDATE = /https?:\/\/[^\s"'<>]+/gi;
const IPV4_CANDIDATE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const SENSITIVE_KEY_FRAGMENTS = [
  'authorization',
  'api-key',
  'apikey',
  'access-token',
  'accesstoken',
  'token',
  'secret',
  'password',
  'cookie',
  'task-input',
  'taskinput',
  'prompt',
  'raw-input',
  'rawinput',
];

const compareText = (left, right) => left.localeCompare(right, 'en');

async function assertRegularFile(path, label) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file and must not be a symbolic link.`);
  }
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function normalizeKey(key) {
  return String(key).toLowerCase().replaceAll('_', '-');
}

function isSensitiveKey(key) {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function parseIpv4(value) {
  if (isIP(value) !== 4) return undefined;
  return value.split('.').map(Number);
}

function isPrivateIpv4(value) {
  const parts = parseIpv4(value);
  if (!parts) return false;
  const [first, second] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31)
  );
}

function isPrivateIpv6(value) {
  if (isIP(value) !== 6) return false;
  const normalized = value.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  );
}

function isPrivateHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.local') ||
    isPrivateIpv4(normalized) ||
    isPrivateIpv6(normalized)
  );
}

function redactPrivateUrls(value) {
  return value.replace(URL_CANDIDATE, (candidate) => {
    try {
      return isPrivateHostname(new URL(candidate).hostname) ? '[REDACTED-PRIVATE-URL]' : candidate;
    } catch {
      return candidate;
    }
  });
}

function redactPrivateIpv4(value) {
  return value.replace(IPV4_CANDIDATE, (candidate) =>
    isPrivateIpv4(candidate) ? '[REDACTED-PRIVATE-IP]' : candidate,
  );
}

function redactEnvironmentAssignments(value) {
  return value
    .split('\n')
    .map((line) => {
      const separator = line.indexOf('=');
      if (separator < 1 || !isSensitiveKey(line.slice(0, separator).trim())) return line;
      return `${line.slice(0, separator + 1)}[REDACTED]`;
    })
    .join('\n');
}

function redactString(value) {
  const withoutPrivateKeys = value.replace(PRIVATE_KEY, '[REDACTED]');
  const withoutAuthorization = withoutPrivateKeys.replace(AUTHORIZATION_BEARER, '$1[REDACTED]');
  const withoutBearerValues = withoutAuthorization.replace(BEARER_VALUE, 'Bearer [REDACTED]');
  const withoutEnvironmentSecrets = redactEnvironmentAssignments(withoutBearerValues);
  const withoutQuerySecrets = withoutEnvironmentSecrets.replace(QUERY_SECRET, '$1[REDACTED]');
  return redactPrivateIpv4(redactPrivateUrls(withoutQuerySecrets));
}

function redactValue(value, key = '') {
  if (isSensitiveKey(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function redactDiagnosticText(content, fileName = '') {
  if (fileName.endsWith('.json')) {
    try {
      const parsed = JSON.parse(content);
      return `${JSON.stringify(redactValue(parsed), null, 2)}\n`;
    } catch {
      // Preserve malformed diagnostic evidence as text while still redacting it.
    }
  }
  return redactString(content);
}

function containsPrivateLocation(content) {
  const privateUrl = [...content.matchAll(URL_CANDIDATE)].some((match) => {
    try {
      return isPrivateHostname(new URL(match[0]).hostname);
    } catch {
      return false;
    }
  });
  if (privateUrl) return true;
  return [...content.matchAll(IPV4_CANDIDATE)].some((match) => isPrivateIpv4(match[0]));
}

function containsUnredactedBearer(content) {
  return [...content.matchAll(BEARER_VALUE)].some((match) => match[0] !== 'Bearer [REDACTED]');
}

function containsUnredactedAssignment(content) {
  return content.split('\n').some((line) => {
    const separator = line.indexOf('=');
    if (separator < 1 || !isSensitiveKey(line.slice(0, separator).trim())) return false;
    const value = line.slice(separator + 1).trim();
    return value.length > 0 && value !== '[REDACTED]';
  });
}

function containsUnredactedSensitiveData(content) {
  return (
    PRIVATE_KEY_HEADER.test(content) ||
    containsUnredactedBearer(content) ||
    containsUnredactedAssignment(content) ||
    containsPrivateLocation(content)
  );
}

async function readBundleManifest(manifestPath) {
  await assertRegularFile(manifestPath, 'Diagnostic bundle manifest');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.requiredFiles) || manifest.requiredFiles.length === 0) {
    throw new Error('Diagnostic bundle manifest requires a non-empty requiredFiles array.');
  }
  const requiredFiles = manifest.requiredFiles.map((name) => {
    if (typeof name !== 'string' || name !== basename(name) || name.includes('..')) {
      throw new Error(`Unsafe diagnostic bundle filename: ${String(name)}`);
    }
    return name;
  });
  return { ...manifest, requiredFiles };
}

export async function createDiagnosticBundle(options) {
  const { manifestPath, sourceDirectory, outputDirectory, now = () => new Date() } = options ?? {};
  const manifest = await readBundleManifest(manifestPath);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  const indexFiles = [];

  for (const fileName of manifest.requiredFiles) {
    const sourcePath = join(sourceDirectory, fileName);
    await assertRegularFile(sourcePath, `Diagnostic source ${fileName}`);
    const redacted = redactDiagnosticText(await readFile(sourcePath, 'utf8'), fileName);
    const destinationPath = join(outputDirectory, fileName);
    await writeFile(destinationPath, redacted, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    indexFiles.push({
      name: fileName,
      sizeBytes: Buffer.byteLength(redacted),
      sha256: hash(redacted),
    });
  }

  const index = {
    schemaVersion: 1,
    createdAt: now().toISOString(),
    classification: manifest.classification ?? 'redacted-operational-evidence',
    files: indexFiles,
  };
  await writeFile(
    join(outputDirectory, 'bundle-index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    },
  );
  return { files: manifest.requiredFiles, index };
}

export async function validateDiagnosticBundle(options) {
  const { manifestPath, bundleDirectory } = options ?? {};
  const manifest = await readBundleManifest(manifestPath);
  const indexPath = join(bundleDirectory, 'bundle-index.json');
  await assertRegularFile(indexPath, 'Diagnostic bundle index');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  const indexEntries = Array.isArray(index.files) ? index.files : [];
  const indexByName = new Map(indexEntries.map((entry) => [entry.name, entry]));
  if (indexByName.size !== indexEntries.length) {
    throw new Error('Diagnostic bundle index contains duplicate filenames.');
  }
  const expectedNames = [...manifest.requiredFiles, 'bundle-index.json'].sort(compareText);
  const observedNames = (await readdir(bundleDirectory)).sort(compareText);
  if (JSON.stringify(observedNames) !== JSON.stringify(expectedNames)) {
    const unexpected = observedNames.filter((name) => !expectedNames.includes(name));
    const missing = expectedNames.filter((name) => !observedNames.includes(name));
    throw new Error(
      `Diagnostic bundle contents are not exact; unexpected: ${unexpected.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}.`,
    );
  }
  const indexedNames = [...indexByName.keys()].sort(compareText);
  const requiredNames = [...manifest.requiredFiles].sort(compareText);
  if (JSON.stringify(indexedNames) !== JSON.stringify(requiredNames)) {
    throw new Error('Diagnostic bundle index must contain exactly the required files.');
  }

  for (const fileName of manifest.requiredFiles) {
    const path = join(bundleDirectory, fileName);
    await assertRegularFile(path, `Diagnostic bundle file ${fileName}`);
    const content = await readFile(path, 'utf8');
    if (containsUnredactedSensitiveData(content)) {
      throw new Error(`Diagnostic bundle file ${fileName} contains unredacted sensitive data.`);
    }
    const expected = indexByName.get(fileName);
    if (
      !expected ||
      expected.sha256 !== hash(content) ||
      expected.sizeBytes !== Buffer.byteLength(content)
    ) {
      throw new Error(`Diagnostic bundle index mismatch for ${fileName}.`);
    }
  }
  return { valid: true, files: manifest.requiredFiles };
}
