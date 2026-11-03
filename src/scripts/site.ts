import { bindTrackAttributes, track } from '@/lib/analytics';
import { readConsent, writeConsent } from '@/lib/consent';
import { COMPARE_MAX, clearCollection, hasItem, onCollectionChange, readCollection, toggleItem } from '@/lib/collections';
import { initCompanion } from '@/scripts/companion';

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(sel));

/* ---------- toast ---------- */
let toastTimer: number | undefined;
export function toast(message: string): void {
  const el = $('[data-toast]');
  if (!el) return;
  el.textContent = message;
  el.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('is-visible'), 3200);
}

/* ---------- scroll lock (shared by overlays) ---------- */
let lockCount = 0;
export function lockScroll(lock: boolean): void {
  lockCount = Math.max(0, lockCount + (lock ? 1 : -1));
  document.body.classList.toggle('scroll-locked', lockCount > 0);
}

/** Modal <dialog> with scroll lock and focus return to the opener. */
export function openModal(dialog: HTMLDialogElement, opener?: HTMLElement | null): void {
  if (dialog.open) return;
  dialog.showModal();
  lockScroll(true);
  dialog.addEventListener(
    'close',
    () => {
      lockScroll(false);
      opener?.focus({ preventScroll: true });
    },
    { once: true },
  );
}

/* ---------- header ---------- */
let headerChromeBound = false;

function closeHeaderDropdowns(except?: Element): void {
  const header = $('[data-header]');
  if (!header) return;
  for (const dd of $$('[data-dropdown]', header)) {
    if (dd === except) continue;
    $('button', dd)?.setAttribute('aria-expanded', 'false');
    const panel = $('.dropdown', dd);
    if (panel) panel.hidden = true;
  }
}

let headerThemeIo: IntersectionObserver | null = null;

function tagHeaderThemeSections(): void {
  const main = $('#main') ?? document.body;
  $$('.section-sand, .section-paper, .section-forest, .page-hero, .hero, [data-header-theme]', main).forEach((el) => {
    if (el.hasAttribute('data-header-theme')) return;
    if (el.classList.contains('hero')) el.setAttribute('data-header-theme', 'dark');
    else if (el.classList.contains('section-forest')) el.setAttribute('data-header-theme', 'forest');
    else if (el.classList.contains('section-sand')) el.setAttribute('data-header-theme', 'sand');
    else el.setAttribute('data-header-theme', 'light');
  });
}

function initHeaderTheme(): void {
  const header = $('[data-header]');
  if (!header || !('IntersectionObserver' in window)) return;
  tagHeaderThemeSections();
  headerThemeIo?.disconnect();
  const sections = $$('[data-header-theme]');
  if (!sections.length) {
    header.removeAttribute('data-theme');
    return;
  }
  const visible = new Map<Element, number>();
  headerThemeIo = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.set(entry.target, entry.intersectionRatio);
        else visible.delete(entry.target);
      }
      let best: Element | null = null;
      let bestRatio = 0;
      for (const [el, ratio] of visible) {
        if (ratio >= bestRatio) {
          best = el;
          bestRatio = ratio;
        }
      }
      const theme = best?.getAttribute('data-header-theme');
      if (theme) header.setAttribute('data-theme', theme);
      else if (!header.hasAttribute('data-overlay') || header.classList.contains('is-solid')) {
        header.setAttribute('data-theme', 'light');
      } else {
        header.removeAttribute('data-theme');
      }
    },
    {
      /* Probe band just under the sticky header */
      root: null,
      rootMargin: '-12% 0px -70% 0px',
      threshold: [0, 0.15, 0.35, 0.6],
    },
  );
  sections.forEach((el) => headerThemeIo?.observe(el));
}

