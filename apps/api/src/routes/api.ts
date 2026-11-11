import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Simulator } from '../services/simulator.js';
import { AppError } from '../errors.js';
const equipmentId = z.string().regex(/^[A-Z]-\d{3}$/, 'Неверный ID оборудования');
const incidentId = z.string().min(1).max(80);
const status = z.enum(['NORMAL', 'WARNING', 'CRITICAL']);
const period = z.object({ minutes: z.coerce.number().int().min(1).max(1440).default(15) }).strict();
const equipmentQuery = z
  .object({ search: z.string().max(100).optional(), status: status.optional() })
  .strict();
const incidentQuery = z
  .object({
    equipmentId: equipmentId.optional(),
    status: z.enum(['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
    severity: z.enum(['WARNING', 'CRITICAL']).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export function apiRouter(db: PrismaClient, simulator: Simulator) {
  const api = Router();
  api.get('/health', async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', demo: true, simulator: simulator.state });
  });
  api.get('/equipment', async (req, res) => {
    const q = equipmentQuery.parse(req.query);
    res.json(
      await db.equipment.findMany({
        where: {
          status: q.status,
          ...(q.search
            ? {
                OR: [
                  { name: { contains: q.search } },
                  { id: { contains: q.search } },
                  { description: { contains: q.search } },
                ],
              }
            : {}),
        },
        orderBy: { id: 'asc' },
      }),
    );
  });
  api.get('/equipment/:id', async (req, res) => {
    const e = await db.equipment.findUnique({ where: { id: equipmentId.parse(req.params.id) } });
    if (!e) throw new AppError(404, 'NOT_FOUND', 'Оборудование не найдено');
    res.json(e);
  });
  api.get('/equipment/:id/telemetry', async (req, res) => {
    const id = equipmentId.parse(req.params.id);
    const { minutes } = period.parse(req.query);
    if (!(await db.equipment.findUnique({ where: { id } })))
      throw new AppError(404, 'NOT_FOUND', 'Оборудование не найдено');
    const to = Date.now(),
      from = to - minutes * 60000,
      bucketMs = Math.max(2000, Math.ceil((minutes * 60000) / 300));
    // At most ~301 points; aggregation happens in SQLite, not in the browser.
    const rows = await db.$queryRaw<
      { stamp: bigint; temperature: number; pressure: number; vibration: number | null }[]
    >(Prisma.sql`
      SELECT MAX(timestamp) AS stamp, AVG(temperature) AS temperature, AVG(pressure) AS pressure, AVG(vibration) AS vibration
      FROM TelemetryReading WHERE equipmentId=${id} AND timestamp>=${from} AND timestamp<=${to}
      GROUP BY CAST(timestamp / ${bucketMs} AS INTEGER) ORDER BY stamp ASC`);
    res.json({
      items: rows.map((r) => ({
        timestamp: new Date(Number(r.stamp)).toISOString(),
        temperature: r.temperature,
        pressure: r.pressure,
        vibration: r.vibration,
      })),
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      bucketMs,
    });
  });
  api.get('/incidents', async (req, res) => {
    const { page, pageSize, ...where } = incidentQuery.parse(req.query);
    const [items, total] = await db.$transaction([
      db.incident.findMany({
        where,
        include: { equipment: { select: { id: true, name: true } } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.incident.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  });
  api.get('/incidents/:id', async (req, res) => {
    const incident = await db.incident.findUnique({
      where: { id: incidentId.parse(req.params.id) },
      include: { equipment: { select: { id: true, name: true } } },
    });
    if (!incident) throw new AppError(404, 'NOT_FOUND', 'Инцидент не найден');
    res.json(incident);
  });
  api.patch('/incidents/:id/acknowledge', async (req, res) => {
    res.json(await simulator.acknowledge(incidentId.parse(req.params.id)));
  });
  api.post('/simulation/equipment/:id/fault', async (req, res) => {
    const { type } = z
      .object({ type: z.enum(['OVERHEAT', 'OVERPRESSURE']) })
      .strict()
      .parse(req.body);
    res.status(202).json(await simulator.fault(equipmentId.parse(req.params.id), type));
  });
  api.post('/simulation/equipment/:id/reset', async (req, res) => {
    res.json(await simulator.reset(equipmentId.parse(req.params.id)));
  });
  api.get('/dashboard/summary', async (_req, res) => {
    const [total, normal, warning, critical, activeIncidents, unacknowledged] =
      await db.$transaction([
        db.equipment.count(),
        db.equipment.count({ where: { status: 'NORMAL' } }),
        db.equipment.count({ where: { status: 'WARNING' } }),
        db.equipment.count({ where: { status: 'CRITICAL' } }),
        db.incident.count({ where: { status: { not: 'RESOLVED' } } }),
        db.incident.count({ where: { status: 'ACTIVE' } }),
      ]);
    res.json({
      total,
      normal,
      warning,
      critical,
      activeIncidents,
      unacknowledged,
      simulator: simulator.state,
    });
  });
  api.get('/analytics', async (req, res) => {
    const { minutes } = period.parse(req.query),
      to = new Date(),
      from = new Date(to.getTime() - minutes * 60000),
      where = { occurredAt: { gte: from, lte: to } };
    const [byEquipment, bySeverity, totalReadings, totalIncidents, resolvedIncidents] =
      await db.$transaction([
        db.incident.groupBy({
          by: ['equipmentId'],
          where,
          orderBy: { equipmentId: 'asc' },
          _count: true,
        }),
        db.incident.groupBy({
          by: ['severity'],
          where,
          orderBy: { severity: 'asc' },
          _count: true,
        }),
        db.telemetryReading.count({ where: { timestamp: { gte: from, lte: to } } }),
        db.incident.count({ where }),
        db.incident.count({ where: { ...where, status: 'RESOLVED' } }),
      ]);
    res.json({
      incidentsByEquipment: byEquipment.map((r) => ({ id: r.equipmentId, count: r._count })),
      incidentsBySeverity: bySeverity.map((r) => ({ severity: r.severity, count: r._count })),
      totalReadings,
      totalIncidents,
      resolvedIncidents,
      from: from.toISOString(),
      to: to.toISOString(),
    });
  });
  return api;
}
