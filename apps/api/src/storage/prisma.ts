import type { Prisma, PrismaClient } from '@prisma/client';
import type { Repository, UnitOfWork } from './repository.js';
import type { EquipmentRecord, IncidentRecord, OrderRecord } from '../domain/models.js';
function unit(tx: Prisma.TransactionClient): UnitOfWork {
  return {
    equipment: async () =>
      (await tx.equipment.findMany({ orderBy: { id: 'asc' } })) as EquipmentRecord[],
    saveEquipment: async (e) => {
      await tx.equipment.update({ where: { id: e.id }, data: e });
    },
    incidents: async () =>
      (await tx.incident.findMany({ orderBy: { occurredAt: 'asc' } })) as IncidentRecord[],
    saveIncident: async (i) => {
      await tx.incident.upsert({ where: { id: i.id }, create: i, update: i });
    },
    readings: async (id, from, to) =>
      tx.telemetryReading.findMany({
        where: { equipmentId: id, timestamp: { gte: from, lte: to } },
        orderBy: { timestamp: 'asc' },
      }),
    countReadings: async (from, to) =>
      tx.telemetryReading.count({ where: { timestamp: { gte: from, lte: to } } }),
    appendReading: async (r) => {
      await tx.telemetryReading.create({ data: r });
    },
    orders: async (details = true) => {
      const rows = await tx.workOrder.findMany({
        include: {
          comments: details ? { orderBy: { createdAt: 'asc' } } : false,
          history: details ? { orderBy: { createdAt: 'asc' } } : false,
        },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((o) => ({
        ...o,
        comments: o.comments ?? [],
        history: o.history ?? [],
      })) as OrderRecord[];
    },
    order: async (id) =>
      (await tx.workOrder.findUnique({
        where: { id },
        include: {
          comments: { orderBy: { createdAt: 'asc' } },
          history: { orderBy: { createdAt: 'asc' } },
        },
      })) as OrderRecord | null,
    saveOrder: async (order) => {
      const { comments, history, ...data } = order;
      await tx.workOrder.upsert({ where: { id: data.id }, create: data, update: data });
      for (const c of comments)
        await tx.workOrderComment.upsert({
          where: { id: c.id },
          create: { ...c, workOrderId: data.id },
          update: {},
        });
      for (const h of history)
        await tx.workOrderHistory.upsert({
          where: { id: h.id },
          create: { ...h, workOrderId: data.id },
          update: {},
        });
    },
  };
}
export class PrismaRepository implements Repository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly db: PrismaClient) {}
  async read<T>(work: (tx: UnitOfWork) => Promise<T>) {
    await this.queue;
    return this.db.$transaction((tx) => work(unit(tx)), { timeout: 15000 });
  }
  transaction<T>(work: (tx: UnitOfWork) => Promise<T>): Promise<T> {
    const job = this.queue.then(() =>
      this.db.$transaction((tx) => work(unit(tx)), { timeout: 15000 }),
    );
    this.queue = job.catch(() => undefined);
    return job;
  }
  async close() {
    await this.queue;
    await this.db.$disconnect();
  }
}
