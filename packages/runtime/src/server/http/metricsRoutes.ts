import type { Express, Response } from 'express';
import type { AgentCard } from '../../types/agent-card.js';
import type { A2AHealthResponse, TaskCounts } from '../../types/task.js';
import type { RuntimeMetrics } from '../../telemetry/index.js';

export type HealthDetailLevel = 'safe' | 'detailed';

export interface HealthResponseInput {
  agentCard: AgentCard;
  startedAt: number;
  now?: number;
  taskCounts: TaskCounts;
  memoryUsage: Pick<NodeJS.MemoryUsage, 'heapUsed' | 'heapTotal'>;
  detailLevel?: HealthDetailLevel;
}

export interface MetricsRouteDependencies {
  app: Express;
  agentCard: AgentCard;
  startedAt: number;
  runtimeMetrics: RuntimeMetrics;
  getTaskCounts: () => TaskCounts;
}

export function buildHealthResponse(input: HealthResponseInput): A2AHealthResponse {
  const detailLevel = input.detailLevel ?? (process.env['NODE_ENV'] === 'production' ? 'safe' : 'detailed');
  const base: A2AHealthResponse = {
    status: 'healthy',
    version: input.agentCard.version,
    protocol: 'A2A/1.0',
    uptime: Math.floor(((input.now ?? Date.now()) - input.startedAt) / 1000),
    tasks: {
      active: input.taskCounts.active,
      completed: input.taskCounts.completed,
      failed: input.taskCounts.failed,
      total: input.taskCounts.total,
    },
    memory: {
      heapUsedMb: Number((input.memoryUsage.heapUsed / 1024 / 1024).toFixed(1)),
      heapTotalMb: Number((input.memoryUsage.heapTotal / 1024 / 1024).toFixed(1)),
    },
  };

  if (detailLevel === 'safe') {
    return {
      status: base.status,
      version: base.version,
      protocol: base.protocol,
      uptime: base.uptime,
      tasks: {
        active: base.tasks.active,
        completed: base.tasks.completed,
        failed: base.tasks.failed,
        total: base.tasks.total,
      },
      memory: { heapUsedMb: 0, heapTotalMb: 0 },
    };
  }

  return base;
}

export function registerMetricsRoutes(deps: MetricsRouteDependencies): void {
  deps.app.get('/health', (_req, res) => {
    const detailLevel = process.env['A2AMESH_HEALTH_DETAIL'] === 'detailed' ? 'detailed' : undefined;
    res.json(
      buildHealthResponse({
        agentCard: deps.agentCard,
        startedAt: deps.startedAt,
        taskCounts: deps.getTaskCounts(),
        memoryUsage: process.memoryUsage(),
        ...(detailLevel ? { detailLevel } : {}),
      }),
    );
  });

  deps.app.get('/metrics', (_req, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(deps.runtimeMetrics.renderPrometheus(deps.getTaskCounts()));
  });
}
