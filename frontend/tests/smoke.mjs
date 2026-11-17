import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const env = process.env;
const base = env.HCC_SMOKE_WEB ?? 'http://127.0.0.1:15173';
const actor = env.HCC_SMOKE_ACTOR;
const checklist = env.HCC_SMOKE_CHECKLIST;
const step = env.HCC_SMOKE_STEP;
const supervisor = env.HCC_DEMO_SUPERVISOR_TOKEN;
const auditor = env.HCC_DEMO_AUDITOR_TOKEN;
if (![actor, checklist, step, supervisor, auditor].every(Boolean)) {
  throw new Error('Load the test tokens and the Browser fixture printed by smoke-modern.py.');
}
const browser = await chromium.launch({ channel: env.HCC_CHROME_CHANNEL || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const signIn = async token => {
    await page.getByLabel('Bearer-токен').fill(token);
    await page.getByRole('button', { name: 'Подключиться' }).click();
  };
  await signIn('invalid-token');
  await page.getByRole('alert').getByText(/Токен недействителен/).waitFor();
  await signIn(supervisor);
  await page.getByRole('heading', { name: 'Журнал аудита' }).waitFor();
  await page.getByLabel('Исполнитель').fill(actor);
  await page.getByLabel('Действие', { exact: true }).fill('STEP_COMPLETED');
  await page.getByRole('button', { name: 'Применить' }).click();
  const row = page.getByRole('row').filter({ hasText: 'STEP_COMPLETED' });
  await row.waitFor();
  assert.equal(await page.getByRole('row').count(), 2);
  await row.getByRole('button', { name: /Открыть событие/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Событие аудита' });
  await dialog.getByText('Исходный payload').click();
  await dialog.getByText(/actorUserId/).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  if (env.HCC_SMOKE_SCREENSHOTS) {
    await page.screenshot({ path: env.HCC_SMOKE_SCREENSHOTS + '/audit.png', fullPage: true });
  }

  await page.getByRole('link', { name: 'Резервные записи', exact: true }).click();
  await page.getByRole('link', { name: /Новая запись/ }).click();
  await page.getByLabel('Чек-лист', { exact: true }).fill(checklist);
  await page.getByLabel('Пункт', { exact: true }).fill(step);
  await page.getByLabel('Исполнитель', { exact: true }).fill(actor);
  await page.getByLabel('Действие / тип события').fill('STEP_COMPLETED');
  await page.getByLabel('Основание').fill('Проверка браузера HCC DATA');
  const operations = [];
  await page.route('**/api/reserve-records', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    operations.push(body);
    if (operations.length === 1) {
      const committed = await route.fetch();
      assert.equal(committed.status(), 201);
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Сохранить запись' }).click();
  await page.getByText(/Результат отправки неизвестен/).waitFor();
  await page.getByRole('button', { name: 'Повторить ту же операцию' }).click();
  await page.getByText('Эта операция уже сохранена.').waitFor();
  assert.equal(operations.length, 2);
  assert.deepEqual(operations[0], operations[1]);
  await page.unroute('**/api/reserve-records');

  await page.getByRole('link', { name: /К сверке/ }).click();
  await page.getByRole('button', { name: /Найти события CORE/ }).click();
  await page.getByRole('button', { name: /^STEP_COMPLETED/ }).click();
  await page.getByRole('combobox', { name: 'Решение', exact: true }).selectOption('MARK_DUPLICATE');
  await page.getByLabel('Основание', { exact: true }).fill('Подтверждено по журналу CORE');
  await page.getByRole('button', { name: 'Проверить и подтвердить' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Записать решение' }).click();
  await page.getByText('Решение сохранено в истории.').waitFor();
  await page.getByRole('row').filter({ hasText: 'Подтверждено по журналу CORE' }).waitFor();
  await page.getByRole('link', { name: 'Статистика', exact: true }).click();
  await page.getByLabel('Идентификатор', { exact: true }).fill(actor);
  await page.getByRole('button', { name: 'Получить статистику' }).click();
  await page.getByRole('row').filter({ hasText: 'STEP_COMPLETED' }).waitFor();
  await page.getByRole('button', { name: /Выйти/ }).click();
  await signIn(auditor);
  await page.getByRole('link', { name: 'Журнал аудита', exact: true }).click();
  await page.getByRole('link', { name: 'Безопасность AUTH', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'auth.login' }).first().waitFor();
  await page.getByRole('link', { name: 'Диагностика', exact: true }).click();
  await page.getByText('EVENT_ID_COLLISION').first().waitFor();

  await page.getByRole('link', { name: 'Резервные записи', exact: true }).click();
  await page.getByRole('link', { name: /Новая запись/ }).click();
  await page.getByLabel('Чек-лист', { exact: true }).fill(checklist);
  await page.getByLabel('Пункт', { exact: true }).fill(step);
  await page.getByLabel('Исполнитель', { exact: true }).fill(actor);
  await page.getByLabel('Действие / тип события').fill('STEP_COMPLETED');
  await page.getByLabel('Основание').fill('Попытка без полномочий на запись');
  const forbidden = page.waitForResponse(response =>
    response.url().endsWith('/api/reserve-records') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Сохранить запись' }).click();
  assert.equal((await forbidden).status(), 403);
  await page.getByRole('alert').getByText(/нет доступа к этой операции/).waitFor();

  await page.getByRole('link', { name: 'Журнал аудита', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'STEP_COMPLETED' }).first().waitFor();
  await page.route(url => url.pathname === '/api/audit', route => route.fulfill({
    status: 503, json: { error: 'unavailable' },
  }), { times: 1 });
  await page.getByRole('button', { name: 'Обновить', exact: false }).click();
  await page.getByText(/DATA временно недоступен/).waitFor();
  await page.getByRole('button', { name: 'Повторить запрос' }).click();
  await page.getByRole('row').filter({ hasText: 'STEP_COMPLETED' }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Журнал аудита', exact: true }).click();
  await page.getByRole('heading', { name: 'Журнал аудита' }).waitFor();
  await page.getByRole('row').filter({ hasText: 'STEP_COMPLETED' }).first().waitFor();
  if (env.HCC_SMOKE_SCREENSHOTS) {
    await page.screenshot({ path: env.HCC_SMOKE_SCREENSHOTS + '/audit-mobile.png', fullPage: true });
  }
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll('body *')].filter(el =>
      el.getBoundingClientRect().right > window.innerWidth && !el.closest('.table-scroll'))
      .slice(0, 12).map(el => el.tagName + '.' + el.className + ':' + el.getBoundingClientRect().right),
  }));
  assert.ok(layout.document <= layout.viewport, JSON.stringify(layout));
  await page.reload();
  await page.getByRole('heading', { name: 'Подключение к DATA' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: Chrome, sign-in, audit, detail, idempotent retry, reconciliation, history, statistics, AUTH, diagnostics and mobile layout.');
} finally {
  await browser.close();
}
