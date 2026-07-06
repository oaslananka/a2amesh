/**
 * @file ITrustLogStorage.ts
 * Append-only transparency log for verified Signed Agent Card registrations.
 * Each entry hash-chains to the previous one (same pattern as the SQLite task
 * audit journal and the Fleet control-plane audit timeline), so any
 * retroactive edit to a past entry breaks every hash after it.
 */

export interface TrustLogEntryInput {
  cardHash: string;
  keyId: string;
  algorithm: string;
  agentUrl: string;
  tenantId?: string;
  timestamp: string;
}

export interface TrustLogEntry extends TrustLogEntryInput {
  sequence: number;
  entryHash: string;
}

export interface TrustLogListFilter {
  cardHash?: string;
  limit?: number;
}

export interface ITrustLogStorage {
  append(entry: TrustLogEntryInput): Promise<TrustLogEntry>;
  list(filter?: TrustLogListFilter): Promise<TrustLogEntry[]>;
}
