import { Router } from 'express';
import { z } from 'zod';
import type { Simulator } from '../services/simulator.js';
import { getEquipment } from '../services/simulator.js';
import { MaintenanceService } from '../services/maintenance.js';
import { csv } from '../services/csv.js';
import { AppError } from '../errors.js';
import * as v from '../domain/validation.js';
import type { UnitOfWork } from '../storage/repository.js';
import type { Reading } from '../domain/models.js';
const paginate = <T>(items: T[], page: number, pageSize: number) => ({
  items: items.slice((page - 1) * pageSize, page * pageSize),
  total: items.length,
  page,
  pageSize,
});
async function incidents(tx: UnitOfWork, q: z.infer<typeof v.incidentQuery>) {
  const equipment = await tx.equipment();
  return (await tx.incidents())
    .filter(
      (i) =>
        (!q.equipmentId || i.equipmentId === q.equipmentId) &&
        (!q.status || i.status === q.status) &&
        (!q.severity || i.severity === q.severity),
    )
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id))
    .map((i) => ({
      ...i,
      equipment: { id: i.equipmentId, name: equipment.find((e) => e.id === i.equipmentId)!.name },
    }));
}
function aggregate(rows: Reading[], bucketMs: number) {
  const buckets = new Map<number, Reading[]>();
  for (const r of rows) {
    const key = Math.floor(r.timestamp.getTime() / bucketMs);
    const group = buckets.get(key) ?? [];
    group.push(r);
    buckets.set(key, group);
  }
  return [...buckets.values()].map((group) => ({
    timestamp: group[group.length - 1].timestamp,
    temperature: group.reduce((n, r) => n + r.temperature, 0) / group.length,
    pressure: group.reduce((n, r) => n + r.pressure, 0) / group.length,
    vibration:
      group[0].vibration === null
        ? null
        : group.reduce((n, r) => n + (r.vibration ?? 0), 0) / group.length,
  }));
}
async function telemetry(tx: UnitOfWork, id: string, minutes: number, now: Date) {
  await getEquipment(tx, id);
  const from = new Date(now.getTime() - minutes * 60000),
    bucketMs = Math.max(2000, Math.ceil((minutes * 60000) / 300));
  return {
    id,
    items: aggregate(await tx.readings(id, from, now), bucketMs),
    from,
    to: now,
    bucketMs,
  };
}
export function apiRouter(now = () => new Date()) {
  const api = Router();
  api.use(async (_req, res, next) => {
    await (res.locals.simulator as Simulator).advance();
    next();
  });
  const sim = (res: { locals: Record<string, unknown> }) => res.locals.simulator as Simulator;
  api.get('/equipment', async (req, res) => {
    const q = z
      .object({ search: z.string().max(100).optional(), status: v.status.optional() })
      .strict()
      .parse(req.query);
    res.json(
      await sim(res).repository.read(async (tx) =>
        (await tx.equipment()).filter(
          (e) =>
            (!q.status || e.status === q.status) &&
            (!q.search ||
              `${e.name} ${e.id} ${e.description}`.toLowerCase().includes(q.search.toLowerCase())),
        ),
      ),
    );
  });
  api.get('/equipment/:id', async (req, res) =>
    res.json(
      await sim(res).repository.read((tx) => getEquipment(tx, v.equipmentId.parse(req.params.id))),
    ),
  );
  api.get('/equipment/:id/telemetry', async (req, res) => {
    const { minutes } = v.period.parse(req.query);
    res.json(
      await sim(res).repository.read((tx) =>
        telemetry(tx, v.equipmentId.parse(req.params.id), minutes, now()),
      ),
    );
  });
  api.get('/telemetry', async (req, res) => {
    const { minutes } = v.period.parse(req.query);
    res.json(
      await sim(res).repository.read(async (tx) =>
        Promise.all((await tx.equipment()).map((e) => telemetry(tx, e.id, minutes, now()))),
      ),
    );
  });
  api.get('/incidents/export', async (req, res) => {
    const q = v.incidentQuery.parse(req.query);
    const rows = await sim(res).repository.read((tx) => incidents(tx, q));
    res
      .attachment('plantops-incidents.csv')
      .type('text/csv')
      .send(
        csv([
          [
            'ID',
            'Оборудование',
            'Тип',
            'Описание',
            'Критичность',
            'Статус',
            'Возник',
            'Подтверждён',
            'Устранён',
          ],
          ...rows
            .slice(0, 10000)
            .map((i) => [
              i.id,
              i.equipment.name,
              i.type,
              i.description,
              i.severity,
              i.status,
              i.occurredAt,
              i.acknowledgedAt,
              i.resolvedAt,
            ]),
        ]),
      );
  });
  api.get('/incidents', async (req, res) => {
    const q = v.incidentQuery.parse(req.query);
    res.json(
      await sim(res).repository.read(async (tx) =>
        paginate(await incidents(tx, q), q.page, q.pageSize),
      ),
    );
  });
  api.get('/incidents/:id', async (req, res) => {
    const id = v.id.parse(req.params.id);
    const i = await sim(res).repository.read(async (tx) =>
      (await incidents(tx, { page: 1, pageSize: 100 })).find((i) => i.id === id),
    );
    if (!i) throw new AppError(404, 'NOT_FOUND', 'Инцидент не найден');
    res.json(i);
  });
  api.patch('/incidents/:id/acknowledge', async (req, res) =>
    res.json(await sim(res).acknowledge(v.id.parse(req.params.id))),
  );
  api.post('/simulation/equipment/:id/fault', async (req, res) => {
    const { type } = z
      .object({ type: z.enum(['OVERHEAT', 'OVERPRESSURE', 'HIGH_VIBRATION', 'COMBINED']) })
      .strict()
      .parse(req.body);
    res.status(202).json(await sim(res).fault(v.equipmentId.parse(req.params.id), type));
  });
  api.post('/simulation/equipment/:id/reset', async (req, res) =>
    res.json(await sim(res).reset(v.equipmentId.parse(req.params.id))),
  );
  api.get('/dashboard/summary', async (_req, res) =>
    res.json(
      await sim(res).repository.read(async (tx) => {
        const e = await tx.equipment(),
          i = await tx.incidents(),
          orders = (await tx.orders(false)).filter((o) => !o.archived);
        return {
          total: e.length,
          normal: e.filter((e) => e.status === 'NORMAL').length,
          warning: e.filter((e) => e.status === 'WARNING').length,
          critical: e.filter((e) => e.status === 'CRITICAL').length,
          activeIncidents: i.filter((i) => i.status !== 'RESOLVED').length,
          unacknowledged: i.filter((i) => i.status === 'ACTIVE').length,
          simulator: sim(res).state,
          maintenance: Object.fromEntries(
            ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => [
              s,
              orders.filter((o) => o.status === s).length,
            ]),
          ),
        };
      }),
    ),
  );
  api.get('/analytics', async (req, res) => {
    const { minutes } = v.period.parse(req.query),
      to = now(),
      from = new Date(to.getTime() - minutes * 60000);
    res.json(
      await sim(res).repository.read(async (tx) => {
        const events = (await tx.incidents()).filter(
          (i) => i.occurredAt >= from && i.occurredAt <= to,
        );
        return {
          from,
          to,
          totalReadings: await tx.countReadings(from, to),
          totalIncidents: events.length,
          resolvedIncidents: events.filter((i) => i.status === 'RESOLVED').length,
          incidentsByEquipment: (await tx.equipment()).map((e) => ({
            id: e.id,
            count: events.filter((i) => i.equipmentId === e.id).length,
          })),
          incidentsBySeverity: ['WARNING', 'CRITICAL'].map((severity) => ({
            severity,
            count: events.filter((i) => i.severity === severity).length,
          })),
          incidentsByType: ['TEMPERATURE', 'PRESSURE', 'VIBRATION'].map((type) => ({
            type,
            count: events.filter((i) => i.type === type).length,
          })),
        };
      }),
    );
  });
  api.get('/analytics/export', async (req, res) => {
    const { minutes } = v.period.parse(req.query);
    const series = await sim(res).repository.read(async (tx) =>
      Promise.all((await tx.equipment()).map((e) => telemetry(tx, e.id, minutes, now()))),
    );
    res
      .attachment('plantops-telemetry.csv')
      .type('text/csv')
      .send(
        csv([
          [
            'Оборудование',
            'Время UTC',
            'Температура °C (среднее)',
            'Давление бар (среднее)',
            'Вибрация мм/с (среднее)',
          ],
          ...series.flatMap((s) =>
            s.items.map((r) => [s.id, r.timestamp, r.temperature, r.pressure, r.vibration]),
          ),
        ]),
      );
  });
  api.get('/maintenance', async (req, res) => {
    const q = v.orderQuery.parse(req.query);
    res.json(
      await sim(res).repository.read(async (tx) =>
        paginate(
          (await tx.orders(false))
            .filter(
              (o) =>
                !o.archived &&
                (!q.equipmentId || o.equipmentId === q.equipmentId) &&
                (!q.status || o.status === q.status) &&
                (!q.priority || o.priority === q.priority) &&
                (!q.search ||
                  `${o.title} ${o.description} ${o.assignee}`
                    .toLowerCase()
                    .includes(q.search.toLowerCase())),
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
          q.page,
          q.pageSize,
        ),
      ),
    );
  });
  api.get('/maintenance/:id', async (req, res) => {
    const id = v.id.parse(req.params.id);
    const order = await sim(res).repository.read(async (tx) => tx.order(id));
    if (!order || order.archived) throw new AppError(404, 'NOT_FOUND', 'Заявка не найдена');
    res.json(order);
  });
  api.post('/maintenance', async (req, res) =>
    res
      .status(201)
      .json(
        await new MaintenanceService(sim(res).repository, now).create(
          v.createOrder.parse(req.body),
        ),
      ),
  );
  api.patch('/maintenance/:id', async (req, res) =>
    res.json(
      await new MaintenanceService(sim(res).repository, now).update(
        v.id.parse(req.params.id),
        v.updateOrder.parse(req.body),
      ),
    ),
  );
  api.post('/maintenance/:id/comments', async (req, res) =>
    res
      .status(201)
      .json(
        await new MaintenanceService(sim(res).repository, now).comment(
          v.id.parse(req.params.id),
          v.commentInput.parse(req.body),
        ),
      ),
  );
  api.delete('/maintenance/:id', async (req, res) => {
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    await new MaintenanceService(sim(res).repository, now).archive(
      v.id.parse(req.params.id),
      version,
    );
    res.status(204).end();
  });
  return api;
}
