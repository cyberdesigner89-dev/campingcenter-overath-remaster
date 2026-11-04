/**
 * CampingCompanion module controller — enhances the inline boot controller.
 *
 * Root causes addressed:
 * 1) Deferred modules arrive after first paint → first clicks were lost until refresh.
 *    Fix: boot-script owns open/close; this module enhances tabs/AI/size + self-heals.
 * 2) ClientRouter + transition:persist + Astro scoped CSS hash mismatch let closed
 *    ChatWidget regain pointer-events and steal FAB hits.
 *    Fix: global CSS + healChatOverlays + ChatWidget removed from layout.
 */
import { track } from '@/lib/analytics';
import type { CampingAssistResult } from '@/lib/camping-assist';
import { url } from '@/lib/url';

const API = (import.meta.env.PUBLIC_API_BASE as string | undefined)?.replace(/\/$/, '') || '';
const SIZE_KEY = 'cco:companion-size';
const THINK_MS = 700;
const MSG_SHORT =
  'Schreib bitte etwas genauer – z. B. „Challenger 240“, „mieten“ oder „Öffnungszeiten“.';
const THINK_LABEL = 'Camping-KI denkt';
const AI_UNAVAILABLE =
  'Der KI-Assistent ist momentan nicht erreichbar. Bitte versuche es später erneut. Barrierefreiheit und Kontakt bleiben verfügbar.';

type AssistFn = (message: string) => CampingAssistResult;
let assistCampingLazy: AssistFn | null = null;
let assistLoad: Promise<AssistFn> | null = null;
let enhancementWired = false;
let healObserver: MutationObserver | null = null;
let recoverCount = 0;
const MAX_RECOVER = 3;

function debugEnabled() {
  try {
    return localStorage.getItem('cco:debug-companion') === '1';
  } catch {
    return false;
  }
}

function log(...args: unknown[]) {
  if (!debugEnabled()) return;
  try {
    console.info('[cco-companion]', ...args);
  } catch {
    /* ignore */
  }
}

