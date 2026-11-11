import { copyFileSync, existsSync } from 'node:fs';
if (!existsSync('apps/api/.env')) copyFileSync('.env.example', 'apps/api/.env');
console.log('PlantOps environment ready. Existing .env preserved.');
