import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { DemoSessions, IDLE_TTL } from '../src/services/sessions.js';
import { MemoryRepository, DEMO_LIMITS } from '../src/storage/memory.js';
import { Simulator } from '../src/services/simulator.js';
import { MaintenanceService } from '../src/services/maintenance.js';
let time: number, sessions: DemoSessions, app: ReturnType<typeof createApp>;
const now = () => new Date(time);
const header = { 'X-PlantOps-Request': '1' };
const input = {
  equipmentId: 'H-101',
  title: 'Осмотр насоса',
  description: 'Проверить уплотнение и опоры',
  assignee: 'Механик',
  priority: 'HIGH' as const,
};
beforeEach(() => {
  time = Date.parse('2026-01-01T00:00:00Z');
  sessions = new DemoSessions(now);
  app = createApp({ sessions, now, rateLimit: false });
});
async function visitor() {
  const agent = request.agent(app);
  const session = await agent.get('/api/session').expect(200);
  return { agent, session };
}
describe('public API isolation and recovery', () => {
  it('bootstraps once with opaque HttpOnly cookie; cannot adopt an invented token', async () => {
    const { agent, session } = await visitor();
    expect(session.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(session.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect(session.body).toMatchObject({ mode: 'demo', pollMs: 5000 });
    expect((await agent.get('/api/session')).body.revision).toBe(session.body.revision);
    expect(sessions.size).toBe(1);
    await request(app).get('/api/equipment').set('Cookie', 'plantops_demo=guessed').expect(409);
    const replaced = await request(app)
      .get('/api/session')
      .set('Cookie', 'plantops_demo=guessed')
      .expect(200);
    expect(replaced.headers['set-cookie'][0]).not.toContain('=guessed');
    expect(replaced.body.resetReason).toBeTruthy();
  });
  it('lists five assets, rejects missing IDs and strict malformed queries', async () => {
    const { agent } = await visitor();
    expect((await agent.get('/api/equipment').expect(200)).body).toHaveLength(5);
    await agent.get('/api/equipment/H-999').expect(404);
    await agent.get('/api/equipment/H-101/telemetry?minutes=no').expect(400);
    await agent.get('/api/equipment?extra=1').expect(400);
    await agent
      .post('/api/simulation/equipment/H-101/fault')
      .set(header)
      .send({ type: 12 })
      .expect(400);
  });
  it('keeps faults, orders, incident IDs and reset private to a visitor', async () => {
    const { agent: a } = await visitor(),
      { agent: b } = await visitor();
    await a
      .post('/api/simulation/equipment/H-101/fault')
      .set(header)
      .send({ type: 'OVERHEAT' })
      .expect(202);
    time += 40000;
    const eq = await a.get('/api/equipment/H-101').expect(200);
    expect(eq.body.status).toBe('CRITICAL');
    expect((await b.get('/api/equipment/H-101')).body.status).toBe('NORMAL');
    const incident = (await a.get('/api/incidents')).body.items[0];
    await b.get(`/api/incidents/${incident.id}`).expect(404);
    await b.patch(`/api/incidents/${incident.id}/acknowledge`).set(header).send({}).expect(404);
    const order = (await a.post('/api/maintenance').set(header).send(input).expect(201)).body;
    await b.get(`/api/maintenance/${order.id}`).expect(404);
    expect((await b.get('/api/maintenance')).body.total).toBe(0);
    await b.post('/api/demo/reset').set(header).send({}).expect(200);
    expect((await a.get('/api/maintenance')).body.total).toBe(1);
  });
  it('deduplicates concurrent reads/ticks and repeated faults, acknowledges and resolves', async () => {
    const { agent } = await visitor();
    await agent
      .post('/api/simulation/equipment/H-101/fault')
      .set(header)
      .send({ type: 'COMBINED' })
      .expect(202);
    time += 40000;
    await Promise.all(
      Array.from({ length: 10 }, () => agent.get('/api/dashboard/summary').expect(200)),
    );
    expect((await agent.get('/api/analytics')).body.totalReadings).toBe(45);
    const incidents = (await agent.get('/api/incidents')).body.items;
    expect(incidents).toHaveLength(3);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        agent
          .post('/api/simulation/equipment/H-101/fault')
          .set(header)
          .send({ type: 'COMBINED' })
          .expect(202),
      ),
    );
    const id = incidents[0].id;
    const a = await agent
      .patch(`/api/incidents/${id}/acknowledge`)
      .set(header)
      .send({})
      .expect(200);
    const b = await agent
      .patch(`/api/incidents/${id}/acknowledge`)
      .set(header)
      .send({})
      .expect(200);
    expect(a.body.acknowledgedAt).toBe(b.body.acknowledgedAt);
    expect(a.body.resolvedAt).toBeNull();
    await agent.post('/api/simulation/equipment/H-101/reset').set(header).send({}).expect(200);
    const all = (await agent.get('/api/incidents')).body.items;
    expect(all).toHaveLength(3);
    expect(all.every((i: { status: string }) => i.status === 'RESOLVED')).toBe(true);
    await agent.patch(`/api/incidents/${id}/acknowledge`).set(header).send({}).expect(409);
  });
  it('rejects a vibration fault on an asset without a sensor', async () => {
    const { agent } = await visitor();
    await agent
      .post('/api/simulation/equipment/T-301/fault')
      .set(header)
      .send({ type: 'HIGH_VIBRATION' })
      .expect(422);
  });
  it('invalidates idle sessions, lazily cleans state and explains server loss', async () => {
    const { agent, session } = await visitor();
    time += IDLE_TTL + 1;
    await agent.get('/api/equipment').expect(409);
    expect(sessions.size).toBe(0);
    const next = await agent.get('/api/session').expect(200);
    expect(next.body.revision).not.toBe(session.body.revision);
    expect(next.body.resetReason).toBeTruthy();
    const restarted = createApp({ now, rateLimit: false });
    await request(restarted)
      .get('/api/equipment')
      .set('Cookie', next.headers['set-cookie'][0].split(';')[0])
      .expect(409);
  });
  it('enforces absolute TTL even during active polling', async () => {
    const { agent } = await visitor();
    for (let n = 0; n < 5; n++) {
      time += 10 * 60000;
      await agent.get('/api/session').expect(200);
    }
    time += 10 * 60000;
    await agent.get('/api/equipment').expect(409);
  });
  it('resets session revision and data without affecting another visitor', async () => {
    const { agent, session } = await visitor();
    await agent.post('/api/maintenance').set(header).send(input);
    const reset = await agent.post('/api/demo/reset').set(header).send({}).expect(200);
    expect(reset.body.revision).not.toBe(session.body.revision);
    expect((await agent.get('/api/maintenance')).body.total).toBe(0);
    expect((await agent.get('/api/equipment')).body).toHaveLength(5);
  });
  it('exports actual filtered incidents and accumulated telemetry as CSV', async () => {
    const { agent } = await visitor();
    await agent
      .post('/api/simulation/equipment/H-101/fault')
      .set(header)
      .send({ type: 'OVERHEAT' });
    time += 40000;
    await agent.get('/api/equipment');
    const exported = await agent.get('/api/incidents/export?status=ACTIVE').expect(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.text).toContain('TEMPERATURE');
    const empty = await agent.get('/api/incidents/export?status=RESOLVED');
    expect(empty.text).not.toContain('TEMPERATURE');
    expect((await agent.get('/api/analytics/export?minutes=15')).text).toContain('H-101');
  });
});
describe('maintenance business API', () => {
  it('supports create, edit, comment, start, complete and archive with history', async () => {
    const { agent } = await visitor();
    let o = (await agent.post('/api/maintenance').set(header).send(input).expect(201)).body;
    expect(o.status).toBe('OPEN');
    o = (
      await agent
        .patch(`/api/maintenance/${o.id}`)
        .set(header)
        .send({ version: o.version, assignee: 'Сервисная бригада', priority: 'URGENT' })
        .expect(200)
    ).body;
    o = (
      await agent
        .post(`/api/maintenance/${o.id}/comments`)
        .set(header)
        .send({ version: o.version, author: 'Механик', text: '<script>alert(1)</script>' })
        .expect(201)
    ).body;
    expect(o.comments[0].text).toBe('<script>alert(1)</script>');
    o = (
      await agent
        .patch(`/api/maintenance/${o.id}`)
        .set(header)
        .send({ version: o.version, status: 'IN_PROGRESS' })
        .expect(200)
    ).body;
    o = (
      await agent
        .patch(`/api/maintenance/${o.id}`)
        .set(header)
        .send({ version: o.version, status: 'COMPLETED', resolution: 'Уплотнение проверено' })
        .expect(200)
    ).body;
    expect(o.completedAt).toBeTruthy();
    expect(o.history).toHaveLength(5);
    await agent
      .patch(`/api/maintenance/${o.id}`)
      .set(header)
      .send({ version: o.version, title: 'Нельзя менять' })
      .expect(409);
    expect((await agent.get('/api/dashboard/summary')).body.maintenance.COMPLETED).toBe(1);
    await agent
      .delete(`/api/maintenance/${o.id}`)
      .set(header)
      .send({ version: o.version })
      .expect(204);
    await agent.get(`/api/maintenance/${o.id}`).expect(404);
  });
  it('rejects lost updates and preserves a single winning concurrent change', async () => {
    const { agent } = await visitor();
    const o = (await agent.post('/api/maintenance').set(header).send(input)).body;
    const results = await Promise.all(
      ['Первая версия', 'Вторая версия'].map((title) =>
        agent.patch(`/api/maintenance/${o.id}`).set(header).send({ version: 1, title }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await agent.get(`/api/maintenance/${o.id}`)).body.version).toBe(2);
  });
  it('guards transitions, required resolution, equipment health and immutable closed orders', async () => {
    const { agent } = await visitor();
    let o = (await agent.post('/api/maintenance').set(header).send(input)).body;
    await agent
      .patch(`/api/maintenance/${o.id}`)
      .set(header)
      .send({ version: 1, status: 'COMPLETED', resolution: 'Проверено' })
      .expect(409);
    await agent.delete(`/api/maintenance/${o.id}`).set(header).send({ version: 1 }).expect(409);
    o = (
      await agent
        .patch(`/api/maintenance/${o.id}`)
        .set(header)
        .send({ version: 1, status: 'IN_PROGRESS' })
    ).body;
    await agent
      .patch(`/api/maintenance/${o.id}`)
      .set(header)
      .send({ version: o.version, status: 'COMPLETED' })
      .expect(422);
    await agent
      .post('/api/simulation/equipment/H-101/fault')
      .set(header)
      .send({ type: 'OVERHEAT' });
    time += 40000;
    await agent
      .patch(`/api/maintenance/${o.id}`)
      .set(header)
      .send({ version: o.version, status: 'COMPLETED', resolution: 'Проверено' })
      .expect(409);
    await agent.post('/api/simulation/equipment/H-101/reset').set(header).send({});
    o = (
      await agent
        .patch(`/api/maintenance/${o.id}`)
        .set(header)
        .send({ version: o.version, status: 'CANCELLED', resolution: 'Работы отменены' })
        .expect(200)
    ).body;
    await agent
      .post(`/api/maintenance/${o.id}/comments`)
      .set(header)
      .send({ version: o.version, author: 'Механик', text: 'Поздно' })
      .expect(409);
  });
  it('validates input and applies equipment, search, priority and status filters', async () => {
    const { agent } = await visitor();
    await agent
      .post('/api/maintenance')
      .set(header)
      .send({ ...input, status: 'COMPLETED' })
      .expect(400);
    await agent
      .post('/api/maintenance')
      .set(header)
      .send({ ...input, equipmentId: 'H-999' })
      .expect(404);
    await agent.post('/api/maintenance').set(header).send(input).expect(201);
    expect(
      (
        await agent.get(
          '/api/maintenance?search=Механик&priority=HIGH&status=OPEN&equipmentId=H-101',
        )
      ).body.total,
    ).toBe(1);
    expect((await agent.get('/api/maintenance?equipmentId=K-201')).body.total).toBe(0);
  });
});
describe('resource bounds and request protection', () => {
  it('caps sessions and returns Retry-After without evicting active visitors', async () => {
    const limited = createApp({ sessions: new DemoSessions(now, 1), now, rateLimit: false });
    await request(limited).get('/api/session').expect(200);
    const r = await request(limited).get('/api/session').expect(503);
    expect(r.headers['retry-after']).toBe('60');
  });
  it('blocks cross-site writes, non-JSON, invalid JSON and oversized payloads', async () => {
    const { agent } = await visitor();
    await agent.post('/api/maintenance').send(input).expect(403);
    await agent
      .post('/api/maintenance')
      .set(header)
      .set('Sec-Fetch-Site', 'cross-site')
      .send(input)
      .expect(403);
    await agent.post('/api/maintenance').set(header).type('form').send({ x: 1 }).expect(415);
    await agent.post('/api/maintenance').set(header).type('json').send('{').expect(400);
    await agent
      .post('/api/maintenance')
      .set(header)
      .send({ ...input, description: 'x'.repeat(20000) })
      .expect(413);
  });
  it('rate limits session creation and never trusts arbitrary forwarded IP headers', async () => {
    const secured = createApp({ now, sessions: new DemoSessions(now, 40) });
    for (let n = 0; n < 30; n++)
      await request(secured).get('/api/session').set('X-Forwarded-For', `1.2.3.${n}`).expect(200);
    const r = await request(secured).get('/api/session').expect(429);
    expect(r.body.error.code).toBe('RATE_LIMIT');
    expect(r.headers['retry-after']).toBe('60');
  });
  it('bounds telemetry, catch-up work, comments, history and work order creation', async () => {
    const repo = new MemoryRepository(now()),
      sim = new Simulator(repo, now, () => 0.5, true);
    time += 3600000;
    await sim.advance();
    expect(await repo.read((tx) => tx.countReadings(new Date(0), now()))).toBe(65);
    await repo.transaction(async (tx) => {
      for (let n = 0; n < 400; n++)
        await tx.appendReading({
          equipmentId: 'H-101',
          timestamp: now(),
          temperature: 50,
          pressure: 3,
          vibration: 1,
        });
    });
    expect(await repo.read((tx) => tx.readings('H-101', new Date(0), now()))).toHaveLength(
      DEMO_LIMITS.readingsPerEquipment,
    );
    const service = new MaintenanceService(repo, now);
    let o = await service.create(input);
    for (let n = 0; n < 10; n++)
      o = await service.comment(o.id, { version: o.version, author: 'ОП', text: 'Проверено' });
    await expect(
      service.comment(o.id, { version: o.version, author: 'ОП', text: 'Лишний' }),
    ).rejects.toThrow('10 комментариев');
    for (let n = 0; n < 45; n++)
      o = await service.update(o.id, { version: o.version, title: `Осмотр ${n}` });
    expect((await repo.read((tx) => tx.orders()))[0].history).toHaveLength(40);
    expect(o.history).toHaveLength(40);
    for (let n = 1; n < DEMO_LIMITS.workOrders; n++) await service.create(input);
    await expect(service.create(input)).rejects.toThrow('20 заявок');
    expect(await repo.read((tx) => tx.orders())).toHaveLength(DEMO_LIMITS.workOrders);
  });
  it('evicts only resolved incidents and keeps read snapshots detached', async () => {
    const repo = new MemoryRepository(now());
    await repo.transaction(async (tx) => {
      for (let n = 0; n < 100; n++)
        await tx.saveIncident({
          id: `i-${n}`,
          equipmentId: 'H-101',
          type: 'TEMPERATURE',
          description: 'Учебная авария',
          severity: 'WARNING',
          status: n === 0 ? 'ACTIVE' : 'RESOLVED',
          occurredAt: now(),
          acknowledgedAt: null,
          resolvedAt: n === 0 ? null : now(),
          activeKey: n === 0 ? 'H-101:TEMPERATURE' : null,
        });
    });
    await repo.transaction(async (tx) => {
      const base = (await tx.incidents())[1];
      await tx.saveIncident({ ...base, id: 'new' });
    });
    const events = await repo.read((tx) => tx.incidents());
    expect(events).toHaveLength(100);
    expect(events.some((i) => i.id === 'i-0')).toBe(true);
    expect(events.some((i) => i.id === 'i-1')).toBe(false);
    events[0].description = 'Changed outside repository';
    expect((await repo.read((tx) => tx.incidents()))[0].description).toBe('Учебная авария');
  });
  it('refuses a reset while another operation is using the same session', async () => {
    const { agent, session } = await visitor();
    const token = session.headers['set-cookie'][0].split(';')[0].split('=')[1];
    const active = sessions.get(token)!;
    active.busy = 1;
    await agent.post('/api/demo/reset').set(header).send({}).expect(409);
    active.busy = 0;
    expect((await agent.get('/api/session')).body.revision).toBe(session.body.revision);
  });
  it('rolls back a failed in-memory transaction and leaves the queue usable', async () => {
    const repo = new MemoryRepository(now());
    await expect(
      repo.transaction(async (tx) => {
        const e = (await tx.equipment())[0];
        await tx.saveEquipment({ ...e, overheat: true });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await repo.read((tx) => tx.equipment()))[0].overheat).toBe(false);
    await new Simulator(repo).fault('H-101', 'OVERHEAT');
    expect((await repo.read((tx) => tx.equipment()))[0].overheat).toBe(true);
  });
});
