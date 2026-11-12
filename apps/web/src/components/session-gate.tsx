import { useEffect, useState, type ReactNode } from 'react';
import type { SessionInfo } from '@plantops/contracts';
import {
  initializeSession,
  runtime,
  toast,
  resumePolling,
  pollingAllowed,
  api,
  acceptSession,
} from '@/lib/api';
import { Button } from './ui/button';
import { Factory, RotateCcw } from 'lucide-react';
export function SessionGate({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<SessionInfo | undefined>(runtime()),
    [error, setError] = useState(''),
    [slow, setSlow] = useState(false),
    [attempt, setAttempt] = useState(0),
    [notification, setNotification] = useState('');
  useEffect(() => {
    const notify = (e: Event) => setNotification((e as CustomEvent<string>).detail);
    window.addEventListener('plantops:toast', notify);
    return () => window.removeEventListener('plantops:toast', notify);
  }, []);
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(''), 7000);
    return () => clearTimeout(timer);
  }, [notification]);
  useEffect(() => {
    let active = true;
    setError('');
    setSlow(false);
    const timer = setTimeout(() => {
      if (active) setSlow(true);
    }, 4000);
    const update = (e: Event) => setInfo((e as CustomEvent<SessionInfo>).detail);
    window.addEventListener('plantops:session', update);
    void initializeSession()
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('plantops:session', update);
    };
  }, [attempt]);
  return (
    <>
      {!info ? (
        <div className="boot-screen">
          <Factory size={44} />
          <h1>PlantOps</h1>
          <h2>
            {error
              ? 'Не удалось подключиться'
              : slow
                ? 'Запускаем демонстрационный участок'
                : 'Подключаем оборудование'}
          </h2>
          <p>
            {error ||
              'Первый запуск после простоя может занять до минуты. Сервер готовит вашу рабочую сессию.'}
          </p>
          {!error && (
            <div className="skeleton-lines" aria-label="Подключение">
              <i />
              <i />
              <i />
            </div>
          )}
          {error && <Button onClick={() => setAttempt((n) => n + 1)}>Повторить подключение</Button>}
        </div>
      ) : (
        <div key={info.revision}>{children}</div>
      )}
      {notification && (
        <div role="status" className="toast-message">
          {notification}
          <button aria-label="Закрыть уведомление" onClick={() => setNotification('')}>
            ×
          </button>
        </div>
      )}
    </>
  );
}
export function DemoBanner() {
  const info = runtime()!,
    [busy, setBusy] = useState(false),
    [paused, setPaused] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setPaused(!pollingAllowed()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function reset() {
    if (
      !window.confirm(
        'Сбросить вашу демонстрацию? Заявки, комментарии и история будут удалены только из вашей сессии.',
      )
    )
      return;
    setBusy(true);
    try {
      acceptSession(await api<SessionInfo>('/demo/reset', { method: 'POST', body: '{}' }));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="demo-notice">
      <div>
        <strong>
          Демонстрационная система мониторинга промышленного оборудования. Все данные симулированы
        </strong>
        <p>
          {info.mode === 'demo'
            ? 'Ваша временная сессия изолирована от других посетителей. Данные сбрасываются после простоя, перезапуска или смены сервера.'
            : 'Локальный режим · SQLite сохраняет историю и заявки после перезапуска.'}
        </p>
        {info.resetReason && (
          <p role="status" className="text-yellow">
            {info.resetReason}
          </p>
        )}
        {paused && (
          <p>
            Обновление приостановлено для экономии ресурсов.{' '}
            <button
              onClick={() => {
                resumePolling();
                setPaused(false);
              }}
            >
              Продолжить мониторинг
            </button>
          </p>
        )}
      </div>
      {info.mode === 'demo' && (
        <Button size="sm" variant="outline" disabled={busy} onClick={reset}>
          <RotateCcw />
          Сбросить демо
        </Button>
      )}
    </div>
  );
}
