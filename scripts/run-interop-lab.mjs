#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');
const matrixPath = path.join(root, 'tests/interop/matrix.json');
const reportPath = path.join(root, 'artifacts/interop-lab/report.json');

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read JSON from ${path.relative(root, file)}: ${message}`);
  }
}
const pairKey = (client, server) => `${client}->${server}`;
const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);

function requireString(errors, object, key, owner) {
  if (typeof object[key] !== 'string' || object[key].length === 0) {
    errors.push(`${owner}.${key} must be a non-empty string`);
  }
}

function arrayOfRecords(errors, value, owner) {
  if (!Array.isArray(value)) {
    errors.push(`${owner} must be an array`);
    return [];
  }
  return value.filter((item, index) => {
    if (isRecord(item)) return true;
    errors.push(`${owner}[${index}] must be an object`);
    return false;
  });
}

function stringArray(errors, value, owner) {
  if (!Array.isArray(value)) {
    errors.push(`${owner} must be an array`);
    return [];
  }
  return value.filter((item, index) => {
    if (typeof item === 'string' && item.length > 0) return true;
    errors.push(`${owner}[${index}] must be a non-empty string`);
    return false;
  });
}

function methodNames(events) {
  return events.map((event) => event.method).filter((method) => typeof method === 'string');
}

function stateNames(events) {
  return events.map((event) => event.state).filter((state) => typeof state === 'string');
}

function hasOperation(events, name) {
  return events.some((event) => event.operation === name);
}

function validateTrace(errors, scenario, trace) {
  if (!isRecord(trace)) {
    errors.push(`${scenario.id}: trace must be an object`);
    return;
  }
  if (trace.scenario !== scenario.id) {
    errors.push(`${scenario.id}: trace scenario mismatch`);
  }
  if (trace.profile !== 'official-a2a-v1.0') {
    errors.push(`${scenario.id}: trace profile mismatch`);
  }
  if (trace.client !== scenario.client || trace.server !== scenario.server) {
    errors.push(`${scenario.id}: trace endpoints mismatch`);
  }
  const events = arrayOfRecords(errors, trace.events, `${scenario.id}: trace.events`);
  if (events.length === 0) {
    errors.push(`${scenario.id}: trace must contain events`);
    return;
  }

  const methods = methodNames(events);
  const states = stateNames(events);
  const capabilities = new Set(scenario.capabilities);

  if (capabilities.has('message-send') && !methods.includes('message/send')) {
    errors.push(`${scenario.id}: missing message/send event`);
  }
  if (capabilities.has('message-stream') && !methods.includes('message/stream')) {
    errors.push(`${scenario.id}: missing message/stream event`);
  }
  if (capabilities.has('cancellation') && !methods.includes('tasks/cancel')) {
    errors.push(`${scenario.id}: missing cancel event`);
  }
  if (capabilities.has('callback-config') && !methods.some((method) => method.includes('Config'))) {
    errors.push(`${scenario.id}: missing callback config event`);
  }
  if (capabilities.has('auth-challenge') && !states.includes('TASK_STATE_AUTH_REQUIRED')) {
    errors.push(`${scenario.id}: missing auth required state`);
  }
  if (capabilities.has('task-lifecycle')) {
    const hasStart =
      states.includes('TASK_STATE_SUBMITTED') || states.includes('TASK_STATE_WORKING');
    const hasEnd = states.some((state) =>
      ['TASK_STATE_COMPLETED', 'TASK_STATE_CANCELED', 'TASK_STATE_FAILED'].includes(state),
    );
    if (!hasStart || !hasEnd) {
      errors.push(`${scenario.id}: lifecycle trace must contain start and terminal states`);
    }
  }
  if (capabilities.has('registry-discovery') && !hasOperation(events, 'discover')) {
    errors.push(`${scenario.id}: missing registry discovery event`);
  }
}

async function main() {
  const errors = [];
  const matrix = await readJson(matrixPath);

  if (!isRecord(matrix)) {
    throw new Error('interop matrix must be an object');
  }
  for (const key of ['schemaVersion', 'name', 'profile', 'mode']) {
    requireString(errors, matrix, key, 'matrix');
  }
  if (matrix.profile !== 'official-a2a-v1.0') {
    errors.push('matrix.profile must be official-a2a-v1.0');
  }
  if (matrix.mode !== 'fixture-replay') {
    errors.push('matrix.mode must be fixture-replay');
  }

  const participantRecords = arrayOfRecords(errors, matrix.participants, 'matrix.participants');
  const participants = new Set();
  for (const participant of participantRecords) {
    requireString(errors, participant, 'id', 'participant');
    if (typeof participant.id === 'string') participants.add(participant.id);
  }
  const scenarioRecords = arrayOfRecords(errors, matrix.scenarios, 'matrix.scenarios');
  const coveredCapabilities = new Set();
  const coveredPairs = new Set();
  const traces = [];

  if (participants.size === 0) {
    errors.push('matrix.participants must not be empty');
  }
  if (scenarioRecords.length === 0) {
    errors.push('matrix.scenarios must not be empty');
  }

  for (const scenario of scenarioRecords) {
    for (const key of ['id', 'description', 'client', 'server', 'transport', 'trace']) {
      requireString(errors, scenario, key, 'scenario');
    }
    if (!participants.has(scenario.client)) {
      errors.push(`${scenario.id}: unknown client ${scenario.client}`);
    }
    if (!participants.has(scenario.server)) {
      errors.push(`${scenario.id}: unknown server ${scenario.server}`);
    }
    const capabilities = stringArray(errors, scenario.capabilities, `${scenario.id}: capabilities`);
    if (capabilities.length === 0) {
      errors.push(`${scenario.id}: capabilities must not be empty`);
      continue;
    }
    scenario.capabilities = capabilities;
    for (const capability of capabilities) {
      coveredCapabilities.add(capability);
    }
    coveredPairs.add(pairKey(scenario.client, scenario.server));

    let trace;
    try {
      trace = await readJson(path.join(root, scenario.trace));
    } catch (error) {
      errors.push(`${scenario.id}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    validateTrace(errors, scenario, trace);
    traces.push({
      id: scenario.id,
      client: scenario.client,
      server: scenario.server,
      transport: scenario.transport,
      capabilities: scenario.capabilities,
      events: Array.isArray(trace.events) ? trace.events.length : 0,
    });
  }

  for (const capability of matrix.requiredCapabilities ?? []) {
    if (!coveredCapabilities.has(capability)) {
      errors.push(`required capability is not covered: ${capability}`);
    }
  }
  for (const pair of matrix.requiredPairs ?? []) {
    if (!Array.isArray(pair) || pair.length !== 2 || !coveredPairs.has(pairKey(pair[0], pair[1]))) {
      errors.push(`required pair is not covered: ${JSON.stringify(pair)}`);
    }
  }

  const report = {
    schemaVersion: matrix.schemaVersion,
    profile: matrix.profile,
    mode: matrix.mode,
    status: errors.length === 0 ? 'passed' : 'failed',
    summary: {
      participants: participants.size,
      scenarios: scenarioRecords.length,
      capabilities: coveredCapabilities.size,
      requiredCapabilities: matrix.requiredCapabilities?.length ?? 0,
      requiredPairs: matrix.requiredPairs?.length ?? 0,
      errors: errors.length,
    },
    traces,
    errors,
  };

  if (!checkOnly) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`interop-lab: ${error}`);
    process.exit(1);
  }
  console.log(`Interop lab passed: ${report.summary.scenarios} scenarios.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
