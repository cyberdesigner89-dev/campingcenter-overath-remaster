import { test, expect } from '@playwright/test';

const base = process.env.BASE_PATH || '/';

function path(p: string) {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${b}${p.startsWith('/') ? p : `/${p}`}`;
}

test.describe('CampingCompanion smoke', () => {
  test('opens compact support center with tabs', async ({ page }) => {
    await page.goto(path('/'));
    await expect(page.locator('html')).toHaveAttribute('lang', /de/);
    await expect(page.locator('.companion-fab')).toHaveCount(1);
    await expect(page.locator('.chatw-fab, .a11y-fab')).toHaveCount(0);
    await expect(page.locator('[data-companion-open]')).toHaveAttribute(
      'aria-label',
      'Hilfe, Camping-KI und Barrierefreiheit öffnen',
    );
    await expect(page.locator('.companion-fab .universal-access-icon')).toHaveCount(1);
    await expect(page.locator('.companion-tab-a11y-svg')).toHaveCount(1);
    await expect(page.locator('.companion-fab-compass')).toHaveCount(0);
    await expect(page.locator('.universal-access-icon')).toHaveCount(2);

    await page.locator('[data-companion-open]').click();
    await expect(page.locator('[data-companion-panel]')).toHaveAttribute('open', '');
    await expect(page.getByRole('heading', { name: 'Hilfe & Barrierefreiheit' })).toBeVisible();
    await expect(page.locator('[data-companion-tab="a11y"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-companion-view="a11y"]')).toBeVisible();

    await page.locator('[data-companion-tab="chat"]').click();
    await expect(page.locator('[data-companion-view="chat"]')).toBeVisible();
    await expect(page.locator('[data-companion-chat-input]')).toBeVisible();

    await page.locator('[data-companion-tab="contact"]').click();
    const contact = page.locator('[data-companion-view="contact"]');
    await expect(contact).toBeVisible();
    await expect(contact.getByRole('link', { name: 'Jetzt anrufen' })).toBeVisible();
    await expect(contact.getByRole('link', { name: 'Nachricht schreiben' })).toBeVisible();
    await expect(contact.getByRole('link', { name: 'Route planen' })).toBeVisible();

    await page.locator('[data-companion-size="sm"]').click();
    await expect(page.locator('[data-companion]')).toHaveAttribute('data-size', 'sm');
    await page.locator('[data-companion-size="md"]').click();
    await expect(page.locator('[data-companion]')).toHaveAttribute('data-size', 'md');

    await page.locator('[data-companion-close]').click();
    await expect(page.locator('[data-companion-panel]')).not.toHaveAttribute('open');
  });

  test('a11y prefs toggle contrast and persist size/font', async ({ page }) => {
    await page.goto(path('/'));
    await page.locator('[data-consent-action="necessary"]').click({ timeout: 3000 }).catch(() => undefined);
    await page.locator('[data-companion-open]').click();
    await expect(page.locator('[data-companion-panel]')).toHaveAttribute('open', '');
    const a11y = page.locator('[data-companion-view="a11y"]');
    await expect(a11y).toBeVisible();

    const highContrast = a11y.locator('[data-a11y-choice="contrast"][data-a11y-value="on"]');
    await expect(highContrast).toBeVisible();
    await highContrast.click();
    await expect(page.locator('html')).toHaveClass(/a11y-contrast/);

    await a11y.locator('[data-a11y-font="xl"]').click();
    await expect(page.locator('html')).toHaveClass(/a11y-font-xl/);

    await a11y.locator('[data-a11y-choice="contrast"][data-a11y-value="off"]').click();
    await expect(page.locator('html')).not.toHaveClass(/a11y-contrast/);

    await page.locator('[data-companion-size="lg"]').click();
    await page.locator('[data-companion-close]').click();
    await expect(page.locator('[data-companion-panel]')).not.toHaveAttribute('open');

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/a11y-font-xl/);
    await page.locator('[data-companion-open]').click();
    await expect(page.locator('[data-companion-panel]')).toHaveAttribute('open', '');
    await expect(page.locator('[data-companion]')).toHaveAttribute('data-size', 'lg');
  });

  test('legacy cco:lang preference does not redirect', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cco:lang', 'en'));
    await page.goto(path('/'));
    await expect(page).toHaveURL(/\/?$/);
    await expect(page).not.toHaveURL(/\/en\//);
    await expect(page.locator('html')).toHaveAttribute('lang', /de/);
  });

  test('FAB opens on hard load and after soft-nav', async ({ page }) => {
    await page.goto(path('/'));
    await page.locator('[data-consent-action="necessary"]').click({ timeout: 3000 }).catch(() => undefined);

    const routes = ['/wohnmobile/', '/kontakt/', '/camper-finder/', '/barrierefreiheit/'];
    for (const route of routes) {
      await page.goto(path(route));
      const fab = page.locator('[data-companion-open]');
      await expect(fab).toBeVisible();
      await fab.click();
      await expect(page.locator('[data-companion-panel]')).toHaveAttribute('open', '');
      await page.locator('[data-companion-close]').click();
      await expect(page.locator('[data-companion-panel]')).not.toHaveAttribute('open');
    }

    await page.goto(path('/'));
    const soft = page.locator(`a[href="${path('/wohnmobile/')}"]:visible`).first();
    if (await soft.count()) await soft.click();
    else await page.goto(path('/wohnmobile/'));
    await page.waitForURL(/wohnmobile/);
    await page.locator('[data-companion-open]').click();
    await expect(page.locator('[data-companion-panel]')).toHaveAttribute('open', '');
  });
});
