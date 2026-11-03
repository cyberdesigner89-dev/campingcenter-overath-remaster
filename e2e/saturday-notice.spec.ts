import { chromium, firefox, webkit, expect, test, type BrowserType, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const widths = [320, 360, 390, 768, 1024, 1440, 1920];
const lines = [
  'Liebe Campingfreunde,',
  'ab sofort bleibt unser Campingcenter samstags geschlossen.',
  'Von Montag bis Freitag sind wir wie gewohnt gerne für euch da.',
  'Vielen Dank für euer Verständnis, wir freuen uns auf euren Besuch!',
];

async function allowLocalHttp(page: Page) {
  await page.route('**/*', async (route) => {
    let url = route.request().url();
    if (url.startsWith('https://127.0.0.1:4321')) url = `http://${url.slice('https://'.length)}`;
    const res = await fetch(url, { headers: { accept: route.request().headers().accept || '*/*' } });
    const headers = Object.fromEntries(res.headers.entries());
    if (headers['content-security-policy']?.includes('upgrade-insecure-requests')) {
      headers['content-security-policy'] = headers['content-security-policy'].replace(/upgrade-insecure-requests;?\s*/g, '');
    }
    headers['access-control-allow-origin'] = 'http://127.0.0.1:4321';
    await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
  });
}

async function openFresh(page: Page, path = '/') {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.removeItem('cco:saturday-notice'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const dialog = page.locator('[data-saturday-notice]');
  await expect(dialog).toBeVisible({ timeout: 4000 });
  return dialog;
}

async function assertNotice(page: Page) {
  const dialog = page.locator('[data-saturday-notice]');
  await expect(dialog).toBeVisible();
  for (const line of lines) await expect(dialog).toContainText(line);
  await expect(dialog.getByRole('button', { name: 'Verstanden' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Hinweis schließen' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const box = await dialog.locator('.sn-card').boundingBox();
  expect(box && box.x >= -1 && box.x + box.width <= page.viewportSize()!.width + 1).toBeTruthy();
}

test.describe('Saturday closed notice', () => {
  test.describe.configure({ timeout: 180_000 });

  for (const [name, browserType] of [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ] as const satisfies ReadonlyArray<readonly [string, BrowserType]>) {
    test(`${name}: readable on every width, then stays dismissed`, async () => {
      const browser = await browserType.launch();
      const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
      if (name === 'webkit') await allowLocalHttp(page);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });

      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await openFresh(page);
        await assertNotice(page);
        if (name === 'chromium' && (width === 360 || width === 1440)) {
          mkdirSync('/opt/cursor/artifacts/screenshots', { recursive: true });
          await page.screenshot({ path: `/opt/cursor/artifacts/screenshots/saturday-notice-${width}.png` });
        }
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => {
          const dialog = document.querySelector('[data-saturday-notice]');
          return !!dialog && dialog.contains(document.activeElement);
        });
        expect(inside).toBeTruthy();
        if (width === 1024) await page.mouse.click(8, 8);
        else await page.keyboard.press('Escape');
        await expect(page.locator('[data-saturday-notice]')).toBeHidden();
      }

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      await expect(page.locator('[data-saturday-notice]')).toBeHidden();

      await openFresh(page, '/kontakt/');
      const hours = page.locator('.hours');
      await expect(hours.locator('dt', { hasText: 'Samstag' })).toBeVisible();
      await expect(hours.locator('div', { hasText: 'Samstag' }).locator('dd')).toHaveText('geschlossen');
      await page.locator('[data-saturday-notice]').getByRole('button', { name: 'Verstanden' }).click();
      await expect(page.locator('[data-saturday-notice]')).toBeHidden();
      await expect.poll(() => page.evaluate(() => localStorage.getItem('cco:saturday-notice'))).toBe('1');

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const footerSaturday = page.locator('.footer-hours div', { hasText: 'Samstag' });
      await expect(footerSaturday.locator('dd')).toHaveText('geschlossen');
      expect(errors, errors.join('\n')).toEqual([]);
      await browser.close();
    });
  }

  test('axe color contrast on the open notice', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await openFresh(page);
    const axe = await new AxeBuilder({ page }).include('[data-saturday-notice]').withRules(['color-contrast']).analyze();
    expect(axe.violations).toEqual([]);
    await page.setViewportSize({ width: 360, height: 800 });
    const narrow = await new AxeBuilder({ page }).include('[data-saturday-notice]').withRules(['color-contrast']).analyze();
    expect(narrow.violations).toEqual([]);
    await browser.close();
  });
});