function initHeader(): void {
  const header = $('[data-header]');
  if (!header) return;

  if (!headerChromeBound) {
    headerChromeBound = true;
    window.addEventListener(
      'scroll',
      () => {
        const h = $('[data-header][data-overlay]');
        if (h) h.classList.toggle('is-solid', window.scrollY > 24);
      },
      { passive: true },
    );
    document.addEventListener('click', (e) => {
      if (!(e.target as Element).closest('[data-dropdown]')) closeHeaderDropdowns();
    });
  }

  const overlay = $('[data-header][data-overlay]');
  if (overlay) overlay.classList.toggle('is-solid', window.scrollY > 24);
  initHeaderTheme();

  if (header.hasAttribute('data-bound')) return;
  header.setAttribute('data-bound', '');

  for (const dd of $$('[data-dropdown]', header)) {
    const btn = $<HTMLButtonElement>('button', dd);
    const panel = $('.dropdown', dd);
    if (!btn || !panel) continue;
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      closeHeaderDropdowns(dd);
      btn.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
    });
    dd.addEventListener('focusout', (e) => {
      if (!dd.contains(e.relatedTarget as Node | null)) {
        btn.setAttribute('aria-expanded', 'false');
        panel.hidden = true;
      }
    });
    dd.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) {
        closeHeaderDropdowns();
        btn.focus();
      }
    });
  }
}

/* ---------- mobile menu ---------- */
let menuMediaBound = false;

function initMenu(): void {
  const dialog = $<HTMLDialogElement>('[data-menu]');
  if (!dialog) return;

  const wireOpeners = () => {
    const openers = $$<HTMLButtonElement>('[data-menu-open]');
    const setExpanded = (v: boolean) => openers.forEach((b) => b.setAttribute('aria-expanded', String(v)));
    openers.forEach((btn) => {
      if (btn.hasAttribute('data-bound')) return;
      btn.setAttribute('data-bound', '');
      btn.addEventListener('click', () => {
        const d = $<HTMLDialogElement>('[data-menu]');
        if (!d) return;
        d.showModal();
        lockScroll(true);
        setExpanded(true);
      });
    });
  };

  wireOpeners();

  if (dialog.hasAttribute('data-bound')) return;
  dialog.setAttribute('data-bound', '');

  const setExpanded = (v: boolean) =>
    $$<HTMLButtonElement>('[data-menu-open]').forEach((b) => b.setAttribute('aria-expanded', String(v)));

  dialog.addEventListener('close', () => {
    lockScroll(false);
    setExpanded(false);
    $$<HTMLButtonElement>('[data-menu-open]')[0]?.focus({ preventScroll: true });
  });

  $$('[data-menu-close]', dialog).forEach((b) => b.addEventListener('click', () => dialog.close()));

  dialog.addEventListener('click', (e) => {
    const link = (e.target as Element).closest('a');
    if (link) {
      const href = link.getAttribute('href') ?? '';
      // same-page anchors: close so the target is visible
      if (href.includes('#') || href === location.pathname) dialog.close();
    }
  });

  if (!menuMediaBound) {
    menuMediaBound = true;
    window.matchMedia('(min-width: 64em)').addEventListener('change', (mq) => {
      const d = $<HTMLDialogElement>('[data-menu]');
      if (mq.matches && d?.open) d.close();
    });
  }
}

/* ---------- on-screen keyboard: hide sticky bars while typing ---------- */
function initKeyboardAwareness(): void {
  const coarse = window.matchMedia('(pointer: coarse)');
  const isField = (el: EventTarget | null) =>
    el instanceof HTMLElement &&
    (el.matches('textarea, select, [contenteditable]') ||
      (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'file', 'range'].includes(el.type)));

  document.addEventListener('focusin', (e) => {
    if (coarse.matches && isField(e.target)) document.body.classList.add('kb-open');
  });
  document.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!isField(document.activeElement)) document.body.classList.remove('kb-open');
    }, 60);
  });
}

