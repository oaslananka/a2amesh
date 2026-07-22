import { createHmac, randomUUID } from 'node:crypto';
import type { JsonRpcError } from '../types/jsonrpc.js';

const IDEMPOTENCY_FINGERPRINT_ALGORITHM = 'sha256';
const IDEMPOTENCY_FINGERPRINT_DOMAIN = 'a2amesh:idempotency:fingerprint:v1';
const HIGH_SURROGATE_END = 0xdbff;
const HIGH_SURROGATE_START = 0xd800;
const LOW_SURROGATE_END = 0xdfff;
const LOW_SURROGATE_START = 0xdc00;
const REPLACEMENT_CHARACTER = '\uFFFD';
const IDEMPOTENCY_IN_FLIGHT_RETENTION_MULTIPLIER = 2;
const IDEMPOTENCY_MINIMUM_IN_FLIGHT_RETENTION_MS = 60_000;

type StringWithToWellFormed = string & { toWellFormed?: () => string };

export interface IdempotencySuccessResult {
  kind: 'success';
  value: unknown;
}

export interface IdempotencyFailureResult {
  kind: 'error';
  error: Pick<JsonRpcError, 'code' | 'message' | 'data'>;
}

export type IdempotencyStoredResult = IdempotencySuccessResult | IdempotencyFailureResult;

interface IdempotencyRecordBase {
  scope: string;
  key: string;
  fingerprint: string;
  expiresAt: number;
}

export interface IdempotencyInFlightRecord extends IdempotencyRecordBase {
  state: 'in-flight';
  ownerId: string;
  reservedAt: number;
}

export interface IdempotencyCompletedRecord extends IdempotencyRecordBase {
  state: 'completed';
  storedAt: string;
  result: IdempotencySuccessResult;
}

export interface IdempotencyFailedRecord extends IdempotencyRecordBase {
  state: 'failed';
  storedAt: string;
  result: IdempotencyFailureResult;
}

export type IdempotencyRecord =
  | IdempotencyInFlightRecord
  | IdempotencyCompletedRecord
  | IdempotencyFailedRecord;

export type IdempotencyReservationOutcome =
  | 'acquired'
  | 'recovered'
  | 'replay'
  | 'in-progress'
  | 'conflict';

export type IdempotencyReservation =
  | { outcome: 'acquired' | 'recovered' | 'in-progress'; record: IdempotencyInFlightRecord }
  | { outcome: 'replay'; record: IdempotencyCompletedRecord | IdempotencyFailedRecord }
  | { outcome: 'conflict'; record: IdempotencyRecord };

export class IdempotencyOwnershipError extends Error {
  constructor(message = 'Idempotency reservation ownership was lost') {
    super(message);
    this.name = 'IdempotencyOwnershipError';
  }
}

export interface IdempotencyStore {
  get(scope: string, key: string): Promise<IdempotencyRecord | null>;
  reserve(
    scope: string,
    key: string,
    fingerprint: string,
    leaseMs: number,
  ): Promise<IdempotencyReservation>;
  renew(scope: string, key: string, ownerId: string, leaseMs: number): Promise<boolean>;
  complete(
    scope: string,
    key: string,
    ownerId: string,
    result: IdempotencyStoredResult,
    ttlMs: number,
  ): Promise<IdempotencyCompletedRecord | IdempotencyFailedRecord>;
  release(scope: string, key: string, ownerId: string): Promise<boolean>;
  /**
   * Writes a terminal record only when no reservation is in flight.
   * @deprecated Request handlers must use reserve() and complete() to preserve atomic ownership.
   */
  set(
    scope: string,
    key: string,
    fingerprint: string,
    result: IdempotencyStoredResult,
    ttlMs: number,
  ): Promise<IdempotencyCompletedRecord | IdempotencyFailedRecord>;
}