function loadAssist(): Promise<AssistFn> {
  if (assistCampingLazy) return Promise.resolve(assistCampingLazy);
  if (!assistLoad) {
    assistLoad = import('@/lib/camping-assist')
      .then((m) => {
        assistCampingLazy = m.assistCamping;
        return m.assistCamping;
      })
      .catch(() => {
        const fallback: AssistFn = () => ({
          title: 'Momentan nicht erreichbar',
          summary: AI_UNAVAILABLE,
          provider: 'rules',
          offTopic: false,
        });
        assistCampingLazy = fallback;
        return fallback;
      });
  }
  return assistLoad;
}

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderResult(data: CampingAssistResult): string {
  const bullets = data.bullets?.length
    ? `<ul class="companion-chat-points">${data.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
    : '';
  const href = data.ctaHref ? (data.ctaHref.startsWith('http') ? data.ctaHref : url(data.ctaHref)) : '';
  const cta =
    data.ctaLabel && href
      ? `<span class="companion-chat-actions"><a href="${href}">${escapeHtml(data.ctaLabel)}</a></span>`
      : '';
  const disclaimer = data.disclaimer
    ? `<span class="companion-chat-disclaimer">${escapeHtml(data.disclaimer)}</span>`
    : '';
  return `<span class="companion-chat-title">${escapeHtml(data.title)}</span><p>${escapeHtml(data.summary)}</p>${bullets}${disclaimer}${cta}`;
}

function thinkingHtml() {
  return `<span class="companion-chat-thinking" aria-live="polite"><span>${THINK_LABEL}</span><span class="companion-chat-dots" aria-hidden="true"><span></span><span></span><span></span></span></span>`;
}

function wait(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms));
}

function prefersReducedMotion() {
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.classList.contains('a11y-reduce-motion')
  );
}

export function uniqueRoot(): HTMLElement | null {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-companion]'));
  if (!roots.length) return null;
  for (let i = 1; i < roots.length; i++) roots[i]?.remove();
  return roots[0] ?? null;
}

export function healChatOverlays(): void {
  document.querySelectorAll<HTMLElement>('[data-chat-widget]').forEach((chat) => {
    if (!chat.classList.contains('is-open')) {
      chat.setAttribute('data-closed', '');
      chat.style.pointerEvents = 'none';
      chat.style.visibility = 'hidden';
    } else {
      chat.removeAttribute('data-closed');
      chat.style.pointerEvents = '';
      chat.style.visibility = '';
    }
  });
  const w = window as Window & { __ccoCompanionHeal?: () => void };
  try {
    w.__ccoCompanionHeal?.();
  } catch {
    /* ignore */
  }
}

function setSize(root: HTMLElement, size: string) {
  const allowed = ['sm', 'md', 'lg'];
  const next = allowed.includes(size) ? size : 'md';
  root.dataset.size = next;
  root.querySelectorAll<HTMLButtonElement>('[data-companion-size]').forEach((b) => {
    const on = b.dataset.companionSize === next;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  try {
    localStorage.setItem(SIZE_KEY, next);
  } catch {
    /* ignore */
  }
}

function setTab(root: HTMLElement, name: string) {
  const tabName = name === 'chat' || name === 'contact' || name === 'a11y' ? name : 'a11y';
  root.querySelectorAll<HTMLButtonElement>('[data-companion-tab]').forEach((t) => {
    const on = t.dataset.companionTab === tabName;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
  root.querySelectorAll<HTMLElement>('[data-companion-view]').forEach((v) => {
    const on = v.dataset.companionView === tabName;
    v.hidden = !on;
    v.classList.toggle('is-active', on);
  });
  if (tabName === 'a11y') window.dispatchEvent(new CustomEvent('cco:a11y-sync'));
  if (tabName === 'chat') {
    void loadAssist();
    window.dispatchEvent(new CustomEvent('cco:chat-opened'));
    root.querySelector<HTMLTextAreaElement>('[data-companion-chat-input]')?.focus({ preventScroll: true });
    scrollChat(root);
  }
}

/** Panel open is independent of AI backend readiness. */
export function setOpen(root: HTMLElement, open: boolean, tab?: string): boolean {
  const panel = root.querySelector<HTMLDialogElement>('[data-companion-panel]');
  const openBtn = root.querySelector<HTMLButtonElement>('[data-companion-open]');
  if (!panel || !openBtn) return false;

  healChatOverlays();
  openBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    if (!panel.open) {
      try {
        panel.showModal();
      } catch {
        panel.setAttribute('open', '');
      }
    }
    document.body.classList.add('companion-open');
    const opened = tab || 'a11y';
    setTab(root, opened);
    // Chat keeps the caret in the composer. Other tabs land on the tab itself.
    if (opened !== 'chat') {
      const focusTarget =
        root.querySelector<HTMLElement>('.companion-tab.is-active') ||
        root.querySelector<HTMLElement>('[data-companion-close]');
      focusTarget?.focus({ preventScroll: true });
    }
  } else if (panel.open) {
    panel.close();
  } else {
    panel.removeAttribute('open');
    document.body.classList.remove('companion-open');
  }
  return open ? panel.open || panel.hasAttribute('open') : !panel.open;
}

function scrollChat(root: HTMLElement) {
  const chatBody = root.querySelector<HTMLElement>('[data-companion-chat-body]');
  if (!chatBody) return;
  requestAnimationFrame(() => {
    chatBody.scrollTop = chatBody.scrollHeight;
  });
}

function markLatest(root: HTMLElement, el: HTMLElement) {
  const chatBody = root.querySelector<HTMLElement>('[data-companion-chat-body]');
  chatBody?.querySelectorAll('.is-latest').forEach((n) => n.classList.remove('is-latest'));
  el.classList.add('is-latest');
  scrollChat(root);
}

function appendMsg(root: HTMLElement, text: string, who: 'bot' | 'user', asHtml = false) {
  const chatBody = root.querySelector<HTMLElement>('[data-companion-chat-body]');
  const chatAnchor = root.querySelector<HTMLElement>('[data-companion-chat-anchor]');
  if (!chatBody) return null;
  const el = document.createElement('div');
  el.className = `companion-chat-msg companion-chat-msg-${who}`;
  el.dataset.companionChatMsg = '';
  if (asHtml) el.innerHTML = text;
  else el.textContent = text;
  if (chatAnchor) chatBody.insertBefore(el, chatAnchor);
  else chatBody.appendChild(el);
  markLatest(root, el);
  return el;
}

async function ask(message: string): Promise<CampingAssistResult> {
  let data: CampingAssistResult;
  try {
    const assistCamping = await loadAssist();
    data = assistCamping(message);
  } catch {
    return {
      title: 'Nicht erreichbar',
      summary: AI_UNAVAILABLE,
      provider: 'rules',
      offTopic: false,
    };
  }
  try {
    if (API) {
      const res = await fetch(`${API}/api/camping-assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, lang: 'de' }),
      });
      if (res.ok) data = (await res.json()) as CampingAssistResult;
    }
  } catch {
    /* keep local rules / offline fallback */
  }
  return data;
}

