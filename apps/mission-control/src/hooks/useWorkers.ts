import { useCallback, useEffect, useState } from 'react';
import { fetchWorkers, type FleetWorkerSummary } from '../api/fleet';

export function useWorkers(pollIntervalMs = 5_000) {
  const [workers, setWorkers] = useState<FleetWorkerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const nextWorkers = await fetchWorkers();
      setWorkers(nextWorkers);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load workers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load();
    }, pollIntervalMs);
    return () => window.clearInterval(interval);
  }, [load, pollIntervalMs]);

  return { workers, loading, error, refresh: load };
}