/* ---------- consent ---------- */
function initConsent(): void {
  const banner = $('[data-consent-banner]');
  const dialog = $<HTMLDialogElement>('[data-consent-dialog]');
  const form = $<HTMLFormElement>('[data-consent-form]');

  // Boot script may already unhide the banner; keep that, or show if still needed.
  if (banner && !readConsent()) banner.hidden = false;
  else if (banner && readConsent()) banner.hidden = true;

  const decide = (media: boolean, stats: boolean) => {
    writeConsent(media, stats);
    if (banner) banner.hidden = true;
    document.documentElement.classList.add('consent-known');
    document.documentElement.classList.remove('needs-consent');
  };

  $$('[data-consent-action]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const all = btn.dataset.consentAction === 'all';
      decide(all, all);
    }),
  );

  document.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('[data-consent-open]') || !dialog || !form) return;
    const state = readConsent();
    (form.elements.namedItem('media') as HTMLInputElement).checked = !!state?.media;
    (form.elements.namedItem('stats') as HTMLInputElement).checked = !!state?.stats;
    lockScroll(true);
    dialog.showModal();
  });

  dialog?.addEventListener('close', () => {
    lockScroll(false);
    if (!form) return;
    if (dialog.returnValue === 'all') decide(true, true);
    else if (dialog.returnValue === 'necessary') decide(false, false);
    else if (dialog.returnValue === 'save')
      decide(
        (form.elements.namedItem('media') as HTMLInputElement).checked,
        (form.elements.namedItem('stats') as HTMLInputElement).checked,
      );
    dialog.returnValue = '';
  });
}

/* ---------- Merkliste & Vergleich ---------- */
function syncCollections(): void {
  const favs = readCollection('favorites');
  const cmp = readCollection('compare');
  $$('[data-fav-count]').forEach((el) => {
    el.textContent = String(favs.length);
    el.hidden = favs.length === 0;
  });
  $$('[data-compare-count]').forEach((el) => {
    el.textContent = String(cmp.length);
  });
  $$('[data-compare-tray]').forEach((el) => {
    el.hidden = cmp.length === 0;
  });
  $$<HTMLButtonElement>('[data-fav-toggle]').forEach((btn) => {
    const on = hasItem('favorites', btn.dataset.favToggle ?? '');
    btn.setAttribute('aria-pressed', String(on));
    const label = btn.querySelector('[data-label]');
    if (label) label.textContent = on ? 'Gemerkt' : 'Merken';
  });
  $$<HTMLButtonElement>('[data-compare-toggle]').forEach((btn) => {
    const on = hasItem('compare', btn.dataset.compareToggle ?? '');
    btn.setAttribute('aria-pressed', String(on));
    const label = btn.querySelector('[data-label]');
    if (label) label.textContent = on ? 'Im Vergleich' : 'Vergleichen';
  });
}

function initCollections(): void {
  document.addEventListener('click', (e) => {
    const target = e.target as Element;
    const fav = target.closest<HTMLElement>('[data-fav-toggle]');
    if (fav) {
      e.preventDefault();
      const id = fav.dataset.favToggle ?? '';
      const on = toggleItem('favorites', id);
      toast(on ? 'Zur Merkliste hinzugefügt' : 'Von der Merkliste entfernt');
      track('vehicle_favorite', { vehicle_id: id, state: on ? 'add' : 'remove' });
      return;
    }
    const cmp = target.closest<HTMLElement>('[data-compare-toggle]');
    if (cmp) {
      e.preventDefault();
      const id = cmp.dataset.compareToggle ?? '';
      const on = toggleItem('compare', id);
      if (on === null) toast(`Maximal ${COMPARE_MAX} Fahrzeuge im Vergleich – entferne zuerst eines.`);
      else toast(on ? 'Zum Vergleich hinzugefügt' : 'Aus dem Vergleich entfernt');
      if (on !== null) track('vehicle_compare', { vehicle_id: id, state: on ? 'add' : 'remove' });
      return;
    }
    if (target.closest('[data-compare-clear]')) {
      clearCollection('compare');
      toast('Vergleich geleert');
    }
  });
  onCollectionChange(syncCollections);
  syncCollections();
}