function autosize(ta: HTMLTextAreaElement) {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
}

async function runChat(root: HTMLElement, message: string) {
  const cleaned = message.trim();
  const chatInput = root.querySelector<HTMLTextAreaElement>('[data-companion-chat-input]');
  const chatChips = root.querySelector<HTMLElement>('[data-companion-chat-chips]');
  if (cleaned.length < 2) return;
  if (cleaned.length < 4) {
    appendMsg(root, MSG_SHORT, 'bot');
    return;
  }
  chatChips?.setAttribute('hidden', '');
  appendMsg(root, cleaned, 'user');
  if (chatInput) {
    chatInput.value = '';
    autosize(chatInput);
  }
  track('camping_assistant_start', { source: 'companion' });

  const thinking = appendMsg(root, thinkingHtml(), 'bot', true);
  thinking?.classList.add('is-thinking');
  const started = Date.now();
  const data = await ask(cleaned);
  const left = THINK_MS - (Date.now() - started);
  if (left > 0) await wait(left);

  if (thinking) {
    thinking.classList.remove('is-thinking');
    thinking.innerHTML = renderResult(data);
    markLatest(root, thinking);
  }
  track('camping_assistant_complete', { provider: data.provider, off_topic: data.offTopic ? 1 : 0 });
}

function nudgeFab(openBtn: HTMLElement) {
  if (prefersReducedMotion()) return;
  openBtn.classList.remove('is-nudging');
  void openBtn.offsetWidth;
  openBtn.classList.add('is-nudging');
  window.setTimeout(() => openBtn.classList.remove('is-nudging'), 480);
}

function syncPersistedUi(root: HTMLElement) {
  const panel = root.querySelector<HTMLDialogElement>('[data-companion-panel]');
  const openBtn = root.querySelector<HTMLButtonElement>('[data-companion-open]');
  if (panel && !panel.dataset.closeBound) {
    panel.dataset.closeBound = '1';
    panel.addEventListener('close', () => {
      openBtn?.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('companion-open');
      openBtn?.focus({ preventScroll: true });
    });
  }

  try {
    const saved = localStorage.getItem(SIZE_KEY);
    if (saved) setSize(root, saved);
  } catch {
    /* ignore */
  }

  healChatOverlays();
}

function enhancedSetOpen(open: boolean, tab?: string): boolean {
  const root = uniqueRoot();
  if (!root) {
    recover('enhanced-setOpen-missing-root');
    const again = uniqueRoot();
    if (!again) return false;
    return setOpen(again, open, tab);
  }
  const ok = setOpen(root, open, tab);
  if (open && !ok) {
    recover('enhanced-open-failed');
    return setOpen(uniqueRoot() || root, true, tab);
  }
  return ok;
}

