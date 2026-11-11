import express, { type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { apiRouter } from './routes/api.js';
import type { Simulator } from './services/simulator.js';
import { AppError } from './errors.js';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
export function createApp(db: PrismaClient, simulator: Simulator, webDirectory?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', apiRouter(db, simulator));
  app.use('/api', (_req, _res, next) =>
    next(new AppError(404, 'NOT_FOUND', 'Маршрут API не найден')),
  );
  if (webDirectory && existsSync(resolve(webDirectory, 'index.html'))) {
    app.use(express.static(webDirectory));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(webDirectory, 'index.html')));
  }
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Некорректные данные запроса',
          details: error.flatten(),
        },
      });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Некорректный JSON' } });
      return;
    }
    if (error.type === 'entity.too.large') {
      res
        .status(413)
        .json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Тело запроса превышает 16 КБ' } });
      return;
    }
    console.error(error);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' } });
  };
  app.use(errors);
  return app;
}
