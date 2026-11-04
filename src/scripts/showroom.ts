import {
  activeFilterCount,
  emptyFilters,
  filtersToParams,
  matches,
  paramsToFilters,
  sortVehicles,
  type Category,
  type Condition,
  type FilterableVehicle,
  type FilterState,
  type SortKey,
} from '@/lib/filter';
import { track } from '@/lib/analytics';
import { openModal } from '@/scripts/site';

interface Item extends FilterableVehicle {
  el: HTMLElement;
  order: number;
}

const numOrNull = (s: string | undefined) => (s ? Number(s) : null);

/** Form field name ↔ FilterState key. Names equal the URL query keys. */
const listFields = { zustand: 'condition', marke: 'make', art: 'category', getriebe: 'transmission', gewicht: 'weight' } as const;
type ListField = keyof typeof listFields;

function init(form: HTMLFormElement, grid: HTMLElement): void {
  const items: Item[] = Array.from(grid.querySelectorAll<HTMLElement>('[data-grid-item]')).map((el) => {
    const d = (el.querySelector<HTMLElement>('[data-vehicle]') ?? el).dataset;
    let beds: Item['beds'] = [];
    if (d.beds) {
      try {
        beds = JSON.parse(d.beds) as Item['beds'];
      } catch {
        beds = [];
      }
    }
    return {
      el,
      id: d.id ?? '',
      order: Number(d.order ?? 0),
      condition: d.condition as Condition,
      make: d.make ?? '',
      category: d.category as Category,
      transmission: d.transmission || null,
      grossWeightKg: numOrNull(d.gw),
      price: Number(d.price ?? 0),
      lengthMm: numOrNull(d.length),
      mileageKm: numOrNull(d.km),
      seats: numOrNull(d.seats),
      sleepingPlaces: numOrNull(d.sleeps),
      beds,
    };
  });

  const sortSelect = document.querySelector<HTMLSelectElement>('[data-sort]');
  const countEl = document.querySelector('[data-result-count]');
  const nounEl = document.querySelector('[data-result-noun]');
  const applyLabel = document.querySelector('[data-apply-label]');
  const badge = document.querySelector<HTMLElement>('[data-filter-badge]');
  const chips = document.querySelector<HTMLElement>('[data-active-chips]');
  const empty = document.querySelector<HTMLElement>('[data-empty]');
  const checkboxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  const price = form.elements.namedItem('preis') as HTMLSelectElement;
  const length = form.elements.namedItem('laenge') as HTMLSelectElement;

  const readForm = (): FilterState => {
    const f = emptyFilters();
    for (const cb of checkboxes) {
      if (!cb.checked) continue;
      const key = listFields[cb.name as ListField];
      if (key) (f[key] as string[]).push(cb.value);
    }
    f.priceMax = price.value ? Number(price.value) : null;
    f.lengthMax = length.value ? Number(length.value) : null;
    return f;
  };

  const writeForm = (f: FilterState): void => {
    for (const cb of checkboxes) {
      const key = listFields[cb.name as ListField];
      cb.checked = key ? (f[key] as string[]).includes(cb.value) : false;
    }
    const setSelect = (sel: HTMLSelectElement, v: number | null) => {
      sel.value = v === null ? '' : String(v);
      // a value from the URL that is not an option falls back to "Beliebig"
      if (v !== null && sel.value !== String(v)) sel.value = '';
    };
    setSelect(price, f.priceMax);
    setSelect(length, f.lengthMax);
  };

  const plural = (n: number) => (n === 1 ? 'Fahrzeug' : 'Fahrzeuge');

  const labelFor = (el: HTMLInputElement | HTMLSelectElement): string => {
    if (el instanceof HTMLSelectElement) {
      const prefix = el.name === 'preis' ? 'bis' : 'Länge bis';
      return `${prefix} ${el.selectedOptions[0]?.textContent?.trim() ?? ''}`;
    }
    return el.closest('label')?.querySelector('.fcheck-label')?.firstChild?.textContent?.trim() ?? el.value;
  };

  const renderChips = (): void => {
    if (!chips) return;
    chips.replaceChildren();
    const active: (HTMLInputElement | HTMLSelectElement)[] = [...checkboxes.filter((c) => c.checked), ...[price, length].filter((s) => s.value)];
    for (const control of active) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      const text = labelFor(control);
      btn.innerHTML = `<span></span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
      btn.querySelector('span')!.textContent = text;
      btn.setAttribute('aria-label', `Filter entfernen: ${text}`);
      btn.addEventListener('click', () => {
        if (control instanceof HTMLInputElement) control.checked = false;
        else control.value = '';
        update();
        (chips.querySelector('button') ?? sortSelect)?.focus();
      });
      li.append(btn);
      chips.append(li);
    }
    chips.hidden = active.length === 0;
  };

  const updateFacets = (f: FilterState): void => {
    for (const cb of checkboxes) {
      const key = listFields[cb.name as ListField];
      if (!key) continue;
      const probe: FilterState = { ...f, [key]: [cb.value] };
      const n = items.filter((i) => matches(i, probe)).length;
      const out = form.querySelector(`[data-facet-count="${cb.name}:${CSS.escape(cb.value)}"]`);
      if (out) out.textContent = String(n);
      cb.disabled = n === 0 && !cb.checked;
    }
  };

  const update = (opts: { fromUser?: boolean } = { fromUser: true }): void => {
    const f = readForm();
    const sort = (sortSelect?.value ?? 'empfohlen') as SortKey;

    const visible = items.filter((i) => matches(i, f));
    const ordered = sort === 'empfohlen' ? [...visible].sort((a, b) => a.order - b.order) : sortVehicles(visible, sort);
    const hidden = items.filter((i) => !visible.includes(i));
    for (const i of [...ordered, ...hidden]) grid.append(i.el);
    for (const i of items) i.el.hidden = !visible.includes(i);

    const n = visible.length;
    if (countEl) countEl.textContent = String(n);
    if (nounEl) nounEl.textContent = plural(n);
    if (applyLabel) applyLabel.textContent = n ? `${n} ${plural(n)} anzeigen` : 'Keine Treffer – Filter anpassen';
    if (empty) empty.hidden = n > 0;
    grid.hidden = n === 0;

    const active = activeFilterCount(f);
    if (badge) {
      badge.textContent = String(active);
      badge.hidden = active === 0;
    }
    renderChips();
    updateFacets(f);

    const params = filtersToParams(f, sort).toString();
    const next = `${location.pathname}${params ? `?${params}` : ''}${location.hash}`;
    if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, '', next);

    if (opts.fromUser) track('filter_apply', { active_filters: active, results: n, sort });
  };

  // initial state from URL (e.g. /wohnmobile/?art=alkoven from the finder teaser)
  const initial = paramsToFilters(new URLSearchParams(location.search));
  writeForm(initial.filters);
  if (sortSelect) sortSelect.value = initial.sort;
  update({ fromUser: false });

  form.addEventListener('change', () => update());
  form.addEventListener('submit', (e) => e.preventDefault());
  sortSelect?.addEventListener('change', () => update());

  const reset = () => {
    writeForm(emptyFilters());
    update();
  };
  form.addEventListener('reset', (e) => {
    e.preventDefault();
    reset();
  });
  document.querySelectorAll('[data-filter-reset]:not([type="reset"])').forEach((b) => b.addEventListener('click', reset));

  /* ---------- mobile sheet: the same form moves between sidebar and sheet ---------- */
  const sheet = document.querySelector<HTMLDialogElement>('[data-filter-sheet]');
  const sheetBody = sheet?.querySelector<HTMLElement>('[data-filter-sheet-body]');
  const home = document.querySelector<HTMLElement>('[data-filter-home]');
  const opener = document.querySelector<HTMLButtonElement>('[data-filter-open]');
  if (!sheet || !sheetBody || !home || !opener) return;

  opener.addEventListener('click', () => {
    sheetBody.append(form);
    openModal(sheet, opener);
    opener.setAttribute('aria-expanded', 'true');
  });
  sheet.addEventListener('close', () => {
    home.append(form);
    opener.setAttribute('aria-expanded', 'false');
  });
  sheet.querySelectorAll('[data-filter-close]').forEach((b) =>
    b.addEventListener('click', () => {
      sheet.close();
      if ((b as HTMLElement).dataset.filterApply !== undefined) grid.closest('section')?.scrollIntoView({ block: 'start' });
    }),
  );
  window.matchMedia('(min-width: 64em)').addEventListener('change', (mq) => {
    if (mq.matches && sheet.open) sheet.close();
  });
}

function bootShowroom(): void {
  const form = document.querySelector<HTMLFormElement>('[data-filter-form]');
  const grid = document.querySelector<HTMLElement>('[data-grid]');
  if (!form || !grid || form.dataset.showroomBound === '1') return;
  form.dataset.showroomBound = '1';
  init(form, grid);
}

bootShowroom();
document.addEventListener('astro:page-load', bootShowroom);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) bootShowroom();
});
