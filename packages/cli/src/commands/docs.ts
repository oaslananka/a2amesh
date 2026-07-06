import { benchmarkCommandDoc } from './benchmark.js';
import { conformanceBadgeCommandDoc } from './conformance-badge.js';
import { conformanceCommandDoc } from './conformance.js';
import { discoverCommandDoc } from './discover.js';
import { doctorCommandDoc } from './doctor.js';
import { exportCardCommandDoc } from './export-card.js';
import { healthCommandDoc } from './health.js';
import { monitorCommandDoc } from './monitor.js';
import { registryCommandDoc } from './registry.js';
import { releaseCheckCommandDoc } from './release-check.js';
import { replayCommandDoc } from './replay.js';
import { scaffoldCommandDoc } from './scaffold.js';
import { sendCommandDoc } from './send.js';
import { taskCommandDoc } from './task.js';
import { trustCommandDoc } from './trust.js';
import { validateCommandDoc } from './validate.js';
import type { CliCommandDoc } from './doc-metadata.js';

export { commandDocKey, type CliCommandDoc } from './doc-metadata.js';

export const cliCommandDocs = [
  benchmarkCommandDoc,
  conformanceBadgeCommandDoc,
  conformanceCommandDoc,
  discoverCommandDoc,
  doctorCommandDoc,
  exportCardCommandDoc,
  healthCommandDoc,
  monitorCommandDoc,
  registryCommandDoc,
  releaseCheckCommandDoc,
  replayCommandDoc,
  scaffoldCommandDoc,
  sendCommandDoc,
  taskCommandDoc,
  trustCommandDoc,
  validateCommandDoc,
] as const satisfies readonly CliCommandDoc[];
