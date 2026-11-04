import { track } from '@/lib/analytics';

const BOUND = '__ccoYtBound';

type FlaggedWindow = Window & { [BOUND]?: boolean };

/** Insert the youtube-nocookie player. Safe to call twice: the second click is ignored. */
export function playYouTube(root: HTMLElement): void {
  if (root.classList.contains('is-playing') || root.querySelector('iframe')) return;
  const id = root.dataset.yt ?? '';
  if (!id) return;
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&modestbranding=1`;
  iframe.title = root.dataset.ytTitle ?? 'YouTube-Video';
  iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.loading = 'eager';
  const frame = root.querySelector('.yt-frame');
  frame?.replaceChildren(iframe);
  root.classList.add('is-playing');
  iframe.focus();
  track('video_play', { video_id: id });
}

/**
 * One document-level click listener for every `[data-yt]` tile.
 * The listener survives ClientRouter swaps, back/forward and bfcache,
 * and registering it again (page-load, pageshow) does not stack handlers.
 */
export function bindYouTube(): void {
  const w = window as FlaggedWindow;
  if (w[BOUND]) return;
  w[BOUND] = true;
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>('[data-yt-play]');
    if (!button) return;
    const root = button.closest<HTMLElement>('[data-yt]');
    if (!root) return;
    event.preventDefault();
    playYouTube(root);
  });
}

function armYouTube(): void {
  if (typeof document === 'undefined') return;
  bindYouTube();
  document.addEventListener('astro:page-load', bindYouTube);
  document.addEventListener('astro:after-swap', bindYouTube);
  window.addEventListener('pageshow', bindYouTube);
}

armYouTube();