export interface RedisIdempotencyClient {
  get(key: string): Promise<string | null>;
  set?(key: string, value: string): Promise<unknown>;
  pexpire?(key: string, ttlMs: number): Promise<number>;
  eval?(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

const REDIS_RESERVE_SCRIPT = `-- a2amesh:idempotency:reserve:v1
local current_raw = redis.call('GET', KEYS[1])
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local lease_ms = tonumber(ARGV[5])
local owner_id = ARGV[4]
local fingerprint = ARGV[3]
local outcome = 'acquired'

if current_raw then
  local current = cjson.decode(current_raw)
  if current.fingerprint ~= fingerprint then
    return cjson.encode({ outcome = 'conflict', record = current })
  elseif current.state == 'in-flight' then
    if tonumber(current.expiresAt) > now then
      return cjson.encode({ outcome = 'in-progress', record = current })
    end
    outcome = 'recovered'
  else
    return cjson.encode({ outcome = 'replay', record = current })
  end
end

local record = {
  state = 'in-flight',
  scope = ARGV[1],
  key = ARGV[2],
  fingerprint = fingerprint,
  ownerId = owner_id,
  reservedAt = now,
  expiresAt = now + lease_ms
}
redis.call('SET', KEYS[1], cjson.encode(record), 'PX', math.max(lease_ms * ${IDEMPOTENCY_IN_FLIGHT_RETENTION_MULTIPLIER}, ${IDEMPOTENCY_MINIMUM_IN_FLIGHT_RETENTION_MS}))
return cjson.encode({ outcome = outcome, record = record })`;

const REDIS_RENEW_SCRIPT = `-- a2amesh:idempotency:renew:v1
local current_raw = redis.call('GET', KEYS[1])
if not current_raw then return 0 end
local current = cjson.decode(current_raw)
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local lease_ms = tonumber(ARGV[2])
if current.state ~= 'in-flight' or current.ownerId ~= ARGV[1] or tonumber(current.expiresAt) <= now then
  return 0
end
current.expiresAt = now + lease_ms
redis.call('SET', KEYS[1], cjson.encode(current), 'PX', math.max(lease_ms * ${IDEMPOTENCY_IN_FLIGHT_RETENTION_MULTIPLIER}, ${IDEMPOTENCY_MINIMUM_IN_FLIGHT_RETENTION_MS}))
return 1`;

const REDIS_COMPLETE_SCRIPT = `-- a2amesh:idempotency:complete:v1
local current_raw = redis.call('GET', KEYS[1])
if not current_raw then return cjson.encode({ outcome = 'lost' }) end
local current = cjson.decode(current_raw)
local redis_time = redis.call('TIME')
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
if current.state ~= 'in-flight' or current.ownerId ~= ARGV[1] or tonumber(current.expiresAt) <= now then
  return cjson.encode({ outcome = 'lost' })
end
local result = cjson.decode(ARGV[2])
local ttl_ms = tonumber(ARGV[3])
local state = 'completed'
if result.kind == 'error' then state = 'failed' end
local record = {
  state = state,
  scope = current.scope,
  key = current.key,
  fingerprint = current.fingerprint,
  storedAt = ARGV[4],
  expiresAt = now + ttl_ms,
  result = result
}
redis.call('SET', KEYS[1], cjson.encode(record), 'PX', ttl_ms)
return cjson.encode({ outcome = 'completed', record = record })`;

const REDIS_RELEASE_SCRIPT = `-- a2amesh:idempotency:release:v1
local current_raw = redis.call('GET', KEYS[1])
if not current_raw then return 0 end
local current = cjson.decode(current_raw)
if current.state ~= 'in-flight' or current.ownerId ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])`;

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const storageKey = this.buildKey(scope, key);
    const record = this.records.get(storageKey);
    if (!record) return null;
    if (recordRetentionExpiresAt(record) <= Date.now()) {
      this.records.delete(storageKey);
      return null;
    }
    return structuredClone(record);
  }

