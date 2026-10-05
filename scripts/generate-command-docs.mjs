import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
import { runPnpmSync } from './check-utils.mjs';

const generatedMarker = '<!-- Synced from scripts/generate-command-docs.mjs. -->';
const checkMode = process.argv.includes('--check');
const repoRoot = process.cwd();
const cliDocsHelpWidth = 100;

function buildCliPackage() {
  runPnpmSync(['--filter', '@a2amesh/cli...', 'run', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

async function loadCliDocumentationSurface() {
  const entryUrl = pathToFileURL(resolve(repoRoot, 'packages/cli/dist/index.js'));
  entryUrl.searchParams.set('docs', String(Date.now()));
  return import(entryUrl.href);
}

function normalizeHelp(text) {
  return text.trimEnd();
}

function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, '\n');
}

function renderMarkdownTableCell(value) {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function configureDeterministicHelp(command) {
  command.configureHelp({ helpWidth: cliDocsHelpWidth });
  for (const subcommand of command.commands) {
    configureDeterministicHelp(subcommand);
  }
  return command;
}

function commandPath(command) {
  const parts = [];
  let current = command;
  while (current.parent) {
    parts.unshift(current.name());
    current = current.parent;
  }
  return parts;
}

function commandTitle(path) {
  return `a2amesh ${path.join(' ')}`;
}

function commandFileName(path) {
  return `${path.join('-')}.md`;
}

function renderExampleBlock(example, shell) {
  const lines = shell === 'bash' ? example.bash : example.powershell;
  const label = shell === 'bash' ? 'Linux/macOS' : 'PowerShell';
  return [`### ${example.title} (${label})`, '', `\`\`\`${shell}`, ...lines, '```', ''].join('\n');
}

function renderExamples(doc) {
  return doc.examples
    .flatMap((example) => [
      renderExampleBlock(example, 'bash'),
      renderExampleBlock(example, 'powershell'),
    ])
    .join('\n')
    .trimEnd();
}

function renderCommandTable(commands, docByKey, commandDocKey) {
  return [
    '| Command | Summary |',
    '| --- | --- |',
    ...commands.map((command) => {
      const path = commandPath(command);
      const doc = docByKey.get(commandDocKey(path));
      const summary = renderMarkdownTableCell(
        doc?.summary ?? (command.summary() || command.description() || ''),
      );
      return `| \`${commandTitle(path)}\` | ${summary} |`;
    }),
  ].join('\n');
}

function renderSubcommands(command, commandDocKey, docByKey) {
  if (command.commands.length === 0) return '';

  return [
    '## Subcommands',
    '',
    renderCommandTable(command.commands, docByKey, commandDocKey),
    '',
  ].join('\n');
}

function renderRootPage(program, commandDocKey, docByKey) {
  const commands = [...program.commands].sort((left, right) =>
    left.name().localeCompare(right.name()),
  );
  return [
    '# CLI',
    '',
    generatedMarker,
    '',
    program.description(),
    '',
    '## Usage',
    '',
    '```text',
    normalizeHelp(program.helpInformation()),
    '```',
    '',
    '## Commands',
    '',
    renderCommandTable(commands, docByKey, commandDocKey),
    '',
    '## Shared Network Options',
    '',
    'Network commands accept the same request options where applicable: `--header <key:value...>`, `--bearer-token <token>`, `--api-key <name:value>`, `--timeout-ms <ms>`, `--retries <count>`, `--request-id <id>`, and `--origin <url>`.',
    '',
    'Secret-bearing values are sent in request headers only; JSON output and validation errors must not echo bearer tokens, API key values, or full auth headers.',
    '',
  ].join('\n');
}

function renderCommandPage(command, commandDocKey, docByKey) {
  const path = commandPath(command);
  const doc = docByKey.get(commandDocKey(path));
  if (!doc) throw new Error(`Missing CLI command docs metadata for ${path.join(' ')}`);

  return [
    `# ${commandTitle(path)}`,
    '',
    generatedMarker,
    '',
    doc.description,
    '',
    '## Usage',
    '',
    '```text',
    normalizeHelp(command.helpInformation()),
    '```',
    '',
    renderSubcommands(command, commandDocKey, docByKey),
    '## Examples',
    '',
    renderExamples(doc),
    '',
    doc.additionalMarkdown ? `${doc.additionalMarkdown.trim()}\n` : '',
  ].join('\n');
}

function validateMetadata(program, docs, commandDocKey) {
  const topLevelPaths = new Set(
    program.commands.map((command) => commandDocKey(commandPath(command))),
  );
  const failures = [];

  for (const doc of docs) {
    const key = commandDocKey(doc.path);
    if (!topLevelPaths.has(key)) {
      failures.push(`metadata references missing top-level command ${key}`);
    }
    if (doc.examples.length === 0) {
      failures.push(`${key} must define at least one example`);
    }
    for (const example of doc.examples) {
      if (example.bash.length === 0)
        failures.push(`${key} example "${example.title}" missing bash`);
      if (example.powershell.length === 0)
        failures.push(`${key} example "${example.title}" missing powershell`);
    }
  }

  for (const command of program.commands) {
    const key = commandDocKey(commandPath(command));
    if (!docs.some((doc) => commandDocKey(doc.path) === key)) {
      failures.push(`missing metadata for top-level command ${key}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Invalid CLI command documentation metadata:\n- ${failures.join('\n- ')}`);
  }
}

async function renderDocs(program, commandDocKey, docs) {
  const docByKey = new Map(docs.map((doc) => [commandDocKey(doc.path), doc]));
  validateMetadata(program, docs, commandDocKey);

  const files = new Map();
  const rootPage = renderRootPage(program, commandDocKey, docByKey);
  files.set('docs/cli/index.md', await format(rootPage, { parser: 'markdown' }));
  files.set('docs-site/cli/index.md', await format(rootPage, { parser: 'markdown' }));

  for (const command of [...program.commands].sort((left, right) =>
    left.name().localeCompare(right.name()),
  )) {
    const path = commandPath(command);
    const page = renderCommandPage(command, commandDocKey, docByKey);
    const fileName = commandFileName(path);
    const formattedPage = await format(page, { parser: 'markdown' });
    files.set(`docs/cli/${fileName}`, formattedPage);
    files.set(`docs-site/cli/${fileName}`, formattedPage);
  }

  return files;
}

function writeOrCheck(files) {
  const failures = [];

  for (const [relativePath, contents] of files) {
    const targetPath = resolve(repoRoot, relativePath);
    if (checkMode) {
      if (!existsSync(targetPath)) {
        failures.push(`${relativePath}: missing`);
        continue;
      }
      const current = normalizeLineEndings(readFileSync(targetPath, 'utf8'));
      if (current !== normalizeLineEndings(contents)) {
        failures.push(`${relativePath}: generated docs are stale`);
      }
      continue;
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, contents, 'utf8');
  }

  if (failures.length > 0) {
    console.error('Generated CLI documentation is out of date.');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error('Run `pnpm run docs:commands:generate` and commit the result.');
    process.exitCode = 1;
  }
}

buildCliPackage();
const { cliCommandDocs, commandDocKey, createProgram } = await loadCliDocumentationSurface();
writeOrCheck(
  await renderDocs(configureDeterministicHelp(createProgram()), commandDocKey, cliCommandDocs),
);
