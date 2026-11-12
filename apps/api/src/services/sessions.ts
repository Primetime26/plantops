import { randomBytes, randomUUID } from 'node:crypto';
import { MemoryRepository, DEMO_LIMITS } from '../storage/memory.js';
import { Simulator } from './simulator.js';
import { AppError } from '../errors.js';
export const IDLE_TTL = 15 * 60 * 1000,
  MAX_AGE = 60 * 60 * 1000;
export interface DemoSession {
  simulator: Simulator;
  revision: string;
  created: number;
  seen: number;
  busy: number;
}
export class DemoSessions {
  private sessions = new Map<string, DemoSession>();
  constructor(
    private now = () => new Date(),
    readonly capacity = DEMO_LIMITS.sessions,
  ) {}
  sweep() {
    const now = this.now().getTime();
    for (const [key, s] of this.sessions)
      if (!s.busy && (now - s.seen >= IDLE_TTL || now - s.created >= MAX_AGE))
        this.sessions.delete(key);
  }
  get(token: string | undefined) {
    this.sweep();
    const s = token ? this.sessions.get(token) : undefined;
    if (s) s.seen = this.now().getTime();
    return s;
  }
  create() {
    this.sweep();
    if (this.sessions.size >= this.capacity)
      throw new AppError(503, 'DEMO_FULL', 'Демостенд занят. Повторите через несколько минут.');
    const now = this.now(),
      token = randomBytes(32).toString('base64url');
    const session = {
      simulator: new Simulator(new MemoryRepository(now), this.now, () => 0.5, true),
      revision: randomUUID(),
      created: now.getTime(),
      seen: now.getTime(),
      busy: 0,
    };
    this.sessions.set(token, session);
    return { token, session };
  }
  reset(token: string) {
    const old = this.get(token);
    if (!old) throw new AppError(409, 'SESSION_RESET', 'Демонстрационная сессия сброшена');
    if (old.busy > 1)
      throw new AppError(409, 'SESSION_BUSY', 'Дождитесь завершения других операций');
    old.simulator = new Simulator(new MemoryRepository(this.now()), this.now, () => 0.5, true);
    old.revision = randomUUID();
    old.created = this.now().getTime();
    return old;
  }
  get size() {
    this.sweep();
    return this.sessions.size;
  }
}
