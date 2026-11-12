import { createContext, useContext, useEffect, useState } from 'react';
import type { ApiError, SessionInfo } from '@plantops/contracts';
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = '',
  ) {
    super(message);
  }
}
let current: SessionInfo | undefined, sessionPromise: Promise<SessionInfo> | undefined;
export function runtime() {
  return current;
}
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent('plantops:toast', { detail: message }));
}
export function acceptSession(info: SessionInfo) {
  if (current && info.mode === 'demo' && current.revision !== info.revision && !info.resetReason)
    info = {
      ...info,
      resetReason: 'Демонстрационная сессия обновлена. Загружены начальные данные.',
    };
  current = info;
  window.dispatchEvent(new CustomEvent('plantops:session', { detail: info }));
  if (info.resetReason) toast(info.resetReason);
  return info;
}
export function initializeSession(): Promise<SessionInfo> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const r = await fetch('/api/session', {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) {
      const data = (await r.json().catch(() => null)) as ApiError | null;
      throw new RequestError(
        data?.error.message ?? 'Сервер пока недоступен. Повторите подключение.',
        r.status,
      );
    }
    return acceptSession((await r.json()) as SessionInfo);
  })()
    .catch((error: unknown) => {
      if (error instanceof RequestError) throw error;
      throw new RequestError(
        'Не удалось связаться с сервером. Он может запускаться после простоя. Повторите подключение.',
        0,
      );
    })
    .finally(() => {
      sessionPromise = undefined;
    });
  return sessionPromise;
}
async function response(path: string, options: RequestInit = {}, retry = true): Promise<Response> {
  if (options.method && !['GET', 'HEAD'].includes(options.method) && options.body === undefined)
    options = { ...options, body: '{}' };
  if (!current) await initializeSession();
  const revision = current?.revision;
  let r: Response;
  try {
    r = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-PlantOps-Request': '1',
        ...options.headers,
      },
      signal: options.signal ?? AbortSignal.timeout(45000),
    });
  } catch {
    throw new RequestError('Нет соединения с сервером', 0);
  }
  if (!r.ok) {
    const data = (await r.json().catch(() => null)) as ApiError | null;
    if (data?.error.code === 'SESSION_RESET' && retry) {
      if (current?.revision === revision) await initializeSession();
      if (!options.method || options.method === 'GET') return response(path, options, false);
      throw new RequestError(
        'Сессия обновлена. Проверьте данные и повторите действие.',
        409,
        'SESSION_RESET',
      );
    }
    throw new RequestError(
      data?.error.message ?? `Сервер пока не готов (${r.status})`,
      r.status,
      data?.error.code,
    );
  }
  const received = r.headers.get('X-PlantOps-Revision');
  if (received && received !== current?.revision) {
    if (path === '/demo/reset') {
      /* Caller accepts the returned session. */
    } else if (current?.revision === revision) await initializeSession();
  }
  return r;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const r = await response(path, options);
  const data = r.status === 204 ? undefined : await r.json();
  if (options.method && !['GET', 'HEAD'].includes(options.method)) toast('Изменения сохранены');
  return data as T;
}
export async function downloadCsv(path: string, name: string) {
  try {
    const r = await response(path);
    const url = URL.createObjectURL(await r.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV выгружен');
  } catch (e) {
    toast((e as Error).message);
  }
}
export const RefreshContext = createContext({ version: 0, refresh: () => {} });
let lastActivity = Date.now();
for (const event of ['pointerdown', 'keydown', 'scroll'])
  window.addEventListener(
    event,
    () => {
      lastActivity = Date.now();
    },
    { passive: true },
  );
export function pollingAllowed() {
  return (
    document.visibilityState === 'visible' &&
    (current?.mode !== 'demo' || Date.now() - lastActivity < 120000)
  );
}
export function resumePolling() {
  lastActivity = Date.now();
  window.dispatchEvent(new Event('plantops:resume'));
}
export function usePoll<T>(path: string, interval?: number) {
  const { version } = useContext(RefreshContext);
  const [state, setState] = useState<{ path: string; data?: T; error?: string; loading: boolean }>({
    path,
    loading: true,
  });
  useEffect(() => {
    let active = true,
      inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    setState((s) => (s.path === path ? s : { path, loading: true }));
    async function load() {
      if (inFlight || !active) return;
      clearTimeout(timer);
      if (!pollingAllowed()) {
        timer = setTimeout(load, 1000);
        return;
      }
      inFlight = true;
      try {
        const data = await api<T>(path, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
        });
        if (active) setState({ path, data, loading: false });
      } catch (e) {
        if (active) setState((s) => ({ ...s, path, loading: false, error: (e as Error).message }));
      } finally {
        inFlight = false;
        if (active) timer = setTimeout(load, interval ?? current?.pollMs ?? 5000);
      }
    }
    void load();
    window.addEventListener('plantops:resume', load);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('plantops:resume', load);
    };
  }, [path, interval, version]);
  return state.path === path ? state : { path, loading: true, data: undefined, error: undefined };
}
