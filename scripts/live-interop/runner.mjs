import { redactText } from './report.mjs';

export const LIVE_INTEROP_SCENARIOS = Object.freeze([
  {
    id: 'official-javascript-client-to-mesh',
    ecosystem: 'javascript',
    direction: 'official-javascript-client->a2amesh-server',
  },
  {
    id: 'mesh-client-to-official-javascript',
    ecosystem: 'javascript',
    direction: 'a2amesh-client->official-javascript-server',
  },
  {
    id: 'negative-protocol-version',
    ecosystem: 'javascript',
    direction: 'unsupported-version->a2amesh-server',
  },
  {
    id: 'official-python-client-to-mesh',
    ecosystem: 'python',
    direction: 'official-python-client->a2amesh-server',
  },
  {
    id: 'mesh-client-to-official-python',
    ecosystem: 'python',
    direction: 'a2amesh-client->official-python-server',
  },
]);

export function parseLiveInteropArgs(argv) {
  const options = {
    check: false,
    ecosystem: 'all',
    report: 'artifacts/interop-live/report.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--check') {
      options.check = true;
      continue;
    }
    if (argument === '--ecosystem') {
      const value = argv[index + 1];
      if (!['javascript', 'python', 'all'].includes(value)) {
        throw new Error('--ecosystem must be javascript, python, or all');
      }
      options.ecosystem = value;
      index += 1;
      continue;
    }
    if (argument === '--report') {
      const value = argv[index + 1];
      if (!value) throw new Error('--report requires a path');
      options.report = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown live interop argument: ${argument}`);
  }

  return options;
}

export function selectLiveInteropScenarios(ecosystem) {
  if (!['javascript', 'python', 'all'].includes(ecosystem)) {
    throw new Error(`Unsupported live interop ecosystem: ${ecosystem}`);
  }
  return LIVE_INTEROP_SCENARIOS.filter(
    (scenario) => ecosystem === 'all' || scenario.ecosystem === ecosystem,
  );
}

export async function runScenarioMatrix({ scenarios, executeScenario, secrets = [] }) {
  const startedAt = new Date().toISOString();
  const results = [];

  for (const scenario of scenarios) {
    const scenarioStartedAt = Date.now();
    try {
      const result = await executeScenario(scenario);
      results.push({
        ...scenario,
        status: 'passed',
        durationMs: Date.now() - scenarioStartedAt,
        result,
      });
    } catch (error) {
      results.push({
        ...scenario,
        status: 'failed',
        durationMs: Date.now() - scenarioStartedAt,
        error: redactText(error instanceof Error ? error.message : String(error), secrets),
      });
    }
  }

  return {
    schemaVersion: '2026-07-23',
    mode: 'live-sdk',
    status: results.every((scenario) => scenario.status === 'passed') ? 'passed' : 'failed',
    startedAt,
    completedAt: new Date().toISOString(),
    scenarios: results,
  };
}
