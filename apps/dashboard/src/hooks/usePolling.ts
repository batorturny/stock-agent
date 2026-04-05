import { useState, useEffect, useRef, useCallback } from "react";

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number
): { data: T | null; error: string | null; loading: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const fetchData = useCallback(async (signal?: { stale: boolean }) => {
    try {
      const result = await fetcherRef.current();
      if (signal?.stale) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (signal?.stale) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (!signal?.stale) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const signal = { stale: false };
    fetchData(signal);
    const id = setInterval(() => fetchData(signal), intervalMs);
    return () => {
      signal.stale = true;
      clearInterval(id);
    };
  }, [fetchData, intervalMs]);

  return { data, error, loading, refetch: () => fetchData() };
}
