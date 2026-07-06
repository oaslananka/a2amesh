import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import {
  hashAgentCard,
  signAgentCard,
  verifyAgentCard,
  type AgentCard,
  type AgentCardSignature,
  type VerificationKey,
} from '@a2amesh/runtime';
import { emitResult, withSpinner, type RootOptionsProvider } from '../io.js';
import { addNetworkOptions, createRegistryClient, type NetworkCommandOptions } from '../network.js';
import { applyCommandDoc, type CliCommandDoc } from './doc-metadata.js';

export const trustCommandDoc = {
  path: ['trust'],
  summary: 'Sign, verify, and inspect the Agent Card trust chain.',
  description:
    'Signs Agent Cards with a private key, verifies signatures against trusted public keys, and inspects the append-only, hash-chained trust log a registry keeps for trusted registrations.',
  examples: [
    {
      title: 'Sign an Agent Card and verify it against the matching public key.',
      bash: [
        'a2amesh trust sign ./agent-card.json --key ./signing-key.pem --key-id my-key --alg ES256 --output ./agent-card.signed.json',
        'a2amesh trust verify ./agent-card.signed.json --trusted-key my-key:./public-key.pem',
      ],
      powershell: [
        'a2amesh trust sign .\\agent-card.json --key .\\signing-key.pem --key-id my-key --alg ES256 --output .\\agent-card.signed.json',
        'a2amesh trust verify .\\agent-card.signed.json --trusted-key my-key:.\\public-key.pem',
      ],
    },
    {
      title: 'Inspect a registry trust log.',
      bash: ['a2amesh trust log --url http://127.0.0.1:3099 --limit 20'],
      powershell: ['a2amesh trust log --url http://127.0.0.1:3099 --limit 20'],
    },
  ],
  additionalMarkdown: [
    '## Trust Log',
    '',
    'Every registry appends an entry to its trust log when an Agent Card registration is verified as `trusted` (signed with a key the registry was configured to trust). Each entry records a SHA-256 `cardHash` of the canonicalized, signature-less card plus an `entryHash` chained from the previous entry, so tampering with an earlier entry changes every hash after it. The log is exposed read-only at `GET /trust-log` and `GET /trust-log/:cardHash`.',
  ].join('\n'),
} satisfies CliCommandDoc;

interface TrustSignCommandOptions {
  key: string;
  keyId: string;
  alg: AgentCardSignature['algorithm'];
  output: string;
}

interface TrustVerifyCommandOptions {
  trustedKey: VerificationKey[];
}

interface TrustLogCommandOptions extends NetworkCommandOptions {
  url: string;
  card?: string;
  limit?: string;
}

function readAgentCard(path: string): AgentCard {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as AgentCard;
}

function parseTrustedKeyOption(value: string, previous: VerificationKey[]): VerificationKey[] {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0) {
    throw new Error(`Invalid --trusted-key "${value}", expected "<keyId>:<publicKeyPemPath>"`);
  }
  const keyId = value.slice(0, separatorIndex);
  const publicKeyPemPath = value.slice(separatorIndex + 1);
  return [...previous, { keyId, publicKeyPem: readFileSync(resolve(publicKeyPemPath), 'utf8') }];
}

export function createTrustCommand(getOptions: RootOptionsProvider): Command {
  const trustCommand = applyCommandDoc(new Command('trust'), trustCommandDoc);

  trustCommand
    .command('sign')
    .description('Sign an Agent Card with a private key.')
    .argument('<card-file>', 'path to an Agent Card JSON file')
    .requiredOption('--key <path>', 'path to a PKCS8 PEM private key file')
    .requiredOption('--key-id <id>', 'key identifier embedded in the signature')
    .option('--alg <algorithm>', 'signature algorithm (ES256, RS256, or EdDSA)', 'ES256')
    .requiredOption('--output <path>', 'path to write the signed Agent Card JSON file')
    .action(async (cardFile: string, commandOptions: TrustSignCommandOptions) => {
      const options = getOptions();
      const card = readAgentCard(cardFile);
      const privateKeyPem = readFileSync(resolve(commandOptions.key), 'utf8');
      const signed = await withSpinner('Signing Agent Card', options, () =>
        signAgentCard(card, {
          keyId: commandOptions.keyId,
          algorithm: commandOptions.alg,
          privateKeyPem,
        }),
      );
      const outputPath = resolve(commandOptions.output);
      writeFileSync(outputPath, `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
      emitResult(
        { output: outputPath, keyId: commandOptions.keyId, cardHash: hashAgentCard(signed) },
        options,
      );
    });

  trustCommand
    .command('verify')
    .description('Verify an Agent Card signature against one or more trusted public keys.')
    .argument('<card-file>', 'path to a signed Agent Card JSON file')
    .requiredOption(
      '--trusted-key <keyId:path>',
      'trusted key as "<keyId>:<publicKeyPemPath>" (repeatable)',
      parseTrustedKeyOption,
      [] as VerificationKey[],
    )
    .action(async (cardFile: string, commandOptions: TrustVerifyCommandOptions) => {
      const options = getOptions();
      const card = readAgentCard(cardFile);
      const result = await withSpinner('Verifying Agent Card', options, () =>
        verifyAgentCard(card, commandOptions.trustedKey),
      );
      emitResult(
        {
          valid: result.valid,
          ...(result.verifiedKeyId ? { verifiedKeyId: result.verifiedKeyId } : {}),
          cardHash: hashAgentCard(card),
        },
        options,
      );
      if (!result.valid) {
        process.exitCode = 1;
      }
    });

  trustCommand.addCommand(
    addNetworkOptions(
      new Command('log')
        .description('List entries from a registry trust log.')
        .option('--url <url>', 'Registry URL', 'http://localhost:3099')
        .option('--card <cardHash>', 'filter to a single Agent Card hash')
        .option('--limit <n>', 'return only the most recent N entries'),
    ).action(async (commandOptions: TrustLogCommandOptions) => {
      const options = getOptions();
      const client = createRegistryClient(commandOptions.url, commandOptions);
      const entries = await withSpinner('Fetching trust log', options, () =>
        client.getTrustLog({
          ...(commandOptions.card ? { cardHash: commandOptions.card } : {}),
          ...(commandOptions.limit ? { limit: Number(commandOptions.limit) } : {}),
        }),
      );
      emitResult(entries, options);
    }),
  );

  return trustCommand;
}
