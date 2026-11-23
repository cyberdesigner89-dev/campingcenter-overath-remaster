import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('CampingCompanion support center', () => {
  it('ships a single accessibility launcher and compact panel', () => {
    const companion = readFileSync(join(root, 'src/components/layout/CampingCompanion.astro'), 'utf8');
    const chat = readFileSync(join(root, 'src/components/layout/ChatWidget.astro'), 'utf8');
    const a11y = readFileSync(join(root, 'src/components/layout/AccessibilityPrefs.astro'), 'utf8');
    const layout = readFileSync(join(root, 'src/layouts/BaseLayout.astro'), 'utf8');

    expect(companion).toContain('data-companion');
    expect(companion).toContain('companion-fab');
    expect(companion).toContain('UniversalAccessIcon');
    expect(companion).not.toContain('companion-fab-compass');
    expect(companion).not.toContain('companion-fab-needle');
    expect(companion).toContain('Hilfe, Camping-KI und Barrierefreiheit öffnen');
    expect(companion).toContain('Hilfe & Barrierefreiheit');
    expect(companion).toContain('Wir helfen dir gerne weiter.');
    expect(companion).toContain('Camping-KI');
    expect(companion).toContain('data-companion-tab="a11y"');
    expect(companion).toContain('data-companion-tab="chat"');
    expect(companion).toContain('data-companion-tab="contact"');
    expect(companion).toContain('companion-tab-a11y-svg');
    expect(companion).not.toContain('#1a73e8');
    const accessIcon = readFileSync(join(root, 'src/components/ui/UniversalAccessIcon.astro'), 'utf8');
    expect(accessIcon).toContain('aria-hidden="true"');
    expect(accessIcon).toContain('#3b499f');
    expect(accessIcon).toContain('stroke-linecap="round"');
    expect(accessIcon).toContain('universal-access-icon');
    expect(companion).toContain("import { initCompanion } from '@/scripts/companion'");
    expect(companion).toContain("astro:page-load");
    expect(companion).toContain("astro:after-swap");
    expect(companion).not.toContain('Premium Kompass');
    expect(companion).not.toContain('Minimalist motorhome');
    expect(companion).not.toMatch(/<rect x="4" y="18" width="28"/);
    expect(companion).not.toContain('data-companion-action="lang"');
    expect(companion).not.toContain('companion-lang-');
    expect(companion).toContain('data-companion-size="sm"');
    expect(companion).toContain('data-companion-size="md"');
    expect(companion).toContain('data-companion-size="lg"');
    expect(companion).toContain('KLEIN');
    expect(companion).toContain('MITTEL');
    expect(companion).toContain('GROSS');
    expect(companion).toContain('min(360px, calc(100vw - 24px))');
    expect(companion).toContain('min(480px, calc(100dvh - 100px))');
    expect(companion).toContain('left: 50%');
    expect(companion).toContain('Jetzt anrufen');
    expect(companion).toContain('Nachricht schreiben');
    expect(companion).toContain('Route planen');
    expect(companion).toContain('company.directions');
    expect(companion).toContain('AccessibilityPrefs');

    const controller = readFileSync(join(root, 'src/scripts/companion.ts'), 'utf8');
    expect(controller).toContain('wireEnhancements');
    expect(controller).toContain("'click'");
    expect(controller).toContain('uniqueRoot');
    expect(controller).toContain('AI_UNAVAILABLE');
    expect(controller).toContain('export function initCompanion');
    expect(controller).toContain('healChatOverlays');
    expect(controller).toContain('recover');
    expect(controller).toContain('__ccoCompanionSetOpen');

    const globalCss = readFileSync(join(root, 'src/styles/global.css'), 'utf8');
    expect(globalCss).toContain('[data-chat-widget].chatw:not(.is-open)');
    expect(globalCss).toContain('pointer-events: none !important');
    expect(globalCss).toContain('.companion[data-companion]');
    expect(globalCss).toContain('.companion[data-companion] .companion-sheet');
    expect(globalCss).toContain('--z-companion: 80');

    expect(chat).not.toContain('chatw-fab');
    expect(chat).toContain('cco:open-companion');
    expect(chat).toMatch(/\.chatw:not\(\.is-open\)[\s\S]*pointer-events:\s*none/);
    expect(a11y).not.toContain('a11y-fab');
    expect(a11y).toContain('data-a11y');
    expect(a11y).toContain('Sehr groß');
    expect(a11y).toContain('data-a11y-font="xl"');
    expect(a11y).toContain('Tastatur-Fokus');
    expect(a11y).toContain('a11y-focus-strong');
    expect(a11y).toContain('Einstellungen zurücksetzen');

    expect(layout).toContain('CampingCompanion');
    expect(layout).not.toContain("import ChatWidget");
    expect(layout).not.toMatch(/<ChatWidget/);
    expect(layout).toContain('transition:persist="cco-companion"');
    expect(layout).not.toContain('transition:persist="cco-chat"');
    expect(layout).toMatch(/lang="de"/);
  });

  it('keeps boot-before-paint a11y key without locale redirects', () => {
    const boot = readFileSync(join(root, 'src/lib/boot-script.ts'), 'utf8');
    expect(boot).toContain('cco:a11y');
    expect(boot).toContain('ccoFavCount');
    expect(boot).toContain('a11y-font-xl');
    expect(boot).toContain('a11y-focus-strong');
    expect(boot).toContain('__ccoCompanionSetOpen');
    expect(boot).toContain('__ccoCompanionBoot');
    expect(boot).toContain('data-companion-open');
    expect(boot).toContain('showModal');
    expect(boot).not.toContain('cco:lang');
    expect(boot).not.toContain('enRoutes');
  });

  it('boot opening labels stay German', () => {
    const boot = readFileSync(join(root, 'src/lib/boot-script.ts'), 'utf8');
    expect(boot).toContain('Aktuell geschlossen');
    expect(boot).toContain('Heute geöffnet');
    expect(boot).toContain('Feiertag');
    expect(boot).not.toContain('Currently closed');
  });

  it('boot refreshes opening status live (not one-shot SSR text)', () => {
    const boot = readFileSync(join(root, 'src/lib/boot-script.ts'), 'utf8');
    const site = readFileSync(join(root, 'src/scripts/site.ts'), 'utf8');
    expect(boot).toContain('__ccoRefreshOpen');
    expect(boot).toContain('cco:refresh-open');
    expect(boot).toContain('data-oh-banner-title');
    expect(boot).toContain('visibilitychange');
    expect(site).toContain('refreshOpenStatus');
    expect(site).toContain('astro:after-swap');
  });

  it('chat lazy-loads assist rules (companion + widget)', () => {
    const companionUi = readFileSync(join(root, 'src/components/layout/CampingCompanion.astro'), 'utf8');
    const companion = readFileSync(join(root, 'src/scripts/companion.ts'), 'utf8');
    const chat = readFileSync(join(root, 'src/components/layout/ChatWidget.astro'), 'utf8');
    expect(companionUi).toContain('CAMPING_QUICK_PROMPTS');
    expect(companion).toContain("import('@/lib/camping-assist')");
    expect(companion).toContain('loadAssist');
    expect(chat).toContain("import('@/lib/camping-assist')");
    expect(chat).toContain('loadAssist');
    expect(chat).toContain('CAMPING_QUICK_PROMPTS');
  });
});
