// "Immersive scroll": film rows behave like a lens.
//  • Horizontally, the card nearest the middle of a row is magnified and lit; cards toward the
//    edges shrink and dim, so a film grows as it scrolls into the spotlight.
//  • Vertically, the row nearest the middle of the window is in focus; rows above/below recede.
//  • The focused film's poster bleeds behind its row as a blurred ambient glow.
//  • Rows reveal with a staggered zoom the first time they scroll into view.
// All motion is driven by CSS custom properties (--lens per card, --row-focus per section),
// written once per animation frame; the visual rules live in globals.css under [data-immersive='on'].
import { useEffect, useRef, type RefObject } from 'react';

const STORAGE_KEY = 'cinelocal_immersive';
const CHANGE_EVENT = 'cinelocal:immersive';

const reducedMotion = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

export function isImmersiveEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Turns the effect on/off app-wide and remembers the choice. */
export function setImmersiveEnabled(on: boolean) {
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* preference only */ }
  applyImmersiveAttribute();
}

/** Syncs <html data-immersive> with the setting and the OS "reduce motion" preference. */
export function applyImmersiveAttribute() {
  const on = isImmersiveEnabled() && !reducedMotion?.matches;
  document.documentElement.dataset.immersive = on ? 'on' : 'off';
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function initImmersive() {
  applyImmersiveAttribute();
  reducedMotion?.addEventListener?.('change', applyImmersiveAttribute);
}

const isActive = () => document.documentElement.dataset.immersive === 'on';
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const MAX_STAGGER = 12;

/**
 * Drives the lens effect for one horizontal row.
 * @param rowRef     the scrolling `.movie-row` element
 * @param ambientRef the `<RowAmbient>` element behind the row
 * @param renderKey  changes whenever the row mounts/unmounts or its contents change
 */
export function useImmersiveRow(
  rowRef: RefObject<HTMLElement>,
  ambientRef: RefObject<HTMLElement>,
  renderKey: unknown
) {
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const section = row.closest<HTMLElement>('.section');
    const scroller = row.closest<HTMLElement>('.main-content');
    const ambient = ambientRef.current;
    const lastLens = new WeakMap<Element, number>();
    let frame = 0;
    let ambientSrc = '';
    let ambientLayer = 0;
    let revealed = section?.classList.contains('is-revealed') ?? false;

    const setAmbient = (src: string) => {
      if (!ambient || src === ambientSrc) return;
      ambientSrc = src;
      const layers = ambient.children;
      if (layers.length < 2) return;
      const next = layers[ambientLayer ^ 1] as HTMLElement;
      const prev = layers[ambientLayer] as HTMLElement;
      next.style.backgroundImage = src ? `url("${src.replace(/"/g, '%22')}")` : 'none';
      next.classList.toggle('on', !!src);
      prev.classList.remove('on');
      ambientLayer ^= 1;
    };

    const update = () => {
      frame = 0;
      if (!isActive()) return;
      const width = row.clientWidth;
      if (!width) return;

      // ── Row focus: how close this row is to the middle of the window ──
      if (section && scroller) {
        const view = scroller.getBoundingClientRect();
        const box = section.getBoundingClientRect();
        const dist = Math.abs(box.top + box.height / 2 - (view.top + view.height * 0.5));
        const d = Math.min(1, dist / (view.height * 0.8));
        section.style.setProperty('--row-focus', (1 - d * d).toFixed(3));
      }

      // ── Card lens: magnification by distance from the row's visible centre ──
      // offsetLeft is layout-based, so the scale we apply never feeds back into the measurement.
      const centre = row.scrollLeft + width / 2;
      const reach = Math.max(width * 0.55, 320);
      const kids = row.children;
      let best = -1;
      let bestLens = -1;
      let firstVisible = -1;
      const values: number[] = new Array(kids.length);
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i] as HTMLElement;
        const mid = k.offsetLeft + k.offsetWidth / 2;
        values[i] = smoothstep(1 - Math.min(1, Math.abs(mid - centre) / reach));
        if (values[i] > bestLens) { bestLens = values[i]; best = i; }
        if (firstVisible === -1 && k.offsetLeft + k.offsetWidth > row.scrollLeft) firstVisible = i;
      }
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i] as HTMLElement;
        const v = values[i];
        if (Math.abs((lastLens.get(k) ?? -1) - v) > 0.004) {
          k.style.setProperty('--lens', v.toFixed(3));
          lastLens.set(k, v);
        }
        // Entrance stagger order, counted from the first card on screen
        if (!k.style.getPropertyValue('--i')) {
          k.style.setProperty('--i', String(Math.max(0, Math.min(MAX_STAGGER, i - Math.max(0, firstVisible)))));
        }
      }

      if (best >= 0) {
        const img = kids[best].querySelector('img');
        // Skip images that failed (cards hide them) so the glow never shows a broken image
        setAmbient(img && img.style.display !== 'none' ? img.getAttribute('src') || '' : '');
      }
    };

    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

    row.addEventListener('scroll', schedule, { passive: true });
    scroller?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener(CHANGE_EVENT, schedule);
    const resizeObs = new ResizeObserver(schedule);
    resizeObs.observe(row);
    const mutationObs = new MutationObserver(schedule);
    mutationObs.observe(row, { childList: true });

    // Reveal the row with a staggered zoom the first time it scrolls into view
    let revealObs: IntersectionObserver | null = null;
    if (section && !revealed) {
      revealObs = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) {
          revealed = true;
          section.classList.add('is-revealed');
          revealObs?.disconnect();
        }
      }, { root: scroller, threshold: 0.12 });
      revealObs.observe(section);
    }

    schedule();
    return () => {
      cancelAnimationFrame(frame);
      row.removeEventListener('scroll', schedule);
      scroller?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener(CHANGE_EVENT, schedule);
      resizeObs.disconnect();
      mutationObs.disconnect();
      revealObs?.disconnect();
    };
  }, [rowRef, ambientRef, renderKey]);
}

/** Refs for a row and its ambient glow, wired to the lens effect. */
export function useImmersive(renderKey: unknown) {
  const rowRef = useRef<HTMLDivElement>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  useImmersiveRow(rowRef, ambientRef, renderKey);
  return { rowRef, ambientRef };
}

/** Blurred poster glow behind a row; two layers so the image cross-fades as focus moves. */
export function RowAmbient({ innerRef }: { innerRef: RefObject<HTMLDivElement> }) {
  return (
    <div className="row-ambient" ref={innerRef} aria-hidden="true">
      <div />
      <div />
    </div>
  );
}
