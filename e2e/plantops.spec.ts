import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

test('operator lifecycle: dashboard → fault → incident → maintenance → reset', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Обзор участка' })).toBeVisible();
  await expect(page.locator('.equipment-table tbody tr')).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  await page.getByRole('link', { name: 'Оборудование', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Оборудование', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Открыть Н-101', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Н-101 ·/ })).toBeVisible();
  await page.getByRole('button', { name: 'Симулировать перегрев', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Перегрев активен' })).toBeDisabled();
  await expect(page.locator('.page-heading .status')).toHaveText('Критическое', { timeout: 50000 });
  await expect(page.locator('.incident-table tbody tr')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('equipment-fault.png'), fullPage: true });
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.locator('.incident-table .status')).toHaveText('Подтверждён');
  await page.getByRole('button', { name: 'Восстановить нормальный режим' }).click();
  await expect(page.locator('.page-heading .status')).toHaveText('В норме');
  await expect(page.locator('.incident-table .status')).toHaveText('Устранён');
  await page.getByRole('link', { name: 'Аварии и инциденты', exact: true }).click();
  await page.getByLabel('Статус инцидента').selectOption('RESOLVED');
  await expect(page.locator('.incident-table tbody tr')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт CSV' }).click();
  expect((await download).suggestedFilename()).toBe('plantops-incidents.csv');
  await page.getByRole('link', { name: 'Техобслуживание', exact: true }).click();
  await page.getByRole('button', { name: 'Новая заявка', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Название заявки', { exact: true }).fill('Проверка насоса после перегрева');
  await page
    .getByLabel('Описание проблемы', { exact: true })
    .fill('Осмотр уплотнений и проверка давления после восстановления.');
  await page.getByLabel('Ответственный', { exact: true }).fill('Сервисная бригада');
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Проверка насоса после перегрева' }),
  ).toBeVisible();
  const malicious = '<img src=x onerror="alert(1)">';
  await page.getByLabel('Новый комментарий').fill(malicious);
  await page.getByRole('button', { name: 'Добавить комментарий' }).click();
  await expect(page.locator('.order-comment p')).toHaveText(malicious);
  await expect(page.locator('.order-comment img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Взять в работу' }).click();
  await expect(page.locator('.order-meta .status')).toHaveText('В работе');
  await page
    .getByLabel('Результат работ / причина отмены')
    .fill('Уплотнения исправны, параметры в норме.');
  await page.getByRole('button', { name: 'Завершить заявку' }).click();
  await expect(page.locator('.order-meta .status')).toHaveText('Выполнена');
  await page.screenshot({ path: testInfo.outputPath('maintenance.png'), fullPage: true });
  await page.getByRole('link', { name: 'Аналитика', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Аналитика', exact: true })).toBeVisible();
  await expect(page.locator('.recharts-line').first()).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить демо' }).click();
  await expect(page.locator('.demo-notice')).toContainText('Демонстрация сброшена');
  await page.getByRole('link', { name: 'Техобслуживание', exact: true }).click();
  await expect(
    page.getByText('Заявок не найдено. Создайте заявку или измените фильтры.'),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('separate visitors, tablet layout and accessible dialog keyboard', async ({
  browser,
}, testInfo) => {
  const a = await browser.newContext({ viewport: { width: 820, height: 1180 } }),
    b = await browser.newContext();
  const p = await a.newPage(),
    q = await b.newPage();
  try {
    await p.goto('http://127.0.0.1:3100/equipment/H-101');
    await p.getByRole('button', { name: 'Симулировать перегрев', exact: true }).click();
    await expect(p.getByRole('button', { name: 'Перегрев активен' })).toBeDisabled();
    await q.goto('http://127.0.0.1:3100/equipment/H-101');
    await expect(
      q.getByRole('button', { name: 'Симулировать перегрев', exact: true }),
    ).toBeEnabled();
    await p.getByRole('link', { name: 'Техобслуживание', exact: true }).click();
    await p.getByRole('button', { name: 'Новая заявка', exact: true }).click();
    await expect(p.getByRole('dialog')).toBeVisible();
    await p.keyboard.press('Escape');
    await expect(p.getByRole('dialog')).toHaveCount(0);
    await p.getByRole('link', { name: 'Главная панель', exact: true }).click();
    await expect(p.locator('.equipment-table tbody tr')).toHaveCount(5);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
      true,
    );
    await p.screenshot({ path: testInfo.outputPath('tablet.png'), fullPage: true });
  } finally {
    await a.close();
    await b.close();
  }
});

test('friendly slow boot, API error and explicit retry', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/session', async (route) => {
    attempts++;
    if (attempts === 1) {
      await new Promise((r) => setTimeout(r, 5000));
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'UNAVAILABLE', message: 'Демостенд временно занят' },
        }),
      });
    } else await route.continue();
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Запускаем демонстрационный участок' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить подключение' })).toBeVisible();
  await page.getByRole('button', { name: 'Повторить подключение' }).click();
  await expect(page.getByRole('heading', { name: 'Обзор участка' })).toBeVisible();
});

test('recovers UI and cookie after an actual server process restart', async ({ page }) => {
  let server: ChildProcess | undefined;
  async function start() {
    server = spawn(process.execPath, ['apps/api/dist/index.js'], {
      env: { ...process.env, APP_MODE: 'demo', PORT: '3101', HOST: '127.0.0.1', NODE_ENV: 'test' },
      stdio: 'pipe',
    });
    await expect
      .poll(
        async () => {
          try {
            return (await fetch('http://127.0.0.1:3101/api/health')).status;
          } catch {
            return 0;
          }
        },
        { timeout: 10000 },
      )
      .toBe(200);
  }
  async function stop() {
    if (server && server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill('SIGTERM');
      await exited;
    }
  }
  try {
    await start();
    await page.goto('http://127.0.0.1:3101/equipment/H-101');
    await page.getByRole('button', { name: 'Симулировать перегрев', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Перегрев активен' })).toBeDisabled();
    await stop();
    await start();
    await expect(page.locator('.demo-notice')).toContainText(
      'Сессия истекла или сервер перезапущен',
      { timeout: 20000 },
    );
    await expect(
      page.getByRole('button', { name: 'Симулировать перегрев', exact: true }),
    ).toBeEnabled();
    await expect(page.locator('.page-heading .status')).toHaveText('В норме');
  } finally {
    await stop();
  }
});
