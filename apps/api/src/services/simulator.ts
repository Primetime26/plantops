import type { FaultType, SimulatorState } from '@plantops/contracts';
import { AppError } from '../errors.js';
import { nextValues } from '../domain/simulation.js';
import { persistReading } from '../repositories/monitoring.js';
import type { Repository, UnitOfWork } from '../storage/repository.js';
export async function getEquipment(tx: UnitOfWork, id: string) {
  const e = (await tx.equipment()).find((e) => e.id === id);
  if (!e) throw new AppError(404, 'NOT_FOUND', 'Оборудование не найдено');
  return e;
}
export class Simulator {
  private timer?: ReturnType<typeof setTimeout>;
  private advancing: Promise<void> | null = null;
  readonly state: SimulatorState;
  constructor(
    readonly repository: Repository,
    private now = () => new Date(),
    private random = () => 0.5,
    readonly onDemand = false,
  ) {
    this.state = {
      running: onDemand,
      intervalMs: onDemand ? 5000 : 2000,
      lastTickAt: onDemand ? now().toISOString() : null,
      error: null,
      mode: onDemand ? 'on-demand' : 'background',
    };
  }
  async tick(time = this.now()) {
    await this.repository.transaction(async (tx) => {
      for (const e of await tx.equipment())
        await persistReading(tx, e, nextValues(e, time, this.random), time);
    });
    this.state.lastTickAt = time.toISOString();
    this.state.error = null;
  }
  advance() {
    if (!this.onDemand) return Promise.resolve();
    if (this.advancing) return this.advancing;
    this.advancing = (async () => {
      const now = this.now().getTime(),
        last = Date.parse(this.state.lastTickAt!);
      const steps = Math.min(12, Math.max(0, Math.floor((now - last) / this.state.intervalMs)));
      const base =
        now - last > 12 * this.state.intervalMs ? now - steps * this.state.intervalMs : last;
      for (let i = 1; i <= steps; i++) await this.tick(new Date(base + i * this.state.intervalMs));
    })().finally(() => {
      this.advancing = null;
    });
    return this.advancing;
  }
  fault(id: string, type: FaultType) {
    return this.repository.transaction(async (tx) => {
      const e = await getEquipment(tx, id);
      if (type === 'HIGH_VIBRATION' && e.vibration === null)
        throw new AppError(422, 'NO_SENSOR', 'Для оборудования не предусмотрен датчик вибрации');
      const next = {
        ...e,
        overheat: e.overheat || type === 'OVERHEAT' || type === 'COMBINED',
        overpressure: e.overpressure || type === 'OVERPRESSURE' || type === 'COMBINED',
        highVibration:
          e.highVibration ||
          type === 'HIGH_VIBRATION' ||
          (type === 'COMBINED' && e.vibration !== null),
      };
      await tx.saveEquipment(next);
      return next;
    });
  }
  reset(id: string) {
    return this.repository.transaction(async (tx) => {
      const e = await getEquipment(tx, id);
      return persistReading(
        tx,
        { ...e, overheat: false, overpressure: false, highVibration: false },
        { temperature: e.temperatureBase, pressure: e.pressureBase, vibration: e.vibrationBase },
        this.now(),
      );
    });
  }
  acknowledge(id: string) {
    return this.repository.transaction(async (tx) => {
      const i = (await tx.incidents()).find((i) => i.id === id);
      if (!i) throw new AppError(404, 'NOT_FOUND', 'Инцидент не найден');
      if (i.status === 'RESOLVED')
        throw new AppError(409, 'ALREADY_RESOLVED', 'Устранённый инцидент нельзя подтвердить');
      if (i.status === 'ACKNOWLEDGED') return i;
      const next = { ...i, status: 'ACKNOWLEDGED' as const, acknowledgedAt: this.now() };
      await tx.saveIncident(next);
      return next;
    });
  }
  start() {
    if (this.onDemand || this.state.running) return;
    this.state.running = true;
    const run = async () => {
      const started = Date.now();
      try {
        await this.tick();
      } catch (e) {
        this.state.error = 'Ошибка записи телеметрии';
        console.error(e);
      }
      if (this.state.running)
        this.timer = setTimeout(run, Math.max(0, 2000 - (Date.now() - started)));
    };
    void run();
  }
  async stop() {
    this.state.running = false;
    clearTimeout(this.timer);
    await this.advancing;
    await this.repository.read(async () => undefined);
  }
}
