import { db } from './db.js';
import { Simulator } from './services/simulator.js';
import { createApp } from './app.js';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().default('127.0.0.1'),
  })
  .parse(process.env);
await db.$connect();
await db.$queryRaw`PRAGMA journal_mode = WAL`;
if ((await db.equipment.count()) !== 5)
  throw new Error('Database not initialized. Run npm run setup.');
const simulator = new Simulator(db);
const webDirectory = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const app = createApp(db, simulator, webDirectory);
const server = app.listen(env.PORT, env.HOST, () => {
  simulator.start();
  console.log(`PlantOps API: http://${env.HOST}:${env.PORT}`);
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(async () => {
    await simulator.stop();
    await db.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('error', async (error) => {
  console.error(error);
  await simulator.stop();
  await db.$disconnect();
  process.exit(1);
});
