import type { AgentCard } from '@a2amesh/protocol';
import type { A2AServer } from '@a2amesh/runtime';

export * from './passport-verifier.js';

export interface ReputationPassportExampleContext {
  agentCard?: AgentCard;
  server?: A2AServer;
}
