import { applyConditions, validateScope } from '@/scripts/forms';
import { track } from '@/lib/analytics';

/**
 * Multi-step form on top of a regular `form[data-form]`: one step per screen, validation per step,
 * browser back button support and a session draft so nothing gets lost on reload.
 * The final submit is handled by forms.ts.
 */

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const form = document.querySelector<HTMLFormElement>('form[data-wizard]');

if (form) {
  const steps = Array.from(form.querySelectorAll<HTMLFieldSetElement>('[data-wz-step]'));
  const last = steps.length - 1;
  const current = form.querySelector('[data-wz-current]');
  const name = form.querySelector('[data-wz-name]');
  const bar = form.querySelector<HTMLElement>('[data-wz-bar]');
  const back = form.querySelector<HTMLButtonElement>('[data-wz-back]');
  const nextLabel = form.querySelector('.wz-next [data-submit-label]');
  const titles = steps.map((s) => s.dataset.wzTitle ?? s.querySelector('legend')?.textContent?.trim() ?? '');
  const DRAFT_KEY = `cco:draft:${form.dataset.form ?? 'wizard'}`;
  let step = 0;

  /* ---------- draft ---------- */
  const saveDraft = () => {
    const data: Record<string, string | string[]> = {};
    form.querySelectorAll<Control>('input, select, textarea').forEach((c) => {
      if (!c.name || c.type === 'file' || c.name === 'datenschutz' || c.closest('.hp-field')) return;
      if (c instanceof HTMLInputElement && (c.type === 'checkbox' || c.type === 'radio')) {
        if (!c.checked) return;
        if (c.type === 'checkbox') ((data[c.name] ??= []) as string[]).push(c.value);
        else data[c.name] = c.value;
      } else if (c.value) data[c.name] = c.value;
    });
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step, data }));
    } catch {
      /* private mode */
    }
  };

  const restoreDraft = (): number => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return 0;
      const { step: s, data } = JSON.parse(raw) as { step: number; data: Record<string, string | string[]> };
      form.querySelectorAll<Control>('input, select, textarea').forEach((c) => {
        const v = data[c.name];
        if (v === undefined || c.type === 'file') return;
        if (c instanceof HTMLInputElement && (c.type === 'checkbox' || c.type === 'radio')) {
          c.checked = Array.isArray(v) ? v.includes(c.value) : v === c.value;
        } else c.value = Array.isArray(v) ? v.join(', ') : v;
      });
      return Math.min(Math.max(0, s), last);
    } catch {
      return 0;
    }
  };

  /* ---------- navigation ---------- */
  const show = (i: number, { focus = true, push = true } = {}) => {
    step = i;
    steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
    if (current) current.textContent = String(i + 1);
    if (name) name.textContent = titles[i] ?? '';
    if (bar) bar.style.width = `${((i + 1) / steps.length) * 100}%`;
    if (back) back.hidden = i === 0;
    if (nextLabel) nextLabel.textContent = i === last ? 'Angebot anfordern' : 'Weiter';
    if (push) history.pushState({ wizardStep: i }, '', `#schritt-${i + 1}`);
    if (focus) {
      const legend = steps[i]?.querySelector<HTMLElement>('legend');
      legend?.setAttribute('tabindex', '-1');
      legend?.focus({ preventScroll: true });
      steps[i]?.scrollIntoView({ block: 'start' });
    }
    saveDraft();
    track('ankauf_step', { step: i + 1, name: titles[i] });
  };

  const validateStep = (i: number): boolean => {
    const invalid = validateScope(steps[i] as HTMLElement);
    if (!invalid.length) return true;
    const first = invalid[0] as Control;
    first.scrollIntoView({ block: 'center' });
    first.focus({ preventScroll: true });
    return false;
  };

  // Runs before forms.ts (capture on target) so intermediate steps never submit.
  form.addEventListener(
    'submit',
    (e) => {
      if (step === last) {
        if (!validateStep(step)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (validateStep(step)) show(step + 1);
    },
    true,
  );

  back?.addEventListener('click', () => {
    if (history.state?.wizardStep !== undefined && step > 0) history.back();
    else show(Math.max(0, step - 1));
  });

  window.addEventListener('popstate', (e) => {
    const fromState = (e.state as { wizardStep?: number } | null)?.wizardStep;
    // Firefox can restore the hash without the history state object.
    const fromHash = Number(/^#schritt-(\d+)$/.exec(location.hash)?.[1] ?? NaN);
    const s = typeof fromState === 'number' ? fromState : fromHash - 1;
    if (s >= 0 && s <= last) show(s, { push: false });
    else if (step > 0 && !location.hash) show(0, { push: false });
  });

  form.addEventListener('change', saveDraft);
  form.addEventListener('input', saveDraft);

  form.addEventListener('reset', () => {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      applyConditions(form);
      show(0, { focus: false, push: false });
    });
  });

  // Clear the draft once the request has been prepared or sent.
  new MutationObserver(() => {
    if (form.hidden) {
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
    }
  }).observe(form, { attributes: true, attributeFilter: ['hidden'] });

  const start = restoreDraft();
  applyConditions(form);
  history.replaceState({ wizardStep: start }, '', start > 0 ? `#schritt-${start + 1}` : location.hash);
  show(start, { focus: false, push: false });
}
