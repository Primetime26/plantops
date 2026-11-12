import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(process.execPath, [`${root}apps/api/dist/index.js`], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, APP_MODE: 'demo', HOST: process.env.HOST ?? '0.0.0.0' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
