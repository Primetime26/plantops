// Client transport regression tests without a DOM renderer or paid browser service.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const session = (revision = 'first') => ({
  mode: 'demo',
  revision,
  resetReason: null,
  pollMs: 5000,
  expiresInSeconds: 900,
  limits: null,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { visibilityState: 'visible' });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
it('coalesces concurrent session bootstraps', async () => {
  fetchMock.mockResolvedValueOnce(json(session()));
  const { initializeSession } = await import('../../web/src/lib/api.js');
  const [a, b] = await Promise.all([initializeSession(), initializeSession()]);
  expect(a.revision).toBe(b.revision);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('sends JSON body and same-origin headers for previously empty ACK/reset', async () => {
  fetchMock
    .mockResolvedValueOnce(json(session()))
    .mockResolvedValueOnce(json({ status: 'ACKNOWLEDGED' }));
  const { api } = await import('../../web/src/lib/api.js');
  await api('/incidents/id/acknowledge', { method: 'PATCH' });
  expect(fetchMock.mock.calls[1][1]).toMatchObject({
    method: 'PATCH',
    body: '{}',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-PlantOps-Request': '1' },
  });
});
it('recovers a lost session and retries a read exactly once', async () => {
  fetchMock
    .mockResolvedValueOnce(json(session()))
    .mockResolvedValueOnce(json({ error: { code: 'SESSION_RESET', message: 'Сброс' } }, 409))
    .mockResolvedValueOnce(json(session('second')))
    .mockResolvedValueOnce(json([{ id: 'H-101' }]));
  const { api, runtime } = await import('../../web/src/lib/api.js');
  expect(await api('/equipment')).toEqual([{ id: 'H-101' }]);
  expect(runtime()?.revision).toBe('second');
  expect(runtime()?.resetReason).toContain('Загружены начальные данные');
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
it('does not replay a mutation after session loss', async () => {
  fetchMock
    .mockResolvedValueOnce(json(session()))
    .mockResolvedValueOnce(json({ error: { code: 'SESSION_RESET', message: 'Сброс' } }, 409))
    .mockResolvedValueOnce(json(session('second')));
  const { api } = await import('../../web/src/lib/api.js');
  await expect(api('/maintenance', { method: 'POST', body: '{}' })).rejects.toThrow(
    'повторите действие',
  );
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
it('localizes connection failures and supports explicit bootstrap retry', async () => {
  fetchMock
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(json(session()));
  const { initializeSession } = await import('../../web/src/lib/api.js');
  await expect(initializeSession()).rejects.toThrow('Не удалось связаться');
  await expect(initializeSession()).resolves.toMatchObject({ revision: 'first' });
});
it('pauses polling for hidden tabs and resumes on explicit user action', async () => {
  fetchMock.mockResolvedValueOnce(json(session()));
  const { initializeSession, pollingAllowed, resumePolling } =
    await import('../../web/src/lib/api.js');
  await initializeSession();
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  expect(pollingAllowed()).toBe(false);
  vi.stubGlobal('document', { visibilityState: 'visible' });
  resumePolling();
  expect(pollingAllowed()).toBe(true);
});
