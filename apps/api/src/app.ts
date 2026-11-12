import express, { type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { apiRouter } from './routes/api.js';
import type { Simulator } from './services/simulator.js';
import { DemoSessions, IDLE_TTL, MAX_AGE } from './services/sessions.js';
import { DEMO_LIMITS } from './storage/memory.js';
import { AppError } from './errors.js';
import { RateLimit, securityHeaders, protectWrite } from './security.js';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { SessionInfo } from '@plantops/contracts';
export interface AppOptions {
  local?: Simulator;
  sessions?: DemoSessions;
  webDirectory?: string;
  now?: () => Date;
  secureCookie?: boolean;
  trustLayero?: boolean;
  rateLimit?: boolean;
}
export function createApp(options: AppOptions) {
  const app = express(),
    now = options.now ?? (() => new Date()),
    sessions = options.sessions ?? new DemoSessions(now),
    limiter = new RateLimit(() => now().getTime());
  const mode = options.local ? 'local' : 'demo';
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', async (_req, res) => {
    if (options.local) await options.local.repository.read(async (tx) => tx.equipment());
    res.json({ status: 'ok', mode, demo: true });
  });
  app.use('/api', (req, _res, next) => {
    if (options.rateLimit !== false) {
      const ip = options.trustLayero
        ? (req.get('X-Real-IP') ?? req.socket.remoteAddress ?? 'unknown')
        : (req.socket.remoteAddress ?? 'unknown');
      limiter.take('global', 3000);
      limiter.take(`ip:${ip}`, 240);
      if (req.path === '/session') limiter.take(`session:${ip}`, 30);
    }
    next();
  });
  if (mode === 'demo') app.use('/api', protectWrite);
  const cookieToken = (cookie: string | undefined) =>
    cookie
      ?.split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith('plantops_demo='))
      ?.slice('plantops_demo='.length);
  const info = (revision: string, reason: string | null): SessionInfo => ({
    mode,
    revision,
    resetReason: reason,
    pollMs: mode === 'demo' ? 5000 : 2000,
    expiresInSeconds: mode === 'demo' ? IDLE_TTL / 1000 : null,
    limits: mode === 'demo' ? DEMO_LIMITS : null,
  });
  app.get('/api/session', (req, res) => {
    if (options.local) {
      res.set('X-PlantOps-Revision', 'local');
      return res.json(info('local', null));
    }
    const token = cookieToken(req.headers.cookie),
      found = sessions.get(token);
    if (found) {
      res.set('X-PlantOps-Revision', found.revision);
      return res.json(info(found.revision, null));
    }
    const created = sessions.create();
    res.cookie('plantops_demo', created.token, {
      httpOnly: true,
      secure: options.secureCookie ?? false,
      sameSite: 'strict',
      path: '/api',
      maxAge: MAX_AGE,
    });
    res.set('X-PlantOps-Revision', created.session.revision);
    res.json(
      info(
        created.session.revision,
        token ? 'Сессия истекла или сервер перезапущен. Загружены начальные демоданные.' : null,
      ),
    );
  });
  app.use('/api', async (req, res, next) => {
    if (options.local) {
      res.locals.simulator = options.local;
      res.set('X-PlantOps-Revision', 'local');
      return next();
    }
    const token = cookieToken(req.headers.cookie),
      session = sessions.get(token);
    if (!session)
      throw new AppError(
        409,
        'SESSION_RESET',
        'Сессия истекла или сервер перезапущен. Обновите демо.',
      );
    session.busy++;
    let released = false;
    const release = () => {
      if (!released) {
        session.busy--;
        released = true;
      }
    };
    res.once('finish', release);
    res.once('close', release);
    if (options.rateLimit !== false && !['GET', 'HEAD'].includes(req.method))
      limiter.take(`write:${token}`, 30);
    res.locals.simulator = session.simulator;
    res.locals.demoToken = token;
    res.set('X-PlantOps-Revision', session.revision);
    next();
  });
  app.post('/api/demo/reset', (_req, res) => {
    if (options.local)
      throw new AppError(403, 'LOCAL_MODE', 'Полный сброс доступен только в публичном деморежиме');
    const session = sessions.reset(res.locals.demoToken);
    res.set('X-PlantOps-Revision', session.revision);
    res.json(info(session.revision, 'Демонстрация сброшена по вашему запросу.'));
  });
  app.use('/api', apiRouter(now));
  app.use('/api', (_req, _res, next) =>
    next(new AppError(404, 'NOT_FOUND', 'Маршрут API не найден')),
  );
  const web = options.webDirectory;
  if (web && existsSync(resolve(web, 'index.html'))) {
    app.use(
      express.static(web, {
        maxAge: '1h',
        setHeaders(res, path) {
          if (path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get('/{*path}', (_req, res) =>
      res.sendFile(resolve(web, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }),
    );
  }
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError)
      return void res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Некорректные данные запроса',
          details: error.flatten(),
        },
      });
    if (error instanceof AppError) {
      if ([429, 503].includes(error.status)) res.set('Retry-After', '60');
      return void res
        .status(error.status)
        .json({ error: { code: error.code, message: error.message } });
    }
    if (error.type === 'entity.parse.failed')
      return void res
        .status(400)
        .json({ error: { code: 'INVALID_JSON', message: 'Некорректный JSON' } });
    if (error.type === 'entity.too.large')
      return void res
        .status(413)
        .json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Тело запроса превышает 16 КБ' } });
    console.error(error);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' } });
  };
  app.use(errors);
  return app;
}
