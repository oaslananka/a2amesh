import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import {
  parseCassetteFromJsonl,
  replayCassette,
  verifyCassetteIntegrity,
  type CassetteEntry,
} from '@a2amesh/runtime/testing';
import { emitResult, writeError, writeOutput, type RootOptionsProvider } from '../io.js';
import { applyCommandDoc, type CliCommandDoc } from './doc-metadata.js';

export const replayCommandDoc = {
  path: ['replay'],
  summary: 'Replay a recorded task cassette without invoking a real adapter.',
  description:
    "Verifies a cassette's integrity hash chain, then replays its recorded task lifecycle (created, message, artifact, and state transitions) against a fresh in-process TaskManager, serving artifacts from the cassette instead of a real adapter, and reports whether the replayed sequence matches the recording.",
  examples: [
    {
      title: 'Replay a recorded cassette and print a summary.',
      bash: ['a2amesh replay ./task-123.cassette.jsonl'],
      powershell: ['a2amesh replay .\\task-123.cassette.jsonl'],
    },
    {
      title: 'Print each recorded step.',
      bash: ['a2amesh replay ./task-123.cassette.jsonl --step'],
      powershell: ['a2amesh replay .\\task-123.cassette.jsonl --step'],
    },
  ],
} satisfies CliCommandDoc;

interface ReplayCommandOptions {
  step?: boolean;
}

function describeEntry(entry: CassetteEntry): string {
  const suffix = entry.reason === 'state' ? ` -> ${entry.task.status.state}` : '';
  return `#${entry.sequence} ${entry.reason}${suffix}`;
}

export function createReplayCommand(getOptions: RootOptionsProvider): Command {
  return applyCommandDoc(new Command('replay'), replayCommandDoc)
    .argument('<cassette>', 'path to a JSONL cassette file recorded by CassetteRecorder')
    .option('--step', 'print each recorded step before replaying')
    .action(async (cassettePath: string, commandOptions: ReplayCommandOptions) => {
      const options = getOptions();

      try {
        const jsonl = readFileSync(resolve(cassettePath), 'utf8');
        const cassette = parseCassetteFromJsonl(jsonl);

        if (commandOptions.step && !options.json) {
          for (const entry of cassette.entries) {
            writeOutput(describeEntry(entry));
          }
        }

        const integrity = verifyCassetteIntegrity(cassette);
        const result = await replayCassette(cassette);

        emitResult(
          {
            taskId: cassette.header.taskId,
            recordedEntryCount: cassette.entries.length,
            integrityValid: integrity.valid,
            ...(integrity.failedAtSequence !== undefined
              ? { integrityFailedAtSequence: integrity.failedAtSequence }
              : {}),
            matches: result.matches,
            ...(result.firstMismatchAt !== undefined
              ? { firstMismatchAt: result.firstMismatchAt }
              : {}),
          },
          options,
        );

        if (!result.matches) {
          process.exitCode = 1;
        }
      } catch (error) {
        writeError(`Replay failed: ${String(error)}`);
        process.exitCode = 1;
      }
    });
}
