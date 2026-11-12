import type { RequestHandler } from 'express';
import { AppError } from './errors.js';
// Fixed-window counters, bounded independently of attacker-controlled addresses.
export class RateLimit {
  private buckets = new Map<string, { count: number; start: number }>();
  constructor(
    private now = () => Date.now(),
    private capacity = 1024,
  ) {}
  take(key: string, limit: number) {
    const now = this.now();
    for (const [k, b] of this.buckets) if (now - b.start >= 60000) this.buckets.delete(k);
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.capacity)
        throw new AppError(429, 'RATE_LIMIT', 'Слишком много запросов. Повторите через минуту.');
      b = { count: 0, start: now };
      this.buckets.set(key, b);
    }
    if (++b.count > limit)
      throw new AppError(429, 'RATE_LIMIT', 'Слишком много запросов. Повторите через минуту.');
  }
}
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  };
}
export const protectWrite: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-PlantOps-Request') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site')
    throw new AppError(403, 'CROSS_SITE', 'Изменения разрешены только из интерфейса PlantOps');
  if (!req.is('application/json'))
    throw new AppError(415, 'CONTENT_TYPE', 'Используйте application/json');
  next();
};
