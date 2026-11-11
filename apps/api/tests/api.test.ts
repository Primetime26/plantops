import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../src/app.js';
import { Simulator } from '../src/services/simulator.js';
import { seed } from '../src/repositories/seed.js';
import { evaluate } from '../src/domain/simulation.js';
const folder = mkdtempSync(join(tmpdir(), 'plantops-test-'));
const url = `file:${join(folder, 'test.db').replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasourceUrl: url });
const simulator = new Simulator(
  db,
  () => new Date(),
  () => 0.5,
);
const app = createApp(db, simulator);
async function heat() {
  await request(app)
    .post('/api/simulation/equipment/H-101/fault')
    .send({ type: 'OVERHEAT' })
    .expect(202);
  for (let i = 0; i < 7; i++) await simulator.tick();
  return db.incident.findFirstOrThrow({ where: { equipmentId: 'H-101', status: 'ACTIVE' } });
}
beforeAll(async () => {
  await db.$queryRaw`SELECT 1`;
  execFileSync(
    process.execPath,
    [resolve('../../node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' },
  );
  await db.$connect();
});
beforeEach(async () => {
  await db.incident.deleteMany();
  await db.telemetryReading.deleteMany();
  await db.equipment.deleteMany();
  await seed(db);
});
afterAll(async () => {
  await simulator.stop();
  await db.$disconnect();
  rmSync(folder, { recursive: true, force: true });
});
describe('PlantOps real SQLite API', () => {
  it('lists five equipment records and idempotent seed preserves state', async () => {
    await simulator.fault('H-101', 'OVERHEAT');
    await seed(db);
    const res = await request(app).get('/api/equipment').expect(200);
    expect(res.body).toHaveLength(5);
    expect(res.body.find((e: { id: string }) => e.id === 'H-101').overheat).toBe(true);
    expect(await db.telemetryReading.count()).toBe(5);
  });
  it('returns 404 for valid but missing equipment and incident IDs', async () => {
    const r = await request(app).get('/api/equipment/H-999').expect(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    await request(app).get('/api/incidents/missing').expect(404);
    await request(app).post('/api/simulation/equipment/H-999/reset').expect(404);
  });
  it('creates one incident, escalates same ID and never duplicates across ticks or parallel commands', async () => {
    await simulator.fault('H-101', 'OVERHEAT');
    for (let i = 0; i < 3; i++) await simulator.tick();
    const warning = await db.incident.findFirstOrThrow();
    expect(warning.severity).toBe('WARNING');
    await simulator.acknowledge(warning.id);
    for (let i = 0; i < 10; i++) await simulator.tick();
    await Promise.all(Array.from({ length: 5 }, () => simulator.fault('H-101', 'OVERHEAT')));
    expect(await db.incident.count()).toBe(1);
    const critical = await db.incident.findFirstOrThrow();
    expect(critical.id).toBe(warning.id);
    expect(critical.severity).toBe('CRITICAL');
    expect(critical.status).toBe('ACTIVE');
    const e = await db.equipment.findUniqueOrThrow({ where: { id: 'H-101' } });
    expect(e.temperature).toBeGreaterThan(e.temperatureCritical);
    expect(e.status).toBe('CRITICAL');
  });
  it('acknowledges idempotently without resolving and resets atomically, retaining history', async () => {
    const incident = await heat();
    const ack = await request(app).patch(`/api/incidents/${incident.id}/acknowledge`).expect(200);
    expect(ack.body.status).toBe('ACKNOWLEDGED');
    expect(ack.body.acknowledgedAt).toBeTruthy();
    expect(ack.body.resolvedAt).toBeNull();
    const again = await request(app).patch(`/api/incidents/${incident.id}/acknowledge`).expect(200);
    expect(again.body.acknowledgedAt).toBe(ack.body.acknowledgedAt);
    await simulator.tick();
    expect((await db.equipment.findUniqueOrThrow({ where: { id: 'H-101' } })).status).toBe(
      'CRITICAL',
    );
    const reset = await request(app).post('/api/simulation/equipment/H-101/reset').expect(200);
    expect(reset.body.status).toBe('NORMAL');
    expect(reset.body.overheat).toBe(false);
    const history = await request(app).get(`/api/incidents/${incident.id}`).expect(200);
    expect(history.body.status).toBe('RESOLVED');
    expect(history.body.resolvedAt).toBeTruthy();
    expect(history.body.acknowledgedAt).toBe(ack.body.acknowledgedAt);
    await request(app).patch(`/api/incidents/${incident.id}/acknowledge`).expect(409);
    await heat();
    expect(await db.incident.count()).toBe(2);
  });
  it('handles simultaneous pressure and temperature faults with separate incidents', async () => {
    await simulator.fault('K-201', 'OVERHEAT');
    await simulator.fault('K-201', 'OVERPRESSURE');
    for (let i = 0; i < 8; i++) await simulator.tick();
    expect(await db.incident.count({ where: { equipmentId: 'K-201' } })).toBe(2);
    await simulator.reset('K-201');
    expect(await db.incident.count({ where: { status: 'RESOLVED' } })).toBe(2);
  });
  it('rejects malformed input with consistent errors', async () => {
    for (const data of [{}, { type: 'EXPLOSION' }, { type: 'OVERHEAT', extra: true }]) {
      const r = await request(app)
        .post('/api/simulation/equipment/H-101/fault')
        .send(data)
        .expect(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
    await request(app).get('/api/equipment/H-101/telemetry?minutes=-1').expect(400);
    await request(app).get('/api/incidents?page=0').expect(400);
    await request(app).get('/api/equipment?status=BROKEN').expect(400);
    await request(app)
      .post('/api/simulation/equipment/H-101/fault')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    expect(await db.incident.count()).toBe(0);
  });
  it('restores persisted faults with a fresh simulator and database connection', async () => {
    const incident = await heat();
    await simulator.acknowledge(incident.id);
    const second = new PrismaClient({ datasourceUrl: url });
    const restarted = new Simulator(second);
    await restarted.tick();
    expect((await second.equipment.findUniqueOrThrow({ where: { id: 'H-101' } })).overheat).toBe(
      true,
    );
    expect((await second.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe(
      'ACKNOWLEDGED',
    );
    expect(await second.incident.count()).toBe(1);
    await restarted.stop();
    await second.$disconnect();
  });
  it('returns accumulated telemetry, analytics, filtered journal and coherent summary', async () => {
    await heat();
    const telemetry = await request(app)
      .get('/api/equipment/H-101/telemetry?minutes=15')
      .expect(200);
    expect(telemetry.body.items.length).toBeGreaterThan(0);
    expect(telemetry.body.items[0].timestamp).toBeTruthy();
    const summary = await request(app).get('/api/dashboard/summary').expect(200);
    expect(summary.body).toMatchObject({ total: 5, normal: 4, critical: 1, activeIncidents: 1 });
    const analytics = await request(app).get('/api/analytics?minutes=60').expect(200);
    expect(analytics.body.totalIncidents).toBe(1);
    expect(analytics.body.totalReadings).toBe(40);
    const incidents = await request(app).get('/api/incidents?status=ACTIVE&pageSize=1').expect(200);
    expect(incidents.body.total).toBe(1);
    expect(incidents.body.items).toHaveLength(1);
    await request(app).get('/api/health').expect(200);
  });
  it('normal simulation remains below thresholds and exchanger has no vibration sensor', async () => {
    for (let i = 0; i < 30; i++) await simulator.tick();
    expect(await db.incident.count()).toBe(0);
    expect((await db.equipment.findUniqueOrThrow({ where: { id: 'T-301' } })).vibration).toBeNull();
    const e = await db.equipment.findUniqueOrThrow({ where: { id: 'H-101' } });
    expect(
      evaluate(e, {
        temperature: e.temperatureWarning,
        pressure: e.pressureBase,
        vibration: e.vibrationBase,
      }).status,
    ).toBe('WARNING');
    expect(
      evaluate(e, {
        temperature: e.temperatureCritical,
        pressure: e.pressureBase,
        vibration: e.vibrationBase,
      }).status,
    ).toBe('CRITICAL');
  });
});
