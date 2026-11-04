import { expect, test } from '@playwright/test';

const base = process.env.BASE_PATH || '/';

function path(p: string) {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${b}${p.startsWith('/') ? p : `/${p}`}`;
}

/**
 * YouTube facades:
 * - /ueber-uns/  „Filme – Lern uns kennen“ (eTog12HJsE0, MQLUVc4_rEw)
 * - /werkstatt-kundendienst/ (I_xTKmybkWY)
 */
const tiles = [
  { route: '/ueber-uns/', id: 'eTog12HJsE0' },
  { route: '/ueber-uns/', id: 'MQLUVc4_rEw' },
  { route: '/werkstatt-kundendienst/', id: 'I_xTKmybkWY' },
] as const;

test.describe('YouTube after client navigation', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('play starts the nocookie iframe without a reload, including back/forward', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cco:saturday-notice', '1'));
    await page.goto(path('/'));
    await page.evaluate(() => {
      (window as Window & { __ccoSoft?: number }).__ccoSoft = 1;
    });

    const soft = () => page.evaluate(() => (window as Window & { __ccoSoft?: number }).__ccoSoft ?? 0);

    async function openFilms() {
      await page.locator('.desktop-nav').getByRole('link', { name: 'Über uns', exact: true }).click();
      await page.waitForURL((url) => url.pathname.includes('ueber-uns'));
      await expect(page.getByRole('heading', { name: 'Lern uns kennen' })).toBeVisible();
      expect(await soft(), 'navigation reloaded the page').toBe(1);
    }

    await openFilms();
    await expect(page.getByText('Beim Abspielen wird eine Verbindung zu YouTube (Google) hergestellt').first()).toBeVisible();

    const play = page.getByRole('button', { name: /Video abspielen/ });
    await expect(play).toHaveCount(2);

    await play.nth(0).click();
    await expect(page.locator(`iframe[src*="youtube-nocookie.com/embed/${tiles[0].id}"]`)).toHaveCount(1);
    await play.nth(0).click();
    await expect(page.locator(`iframe[src*="youtube-nocookie.com/embed/${tiles[1].id}"]`)).toHaveCount(1);
    await expect(page.locator('[data-yt] iframe')).toHaveCount(2);

    await page.goBack();
    await page.waitForURL((url) => !url.pathname.includes('ueber-uns'));
    expect(await soft(), 'back navigation reloaded the page').toBe(1);

    await page.goForward();
    await page.waitForURL((url) => url.pathname.includes('ueber-uns'));
    expect(await soft(), 'forward navigation reloaded the page').toBe(1);
    const afterHistory = page.getByRole('button', { name: /Video abspielen/ });
    if ((await afterHistory.count()) > 0) {
      await afterHistory.first().click();
      await expect(page.locator('iframe[src*="youtube-nocookie.com/embed/"]')).toHaveCount(1);
    } else {
      await expect(page.locator('iframe[src*="youtube-nocookie.com/embed/"]')).toHaveCount(2);
    }

    await page.locator('.desktop-nav').getByRole('link', { name: 'Werkstatt', exact: true }).click();
    await page.waitForURL((url) => url.pathname.includes('werkstatt-kundendienst'));
    expect(await soft(), 'workshop navigation reloaded the page').toBe(1);
    await page.getByRole('button', { name: /Video abspielen/ }).click();
    await expect(page.locator(`iframe[src*="youtube-nocookie.com/embed/${tiles[2].id}"]`)).toHaveCount(1);

    await page.goBack();
    await page.waitForURL((url) => url.pathname.includes('ueber-uns'));
    expect(await soft()).toBe(1);
  });
});
