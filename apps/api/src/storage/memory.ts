import type { Repository, UnitOfWork } from './repository.js';
import type { EquipmentRecord, IncidentRecord, OrderRecord, Reading } from '../domain/models.js';
import { seedEquipment } from '../domain/equipment.js';
import { AppError } from '../errors.js';
export const DEMO_LIMITS = {
  sessions: 10,
  readingsPerEquipment: 360,
  incidents: 100,
  workOrders: 20,
};
type State = {
  equipment: EquipmentRecord[];
  incidents: IncidentRecord[];
  readings: Reading[];
  orders: OrderRecord[];
};
function fresh(now: Date): State {
  const equipment = seedEquipment.map((e) => ({
    ...e,
    status: 'NORMAL' as const,
    overheat: false,
    overpressure: false,
    highVibration: false,
    updatedAt: now,
  }));
  return {
    equipment,
    incidents: [],
    orders: [],
    readings: equipment.map((e) => ({
      equipmentId: e.id,
      timestamp: now,
      temperature: e.temperature,
      pressure: e.pressure,
      vibration: e.vibration,
    })),
  };
}
export class MemoryRepository implements Repository {
  private state: State;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(now = new Date()) {
    this.state = fresh(now);
  }
  private unit(state: State): UnitOfWork {
    return {
      equipment: async () => structuredClone(state.equipment),
      saveEquipment: async (value) => {
        state.equipment = state.equipment.map((e) =>
          e.id === value.id ? structuredClone(value) : e,
        );
      },
      incidents: async () => structuredClone(state.incidents),
      saveIncident: async (value) => {
        if (
          value.activeKey &&
          state.incidents.some((i) => i.id !== value.id && i.activeKey === value.activeKey)
        )
          throw new AppError(409, 'DUPLICATE', 'Инцидент уже существует');
        const index = state.incidents.findIndex((i) => i.id === value.id);
        if (index >= 0) state.incidents[index] = structuredClone(value);
        else {
          if (state.incidents.length >= DEMO_LIMITS.incidents) {
            const oldest = state.incidents.findIndex((i) => i.status === 'RESOLVED');
            if (oldest < 0) throw new AppError(409, 'LIMIT', 'Достигнут лимит инцидентов');
            state.incidents.splice(oldest, 1);
          }
          state.incidents.push(structuredClone(value));
        }
      },
      readings: async (id, from, to) =>
        structuredClone(
          state.readings.filter(
            (r) => r.equipmentId === id && r.timestamp >= from && r.timestamp <= to,
          ),
        ),
      countReadings: async (from, to) =>
        state.readings.filter((r) => r.timestamp >= from && r.timestamp <= to).length,
      appendReading: async (value) => {
        state.readings.push(structuredClone(value));
        const own = state.readings.filter((r) => r.equipmentId === value.equipmentId);
        if (own.length > DEMO_LIMITS.readingsPerEquipment) {
          const oldest = own[0];
          state.readings.splice(state.readings.indexOf(oldest), 1);
        }
      },
      orders: async (details = true) =>
        structuredClone(
          details
            ? state.orders
            : state.orders.map(({ comments: _comments, history: _history, ...o }) => ({
                ...o,
                comments: [],
                history: [],
              })),
        ),
      order: async (id) => structuredClone(state.orders.find((o) => o.id === id) ?? null),
      saveOrder: async (value) => {
        if (value.comments.length > 10)
          throw new AppError(409, 'LIMIT', 'В деморежиме доступно 10 комментариев на заявку');
        value = { ...value, history: value.history.slice(-40) };
        const index = state.orders.findIndex((o) => o.id === value.id);
        if (index < 0) {
          if (state.orders.length >= DEMO_LIMITS.workOrders)
            throw new AppError(409, 'LIMIT', 'Лимит 20 заявок: сбросьте демо');
          state.orders.push(structuredClone(value));
        } else state.orders[index] = structuredClone(value);
      },
    };
  }
  async read<T>(work: (tx: UnitOfWork) => Promise<T>) {
    await this.queue;
    return work(this.unit(this.state));
  }
  transaction<T>(work: (tx: UnitOfWork) => Promise<T>): Promise<T> {
    const job = this.queue.then(async () => {
      const draft: State = {
        equipment: [...this.state.equipment],
        incidents: [...this.state.incidents],
        readings: [...this.state.readings],
        orders: [...this.state.orders],
      };
      const result = await work(this.unit(draft));
      this.state = draft;
      return result;
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
  async close() {
    await this.queue;
  }
}
