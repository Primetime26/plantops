// Bounded synthetic stress check; run after npm run build:demo.
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
registerHooks({
  resolve(specifier, context, next) {
    if (/prisma/i.test(specifier)) throw new Error(`Demo attempted to load Prisma: ${specifier}`);
    return next(specifier, context);
  },
});
const { DemoSessions } = await import('../apps/api/dist/services/sessions.js');
const { DEMO_LIMITS } = await import('../apps/api/dist/storage/memory.js');
const { createApp } = await import('../apps/api/dist/app.js');
const now = new Date(),
  sessions = new DemoSessions(() => now),
  handles = [];
let peak = process.memoryUsage().rss;
const sample = () => {
  peak = Math.max(peak, process.memoryUsage().rss, process.resourceUsage().maxRSS * 1024);
};
const text = (length) => `${randomUUID()}${'Учебный текст '.repeat(length)}`.slice(0, length);
const start = performance.now();
for (let s = 0; s < DEMO_LIMITS.sessions; s++) {
  const { session, token } = sessions.create();
  handles.push({ session, token });
  await session.simulator.repository.transaction(async (tx) => {
    for (const e of await tx.equipment())
      for (let n = 1; n < DEMO_LIMITS.readingsPerEquipment; n++)
        await tx.appendReading({
          equipmentId: e.id,
          timestamp: new Date(now - n * 5000),
          temperature: 52,
          pressure: 4.2,
          vibration: 1.8,
        });
    for (let n = 0; n < DEMO_LIMITS.incidents; n++)
      await tx.saveIncident({
        id: randomUUID(),
        equipmentId: 'H-101',
        type: 'TEMPERATURE',
        description: text(120),
        severity: 'CRITICAL',
        status: 'RESOLVED',
        occurredAt: now,
        acknowledgedAt: now,
        resolvedAt: now,
        activeKey: null,
      });
    for (let n = 0; n < DEMO_LIMITS.workOrders; n++)
      await tx.saveOrder({
        id: randomUUID(),
        equipmentId: 'H-101',
        title: text(120),
        description: text(2000),
        assignee: text(80),
        priority: 'HIGH',
        status: 'OPEN',
        resolution: text(2000),
        version: 100,
        archived: false,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        comments: Array.from({ length: 10 }, () => ({
          id: randomUUID(),
          author: text(80),
          text: text(1000),
          createdAt: now,
        })),
        history: Array.from({ length: 40 }, () => ({
          id: randomUUID(),
          action: 'UPDATED',
          detail: text(700),
          createdAt: now,
        })),
      });
  });
  sample();
}
const app = createApp({ sessions, now: () => now, rateLimit: false });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let succeeded = 0;
try {
  for (let round = 0; round < 3; round++)
    await Promise.all(
      handles.map(async ({ session, token }) => {
        await session.simulator.tick();
        sample();
        const response = await fetch(`${url}/api/maintenance?pageSize=10`, {
          headers: { Cookie: `plantops_demo=${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          if (data.total !== DEMO_LIMITS.workOrders) throw new Error('Missing stress records');
          succeeded++;
        } else if (response.status !== 503) throw new Error(`Unexpected HTTP ${response.status}`);
        sample();
      }),
    );
  const health = await fetch(`${url}/api/health`);
  if (health.status !== 200) throw new Error('Health check failed');
  sample();
  const report = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sessions: handles.length,
    readings: DEMO_LIMITS.sessions * 5 * DEMO_LIMITS.readingsPerEquipment,
    workOrders: DEMO_LIMITS.sessions * DEMO_LIMITS.workOrders,
    commentsPerOrder: 10,
    historyPerOrder: 40,
    successfulResponses: succeeded,
    rssPeakMiB: +(peak / 1024 / 1024).toFixed(1),
    heapMiB: +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
    seconds: +((performance.now() - start) / 1000).toFixed(2),
    prismaLoaded: false,
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.rssPeakMiB > 230) process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
