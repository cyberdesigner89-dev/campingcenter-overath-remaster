import { expect, test, type Page } from '@playwright/test';

const base = process.env.BASE_PATH || '/';

function path(p: string) {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${b}${p.startsWith('/') ? p : `/${p}`}`;
}

async function tapBar(page: Page, label: string) {
  const link = page.locator('[data-action-bar] a', { hasText: label });
  await expect(link).toBeVisible();
  const box = await link.boundingBox();
  expect(box).toBeTruthy();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

test.describe('mobile action bar', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Fahrzeuge opens the inventory once, including under the saturday notice and after back', async ({ page }) => {
    const mark = () => page.evaluate(() => (window as Window & { __mark?: number }).__mark ?? 0);

    await page.addInitScript(() => localStorage.removeItem('cco:saturday-notice'));
    await page.goto(path('/'));
    await expect(page.locator('[data-saturday-notice]')).toBeVisible();
    await page.evaluate(() => {
      (window as Window & { __mark?: number }).__mark = 1;
      window.scrollTo(0, 1400);
    });

    await tapBar(page, 'Fahrzeuge');
    await page.waitForURL(/\/wohnmobile\/?$/);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(8);
    expect(await mark(), 'navigation reloaded more than once or not at all').toBe(0);
    await page.evaluate(() => {
      (window as Window & { __mark?: number }).__mark = 2;
    });
    await page.waitForTimeout(600);
    expect(await mark(), 'a second navigation replaced the page').toBe(2);
    await expect(page).toHaveURL(/\/wohnmobile\/?$/);

    await page.evaluate(() => window.scrollTo(0, 700));
    await tapBar(page, 'Fahrzeuge');
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/\/wohnmobile\/?$/);
    expect(await mark()).toBe(2);
    expect(await page.evaluate(() => scrollY)).toBeLessThan(8);

    await page.goBack();
    await page.waitForURL((url) => !url.pathname.includes('wohnmobile'));
    await tapBar(page, 'Fahrzeuge');
    await page.waitForURL(/\/wohnmobile\/?$/);
    expect(await page.evaluate(() => scrollY)).toBeLessThan(8);

    await page.goto(path('/werkstatt-kundendienst/'));
    await expect(page.locator('[data-saturday-notice]')).toBeVisible();
    await tapBar(page, 'Fahrzeuge');
    await page.waitForURL(/\/wohnmobile\/?$/);
    expect(await page.evaluate(() => scrollY)).toBeLessThan(8);

    await page.goto(path('/'));
    await tapBar(page, 'Anfrage');
    await page.waitForURL(/\/kontakt\/?/);
  });
});
