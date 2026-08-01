import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createA2AMcpBridge, createA2AMcpHttpApp } from '../src/server/bridge.js';
import {
  parseA2AMcpServerArgs,
  readA2AMcpPackageVersion,
  renderA2AMcpServerHelp,
  runA2AMcpServerCli,
  runA2AMcpServerCommand,
  startA2AMcpServer,
  startA2AMcpServerCliIfEntrypoint,
} from '../src/server/cli.js';
import { loadA2AMcpRuntimeConfig } from '../src/server/config.js';

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));
vi.mock('../src/server/bridge.js', () => ({
  createA2AMcpBridge: vi.fn(),
  createA2AMcpHttpApp: vi.fn(),
}));
vi.mock('../src/server/config.js', () => ({
  loadA2AMcpRuntimeConfig: vi.fn(),
}));

const createBridgeMock = vi.mocked(createA2AMcpBridge);
const createHttpAppMock = vi.mocked(createA2AMcpHttpApp);
const loadConfigMock = vi.mocked(loadA2AMcpRuntimeConfig);
const stdioTransportMock = vi.mocked(StdioServerTransport);

const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = originalExitCode;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
});

describe('standalone MCP server CLI', () => {
  it('parses every supported command form and rejects invalid arguments', () => {
    expect(parseA2AMcpServerArgs(['--help'])).toEqual({ action: 'help' });
    expect(parseA2AMcpServerArgs(['-h'])).toEqual({ action: 'help' });
    expect(parseA2AMcpServerArgs(['--version'])).toEqual({ action: 'version' });
    expect(parseA2AMcpServerArgs(['-v'])).toEqual({ action: 'version' });
    expect(parseA2AMcpServerArgs([])).toEqual({ action: 'start' });
    expect(parseA2AMcpServerArgs(['--transport', 'stdio'])).toEqual({
      action: 'start',
      transport: 'stdio',
    });
    expect(parseA2AMcpServerArgs(['--transport', 'streamable-http'])).toEqual({
      action: 'start',
      transport: 'streamable-http',
    });
    expect(() => parseA2AMcpServerArgs(['--transport', 'sse'])).toThrow(
      '--transport must be stdio or streamable-http.',
    );
    expect(() => parseA2AMcpServerArgs(['--unknown'])).toThrow(
      'Unknown arguments. Run a2amesh-mcp --help.',
    );
  });

  it('renders help and reads the installed package version fail-closed', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    expect(renderA2AMcpServerHelp()).toContain('Usage: a2amesh-mcp');
    expect(readA2AMcpPackageVersion()).toBe(packageJson.version);
    expect(() => readA2AMcpPackageVersion(() => '{}')).toThrow('Package version is unavailable.');
  });

  it('starts the stdio transport with the resolved runtime configuration', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    loadConfigMock.mockReturnValue({
      transport: 'stdio',
      bridgeOptions: { expectedTenantId: 'tenant-a' },
    } as never);
    createBridgeMock.mockReturnValue({ server: { connect } } as never);
    const errorOutput = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env = { A2AMESH_MCP_TENANT_ID: 'tenant-a' };

    await startA2AMcpServer(env, { action: 'start' });

    expect(loadConfigMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({ serverVersion: expect.any(String) }),
    );
    expect(createBridgeMock).toHaveBeenCalledWith({ expectedTenantId: 'tenant-a' });
    expect(stdioTransportMock).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
    expect(errorOutput).toHaveBeenCalledWith('A2A Mesh MCP server ready on stdio.');
  });

  it('starts and shuts down Streamable HTTP with bounded exit codes', async () => {
    const signalHandlers = new Map<string, (...args: never[]) => void>();
    const close = vi
      .fn()
      .mockImplementationOnce((callback: (error?: Error) => void) => callback())
      .mockImplementationOnce((callback: (error?: Error) => void) =>
        callback(new Error('close failed')),
      );
    const listen = vi.fn((port: number, host: string, callback: () => void) => {
      callback();
      return { close };
    });
    loadConfigMock.mockReturnValue({
      transport: 'streamable-http',
      transportToken: 'transport-token',
      host: '127.0.0.1',
      port: 4318,
      bridgeOptions: { expectedTenantId: 'tenant-a' },
    } as never);
    createHttpAppMock.mockReturnValue({ listen } as never);
    vi.spyOn(process, 'once').mockImplementation(((event: string, listener: () => void) => {
      signalHandlers.set(event, listener);
      return process;
    }) as typeof process.once);
    const errorOutput = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await startA2AMcpServer({}, { action: 'start', transport: 'streamable-http' });

    expect(createHttpAppMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1', transportToken: 'transport-token' }),
    );
    expect(listen).toHaveBeenCalledWith(4318, '127.0.0.1', expect.any(Function));
    expect(errorOutput).toHaveBeenCalledWith(
      'A2A Mesh MCP server ready at http://127.0.0.1:4318/mcp.',
    );

    signalHandlers.get('SIGINT')?.();
    expect(process.exitCode).toBe(0);

    signalHandlers.get('SIGTERM')?.();
    expect(process.exitCode).toBe(1);
    expect(errorOutput).toHaveBeenCalledWith('A2A Mesh MCP server shutdown failed.');
  });

  it('rejects Streamable HTTP when the transport token is absent', async () => {
    loadConfigMock.mockReturnValue({
      transport: 'streamable-http',
      host: '127.0.0.1',
      port: 4318,
      bridgeOptions: {},
    } as never);

    await expect(
      startA2AMcpServer({}, { action: 'start', transport: 'streamable-http' }),
    ).rejects.toThrow('Streamable HTTP transport token is missing.');
  });

  it('dispatches help, version, and start commands', async () => {
    const output = { write: vi.fn() };
    await runA2AMcpServerCommand(['--help'], {}, output);
    expect(output.write).toHaveBeenCalledWith(expect.stringContaining('Usage: a2amesh-mcp'));

    output.write.mockClear();
    await runA2AMcpServerCommand(['--version'], {}, output);
    expect(output.write).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+.*\n$/));

    const connect = vi.fn().mockResolvedValue(undefined);
    loadConfigMock.mockReturnValue({ transport: 'stdio', bridgeOptions: {} } as never);
    createBridgeMock.mockReturnValue({ server: { connect } } as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runA2AMcpServerCommand([], {}, output);
    expect(connect).toHaveBeenCalledOnce();
  });

  it('maps command failures to a redacted CLI error and non-zero exit code', async () => {
    const errorOutput = vi.fn();
    const setExitCode = vi.fn();
    const runCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error('safe failure'))
      .mockRejectedValueOnce('unsafe failure payload');

    await runA2AMcpServerCli({ args: [], env: {}, errorOutput, setExitCode, runCommand });
    expect(errorOutput).toHaveBeenLastCalledWith('safe failure');
    expect(setExitCode).toHaveBeenLastCalledWith(1);

    await runA2AMcpServerCli({ args: [], env: {}, errorOutput, setExitCode, runCommand });
    expect(errorOutput).toHaveBeenLastCalledWith('A2A Mesh MCP server failed.');
    expect(setExitCode).toHaveBeenCalledTimes(2);
  });

  it('runs only when the executable path matches the module URL', async () => {
    const modulePath = fileURLToPath(new URL('../src/server/cli.ts', import.meta.url));
    const moduleUrl = new URL('../src/server/cli.ts', import.meta.url).href;
    const runCli = vi.fn().mockResolvedValue(undefined);

    expect(startA2AMcpServerCliIfEntrypoint(['node'], moduleUrl, runCli)).toBe(false);
    expect(startA2AMcpServerCliIfEntrypoint(['node', modulePath], moduleUrl, runCli)).toBe(true);
    expect(runCli).toHaveBeenCalledOnce();
  });
});
