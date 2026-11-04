import { track } from '@/lib/analytics';

/**
 * Progressive form handling for every `<form data-form="…">`.
 *
 * With `PUBLIC_FORM_ENDPOINT` set, submissions are POSTed there. Without it the site runs in
 * presentation mode: the request is validated and prepared as an e-mail to the service address –
 * nothing is sent silently, and the visitor is told so.
 */

const ENDPOINT = (import.meta.env.PUBLIC_FORM_ENDPOINT as string | undefined)?.trim() || '';
const API_BASE = (import.meta.env.PUBLIC_API_BASE as string | undefined)?.replace(/\/$/, '') || '';
const MAILTO = 'service@ccoverath.de';
const MIN_FILL_MS = 2500;
const MAILTO_MAX = 1800;

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface CollectDetail {
  data: FormData;
  /** Extra plain-text lines for the e-mail fallback (e.g. "3 Fotos ausgewählt"). */
  summary: string[];
}

const messages = {
  required: 'Bitte fülle dieses Feld aus.',
  choice: 'Bitte wähle eine Option.',
  consent: 'Bitte bestätige die Datenschutzhinweise.',
  email: 'Bitte gib eine gültige E-Mail-Adresse ein, z. B. name@beispiel.de.',
  tel: 'Bitte gib eine gültige Telefonnummer ein.',
  pattern: 'Bitte überprüfe deine Eingabe.',
  short: 'Bitte gib etwas mehr Text ein.',
};

const fieldOf = (c: Element) => c.closest<HTMLElement>('.field, .consent-field, fieldset');

function errorElFor(c: Control): HTMLElement | null {
  const ids = (c.getAttribute('aria-describedby') ?? '').split(/\s+/);
  for (const id of ids) {
    const el = id ? document.getElementById(id) : null;
    if (el?.classList.contains('field-error')) return el;
  }
  return fieldOf(c)?.querySelector<HTMLElement>('.field-error') ?? null;
}

function validate(c: Control): string {
  if (c.disabled || c.closest('.hp-field') || c.type === 'hidden' || c.type === 'file') return '';
  const custom = c.dataset.error;
  if (c instanceof HTMLInputElement && (c.type === 'checkbox' || c.type === 'radio')) {
    if (!c.required) return '';
    if (c.type === 'radio') {
      const group = c.form?.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(c.name)}"]`) ?? [];
      return Array.from(group).some((r) => r.checked) ? '' : custom ?? messages.choice;
    }
    return c.checked ? '' : custom ?? (c.name === 'datenschutz' ? messages.consent : messages.required);
  }
  const value = c.value.trim();
  if (c.required && !value) return custom ?? messages.required;
  if (!value) return '';
  if (c.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return messages.email;
  if (c.type === 'tel' && !/^[+()\d\s/.-]{6,}$/.test(value)) return messages.tel;
  const min = Number(c.getAttribute('minlength') ?? 0);
  if (min && value.length < min) return messages.short;
  if (c instanceof HTMLInputElement && c.pattern && !new RegExp(`^(?:${c.pattern})$`).test(value)) return custom ?? messages.pattern;
  return '';
}

function showError(c: Control, msg: string): void {
  const field = fieldOf(c);
  const err = c.type === 'radio' ? (c.closest('fieldset')?.querySelector<HTMLElement>('.field-error') ?? null) : errorElFor(c);
  if (field) field.toggleAttribute('data-invalid', Boolean(msg));
  if (c.type === 'radio') {
    c.form?.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(c.name)}"]`).forEach((r) => r.setAttribute('aria-invalid', String(Boolean(msg))));
  } else {
    c.setAttribute('aria-invalid', String(Boolean(msg)));
  }
  if (err) err.textContent = msg;
}

export function validateScope(scope: ParentNode): Control[] {
  const controls = Array.from(scope.querySelectorAll<Control>('input, select, textarea'));
  const seenRadio = new Set<string>();
  const invalid: Control[] = [];
  for (const c of controls) {
    if (c.type === 'radio') {
      if (seenRadio.has(c.name)) continue;
      seenRadio.add(c.name);
    }
    const msg = validate(c);
    showError(c, msg);
    if (msg) invalid.push(c);
  }
  return invalid;
}

function labelOf(c: Control): string {
  if (c.dataset.label) return c.dataset.label;
  if (c.type === 'radio' || c.type === 'checkbox') {
    const legend = c.closest('fieldset')?.querySelector('legend')?.textContent?.trim();
    if (legend) return legend;
  }
  const label = c.id ? c.form?.querySelector(`label[for="${CSS.escape(c.id)}"]`) : c.closest('label');
  return (label?.textContent ?? c.name).replace(/\s*\(optional\)\s*/i, '').replace(/\s+/g, ' ').trim();
}

