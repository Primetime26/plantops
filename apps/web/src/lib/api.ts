import { createContext, useContext, useEffect, useState } from 'react';
import type { ApiError } from '@plantops/contracts';
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: options.signal ?? AbortSignal.timeout(10000),
    });
  } catch {
    throw new RequestError('Нет соединения с сервером', 0);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    throw new RequestError(
      body?.error.message ?? `Ошибка сервера (${response.status})`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
export const RefreshContext = createContext({ version: 0, refresh: () => {} });
export function usePoll<T>(path: string, interval = 2000) {
  const { version } = useContext(RefreshContext);
  const [state, setState] = useState<{ path: string; data?: T; error?: string; loading: boolean }>({
    path,
    loading: true,
  });
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    setState((s) => (s.path === path ? s : { path, loading: true }));
    async function load() {
      try {
        const data = await api<T>(path, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        });
        if (active) setState({ path, data, loading: false });
      } catch (e) {
        if (active)
          setState((s) => ({
            ...s,
            path,
            loading: false,
            error: e instanceof Error ? e.message : 'Нет соединения с сервером',
          }));
      }
      if (active) timer = setTimeout(load, interval);
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, interval, version]);
  return state.path === path ? state : { path, loading: true, data: undefined, error: undefined };
}