  async reserve(
    scope: string,
    key: string,
    fingerprint: string,
    leaseMs: number,
  ): Promise<IdempotencyReservation> {
    assertPositiveTtl(leaseMs, 'leaseMs');
    const storageKey = this.buildKey(scope, key);
    const now = Date.now();
    const existing = this.records.get(storageKey);
    let recovered = false;

    if (existing) {
      if (recordRetentionExpiresAt(existing) <= now) {
        this.records.delete(storageKey);
      } else if (existing.fingerprint !== fingerprint) {
        return { outcome: 'conflict', record: structuredClone(existing) };
      } else if (existing.state === 'in-flight' && existing.expiresAt > now) {
        return { outcome: 'in-progress', record: structuredClone(existing) };
      } else if (existing.state === 'in-flight') {
        recovered = true;
      } else {
        return { outcome: 'replay', record: structuredClone(existing) };
      }
    }

    const record = createInFlightRecord(scope, key, fingerprint, leaseMs, now);
    this.records.set(storageKey, record);
    return {
      outcome: recovered ? 'recovered' : 'acquired',
      record: structuredClone(record),
    };
  }

  async renew(scope: string, key: string, ownerId: string, leaseMs: number): Promise<boolean> {
    assertPositiveTtl(leaseMs, 'leaseMs');
    const storageKey = this.buildKey(scope, key);
    const record = this.records.get(storageKey);
    const now = Date.now();
    if (
      !record ||
      record.state !== 'in-flight' ||
      record.ownerId !== ownerId ||
      record.expiresAt <= now
    ) {
      return false;
    }
    record.expiresAt = now + leaseMs;
    return true;
  }

  async complete(
    scope: string,
    key: string,
    ownerId: string,
    result: IdempotencyStoredResult,
    ttlMs: number,
  ): Promise<IdempotencyCompletedRecord | IdempotencyFailedRecord> {
    assertPositiveTtl(ttlMs, 'ttlMs');
    const storageKey = this.buildKey(scope, key);
    const existing = this.records.get(storageKey);
    if (
      !existing ||
      existing.state !== 'in-flight' ||
      existing.ownerId !== ownerId ||
      existing.expiresAt <= Date.now()
    ) {
      throw new IdempotencyOwnershipError();
    }
    const record = createTerminalRecord(scope, key, existing.fingerprint, result, ttlMs);
    this.records.set(storageKey, record);
    return structuredClone(record);
  }

  async release(scope: string, key: string, ownerId: string): Promise<boolean> {
    const storageKey = this.buildKey(scope, key);
    const existing = this.records.get(storageKey);
    if (!existing || existing.state !== 'in-flight' || existing.ownerId !== ownerId) {
      return false;
    }
    return this.records.delete(storageKey);
  }

  async set(
    scope: string,
    key: string,
    fingerprint: string,
    result: IdempotencyStoredResult,
    ttlMs: number,
  ): Promise<IdempotencyCompletedRecord | IdempotencyFailedRecord> {
    assertPositiveTtl(ttlMs, 'ttlMs');
    const storageKey = this.buildKey(scope, key);
    const existing = this.records.get(storageKey);
    if (existing?.state === 'in-flight' && recordRetentionExpiresAt(existing) > Date.now()) {
      throw new IdempotencyOwnershipError('Cannot overwrite a retained idempotency reservation');
    }
    const record = createTerminalRecord(scope, key, fingerprint, result, ttlMs);
    this.records.set(storageKey, record);
    return structuredClone(record);
  }