function summarise(form: HTMLFormElement, extra: string[]): string {
  const lines: string[] = [];
  const handled = new Set<string>();
  for (const c of Array.from(form.querySelectorAll<Control>('input, select, textarea'))) {
    if (c.closest('.hp-field') || c.type === 'file' || c.type === 'hidden' || c.name === 'datenschutz' || !c.name) continue;
    if (c.type === 'radio' || c.type === 'checkbox') {
      if (handled.has(c.name)) continue;
      handled.add(c.name);
      const checked = Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(c.name)}"]:checked`));
      if (!checked.length) continue;
      const values = checked.map((i) => i.closest('label')?.querySelector('.choice-title, strong')?.textContent?.trim() || i.value);
      lines.push(`${labelOf(c)}: ${values.join(', ')}`);
      continue;
    }
    if (c.disabled || !c.value.trim()) continue;
    const v = c instanceof HTMLSelectElement ? c.selectedOptions[0]?.textContent?.trim() ?? '' : c.value.trim();
    if (v) lines.push(c instanceof HTMLTextAreaElement ? `\n${labelOf(c)}:\n${v}\n` : `${labelOf(c)}: ${v}`);
  }
  return [...lines, ...extra].join('\n');
}

function mailtoHref(subject: string, body: string): string {
  const trimmed = body.length > MAILTO_MAX ? `${body.slice(0, MAILTO_MAX)}\n[…]` : body;
  return `mailto:${MAILTO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(trimmed)}`;
}

function setStatus(form: HTMLFormElement, tone: 'error' | 'info' | null, html = ''): void {
  const el = form.querySelector<HTMLElement>('[data-form-status]');
  if (!el) return;
  el.hidden = !tone;
  if (tone) el.dataset.tone = tone;
  el.innerHTML = html;
}

function setBusy(form: HTMLFormElement, busy: boolean): void {
  const btn = form.querySelector<HTMLButtonElement>('[type="submit"]');
  if (!btn) return;
  const label = btn.querySelector('[data-submit-label]') ?? btn;
  if (busy) {
    btn.dataset.idleLabel = label.textContent ?? '';
    label.textContent = 'Wird gesendet …';
  } else if (btn.dataset.idleLabel) {
    label.textContent = btn.dataset.idleLabel;
  }
  btn.disabled = busy;
  btn.setAttribute('aria-busy', String(busy));
  form.toggleAttribute('data-busy', busy);
}

function showSuccess(form: HTMLFormElement, mode: 'sent' | 'prepared', mailto: string): void {
  const target = form.dataset.success ? document.getElementById(form.dataset.success) : form.parentElement;
  const success = target?.matches('[data-form-success]') ? target : target?.querySelector<HTMLElement>('[data-form-success]');
  if (!success) return;
  success.dataset.mode = mode;
  success.querySelectorAll<HTMLAnchorElement>('[data-success-mailto]').forEach((a) => (a.href = mailto));
  form.hidden = true;
  success.hidden = false;
  success.focus({ preventScroll: true });
  success.scrollIntoView({ block: 'center' });
}

/** `data-show-if="field:valueA|valueB"` – shown (and enabled) when a checked radio/checkbox matches. */
export function applyConditions(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLElement>('[data-show-if]').forEach((el) => {
    const [field = '', values = ''] = (el.dataset.showIf ?? '').split(':');
    const wanted = values.split('|');
    const checked = Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(field)}"]:checked`)).map((i) => i.value);
    const show = checked.some((v) => wanted.includes(v));
    el.hidden = !show;
    el.querySelectorAll<Control>('input, select, textarea').forEach((c) => (c.disabled = !show));
  });
}

