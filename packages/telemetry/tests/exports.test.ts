import { describe, expect, it } from 'vitest';
import * as telemetry from '../src/index.js';

describe('@a2amesh/internal-telemetry exports', () => {
  it('exposes the supported runtime telemetry surface', () => {
    expect(typeof telemetry.RuntimeMetrics).toBe('function');
    expect(typeof telemetry.bootstrapTelemetry).toBe('function');
    expect(typeof telemetry.extractA2AContext).toBe('function');
    expect(typeof telemetry.resolveTelemetryConfigFromEnv).toBe('function');
    expect(typeof telemetry.withA2ABaggage).toBe('function');
    expect(telemetry.a2aMeshTracer).toBeDefined();
    expect(telemetry.SpanStatusCode).toBeDefined();
  });
});