function wireEnhancements() {
  if (enhancementWired) return;
  enhancementWired = true;

  /* Boot owns FAB open/close. Module handles size/tabs/chat/keyboard only. */
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target as Element | null;
      if (!t?.closest) return;
      /* Skip FAB — boot capture handler owns it (prevents double-toggle). */
      if (t.closest('[data-companion-open]')) {
        const btn = t.closest<HTMLElement>('[data-companion-open]');
        if (btn) nudgeFab(btn);
        return;
      }

      const root = t.closest<HTMLElement>('[data-companion]');
      if (!root) return;

      const sizeBtn = t.closest<HTMLButtonElement>('[data-companion-size]');
      if (sizeBtn) {
        e.preventDefault();
        setSize(root, sizeBtn.dataset.companionSize || 'md');
        return;
      }

      const tabBtn = t.closest<HTMLButtonElement>('[data-companion-tab]');
      if (tabBtn) {
        e.preventDefault();
        setTab(root, tabBtn.dataset.companionTab || 'a11y');
        return;
      }

      const chip = t.closest<HTMLButtonElement>('[data-companion-chat-chip]');
      if (chip) {
        e.preventDefault();
        void runChat(root, chip.dataset.text || chip.textContent || '');
      }
    },
    true,
  );

  document.addEventListener('submit', (e) => {
    const form = (e.target as Element)?.closest?.('[data-companion-chat-form]');
    if (!form) return;
    const root = form.closest<HTMLElement>('[data-companion]');
    if (!root) return;
    e.preventDefault();
    const input = root.querySelector<HTMLTextAreaElement>('[data-companion-chat-input]');
    void runChat(root, input?.value || '');
  });

  document.addEventListener('input', (e) => {
    const ta = e.target as HTMLTextAreaElement;
    if (ta?.matches?.('[data-companion-chat-input]')) autosize(ta);
  });

  document.addEventListener('keydown', (e) => {
    const ta = e.target as HTMLTextAreaElement;
    if (ta?.matches?.('[data-companion-chat-input]') && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const root = ta.closest<HTMLElement>('[data-companion]');
      if (root) void runChat(root, ta.value);
      return;
    }

    const tab = (e.target as Element)?.closest?.<HTMLButtonElement>('[data-companion-tab]');
    if (!tab) return;
    const root = tab.closest<HTMLElement>('[data-companion]');
    if (!root) return;
    const order = ['a11y', 'chat', 'contact'];
    const i = order.indexOf(tab.dataset.companionTab || 'a11y');
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = order[(i + dir + order.length) % order.length] || 'a11y';
      setTab(root, next);
      root.querySelector<HTMLButtonElement>(`[data-companion-tab="${next}"]`)?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setTab(root, 'a11y');
      root.querySelector<HTMLButtonElement>('[data-companion-tab="a11y"]')?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      setTab(root, 'contact');
      root.querySelector<HTMLButtonElement>('[data-companion-tab="contact"]')?.focus();
    }
  });

  window.addEventListener('cco:open-companion', ((ev: CustomEvent<{ view?: string; tab?: string }>) => {
    const tab = ev.detail?.tab || ev.detail?.view || 'a11y';
    enhancedSetOpen(true, tab === 'hub' ? 'a11y' : tab);
  }) as EventListener);

  window.addEventListener('cco:open-chat', () => {
    enhancedSetOpen(true, 'chat');
  });

  window.addEventListener('cco:companion-toggle', ((ev: CustomEvent<{ open?: boolean; tab?: string | null }>) => {
    const root = uniqueRoot();
    if (!root || !ev.detail?.open) return;
    /* Sync a11y prefs / default tab after boot opened the dialog. */
    setTab(root, ev.detail.tab || 'a11y');
  }) as EventListener);

  log('enhancements wired');
}

function watchDom() {
  if (healObserver || typeof MutationObserver === 'undefined') return;
  let queued = false;
  healObserver = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const roots = document.querySelectorAll('[data-companion]');
      if (roots.length !== 1) {
        uniqueRoot();
        recover('dom-root-count');
      }
      healChatOverlays();
    });
  });
  healObserver.observe(document.body, { childList: true, subtree: false });
}

export function recover(reason: string): boolean {
  if (recoverCount >= MAX_RECOVER) {
    log('recover exhausted', reason);
    return false;
  }
  recoverCount += 1;
  log('recover', recoverCount, reason);
  healChatOverlays();
  uniqueRoot();
  const root = uniqueRoot();
  if (root) syncPersistedUi(root);
  return true;
}

/** Call on every astro:page-load / after-swap / boot. */
export function initCompanion(): void {
  try {
    wireEnhancements();
    const w = window as Window & {
      __ccoCompanionSetOpen?: (open: boolean, tab?: string) => boolean;
      __ccoInitCompanion?: () => void;
    };
    /* Module becomes the authoritative setOpen implementation once loaded. */
    w.__ccoCompanionSetOpen = enhancedSetOpen;
    w.__ccoInitCompanion = initCompanion;

    healChatOverlays();
    const root = uniqueRoot();
    if (!root) {
      recover('init-missing-root');
      log('init: no root yet');
      return;
    }
    syncPersistedUi(root);
    watchDom();
    recoverCount = 0;
    log('init ok', location.pathname);
  } catch (err) {
    log('init error', err);
    recover('init-throw');
  }
}