/* ---------- reveal on scroll ---------- */
function initReveal(): void {
  const items = $$('.reveal');
  if (!items.length) return;
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  items.forEach((el) => io.observe(el));
}

/** Recompute open/closed from Europe/Berlin (boot script); never reuse stale SSR/VT text. */
function refreshOpenStatus(): void {
  const refresh = (window as Window & { __ccoRefreshOpen?: () => void }).__ccoRefreshOpen;
  if (typeof refresh === 'function') refresh();
  else window.dispatchEvent(new Event('cco:refresh-open'));
}

/** Hours pill opens the sheet. Status text is painted by the boot script. */
function initOpeningSheet(): void {
  $$<HTMLElement>('[data-opening-status]').forEach((root) => {
    if (root.hasAttribute('data-bound')) return;
    root.setAttribute('data-bound', '');
    const sheet = root.querySelector<HTMLDialogElement>('[data-oh-sheet]');
    const opener = root.querySelector<HTMLButtonElement>('[data-oh-open]');
    if (!sheet || !opener) return;
    const setExpanded = (open: boolean) => opener.setAttribute('aria-expanded', String(open));
    opener.addEventListener('click', () => {
      refreshOpenStatus();
      openModal(sheet, opener);
      setExpanded(true);
    });
    root.querySelector('[data-oh-close]')?.addEventListener('click', () => sheet.close());
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) sheet.close();
    });
    sheet.addEventListener('close', () => setExpanded(false));
  });
}

const SATURDAY_NOTICE_KEY = 'cco:saturday-notice';
let saturdayNoticeTimer: number | undefined;
let saturdayNoticeOpener: HTMLElement | null = null;

function saturdayNoticeSeen(): boolean {
  try {
    return localStorage.getItem(SATURDAY_NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSaturdayNotice(): void {
  try {
    localStorage.setItem(SATURDAY_NOTICE_KEY, '1');
  } catch {
    /* Private mode still lets the visitor close the notice for this view. */
  }
}

function initSaturdayNotice(): void {
  window.clearTimeout(saturdayNoticeTimer);
  const dialog = $<HTMLDialogElement>('[data-saturday-notice]');
  if (!dialog) return;
  if (dialog.dataset.bound !== '1') {
    dialog.dataset.bound = '1';
    dialog.addEventListener('close', () => {
      lockScroll(false);
      rememberSaturdayNotice();
      const back = saturdayNoticeOpener;
      saturdayNoticeOpener = null;
      if (back && document.contains(back)) back.focus({ preventScroll: true });
      else document.getElementById('main')?.focus({ preventScroll: true });
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    $$('[data-saturday-dismiss]', dialog).forEach((button) => {
      button.addEventListener('click', () => dialog.close());
    });
  }
  if (saturdayNoticeSeen() || dialog.open) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  saturdayNoticeTimer = window.setTimeout(() => {
    if (saturdayNoticeSeen() || dialog.open) return;
    const active = document.activeElement;
    saturdayNoticeOpener = active instanceof HTMLElement && active !== document.body ? active : null;
    dialog.showModal();
    lockScroll(true);
  }, reduce ? 180 : 650);
}

function bootPageUi(): void {
  initHeader();
  initMenu();
  initReveal();
  initOpeningSheet();
  initSaturdayNotice();
  initHeaderTheme();
  initCompanion();
  refreshOpenStatus();
  const html = document.documentElement;
  const n = html.dataset.ccoFavCount;
  if (n) {
    $$('[data-fav-count]').forEach((el) => {
      if (el === html || el === document.documentElement) return;
      el.textContent = n;
      (el as HTMLElement).hidden = false;
    });
  }
}

initKeyboardAwareness();
initConsent();
initCollections();
bindTrackAttributes();
bootPageUi();
document.addEventListener('astro:page-load', bootPageUi);
document.addEventListener('astro:after-swap', () => {
  refreshOpenStatus();
  initCompanion();
});
