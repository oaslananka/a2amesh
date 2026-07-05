import { useCallback, useEffect, useState } from 'react';
import { fetchRuns, subscribeToFleetEvents, type FleetRun } from '../api/fleet';

function applyRunUpdate(currentRuns: FleetRun[], updated: FleetRun): FleetRun[] {
  const index = currentRuns.findIndex((run) => run.id === updated.id);
  if (index === -1) {
    return [updated, ...currentRuns];
  }
  const nextRuns = [...currentRuns];
  nextRuns[index] = updated;
  return nextRuns;
}

export function useRuns(pollIntervalMs = 10_000) {
  const [runs, setRuns] = useState<FleetRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const nextRuns = await fetchRuns();
      setRuns(nextRuns);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const unsubscribe = subscribeToFleetEvents(
      (updated) => {
        setConnected(true);
        setRuns((currentRuns) => applyRunUpdate(currentRuns, updated));
      },
      () => setConnected(false),
    );

    const interval = window.setInterval(() => {
      void load();
    }, pollIntervalMs);

    return () => {
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [load, pollIntervalMs]);

  return { runs, loading, error, connected, refresh: load };
}
