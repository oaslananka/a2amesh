import { spawn } from 'node:child_process';
import { createOpenClawProbeCommands, loadOpenClawMcpRuntimeConfig } from './config.js';
import { redactA2AOutput as redactOpenClawOutput } from '@a2amesh/mcp/server';

interface OpenClawCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface OpenClawProbeResult {
  serverName: string;
  commands: string[];
  output: string;
}

export interface OpenClawProbeOptions {
  env: NodeJS.ProcessEnv;
  runCommand?:
    | ((command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<OpenClawCommandResult>)
    | undefined;
}

function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<OpenClawCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export async function runOpenClawProbe(
  options: OpenClawProbeOptions,
): Promise<OpenClawProbeResult> {
  if (options.env['A2AMESH_OPENCLAW_LIVE'] !== '1') {
    throw new Error('Set A2AMESH_OPENCLAW_LIVE=1 to enable the real OpenClaw probe.');
  }
  const config = loadOpenClawMcpRuntimeConfig(options.env);
  const serverName = options.env['A2AMESH_OPENCLAW_MCP_SERVER_NAME']?.trim() || 'a2amesh';
  const command = options.env['A2AMESH_OPENCLAW_BIN']?.trim() || 'openclaw';
  const commands = createOpenClawProbeCommands(serverName);
  const runCommand = options.runCommand ?? runProcess;
  const secrets = [
    ...(config.transportToken ? [config.transportToken] : []),
    ...config.bridgeOptions.agents.flatMap((agent) => (agent.token ? [agent.token] : [])),
  ];
  const outputs: string[] = [];

  for (const args of commands) {
    const result = await runCommand(command, args, options.env);
    const output = redactOpenClawOutput(
      [result.stdout, result.stderr].filter(Boolean).join('\n'),
      secrets,
    );
    outputs.push(output);
    if (result.exitCode !== 0) {
      throw new Error(`OpenClaw probe failed for ${args.join(' ')}${output ? `: ${output}` : '.'}`);
    }
  }

  return {
    serverName,
    commands: commands.map((args) => args.join(' ')),
    output: outputs.filter(Boolean).join('\n'),
  };
}
