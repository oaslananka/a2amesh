import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fail } from './check-utils.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
const STALE_PATTERN = 'a2amesh.github.io/a2amesh';
const INTERNAL_INSTALL_PATTERNS = [
  /pnpm\s+add\s+@a2amesh\/internal/,
  /npm\s+install\s+@a2amesh\/internal/,
];
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.cache',
  '.artifacts',
  '.codex-checkpoints',
]);
// Files that intentionally reference the stale URL for documentation or scan-definition purposes.
const EXCLUDE_FILES = new Set([
  'scripts/check-public-docs-links.mjs',
  'docs/audits/a2amesh-clean-start-report.md',
]);

export const DEFAULT_DOCS_BASE_URL = 'https://oaslananka.github.io/a2amesh/';
export const REQUIRED_PUBLIC_DOCS_PATHS = [
  { path: '/', label: 'homepage' },
  { path: '/guide/introduction', label: 'docs index' },
  { path: '/guide/installation', label: 'install guide' },
  { path: '/guide/quick-start', label: 'quick start' },
  { path: '/guide/compatibility', label: 'compatibility guide' },
  { path: '/packages/runtime', label: 'package docs' },
  { path: '/api/core', label: 'API docs' },
  { path: '/cli/', label: 'CLI docs' },
  { path: '/security/threat-model', label: 'threat model' },
  { path: '/release/process', label: 'release process' },
];

const DEFAULT_TIMEOUT_MS = 10_000;
const HTML_CONTENT_TYPE = 'text/html';
const HOME_TITLE = 'A2A Mesh';

export function normalizeBaseUrl(baseUrl = DEFAULT_DOCS_BASE_URL) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

export function buildDocsUrl(baseUrl, path) {
  const normalizedPath = path === '/' ? '' : path.replace(/^\/+/, '');
  return new URL(normalizedPath, normalizeBaseUrl(baseUrl)).toString();
}

export async function checkPublicDocsLinks(options = {}) {
  const baseUrl = options.baseUrl ?? process.env.DOCS_BASE_URL ?? DEFAULT_DOCS_BASE_URL;
  const timeoutMs = options.timeoutMs ?? readTimeoutMs();
  const failures = await Promise.all(
    REQUIRED_PUBLIC_DOCS_PATHS.map((page) => checkDocsPage(baseUrl, page, timeoutMs)),
  );
  return failures.filter(Boolean);
}

function readTimeoutMs() {
  const configured = Number.parseInt(process.env.DOCS_LINK_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

async function checkDocsPage(baseUrl, page, timeoutMs) {
  const url = buildDocsUrl(baseUrl, page.path);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const failure = await validateResponse(page, url, response);
    return failure;
  } catch (error) {
    return `${page.path} (${page.label}) request failed for ${url}: ${String(error)}`;
  }
}

async function validateResponse(page, url, response) {
  if (!response.ok) {
    return `${page.path} (${page.label}) returned HTTP ${response.status} for ${url}`;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes(HTML_CONTENT_TYPE)) {
    return `${page.path} (${page.label}) returned non-HTML content-type ${contentType}`;
  }

  if (page.path === '/') return validateHomePageTitle(page, await response.text());
  return '';
}

function validateHomePageTitle(page, body) {
  if (body.includes(HOME_TITLE)) return '';
  return `${page.path} (${page.label}) did not include ${HOME_TITLE}`;
}

/**
 * Recursively scan the repository for files containing stale base URL references.
 * Returns formatted error lines for each match.
 */
function scanRepoForStaleUrl(rootPath) {
  const errors = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = relative(rootPath, fullPath);
        if (EXCLUDE_FILES.has(relPath.replace(/\\/g, '/'))) continue;
        try {
          const content = readFileSync(fullPath, 'utf8');
          if (content.includes(STALE_PATTERN)) {
            const relPath = relative(rootPath, fullPath);
            // Show every line that matches
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(STALE_PATTERN)) {
                errors.push(`  ${relPath}:${i + 1}: ${lines[i].trim()}`);
              }
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  if (!rootPath || rootPath === '/' || !existsSync(rootPath)) {
    console.warn(
      `  WARNING: ROOT path "${rootPath}" does not exist or is invalid. Skipping repo scan.`,
    );
    return errors;
  }
  walk(rootPath);
  return errors;
}

/**
 * Scan the repository for markdown files containing direct install commands for
 * internal (`@a2amesh/internal-*`) packages. These should never appear in docs
 * or package READMEs because internal packages are private.
 *
 * Lines that explicitly warn the reader not to run the command are excluded.
 */
function scanRepoForInstallPatterns(rootPath) {
  const errors = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = relative(rootPath, fullPath).replace(/\\/g, '/');
        if (EXCLUDE_FILES.has(relPath)) continue;
        // Only scan markdown, TypeScript, and documentation-like files
        if (!/\.(md|mdx|ts|tsx|js|mjs)$/i.test(entry.name)) continue;
        try {
          const content = readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip lines that warn the reader not to run the command
            if (/do\s+not/i.test(line) || /don'?t/i.test(line)) continue;
            for (const pattern of INTERNAL_INSTALL_PATTERNS) {
              if (pattern.test(line)) {
                errors.push(`  ${relPath}:${i + 1}: ${line.trim()}`);
                break;
              }
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  if (!rootPath || rootPath === '/' || !existsSync(rootPath)) {
    console.warn(`  WARNING: ROOT path "${rootPath}" does not exist or is invalid.`);
    return errors;
  }
  walk(rootPath);
  return errors;
}

async function main() {
  // Validate the configured URL is correct for the current owner/repo.
  const configured = normalizeBaseUrl(DEFAULT_DOCS_BASE_URL);
  const expectedHost = 'oaslananka.github.io';
  const url = new URL(configured);
  if (url.hostname !== expectedHost) {
    fail('Public docs link validation failed.', [
      `DEFAULT_DOCS_BASE_URL hostname is "${url.hostname}" but expected "${expectedHost}"`,
    ]);
    return;
  }

  // Scan the repository for direct install commands of internal packages.
  console.log('Scanning repository for internal package install commands in docs...');
  const installErrors = scanRepoForInstallPatterns(ROOT);
  if (installErrors.length > 0) {
    fail(
      `Found ${installErrors.length} internal package install command(s) in non-warning documentation:`,
      installErrors,
    );
    return;
  }
  console.log('  No internal package install commands found. Documentation is clean.');

  // Scan the repository for stale a2amesh.github.io/a2amesh references.
  console.log(`Scanning repository for stale "${STALE_PATTERN}" references...`);
  const staleMatches = scanRepoForStaleUrl(ROOT);
  if (staleMatches.length > 0) {
    fail(
      `Found ${staleMatches.length} stale "${STALE_PATTERN}" reference(s) in the repository:`,
      staleMatches,
    );
    return;
  }
  console.log('  No stale references found. Repository is clean.');

  // Live site check: report HTTP errors (broken links), skip connection errors (not deployed).
  const failures = await checkPublicDocsLinks();
  const httpErrors = failures.filter((f) => /returned HTTP/.test(f));
  const connectionErrors = failures.filter((f) => !/returned HTTP/.test(f));
  if (httpErrors.length > 0) {
    fail(`Found ${httpErrors.length} broken docs link(s):`, httpErrors);
  }
  if (connectionErrors.length > 0) {
    console.warn(
      `WARNING: Docs site does not appear to be deployed yet (expected before GitHub Pages setup). Skipping live link check.`,
    );
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
