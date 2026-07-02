import type { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type {
  AgentCard,
  JwtAuthMiddleware,
  JwtAuthMiddlewareOptions,
  OutboundPolicyOptions,
  RateLimitConfig,
  RateLimitStore,
  Task,
} from '@a2amesh/runtime';
import type { IAgentStorage } from '../storage/IAgentStorage.js';

export interface RegistryServerOptions {
  storage?: IAgentStorage;
  requireAuth?: boolean;
  registrationToken?: string;
  auth?: JwtAuthMiddlewareOptions;
  allowLocalhost?: boolean;
  allowPrivateNetworks?: boolean;
  allowUnresolvedHostnames?: boolean;
  outboundPolicy?: OutboundPolicyOptions;
  allowedOrigins?: string[];
  requireOrigin?: boolean;
  bodyLimit?: string;
  taskPollingIntervalMs?: number;
  maxRecentTasks?: number;
  healthPollingIntervalMs?: number;
  healthCheckBatchSize?: number;
  taskPollingBatchSize?: number;
  healthCheckConcurrency?: number;
  taskPollingConcurrency?: number;
  healthyRecheckIntervalMs?: number;
  unhealthyRecheckIntervalMs?: number;
  unknownRecheckIntervalMs?: number;
  taskPollCooldownMs?: number;
  distributedPollingLeases?: boolean;
  pollingLeaseOwnerId?: string;
  pollingLeaseTtlMs?: number;
  rateLimit?: Partial<RateLimitConfig>;
  rateLimitStore?: RateLimitStore;
}

export interface RegistryMetricsSummary {
  registrations: number;
  searches: number;
  heartbeats: number;
  agentCount: number;
  healthyAgents: number;
  unhealthyAgents: number;
  unknownAgents: number;
  activeTenants: number;
  publicAgents: number;
}

export interface RegistryTaskEvent {
  taskId: string;
  agentId: string;
  agentName: string;
  agentUrl: string;
  status: Task['status']['state'];
  updatedAt: string;
  contextId?: string;
  summary?: string;
  historyCount: number;
  artifactCount: number;
  task: Task;
}

export interface RegistryServerState {
  healthCursor: string | null;
  taskCursor: string | null;
  metrics: {
    registrations: number;
    searches: number;
    heartbeats: number;
  };
}

export interface RegistryServerContext {
  store: IAgentStorage;
  events: EventEmitter;
  taskEvents: EventEmitter;
  options: RegistryServerOptions;
  authMiddleware: JwtAuthMiddleware | undefined;
  rateLimitStore: RateLimitStore;
  recentTasks: Map<string, RegistryTaskEvent>;
  taskVersions: Map<string, string>;
  nextHealthCheckAt: Map<string, number>;
  nextTaskPollAt: Map<string, number>;
  sseClients: Set<Response>;
  state: RegistryServerState;
}

export function createRegistryServerState(): RegistryServerState {
  return {
    healthCursor: null,
    taskCursor: null,
    metrics: {
      registrations: 0,
      searches: 0,
      heartbeats: 0,
    },
  };
}

export function createRegisteredAgentTags(card: AgentCard): string[] {
  return (card.skills ?? []).flatMap((skill) => skill.tags ?? []);
}

export function createRegisteredAgentSkills(card: AgentCard): string[] {
  return (card.skills ?? []).map((skill) => skill.name);
}