function bind(form: HTMLFormElement): void {
  const started = Date.now();
  applyConditions(form);
  form.addEventListener('change', () => applyConditions(form));
  let attempted = false;
  let submitting = false;

  form.addEventListener('input', (e) => {
    const c = e.target as Control;
    if (attempted || c.getAttribute('aria-invalid') === 'true') showError(c, validate(c));
  });
  form.addEventListener(
    'blur',
    (e) => {
      const c = e.target as Control;
      if ((attempted || c.value) && c.matches?.('input:not([type=checkbox]):not([type=radio]), select, textarea')) showError(c, validate(c));
    },
    true,
  );
  form.addEventListener('change', (e) => {
    const c = e.target as Control;
    if (attempted && (c.type === 'checkbox' || c.type === 'radio')) showError(c, validate(c));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    attempted = true;
    setStatus(form, null);

    const invalid = validateScope(form);
    if (invalid.length) {
      setStatus(
        form,
        'error',
        `Bitte prüfe ${invalid.length === 1 ? 'das markierte Feld' : `die ${invalid.length} markierten Felder`}.`,
      );
      invalid[0]?.focus();
      return;
    }

    const kind = form.dataset.form ?? 'contact';
    const subject = form.dataset.subject ?? 'Anfrage über die Website';
    const detail: CollectDetail = { data: new FormData(form), summary: [] };
    form.dispatchEvent(new CustomEvent<CollectDetail>('cco:collect', { detail }));
    const body = summarise(form, detail.summary);
    const mailto = mailtoHref(subject, body);

    const honeypot = (form.querySelector<HTMLInputElement>('.hp-field input')?.value ?? '') !== '';
    const tooFast = Date.now() - started < MIN_FILL_MS;
    if (honeypot || tooFast) {
      // Treated as a bot: pretend success, send nothing.
      showSuccess(form, ENDPOINT ? 'sent' : 'prepared', mailto);
      return;
    }

    submitting = true;
    setBusy(form, true);
    try {
      const apiPath = form.dataset.apiPath?.trim();
      if (API_BASE && apiPath) {
        const json: Record<string, unknown> = Object.fromEntries(
          [...detail.data.entries()].filter(([k]) => k !== 'website').map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
        );
        json.consent =
          detail.data.get('datenschutz') === 'on' || detail.data.get('datenschutz') === 'true' || detail.data.get('consent') === 'true';
        if (kind === 'rental_inquiry') {
          json.adacMember = String(detail.data.get('adacMember') ?? '');
          json.adacNumber = String(detail.data.get('adacNumber') ?? '');
          json.period = String(detail.data.get('period') ?? '');
          json.travelers = String(detail.data.get('travelers') ?? '');
          json.message = String(detail.data.get('message') ?? '');
          json.phone = String(detail.data.get('telefon') ?? detail.data.get('phone') ?? '');
        }
        if (kind === 'lastrada_inquiry') {
          json.phone = String(detail.data.get('telefon') ?? detail.data.get('phone') ?? '');
        }
        const res = await fetch(`${API_BASE}${apiPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(json),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        showSuccess(form, 'sent', mailto);
        track(`${kind}_submit`, { mode: 'api' });
      } else if (ENDPOINT) {
        detail.data.delete('website');
        detail.data.set('_subject', subject);
        detail.data.set('_form', kind);
        const res = await fetch(ENDPOINT, { method: 'POST', body: detail.data, headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        showSuccess(form, 'sent', mailto);
        track(`${kind}_submit`, { mode: 'endpoint' });
      } else {
        await new Promise((r) => setTimeout(r, 450));
        showSuccess(form, 'prepared', mailto);
        track(`${kind}_submit`, { mode: 'presentation' });
      }
    } catch {
      setStatus(
        form,
        'error',
        `Das hat leider nicht geklappt. Bitte versuche es noch einmal – oder schreib uns direkt an <a href="${mailto}">${MAILTO}</a> bzw. ruf an: <a href="tel:+492206951310">02206 95131-0</a>.`,
      );
    } finally {
      submitting = false;
      setBusy(form, false);
    }
  });

  form.addEventListener('reset', () => {
    attempted = false;
    setStatus(form, null);
    form.querySelectorAll<Control>('input, select, textarea').forEach((c) => showError(c, ''));
  });
}

/** Prefill fields from query parameters, e.g. `?fahrzeug=…` or `?anliegen=beratung`. */
function prefill(form: HTMLFormElement): void {
  const params = new URLSearchParams(location.search);
  form.querySelectorAll<Control>('[data-prefill]').forEach((c) => {
    const v = params.get(c.dataset.prefill ?? '');
    if (!v) return;
    if (c instanceof HTMLInputElement && (c.type === 'radio' || c.type === 'checkbox')) c.checked = c.value === v;
    else if (!c.value) c.value = v.slice(0, 500);
  });
}

function bootForms(): void {
  document.querySelectorAll<HTMLFormElement>('form[data-form]').forEach((form) => {
    if (form.dataset.formBound === '1') return;
    form.dataset.formBound = '1';
    form.noValidate = true;
    prefill(form);
    bind(form);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-form-again]').forEach((btn) => {
    if (btn.dataset.formBound === '1') return;
    btn.dataset.formBound = '1';
    btn.addEventListener('click', () => {
      const success = btn.closest<HTMLElement>('[data-form-success]');
      const form = success?.parentElement?.querySelector<HTMLFormElement>('form[data-form]');
      if (!success || !form) return;
      form.reset();
      success.hidden = true;
      form.hidden = false;
      form.querySelector<Control>('input:not([type=hidden]), select, textarea')?.focus();
    });
  });
}

bootForms();
document.addEventListener('astro:page-load', bootForms);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) bootForms();
});
