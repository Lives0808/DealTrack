import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, openStream, type DomainEvent } from './api';

/** Fetch-on-mount with a manual refresh handle and an optional poll interval. */
export function useApi<T>(
  path: string | null,
  options: { pollMs?: number; deps?: unknown[] } = {},
): {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const deps = options.deps ?? [];

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<T>(path)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((cause: Error) => {
        if (cancelled) return;
        setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  useEffect(() => {
    if (!options.pollMs || !path) return;
    const timer = setInterval(refresh, options.pollMs);
    return () => clearInterval(timer);
  }, [options.pollMs, path, refresh]);

  return { data, loading, error, refresh };
}

/**
 * Live agent activity.
 *
 * Keeps a bounded ring buffer so the activity feed can run for hours without
 * eating memory, and exposes a monotonically increasing `version` so pages can
 * cheaply decide whether to refetch.
 */
export function useEventStream(limit = 120): {
  events: DomainEvent[];
  connected: boolean;
  version: number;
  clear: () => void;
} {
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState(0);
  const buffer = useRef<DomainEvent[]>([]);

  useEffect(() => {
    const close = openStream({
      onEvent: (event) => {
        buffer.current = [event, ...buffer.current].slice(0, limit);
        setEvents(buffer.current);
        // Coalesce refetches: a burst of 20 events shouldn't fire 20 requests.
        setVersion((value) => value + 1);
      },
      onStatus: setConnected,
    });
    return close;
  }, [limit]);

  const clear = useCallback(() => {
    buffer.current = [];
    setEvents([]);
  }, []);

  // Traffic-light refetching: only react to events that actually change data.
  const meaningful = useMemo(
    () => events.filter((event) => !event.type.startsWith('agent.run.')).length,
    [events],
  );

  useEffect(() => {
    if (meaningful === 0) return;
  }, [meaningful]);

  return { events, connected, version, clear };
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useLocalState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage is best-effort */
      }
    },
    [key],
  );
  return [value, update];
}
