import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const SENSITIVE_KEY =
  /(authorization|api[-_]?key|access[-_]?token|token|secret|password|cookie|task[-_]?input|prompt|raw[-_]?input)/i;
const PRIVATE_IPV4 =
  /\b(?:10(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3}|169\.254(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g;
const PRIVATE_URL =
  /https?:\/\/(?:localhost|[^/\s]*\.local|(?:10|127|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){1,3})(?::\d+)?[^\s"']*/gi;
const QUERY_SECRET = /([?&](?:token|access_token|api_key|key|secret|password)=)[^&#\s"']+/gi;
const PRIVATE_KEY =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;

async function assertRegularFile(path, label) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file and must not be a symbolic link.`);
  }
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function redactString(value) {
  return value
    .replace(PRIVATE_KEY, '[REDACTED]')
    .replace(/(Authorization\s*[:=]\s*Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .replace(
      /(^|\n)([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|COOKIE|AUTHORIZATION)[A-Za-z0-9_]*\s*=\s*)[^\n]*/gi,
      '$1$2[REDACTED]',
    )
    .replace(QUERY_SECRET, '$1[REDACTED]')
    .replace(PRIVATE_URL, '[REDACTED-PRIVATE-URL]')
    .replace(PRIVATE_IPV4, '[REDACTED-PRIVATE-IP]');
}

function redactValue(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
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
  const expectedNames = [...manifest.requiredFiles, 'bundle-index.json'].sort();
  const observedNames = (await readdir(bundleDirectory)).sort();
  if (JSON.stringify(observedNames) !== JSON.stringify(expectedNames)) {
    const unexpected = observedNames.filter((name) => !expectedNames.includes(name));
    const missing = expectedNames.filter((name) => !observedNames.includes(name));
    throw new Error(
      `Diagnostic bundle contents are not exact; unexpected: ${unexpected.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}.`,
    );
  }
  const indexedNames = [...indexByName.keys()].sort();
  const requiredNames = [...manifest.requiredFiles].sort();
  if (JSON.stringify(indexedNames) !== JSON.stringify(requiredNames)) {
    throw new Error('Diagnostic bundle index must contain exactly the required files.');
  }
  const forbidden = [
    /Bearer\s+(?!\[REDACTED\])\S+/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:10|127|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){1,3}\b/,
    /(?:TOKEN|SECRET|PASSWORD|API_KEY|COOKIE)\s*=\s*(?!\[REDACTED\])\S+/i,
  ];

  for (const fileName of manifest.requiredFiles) {
    const path = join(bundleDirectory, fileName);
    await assertRegularFile(path, `Diagnostic bundle file ${fileName}`);
    const content = await readFile(path, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(content)) {
        throw new Error(`Diagnostic bundle file ${fileName} contains unredacted sensitive data.`);
      }
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