  private buildKey(scope: string, key: string): string {
    return buildScopedStorageKey(scope, key);
  }
}

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly client: RedisIdempotencyClient,
    private readonly prefix = 'a2a:idempotency',
  ) {}

  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const record = await this.client.get(this.buildKey(scope, key));
    if (!record) return null;
    const parsed = normalizeStoredRecord(JSON.parse(record) as UnknownIdempotencyRecord);
    return parsed.state !== 'in-flight' && parsed.expiresAt <= Date.now() ? null : parsed;
  }

  async reserve(
    scope: string,
    key: string,
    fingerprint: string,
    leaseMs: number,
  ): Promise<IdempotencyReservation> {
    assertPositiveTtl(leaseMs, 'leaseMs');
    const result = await this.evalJson<{ outcome: IdempotencyReservationOutcome; record: unknown }>(
      REDIS_RESERVE_SCRIPT,
      [this.buildKey(scope, key)],
      [scope, key, fingerprint, randomUUID(), String(leaseMs)],
    );
    return normalizeReservation(
      result.outcome,
      normalizeStoredRecord(result.record as UnknownIdempotencyRecord),
    );
  }

  async renew(scope: string, key: string, ownerId: string, leaseMs: number): Promise<boolean> {
    assertPositiveTtl(leaseMs, 'leaseMs');
    const result = await this.eval(
      REDIS_RENEW_SCRIPT,
      [this.buildKey(scope, key)],
      [ownerId, String(leaseMs)],
    );
    return Number(result) === 1;
  }

  async complete(
    scope: string,
    key: string,
    ownerId: string,
    result: IdempotencyStoredResult,
    ttlMs: number,
  ): Promise<IdempotencyCompletedRecord | IdempotencyFailedRecord> {
    assertPositiveTtl(ttlMs, 'ttlMs');
    const response = await this.evalJson<{ outcome: 'completed' | 'lost'; record?: unknown }>(
      REDIS_COMPLETE_SCRIPT,
      [this.buildKey(scope, key)],
      [ownerId, JSON.stringify(result), String(ttlMs), new Date().toISOString()],
    );
    if (response.outcome !== 'completed' || !response.record) {
      throw new IdempotencyOwnershipError();
    }
    const record = normalizeStoredRecord(response.record as UnknownIdempotencyRecord);
    if (record.state === 'in-flight') throw new IdempotencyOwnershipError();
    return record;
  }

  async release(scope: string, key: string, ownerId: string): Promise<boolean> {
    const result = await this.eval(REDIS_RELEASE_SCRIPT, [this.buildKey(scope, key)], [ownerId]);
    return Number(result) === 1;
  }

  async set(
    scope: string,
    key: string,
    fingerprint: string,
    result: IdempotencyStoredResult,
    ttlMs: number,
  ): Promise<IdempotencyCompletedRecord | IdempotencyFailedRecord> {
    assertPositiveTtl(ttlMs, 'ttlMs');
    const existing = await this.get(scope, key);
    if (existing?.state === 'in-flight') {
      throw new IdempotencyOwnershipError('Cannot overwrite an active idempotency reservation');
    }
    if (!this.client.set || !this.client.pexpire) {
      throw new Error('Redis idempotency legacy set requires set() and pexpire() support');
    }
    const record = createTerminalRecord(scope, key, fingerprint, result, ttlMs);
    const redisKey = this.buildKey(scope, key);
    await this.client.set(redisKey, JSON.stringify(record));
    await this.client.pexpire(redisKey, ttlMs);
    return record;
  }

  private async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    if (!this.client.eval) {
      throw new Error(
        'RedisIdempotencyStore atomic operations require a node-redis compatible eval() client',
      );
    }
    return this.client.eval(script, { keys, arguments: args });
  }

  private async evalJson<T>(script: string, keys: string[], args: string[]): Promise<T> {
    const result = await this.eval(script, keys, args);
    if (typeof result !== 'string') {
      throw new Error('Redis idempotency script returned an invalid response');
    }
    return JSON.parse(result) as T;
  }

  private buildKey(scope: string, key: string): string {
    return `${this.prefix}:${buildScopedStorageKey(scope, key)}`;
  }
}

function normalizeReservation(
  outcome: IdempotencyReservationOutcome,
  record: IdempotencyRecord,
): IdempotencyReservation {
  if (outcome === 'conflict') return { outcome, record };
  if (outcome === 'replay') {
    if (record.state === 'in-flight') throw new Error('Invalid Redis replay reservation record');
    return { outcome, record };
  }
  if (record.state !== 'in-flight') {
    throw new Error(`Invalid Redis ${outcome} reservation record`);
  }
  return { outcome, record };
}

interface UnknownIdempotencyRecord {
  state?: unknown;
  scope: string;
  key: string;
  fingerprint: string;
  storedAt?: string;
  reservedAt?: number;
  ownerId?: string;
  expiresAt: number;
  result?: IdempotencyStoredResult;
}

