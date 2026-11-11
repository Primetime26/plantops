import { db } from '../src/db.js';
// Prisma 6 migrate deploy can fail on a missing SQLite file in some environments.
// Opening through Prisma Client safely creates the file without changing its schema.
try {
  await db.$queryRaw`SELECT 1`;
} finally {
  await db.$disconnect();
}
