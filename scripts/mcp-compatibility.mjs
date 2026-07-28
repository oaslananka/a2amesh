import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROTOCOL_VERSION = '2026-07-28';
const FIXTURE_NAMES = [
  'legacy-initialize-request',
  'discover-request',
  'discover-result',
  'tools-list-result',
  'tool-call-request',
  'tool-call-result',
  'unsupported-version-error',
  'cancelled-notification',
  'auth-denied',
  'sdk-v2-probe-result',
];
const REQUIRED_SURFACES = [
  'connection.bootstrap',
  'session.state',
  'request.metadata',
  'http.headers',
  'tools.discovery',
  'tools.call',
  'cache.hints',
  'errors.unsupported-version',
  'cancellation',
  'tracing',
  'authorization',
  'tasks.extension',
  'apps.extension',
  'deprecated.server-requests',
];
const ALLOWED_DECISIONS = new Set([
  'adopt-after-final-gate',
  'defer',
  'evaluate',
  'isolate',
  'reject',
  'retain',
]);

export function loadMcpNextContract(root = process.cwd()) {
  const fixtureDirectory = resolve(root, 'tests/conformance/fixtures/mcp-2026-07-28');
  const matrix = readJson(join(fixtureDirectory, 'matrix.json'));
  const fixtures = Object.fromEntries(
    FIXTURE_NAMES.map((name) => [name, readJson(join(fixtureDirectory, `${name}.json`))]),
  );
  return { ...matrix, fixtures };
}

export function validateMcpNextContract(contract) {
  const failures = [];
  validateContractIdentity(contract, failures);
  validateContractSurfaces(contract.surfaces, failures);
  validateContractFixtures(contract.fixtures, failures);
  return failures;
}

export function validateMcpNextProbePayload(payload) {
  const failures = [];
  validateProbeIdentity(payload, failures);
  validateProbeTools(payload, failures);
  validateProbeRequests(payload?.requests, failures);
  validateProbeRedaction(payload, failures);
  return [...new Set(failures)];
}

function validateContractIdentity(contract, failures) {
  if (contract.protocolVersion !== PROTOCOL_VERSION) {
    failures.push(`protocolVersion must be ${PROTOCOL_VERSION}`);
  }
  if (contract.supportStatus !== 'pre-adoption') {
    failures.push('supportStatus must remain pre-adoption until the final adoption gate');
  }
  if (contract.stableSdkRange !== '^1.29.0') {
    failures.push('stableSdkRange must remain ^1.29.0 during the compatibility phase');
  }
  if (!sameJson(contract.candidateSdk, expectedCandidateSdk())) {
    failures.push('candidateSdk must pin the exact split SDK 2.0.0 package set');
  }
}

function validateContractSurfaces(surfaceValue, failures) {
  const surfaces = Array.isArray(surfaceValue) ? surfaceValue : [];
  const surfaceIds = surfaces.map((surface) => surface.id);
  if (!sameJson(surfaceIds, REQUIRED_SURFACES)) {
    failures.push('compatibility surfaces must match the reviewed order and inventory');
  }
  if (new Set(surfaceIds).size !== surfaceIds.length) {
    failures.push('compatibility surface identifiers must be unique');
  }
  for (const surface of surfaces) validateContractSurface(surface, failures);
}

function validateContractSurface(surface, failures) {
  for (const field of ['current', 'next', 'decision', 'evidence', 'rollback']) {
    const value = surface[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      failures.push(`${String(surface.id)} must define ${field}`);
    }
  }
  if (!ALLOWED_DECISIONS.has(surface.decision)) {
    failures.push(`${String(surface.id)} uses unsupported decision ${String(surface.decision)}`);
  }
}

function validateContractFixtures(fixtureValue, failures) {
  const fixtures = fixtureValue ?? {};
  for (const name of FIXTURE_NAMES) {
    if (!Object.hasOwn(fixtures, name)) failures.push(`missing fixture ${name}.json`);
  }
  validateNegotiationFixtures(fixtures, failures);
  validateToolFixtures(fixtures, failures);
  validateFailureFixtures(fixtures, failures);
}

function validateProbeIdentity(payload, failures) {
  if (!sameJson(payload?.sdk, expectedCandidateSdk())) {
    failures.push('candidate probe must use the exact split SDK 2.0.0 package set');
  }
  if (payload?.protocolVersion !== PROTOCOL_VERSION) {
    failures.push(`candidate probe must negotiate ${PROTOCOL_VERSION}`);
  }
  if (payload?.unauthorizedStatus !== 401) {
    failures.push('candidate probe must reject the unauthenticated request with HTTP 401');
  }
  if (!sameJson(payload?.methods, ['server/discover', 'tools/list', 'tools/call'])) {
    failures.push('candidate probe must run discover, list, and call in order');
  }
  if (payload?.sawInitialize !== false) {
    failures.push('candidate probe must not use initialize');
  }
}

function validateProbeTools(payload, failures) {
  if (!sameJson(payload?.tools?.names, ['research-agent', 'summary-agent'])) {
    failures.push('candidate probe must return deterministic tool ordering');
  }
  if (payload?.tools?.ttlMs !== 120_000 || payload?.tools?.cacheScope !== 'public') {
    failures.push('candidate probe must preserve reviewed tools/list cache hints');
  }
  if (payload?.call?.text !== 'fixture-ok') {
    failures.push('candidate probe must return the deterministic tool result');
  }
}

