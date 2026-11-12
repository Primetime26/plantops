import 'dotenv/config';
import { Simulator } from './services/simulator.js';
import { createApp } from './app.js';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const env = z
  .object({
    APP_MODE: z.enum(['local', 'demo']).default('local'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().default('0.0.0.0'),
    NODE_ENV: z.string().optional(),
    TRUST_LAYERO_PROXY: z.enum(['true', 'false']).default('false'),
  })
  .parse(process.env);
let local: Simulator | undefined;
// No Prisma module or engine is loaded in Public Demo.
if (env.APP_MODE === 'local') {
  const { db } = await import('./db.js');
  const { PrismaRepository } = await import('./storage/prisma.js');
  await db.$connect();
  await db.$queryRaw`PRAGMA journal_mode = WAL`;
  if ((await db.equipment.count()) !== 5)
    throw new Error('Database not initialized. Run npm run setup.');
  local = new Simulator(new PrismaRepository(db));
}
const app = createApp({
  local,
  webDirectory: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
  secureCookie: env.APP_MODE === 'demo' && env.NODE_ENV === 'production',
  trustLayero: env.TRUST_LAYERO_PROXY === 'true',
});
const server = app.listen(env.PORT, env.HOST, () => {
  local?.start();
  console.log(`PlantOps (${env.APP_MODE}): http://${env.HOST}:${env.PORT}`);
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await local?.stop();
  server.close(async () => {
    await local?.repository.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('error', async (e) => {
  console.error(e);
  await local?.stop();
  await local?.repository.close();
  process.exit(1);
});