function normalizeStoredRecord(record: UnknownIdempotencyRecord): IdempotencyRecord {
  if (record.state === 'in-flight') {
    if (typeof record.ownerId !== 'string' || typeof record.reservedAt !== 'number') {
      throw new Error('Invalid in-flight idempotency record');
    }
    return {
      state: 'in-flight',
      scope: record.scope,
      key: record.key,
      fingerprint: record.fingerprint,
      ownerId: record.ownerId,
      reservedAt: record.reservedAt,
      expiresAt: record.expiresAt,
    };
  }
  if (!record.result) throw new Error('Invalid terminal idempotency record');
  return createNormalizedTerminalRecord(record);
}

function createNormalizedTerminalRecord(
  record: UnknownIdempotencyRecord,
): IdempotencyCompletedRecord | IdempotencyFailedRecord {
  const storedAt = record.storedAt ?? new Date(record.expiresAt).toISOString();
  if (record.result?.kind === 'error') {
    return {
      state: 'failed',
      scope: record.scope,
      key: record.key,
      fingerprint: record.fingerprint,
      storedAt,
      expiresAt: record.expiresAt,
      result: record.result,
    };
  }
  if (record.result?.kind === 'success') {
    return {
      state: 'completed',
      scope: record.scope,
      key: record.key,
      fingerprint: record.fingerprint,
      storedAt,
      expiresAt: record.expiresAt,
      result: record.result,
    };
  }
  throw new Error('Invalid idempotency result');
}

function recordRetentionExpiresAt(record: IdempotencyRecord): number {
  if (record.state !== 'in-flight') return record.expiresAt;
  const leaseMs = record.expiresAt - record.reservedAt;
  return (
    record.reservedAt +
    Math.max(
      leaseMs * IDEMPOTENCY_IN_FLIGHT_RETENTION_MULTIPLIER,
      IDEMPOTENCY_MINIMUM_IN_FLIGHT_RETENTION_MS,
    )
  );
}

function createInFlightRecord(
  scope: string,
  key: string,
  fingerprint: string,
  leaseMs: number,
  now = Date.now(),
): IdempotencyInFlightRecord {
  return {
    state: 'in-flight',
    scope,
    key,
    fingerprint,
    ownerId: randomUUID(),
    reservedAt: now,
    expiresAt: now + leaseMs,
  };
}

function createTerminalRecord(
  scope: string,
  key: string,
  fingerprint: string,
  result: IdempotencyStoredResult,
  ttlMs: number,
): IdempotencyCompletedRecord | IdempotencyFailedRecord {
  const base = {
    scope,
    key,
    fingerprint,
    storedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlMs,
  };
  return result.kind === 'error'
    ? { ...base, state: 'failed', result: structuredClone(result) }
    : { ...base, state: 'completed', result: structuredClone(result) };
}

function assertPositiveTtl(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

export function buildIdempotencyFingerprint(value: unknown): string {
  return createHmac(IDEMPOTENCY_FINGERPRINT_ALGORITHM, IDEMPOTENCY_FINGERPRINT_DOMAIN)
    .update(stableStringify(value))
    .digest('hex');
}

function buildScopedStorageKey(scope: string, key: string): string {
  return `${encodeStorageKeyPart(scope)}:${encodeStorageKeyPart(key)}`;
}

function encodeStorageKeyPart(value: string): string {
  return encodeURIComponent(toWellFormedString(value));
}

function toWellFormedString(value: string): string {
  const toWellFormed = (value as StringWithToWellFormed).toWellFormed;
  if (typeof toWellFormed === 'function') return toWellFormed.call(value);

  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (isHighSurrogate(codeUnit)) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (isLowSurrogate(nextCodeUnit)) {
        result += value.charAt(index) + value.charAt(index + 1);
        index += 1;
      } else {
        result += REPLACEMENT_CHARACTER;
      }
      continue;
    }
    result += isLowSurrogate(codeUnit) ? REPLACEMENT_CHARACTER : value.charAt(index);
  }
  return result;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= HIGH_SURROGATE_START && codeUnit <= HIGH_SURROGATE_END;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= LOW_SURROGATE_START && codeUnit <= LOW_SURROGATE_END;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
