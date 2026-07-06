import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { fail, readText } from './check-utils.mjs';

const repoRoot = process.cwd();
const outputTargets = [
  'docs/openapi/registry.openapi.json',
  'docs-site/public/openapi/registry.openapi.json',
];
const docsLinks = [
  ['docs/packages/registry.md', '../openapi/registry.openapi.json'],
  ['packages/registry/README.md', '../../docs/openapi/registry.openapi.json'],
  ['docs-site/packages/registry.md', '/openapi/registry.openapi.json'],
];

export const REQUIRED_OPERATIONS = [
  ['GET', '/health'],
  ['GET', '/metrics'],
  ['GET', '/metrics/summary'],
  ['GET', '/events'],
  ['GET', '/agents/stream'],
  ['GET', '/agents'],
  ['POST', '/agents/register'],
  ['POST', '/admin/agents/register'],
  ['GET', '/agents/search'],
  ['GET', '/agents/{id}'],
  ['POST', '/agents/{id}/heartbeat'],
  ['DELETE', '/agents/{id}'],
  ['POST', '/admin/agents/{id}/heartbeat'],
  ['DELETE', '/admin/agents/{id}'],
  ['GET', '/admin/agents/export'],
  ['POST', '/admin/agents/import'],
  ['GET', '/tasks/recent'],
  ['GET', '/tasks/stream'],
  ['GET', '/trust-log'],
  ['GET', '/trust-log/{cardHash}'],
];

export const REQUIRED_SCHEMAS = [
  'AgentCard',
  'AgentSkill',
  'AgentStatus',
  'AgentTransport',
  'AuthErrorResponse',
  'ErrorResponse',
  'RateLimitErrorResponse',
  'RegisterAgentRequest',
  'RegisteredAgent',
  'RegistryEvent',
  'RegistryExportDocument',
  'RegistryHealth',
  'RegistryImportResult',
  'RegistryMetricsSummary',
  'RegistryTaskEvent',
  'TrustLogEntry',
  'ValidationErrorResponse',
  'ValidationIssue',
];

const REQUIRED_AUTH_OPERATIONS = new Set([
  'GET /events',
  'GET /agents/stream',
  'POST /agents/register',
  'POST /admin/agents/register',
  'POST /agents/{id}/heartbeat',
  'DELETE /agents/{id}',
  'POST /admin/agents/{id}/heartbeat',
  'DELETE /admin/agents/{id}',
  'GET /admin/agents/export',
  'POST /admin/agents/import',
  'GET /tasks/recent',
  'GET /tasks/stream',
]);

const REQUIRED_SSE_OPERATIONS = new Set(['GET /events', 'GET /agents/stream', 'GET /tasks/stream']);
const REQUIRED_AGENT_CARD_PROTOCOL_VERSIONS = ['0.3', '1.0', '1.2'];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function methodKey(method) {
  return method.toLowerCase();
}

function operationKey(method, path) {
  return `${method.toUpperCase()} ${path}`;
}

function requireRecord(value, label, failures) {
  if (!isRecord(value)) {
    failures.push(`${label} must be an object`);
    return {};
  }
  return value;
}

function getOperation(document, method, path, failures) {
  const paths = requireRecord(document.paths, 'paths', failures);
  const pathItem = paths[path];
  if (!isRecord(pathItem)) {
    failures.push(`${operationKey(method, path)} path is missing`);
    return undefined;
  }

  const operation = pathItem[methodKey(method)];
  if (!isRecord(operation)) {
    failures.push(`${operationKey(method, path)} operation is missing`);
    return undefined;
  }

  return operation;
}

function getComponents(document, failures) {
  const components = requireRecord(document.components, 'components', failures);
  return {
    parameters: requireRecord(components.parameters, 'components.parameters', failures),
    responses: requireRecord(components.responses, 'components.responses', failures),
    schemas: requireRecord(components.schemas, 'components.schemas', failures),
    securitySchemes: requireRecord(
      components.securitySchemes,
      'components.securitySchemes',
      failures,
    ),
  };
}

function validateOperation(method, path, operation, document, failures) {
  const key = operationKey(method, path);
  if (typeof operation.operationId !== 'string' || operation.operationId.length === 0) {
    failures.push(`${key} must define operationId`);
  }
  if (!Array.isArray(operation.tags) || operation.tags.length === 0) {
    failures.push(`${key} must define at least one tag`);
  }

  const responses = requireRecord(operation.responses, `${key} responses`, failures);
  if (!isRecord(responses['200']) && !isRecord(responses['201']) && !isRecord(responses['204'])) {
    failures.push(`${key} must define a successful response`);
  }
  if (!isRecord(responses['403'])) {
    failures.push(`${key} must define a 403 response`);
  }
  if (!isRecord(responses['429'])) {
    failures.push(`${key} must define a 429 response`);
  }

  if (REQUIRED_AUTH_OPERATIONS.has(key)) {
    if (!Array.isArray(operation.security) || operation.security.length === 0) {
      failures.push(`${key} must define bearer security`);
    }
    if (!isRecord(responses['401'])) {
      failures.push(`${key} must define a 401 response`);
    }
  }

  if (REQUIRED_SSE_OPERATIONS.has(key)) {
    const okResponse = responses['200'];
    const content = isRecord(okResponse) ? okResponse.content : undefined;
    if (!isRecord(content) || !isRecord(content['text/event-stream'])) {
      failures.push(`${key} must document text/event-stream content`);
    }
  }

  if (path.includes('{id}')) {
    const pathItem = document.paths[path];
    const pathParameters = Array.isArray(pathItem?.parameters) ? pathItem.parameters : [];
    const operationParameters = Array.isArray(operation.parameters) ? operation.parameters : [];
    const allParameters = [...pathParameters, ...operationParameters];
    const hasAgentId = allParameters.some(
      (parameter) =>
        isRecord(parameter) &&
        (parameter.$ref === '#/components/parameters/AgentIdPath' || parameter.name === 'id'),
    );
    if (!hasAgentId) {
      failures.push(`${key} must define the id path parameter`);
    }
  }
}

