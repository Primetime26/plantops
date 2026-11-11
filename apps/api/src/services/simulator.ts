import type { PrismaClient } from '@prisma/client';
import type { FaultType, SimulatorState } from '@plantops/contracts';
import { AppError } from '../errors.js';
import { nextValues } from '../domain/simulation.js';
import { persistReading } from '../repositories/monitoring.js';
export class Simulator {
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  readonly state: SimulatorState = {
    running: false,
    intervalMs: 2000,
    lastTickAt: null,
    error: null,
  };
  constructor(
    private db: PrismaClient,
    private now = () => new Date(),
    private random = Math.random,
  ) {}
  // Single-process SQLite writer queue shared by ticks, faults, resets and acknowledgements.
  private write<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => undefined);
    return result;
  }
  tick() {
    return this.write(async () => {
      const time = this.now();
      await this.db.$transaction(async (tx) => {
        const equipment = await tx.equipment.findMany();
        for (const e of equipment)
          await persistReading(tx, e, nextValues(e, time, this.random), time);
      });
      this.state.lastTickAt = time.toISOString();
      this.state.error = null;
    });
  }
  fault(id: string, type: FaultType) {
    return this.write(() =>
      this.db.$transaction(async (tx) => {
        const e = await tx.equipment.findUnique({ where: { id } });
        if (!e) throw new AppError(404, 'NOT_FOUND', 'Оборудование не найдено');
        return tx.equipment.update({
          where: { id },
          data: type === 'OVERHEAT' ? { overheat: true } : { overpressure: true },
        });
      }),
    );
  }
  reset(id: string) {
    return this.write(() =>
      this.db.$transaction(async (tx) => {
        const e = await tx.equipment.findUnique({ where: { id } });
        if (!e) throw new AppError(404, 'NOT_FOUND', 'Оборудование не найдено');
        const cleared = await tx.equipment.update({
          where: { id },
          data: { overheat: false, overpressure: false },
        });
        return persistReading(
          tx,
          cleared,
          { temperature: e.temperatureBase, pressure: e.pressureBase, vibration: e.vibrationBase },
          this.now(),
        );
      }),
    );
  }
  acknowledge(id: string) {
    return this.write(() =>
      this.db.$transaction(async (tx) => {
        const incident = await tx.incident.findUnique({ where: { id } });
        if (!incident) throw new AppError(404, 'NOT_FOUND', 'Инцидент не найден');
        if (incident.status === 'RESOLVED')
          throw new AppError(409, 'ALREADY_RESOLVED', 'Устранённый инцидент нельзя подтвердить');
        if (incident.status === 'ACKNOWLEDGED') return incident;
        return tx.incident.update({
          where: { id },
          data: { status: 'ACKNOWLEDGED', acknowledgedAt: this.now() },
        });
      }),
    );
  }
  start() {
    if (this.state.running) return;
    this.state.running = true;
    const run = async () => {
      const started = Date.now();
      try {
        await this.tick();
      } catch (error) {
        this.state.error = 'Ошибка записи телеметрии';
        console.error(error);
      }
      if (this.state.running)
        this.timer = setTimeout(run, Math.max(0, 2000 - (Date.now() - started)));
    };
    void run();
  }
  async stop() {
    this.state.running = false;
    clearTimeout(this.timer);
    await this.queue;
  }
}
