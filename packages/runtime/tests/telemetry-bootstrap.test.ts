import { describe, expect, it, vi } from 'vitest';
import {
  bootstrapTelemetry,
  resolveTelemetryConfigFromEnv,
  type TelemetryModuleFactory,
} from '../src/telemetry/bootstrap.js';

describe('telemetry bootstrap', () => {
  it('resolves env-driven telemetry defaults safely', () => {
    const config = resolveTelemetryConfigFromEnv({
      A2A_TELEMETRY_ENABLED: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      OTEL_SERVICE_NAME: 'mesh-runtime',
      A2A_SERVICE_VERSION: '1.2.3',
      DEPLOYMENT_ENVIRONMENT: 'staging',
      OTEL_TRACES_SAMPLER_ARG: 'not-a-number',
      A2A_OTEL_METRIC_EXPORT_INTERVAL_MS: 'nope',
    });

    expect(config).toEqual(
      expect.objectContaining({
        enabled: true,
        serviceName: 'mesh-runtime',
        serviceVersion: '1.2.3',
        deploymentEnvironment: 'staging',
        tracesEndpoint: 'http://collector:4318/v1/traces',
        metricsEndpoint: 'http://collector:4318/v1/metrics',
        traceSampleRatio: 1,
        metricExportIntervalMs: 10000,
      }),
    );
  });

  it('returns a no-op handle when telemetry is disabled', async () => {
    const factory: TelemetryModuleFactory = {
      async load() {
        throw new Error('factory should not be loaded');
      },
    };

    const handle = await bootstrapTelemetry(
      { enabled: false, serviceName: 'svc', serviceVersion: '0.0.0' },
      factory,
    );

    expect(handle.enabled).toBe(false);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('boots OTLP trace and metric exporters with correlation resource attributes', async () => {
    const setLogger = vi.fn();
    const sdkStart = vi.fn();
    const sdkShutdown = vi.fn();
    const constructed: Record<string, unknown>[] = [];

    const factory: TelemetryModuleFactory = {
      async load() {
        return {
          diag: { setLogger },
          DiagConsoleLogger: class DiagConsoleLogger {},
          DiagLogLevel: { DEBUG: 1, INFO: 2, ERROR: 3 },
          NodeSDK: class NodeSDK {
            constructor(options: Record<string, unknown>) {
              constructed.push({ kind: 'sdk', options });
            }

            start = sdkStart;
            shutdown = sdkShutdown;
          },
          OTLPTraceExporter: class OTLPTraceExporter {
            constructor(options?: Record<string, unknown>) {
              constructed.push({ kind: 'trace', options });
            }
          },
          OTLPMetricExporter: class OTLPMetricExporter {
            constructor(options?: Record<string, unknown>) {
              constructed.push({ kind: 'metric', options });
            }
          },
          PeriodicExportingMetricReader: class PeriodicExportingMetricReader {
            constructor(options: Record<string, unknown>) {
              constructed.push({ kind: 'reader', options });
            }
          },
          resourceFromAttributes(attributes: Record<string, unknown>) {
            return { attributes };
          },
        };
      },
    };

    const handle = await bootstrapTelemetry(
      {
        enabled: true,
        serviceName: 'registry',
        serviceVersion: '1.1.0',
        deploymentEnvironment: 'prod',
        tracesEndpoint: 'http://collector/v1/traces',
        metricsEndpoint: 'http://collector/v1/metrics',
        headers: { authorization: 'Bearer token' },
        metricExportIntervalMs: 5000,
        traceSampleRatio: 0,
        logLevel: 'debug',
      },
      factory,
    );

    expect(handle.enabled).toBe(true);
    expect(setLogger).toHaveBeenCalledWith(expect.any(Object), 1);
    expect(sdkStart).toHaveBeenCalledOnce();
    expect(constructed).toEqual(
      expect.arrayContaining([
        {
          kind: 'trace',
          options: {
            url: 'http://collector/v1/traces',
            headers: { authorization: 'Bearer token' },
          },
        },
        {
          kind: 'metric',
          options: {
            url: 'http://collector/v1/metrics',
            headers: { authorization: 'Bearer token' },
          },
        },
        expect.objectContaining({
          kind: 'reader',
          options: expect.objectContaining({ exportIntervalMillis: 5000 }),
        }),
      ]),
    );

    const sdkOptions = constructed.find((entry) => entry['kind'] === 'sdk')?.['options'] as {
      sampler: { shouldSample(): { decision: number } };
      resource: { attributes: Record<string, unknown> };
    };
    expect(sdkOptions.resource.attributes).toEqual({
      'service.name': 'registry',
      'service.version': '1.1.0',
      'deployment.environment': 'prod',
    });
    expect(sdkOptions.sampler.shouldSample().decision).toBe(0);

    await handle.shutdown();
    expect(sdkShutdown).toHaveBeenCalledOnce();
  });

  it('supports ratio sampling and diagnostic log-level fallbacks', async () => {
    const setLogger = vi.fn();
    const constructed: Record<string, unknown>[] = [];
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValueOnce(0.75).mockReturnValueOnce(0.25);

    const factory: TelemetryModuleFactory = {
      async load() {
        return {
          diag: { setLogger },
          DiagConsoleLogger: class DiagConsoleLogger {},
          DiagLogLevel: { DEBUG: 1, INFO: 2, ERROR: 3 },
          NodeSDK: class NodeSDK {
            constructor(options: Record<string, unknown>) {
              constructed.push(options);
            }

            start() {}
            async shutdown() {}
          },
          OTLPTraceExporter: class OTLPTraceExporter {},
          OTLPMetricExporter: class OTLPMetricExporter {},
          PeriodicExportingMetricReader: class PeriodicExportingMetricReader {
            constructor(_options: Record<string, unknown>) {}
          },
          resourceFromAttributes: undefined,
        };
      },
    };

    await bootstrapTelemetry(
      {
        enabled: true,
        serviceName: 'svc',
        serviceVersion: '1',
        traceSampleRatio: 0.5,
        logLevel: 'info',
      },
      factory,
    );
    const sampledOptions = constructed[0] as {
      sampler: { shouldSample(): { decision: number } };
    };
    expect(setLogger).toHaveBeenCalledWith(expect.any(Object), 2);
    expect(sampledOptions.sampler.shouldSample().decision).toBe(0);
    expect(sampledOptions.sampler.shouldSample().decision).toBe(2);
    expect(sampledOptions.sampler.toString()).toBe('a2amesh-ratio-sampler');

    setLogger.mockClear();
    await bootstrapTelemetry(
      { enabled: true, serviceName: 'svc', serviceVersion: '1', logLevel: 'none' },
      factory,
    );
    expect(setLogger).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});