function validateAgentCardSchema(components, failures) {
  const agentCard = components.schemas.AgentCard;
  const properties = isRecord(agentCard) ? agentCard.properties : undefined;
  const protocolVersion = isRecord(properties) ? properties.protocolVersion : undefined;
  const versions = isRecord(protocolVersion) ? protocolVersion.enum : undefined;
  if (
    !Array.isArray(versions) ||
    !REQUIRED_AGENT_CARD_PROTOCOL_VERSIONS.every((version) => versions.includes(version))
  ) {
    failures.push(
      `components.schemas.AgentCard.properties.protocolVersion.enum must include ${REQUIRED_AGENT_CARD_PROTOCOL_VERSIONS.join(', ')}`,
    );
  }
}

function validateReferences(value, components, failures, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      validateReferences(entry, components, failures, `${path}[${index}]`),
    );
    return;
  }
  if (!isRecord(value)) return;

  const ref = value.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/components/')) {
    const [, , section, name] = ref.split('/');
    if (!section || !name) {
      failures.push(`${path}: malformed local reference ${ref}`);
    } else if (!isRecord(components[section]) || !Object.hasOwn(components[section], name)) {
      failures.push(`${path}: unresolved local reference ${ref}`);
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    validateReferences(entry, components, failures, `${path}.${key}`);
  }
}

export function validateOpenApiDocument(document) {
  const failures = [];
  if (!isRecord(document)) {
    return ['OpenAPI document must be an object'];
  }
  if (document.openapi !== '3.1.0') {
    failures.push('OpenAPI document must use openapi: 3.1.0');
  }
  if (!isRecord(document.info) || typeof document.info.title !== 'string') {
    failures.push('info.title is required');
  }

  const components = getComponents(document, failures);
  if (!isRecord(components.securitySchemes.bearerAuth)) {
    failures.push('components.securitySchemes.bearerAuth is required');
  }

  for (const schemaName of REQUIRED_SCHEMAS) {
    if (!isRecord(components.schemas[schemaName])) {
      failures.push(`components.schemas.${schemaName} is required`);
    }
  }
  validateAgentCardSchema(components, failures);

  for (const [method, path] of REQUIRED_OPERATIONS) {
    const operation = getOperation(document, method, path, failures);
    if (operation) validateOperation(method, path, operation, document, failures);
  }

  validateReferences(document, document.components ?? {}, failures);
  return failures;
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}

export async function formatOpenApiDocument(document, targetPath = outputTargets[0]) {
  const prettierConfig = await resolveConfig(join(repoRoot, targetPath));
  return format(JSON.stringify(sortJson(document)), {
    ...(prettierConfig ?? {}),
    parser: 'json',
  });
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, '\n');
}

async function checkOutputFiles(document, shouldWrite) {
  const failures = [];

  for (const target of outputTargets) {
    const expected = await formatOpenApiDocument(document, target);
    const absoluteTarget = join(repoRoot, target);
    if (shouldWrite) {
      mkdirSync(dirname(absoluteTarget), { recursive: true });
      writeFileSync(absoluteTarget, expected);
      continue;
    }

    if (!existsSync(absoluteTarget)) {
      failures.push(`${target} is missing; run pnpm run openapi:generate`);
      continue;
    }

    const actual = normalizeLineEndings(readText(target));
    if (actual !== normalizeLineEndings(expected)) {
      failures.push(`${target} is out of date; run pnpm run openapi:generate`);
    }
  }

  return failures;
}

function checkDocsLinks() {
  const failures = [];
  for (const [docPath, link] of docsLinks) {
    const text = readText(docPath);
    if (!text.includes(link)) {
      failures.push(`${docPath} must link to ${link}`);
    }
  }
  return failures;
}

async function loadRegistryOpenApiDocument() {
  const moduleUrl = new URL('../packages/registry/dist/openapi.js', import.meta.url);
  return (await import(moduleUrl.href)).registryOpenApiDocument;
}

async function main() {
  const shouldWrite = process.argv.includes('--write');
  const document = await loadRegistryOpenApiDocument();
  const failures = [
    ...validateOpenApiDocument(document),
    ...(await checkOutputFiles(document, shouldWrite)),
    ...checkDocsLinks(),
  ];

  if (failures.length > 0) {
    fail('Registry OpenAPI validation failed.', failures);
    return;
  }

  console.log('Registry OpenAPI document is valid and up to date.');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  await main();
}