function validateProbeRequests(requestValue, failures) {
  const requests = Array.isArray(requestValue) ? requestValue : [];
  for (const request of requests) validateProbeRequest(request, failures);
}

function validateProbeRequest(request, failures) {
  if (request.protocolVersion !== PROTOCOL_VERSION) {
    failures.push(`${String(request.method)} must carry the modern protocol header`);
  }
  if (request.methodHeader !== request.method) {
    failures.push(`${String(request.method)} must bind Mcp-Method to the body method`);
  }
  if (request.method === 'tools/call' && request.nameHeader !== request.name) {
    failures.push('tools/call must bind Mcp-Name to params.name');
  }
  if (request.hasCredential !== true) {
    failures.push(`${String(request.method)} must pass the synthetic auth boundary`);
  }
}

function validateProbeRedaction(payload, failures) {
  const serialized = JSON.stringify(payload ?? {});
  if (/fixture-credential|authorization\s*:/i.test(serialized)) {
    failures.push('candidate probe evidence must not retain credential material');
  }
}

function expectedCandidateSdk() {
  return { client: '2.0.0', core: '2.0.0', node: '2.0.0', server: '2.0.0' };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function evaluateMcpNextProbeResult({ exitCode, stdout, stderr }) {
  const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
  return {
    status: exitCode === 0 ? 'compatible' : 'incompatible',
    exitCode,
    summary: redactAndBound(combined || (exitCode === 0 ? 'probe completed' : 'probe failed')),
  };
}

function validateNegotiationFixtures(fixtures, failures) {
  const legacy = fixtures['legacy-initialize-request'];
  const discover = fixtures['discover-request'];
  if (legacy?.method !== 'initialize') failures.push('legacy fixture must use initialize');
  if (discover?.method !== 'server/discover') {
    failures.push('modern negotiation fixture must use server/discover');
  }
  if (discover?.params?._meta?.['io.modelcontextprotocol/protocolVersion'] !== PROTOCOL_VERSION) {
    failures.push('discover request must carry the modern protocol version in params._meta');
  }
}

function validateToolFixtures(fixtures, failures) {
  const call = fixtures['tool-call-request'];
  const headers = call?.headers ?? {};
  const body = call?.body ?? {};
  if (headers['MCP-Protocol-Version'] !== PROTOCOL_VERSION) {
    failures.push('tool call must bind the MCP protocol version header');
  }
  if (headers['Mcp-Method'] !== body.method) {
    failures.push('tool call method header must match the JSON-RPC method');
  }
  if (headers['Mcp-Name'] !== body.params?.name) {
    failures.push('tool call name header must match params.name');
  }
  if (body.params?._meta?.['io.modelcontextprotocol/protocolVersion'] !== PROTOCOL_VERSION) {
    failures.push('tool call must carry the protocol version in params._meta');
  }
  if (!/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/.test(body.params?._meta?.traceparent ?? '')) {
    failures.push('tool call traceparent must use a bounded W3C trace context shape');
  }

  const list = fixtures['tools-list-result'];
  const names = Array.isArray(list?.tools) ? list.tools.map((tool) => tool.name) : [];
  if (
    JSON.stringify(names) !==
    JSON.stringify([...names].sort((left, right) => left.localeCompare(right)))
  ) {
    failures.push('tools/list fixture must be sorted by tool name');
  }
  if (new Set(names).size !== names.length) failures.push('tools/list names must be unique');
  if (list?.ttlMs !== 120_000 || list?.cacheScope !== 'public') {
    failures.push('tools/list fixture must carry reviewed cache hints');
  }
}

function validateFailureFixtures(fixtures, failures) {
  const unsupported = fixtures['unsupported-version-error'];
  if (unsupported?.error?.code !== -32022) {
    failures.push('unsupported version fixture must use the modern version error code');
  }
  if (unsupported?.error?.data?.requested === PROTOCOL_VERSION) {
    failures.push('unsupported version fixture must request a version outside the supported set');
  }
  if (!unsupported?.error?.data?.supported?.includes(PROTOCOL_VERSION)) {
    failures.push('unsupported version fixture must advertise the reviewed version');
  }
  if (fixtures['cancelled-notification']?.method !== 'notifications/cancelled') {
    failures.push('cancellation fixture must use notifications/cancelled');
  }
  if (fixtures['auth-denied']?.status !== 401) failures.push('auth denial must use HTTP 401');
  const serialized = JSON.stringify({
    cancellation: fixtures['cancelled-notification'],
    auth: fixtures['auth-denied'],
  });
  if (/authorization|bearer|api[_-]?key|secret|token-value/i.test(serialized)) {
    failures.push('failure fixtures must not contain credential material');
  }
}

function redactAndBound(value) {
  const redacted = String(value)
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*)[^\s]+/gi,
      '$1[REDACTED]',
    );
  return redacted.length <= 2_000 ? redacted : `${redacted.slice(0, 1_997)}...`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
