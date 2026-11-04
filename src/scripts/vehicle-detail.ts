import { track as trackEvent } from '@/lib/analytics';
import { openModal } from '@/scripts/site';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scroll-snap carousel: index derived from scroll position, so native swipe just works. */
function carousel(track: HTMLElement, onChange: (i: number) => void) {
  const count = track.children.length;
  let current = 0;
  const indexNow = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const goTo = (i: number, smooth = !reduced()) => {
    const next = Math.max(0, Math.min(count - 1, i));
    track.scrollTo({ left: next * track.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
    if (!smooth && next !== current) {
      current = next;
      onChange(next);
    }
  };
  let raf = 0;
  track.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = indexNow();
        if (i !== current) {
          current = i;
          onChange(i);
        }
      });
    },
    { passive: true },
  );
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(current + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(current - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      goTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      goTo(count - 1);
    }
  });
  // keep the same slide in view when the viewport (or orientation) changes
  new ResizeObserver(() => goTo(current, false)).observe(track);
  return { goTo, get current() { return current; }, count };
}

function initGallery(root: HTMLElement): void {
  const track = root.querySelector<HTMLElement>('[data-gal-track]');
  if (!track) return;
  const counter = root.querySelector('[data-gal-current]');
  const prev = root.querySelector<HTMLButtonElement>('[data-gal-prev]');
  const next = root.querySelector<HTMLButtonElement>('[data-gal-next]');
  const thumbs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-gal-thumb]'));

  const sync = (i: number) => {
    if (counter) counter.textContent = String(i + 1);
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === main.count - 1;
    thumbs.forEach((t, k) => {
      if (k === i) {
        t.setAttribute('aria-current', 'true');
        const strip = t.closest('ul');
        if (strip) {
          const li = t.parentElement as HTMLElement;
          const left = li.offsetLeft - strip.offsetLeft;
          if (left < strip.scrollLeft || left + li.offsetWidth > strip.scrollLeft + strip.clientWidth) {
            strip.scrollLeft = left - strip.clientWidth / 2 + li.offsetWidth / 2;
          }
        }
      } else t.removeAttribute('aria-current');
    });
  };
  const main = carousel(track, sync);
  sync(0);
  prev?.addEventListener('click', () => main.goTo(main.current - 1));
  next?.addEventListener('click', () => main.goTo(main.current + 1));
  thumbs.forEach((t) => t.addEventListener('click', () => main.goTo(Number(t.dataset.galThumb))));

  /* ---------- lightbox ---------- */
  const dialog = root.querySelector<HTMLDialogElement>('[data-gal-dialog]');
  const lbTrack = dialog?.querySelector<HTMLElement>('[data-lb-track]');
  if (!dialog || !lbTrack) return;
  const lbCounter = dialog.querySelector('[data-lb-current]');
  const lbPrev = dialog.querySelector<HTMLButtonElement>('[data-lb-prev]');
  const lbNext = dialog.querySelector<HTMLButtonElement>('[data-lb-next]');
  const lbSync = (i: number) => {
    if (lbCounter) lbCounter.textContent = String(i + 1);
    if (lbPrev) lbPrev.disabled = i === 0;
    if (lbNext) lbNext.disabled = i === lb.count - 1;
  };
  const lb = carousel(lbTrack, lbSync);
  lbPrev?.addEventListener('click', () => lb.goTo(lb.current - 1));
  lbNext?.addEventListener('click', () => lb.goTo(lb.current + 1));

  const open = (opener: HTMLElement) => {
    openModal(dialog, opener);
    const start = main.current;
    requestAnimationFrame(() => {
      lb.goTo(start, false);
      lbSync(start);
      lbTrack.focus({ preventScroll: true });
    });
    trackEvent('cta_click', { cta: 'gallery_fullscreen' });
  };
  root.querySelectorAll<HTMLElement>('[data-gal-open]').forEach((b) => b.addEventListener('click', () => open(b)));
  track.addEventListener('click', (e) => {
    if ((e.target as Element).closest('img') && window.matchMedia('(hover: hover)').matches) open(track);
  });
  dialog.querySelector('[data-gal-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => main.goTo(lb.current, false));
}

/** Sticky mobile CTA hides while the inquiry form (or footer) is on screen. */
function initStickyCta(): void {
  const bar = document.querySelector<HTMLElement>('[data-sticky-cta]');
  if (!bar) return;
  const targets = document.querySelectorAll('[data-hide-sticky]');
  const visible = new Set<Element>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target);
      else visible.delete(e.target);
    }
    bar.classList.toggle('is-hidden', visible.size > 0);
  });
  targets.forEach((t) => io.observe(t));
}

document.querySelectorAll<HTMLElement>('[data-gallery]').forEach(initGallery);
initStickyCta();

const id = document.querySelector<HTMLElement>('[data-vehicle-page]')?.dataset.vehiclePage;
if (id) trackEvent('vehicle_view', { vehicle_id: id });
