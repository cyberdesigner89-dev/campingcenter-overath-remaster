import { test, expect, type Page } from '@playwright/test';

const base = process.env.BASE_PATH || '/';

function path(p: string) {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${b}${p.startsWith('/') ? p : `/${p}`}`;
}

/** Viewport widths from the Final QA brief (320–1920). */
const VIEWPORTS = [320, 344, 360, 375, 390, 393, 412, 430, 480, 600, 768, 1024, 1280, 1440, 1920] as const;

type Geom = {
  ok: boolean;
  reason?: string;
  vw: number;
  label: string;
  overflowRight: number;
  overflowLeft: number;
  overflowTop: number;
  overflowBottom: number;
  pageOverflow: number;
};

async function measurePill(page: Page): Promise<Geom> {
  return page.evaluate(() => {
    const pill = document.querySelector<HTMLElement>('[data-oh-open]');
    if (!pill) return { ok: false, reason: 'missing pill', vw: innerWidth, label: '', overflowRight: 0, overflowLeft: 0, overflowTop: 0, overflowBottom: 0, pageOverflow: 0 };

    const visibleLine =
      [...pill.querySelectorAll<HTMLElement>('.oh-line')].find((el) => getComputedStyle(el).display !== 'none') ||
      pill.querySelector<HTMLElement>('[data-oh-line-full]');
    if (!visibleLine) {
      return { ok: false, reason: 'missing line', vw: innerWidth, label: '', overflowRight: 0, overflowLeft: 0, overflowTop: 0, overflowBottom: 0, pageOverflow: 0 };
    }

    const pr = pill.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(visibleLine);
    const tr = range.getBoundingClientRect();
    const tol = 1.25; // subpixel / antialias slack

    return {
      ok: true,
      vw: innerWidth,
      label: (visibleLine.textContent || '').trim(),
      overflowRight: Math.max(0, tr.right - pr.right - tol),
      overflowLeft: Math.max(0, pr.left - tr.left - tol),
      overflowTop: Math.max(0, pr.top - tr.top - tol),
      overflowBottom: Math.max(0, tr.bottom - pr.bottom - tol),
      pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth - 1),
    };
  });
}

test.describe('Opening-hours badge geometry', () => {
  for (const width of VIEWPORTS) {
    test(`pill contains status text @ ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 720 : 900 });
      await page.goto(path('/'));
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-oh-open]');
        return Boolean(el && el.getAttribute('data-state') && el.getAttribute('data-state') !== 'pending');
      });

      const geom = await measurePill(page);
      expect(geom.ok, geom.reason).toBe(true);
      expect(geom.label.length, 'empty pill label').toBeGreaterThan(2);
      expect(geom.overflowRight, `right overflow @${width}: "${geom.label}"`).toBe(0);
      expect(geom.overflowLeft, `left overflow @${width}`).toBe(0);
      expect(geom.overflowTop, `top overflow @${width}`).toBe(0);
      expect(geom.overflowBottom, `bottom overflow @${width}`).toBe(0);
      // Page scroll can come from unrelated rails; assert header chrome stays in-bounds instead.
      const headerOverflow = await page.evaluate(() => {
        const header = document.querySelector('.site-header');
        if (!header) return 0;
        const r = header.getBoundingClientRect();
        return Math.max(0, r.right - innerWidth - 1, -r.left - 1);
      });
      expect(headerOverflow, `header overflow @${width}`).toBe(0);

      // Responsive copy bands
      if (width < 360) {
        expect(geom.label).not.toMatch(/^Heute geöffnet/);
      } else if (width < 1440) {
        // Utility-row / mobile short form when open
        if (/geöffnet/i.test(geom.label) && !/geschlossen/i.test(geom.label)) {
          expect(geom.label).toMatch(/^Geöffnet bis |^Bis .+ geöffnet$|^Geöffnet$/);
        }
      } else if (/geöffnet/i.test(geom.label) && !/geschlossen/i.test(geom.label)) {
        expect(geom.label).toMatch(/^Heute geöffnet bis /);
      }
    });
  }

  test('hours sheet shows the permanent Saturday closure', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cco:saturday-notice', '1'));
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(path('/'));
    await page.locator('[data-oh-open]').click();
    const sheet = page.locator('#oh-sheet');
    await expect(sheet).toBeVisible();
    const note = sheet.locator('.oh-saturday-banner');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Samstags dauerhaft geschlossen');
    await expect(note).toContainText('Ab sofort bleibt das Campingcenter jeden Samstag geschlossen');
    await expect(sheet.locator('.is-saturday')).toContainText('dauerhaft geschlossen');
    await expect(sheet.locator('#oh-saturday-title')).toHaveAttribute('id', 'oh-saturday-title');
    const described = await sheet.getAttribute('aria-describedby');
    expect(described).toBe('oh-saturday-title');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const dialog = document.querySelector('#oh-sheet');
      return !!dialog && dialog.contains(document.activeElement);
    });
    expect(inside).toBeTruthy();
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/saturday-hours-390.png' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/saturday-hours-1280.png' });
  });

  test('forced long open label still fits at 1440 after layout fix', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path('/'));
    await page.waitForSelector('[data-oh-open]');
    await page.evaluate(() => {
      document.querySelectorAll('[data-oh-line-full]').forEach((el) => {
        el.textContent = 'Heute geöffnet bis 18 Uhr';
      });
      document.querySelectorAll('[data-oh-line-short]').forEach((el) => {
        el.textContent = 'Geöffnet bis 18 Uhr';
      });
      document.querySelectorAll('[data-oh-line-compact]').forEach((el) => {
        el.textContent = 'Bis 18 Uhr geöffnet';
      });
      const btn = document.querySelector<HTMLElement>('[data-oh-open]');
      if (btn) {
        btn.dataset.state = 'open';
        btn.dataset.reason = 'hours';
      }
    });
    const geom = await measurePill(page);
    expect(geom.overflowRight, `forced 18 Uhr overflow: ${JSON.stringify(geom)}`).toBe(0);
    expect(geom.label).toBe('Heute geöffnet bis 18 Uhr');
  });
});
