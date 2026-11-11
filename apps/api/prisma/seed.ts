import { db } from '../src/db.js';
import { seed } from '../src/repositories/seed.js';
try {
  await seed(db);
  console.log('Seed complete: five equipment records, existing state preserved.');
} finally {
  await db.$disconnect();
}
