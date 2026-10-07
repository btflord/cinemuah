// v2 "cassette shelf": films stand on a shelf as VHS spines; the selected one slides out
// and opens to its cover, with its sleeves fanned behind it and its details underneath.
//
// Motion model (built to scroll without jank):
//  • Every cassette occupies a fixed-width slot, so the row's layout never changes. Opening one
//    is drawn as an overlay, and the cassettes after it slide right with a GPU transform.
//  • Slots are CSS scroll-snap points aligned so that slot i is centred at scrollLeft = i * STEP.
//    Trackpad/wheel scrolling therefore lands exactly on a cassette natively, and selecting one
//    never needs a corrective scroll.
//  • Positions are computed from constants, never measured; only the open cassette renders its cover.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { getPalette, paletteFromSeed, rgbCss, type Palette } from '@/lib/palette';
import { languageLabel } from '@/lib/languages';

export interface CassetteItem {
  key: string | number;
  title: string;
  year?: number | null;
  poster: string;
  /** Short tag printed at the top of the spine, e.g. "1080p" or "HBO". */
  tag?: string;
  subtitle?: string;
  rating?: number;
  runtime?: number; // minutes
  genres?: string[];
  language?: string;
  summary?: string;
  badges?: string[];
  /** Watch progress 0..100 */
  progress?: number;
}

interface CassetteShelfProps {
  title: string;
  items: CassetteItem[];
  loading?: boolean;
  onOpen: (index: number) => void;
  renderActions?: (index: number) => ReactNode;
  onSeeAll?: () => void;
  /** Optional element shown next to the title (e.g. a count or note). */
  aside?: ReactNode;
  /** More items exist beyond the loaded ones; `onNearEnd` fetches them as you approach the end. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onNearEnd?: () => void;
}

/** Start fetching the next page when the open cassette is this close to the last loaded one. */
const NEAR_END = 6;

// Keep in sync with --spine-w / --open-w / --gap in globals.css (they're also set inline below).
const SPINE = 74;
const OPEN = 320; // cover (OPEN - 52) wide, 2:3 with the 400px cassette height, plus room for the sleeves
const GAP = 14;
const STEP = SPINE + GAP;

const hueOf = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

const languageName = (l?: string) => (l ? languageLabel(l) : '');

const formatRuntime = (m?: number) => (m && m > 0 ? `${Math.floor(m / 60) ? `${Math.floor(m / 60)}h ` : ''}${m % 60}m` : '');

export function CassetteShelf({
  title, items, loading = false, onOpen, renderActions, onSeeAll, aside, hasMore = false, loadingMore = false, onNearEnd,
}: CassetteShelfProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(() => Math.min(3, Math.max(0, items.length - 1)));
  const focusRef = useRef(focus);
  focusRef.current = focus;

  const interacted = useRef(false);
  const positioned = useRef(false);
  /** scrollLeft a button/key-driven smooth scroll is heading to; null while the user scrolls freely */
  const target = useRef<number | null>(null);

  // Keep focus valid when the list changes (language/decade filters, refreshes); when data first
  // arrives, start a few cassettes in so there are spines on both sides of the open one.
  useEffect(() => {
    if (items.length === 0) return;
    if (!interacted.current) setFocus(Math.min(3, items.length - 1));
    else if (focus > items.length - 1) setFocus(items.length - 1);
  }, [items.length]);

  // Slide the focused cassette to the centre. The track's side padding is (50% - OPEN/2),
  // so cassette i is centred exactly when scrollLeft = i * STEP.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || items.length === 0) return;
    const left = focus * STEP;
    const smooth = positioned.current;
    positioned.current = true;
    // Already there (e.g. focus came from where a free scroll snapped): nothing will scroll,
    // so no 'scrollend' would ever clear the target. Don't set one.
    if (Math.abs(track.scrollLeft - left) <= 1) { target.current = null; return; }
    target.current = left;
    track.scrollTo({ left, behavior: smooth ? 'smooth' : 'instant' });
    // Safety net: if the scroll is interrupted in a way that never reaches the target, stop waiting
    const t = setTimeout(() => { if (target.current === left) target.current = null; }, 1500);
    return () => clearTimeout(t);
  }, [focus, items.length]);

  // After a free scroll (trackpad, wheel, scrollbar) snaps to rest, open the cassette it landed on.
  // Snapping guarantees scrollLeft is a multiple of STEP, so this never moves anything.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const settle = () => {
      // A smooth scroll interrupted by the next arrow press also fires 'scrollend' part-way;
      // ignore it until the latest programmatic scroll has actually arrived.
      if (target.current !== null) {
        if (Math.abs(track.scrollLeft - target.current) > 1) return;
        target.current = null;
        return;
      }
      const landed = Math.max(0, Math.min(items.length - 1, Math.round(track.scrollLeft / STEP)));
      if (landed !== focusRef.current) {
        interacted.current = true;
        setFocus(landed);
      }
    };
    // Real user input takes over from any programmatic scroll still in flight
    const userScroll = () => { target.current = null; };
    track.addEventListener('scrollend', settle);
    track.addEventListener('wheel', userScroll, { passive: true });
    track.addEventListener('pointerdown', userScroll, { passive: true });
    track.addEventListener('touchstart', userScroll, { passive: true });
    return () => {
      track.removeEventListener('scrollend', settle);
      track.removeEventListener('wheel', userScroll);
      track.removeEventListener('pointerdown', userScroll);
      track.removeEventListener('touchstart', userScroll);
    };
  }, [items.length]);

  // Endless shelf: ask for more as the user browses toward the end. At most one request per
  // cassette the user moves to, so a sparse filtered list (few matches per page) can never keep
  // fetching page after page by itself.
  const requestedAtFocus = useRef(-1);
  useEffect(() => {
    if (!interacted.current || requestedAtFocus.current === focus) return;
    if (onNearEnd && hasMore && !loadingMore && !loading && items.length > 0 && focus >= items.length - NEAR_END) {
      requestedAtFocus.current = focus;
      onNearEnd();
    }
  }, [focus, items.length, hasMore, loadingMore, loading, onNearEnd]);

  const move = useCallback((delta: number) => {
    interacted.current = true;
    // Pressing "next" on the last cassette fetches more instead of doing nothing
    if (delta > 0 && focusRef.current >= items.length - 1 && hasMore && !loadingMore) onNearEnd?.();
    setFocus(f => Math.max(0, Math.min(items.length - 1, f + delta)));
  }, [items.length, hasMore, loadingMore, onNearEnd]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); interacted.current = true; setFocus(0); }
    else if (e.key === 'End') { e.preventDefault(); interacted.current = true; setFocus(items.length - 1); }
    else if (e.key === 'Enter' && items[focus]) { e.preventDefault(); onOpen(focus); }
  };

  // Colour theme of the open film, diffused behind the shelf. Neighbours are sampled ahead of
  // time so moving left/right finds their colours already cached.
  const current = items[focus];
  const [palette, setPalette] = useState<Palette | null>(null);
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    const fallback = paletteFromSeed(current.title);
    getPalette(current.poster).then(p => { if (!cancelled) setPalette(p ?? fallback); });
    for (const n of [items[focus - 1], items[focus + 1], items[focus + 2]]) if (n?.poster) getPalette(n.poster);
    return () => { cancelled = true; };
  }, [current?.key, current?.poster]);

  const trackStyle = useMemo(() => ({
    '--spine-w': `${SPINE}px`, '--open-w': `${OPEN}px`, '--gap': `${GAP}px`,
  }) as React.CSSProperties, []);

  const themeStyle = palette
    ? ({ '--shelf-c1': rgbCss(palette.primary), '--shelf-c2': rgbCss(palette.secondary) } as React.CSSProperties)
    : undefined;

  if (!loading && items.length === 0) return null;

  const meta = current ? [
    current.year ? String(current.year) : '',
    formatRuntime(current.runtime),
    languageName(current.language),
  ].filter(Boolean) : [];

  return (
    <section className={`shelf ${palette ? 'has-palette' : ''}`} aria-label={title} style={themeStyle}>
      <div className="shelf-ambient" aria-hidden="true" />

      <header className="shelf-header">
        <h2 className="shelf-title">{title}</h2>
        {!loading && (
          <span className="shelf-count">
            {String(focus + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}{hasMore ? '+' : ''}
          </span>
        )}
        {aside}
        {onSeeAll && (
          <button className="shelf-see-all" onClick={onSeeAll}>
            See all <Icon name="chevronRight" size={16} />
          </button>
        )}
      </header>

      <div className="shelf-stage">
        <button className="shelf-arrow left" onClick={() => move(-1)} disabled={loading || focus === 0} aria-label="Previous film">
          <Icon name="chevronLeft" size={28} />
        </button>

        <div
          className="shelf-track"
          ref={trackRef}
          style={trackStyle}
          tabIndex={0}
          role="listbox"
          aria-label={`${title} — use the arrow keys to browse, Enter for details`}
          aria-activedescendant={current ? `cassette-${title}-${focus}` : undefined}
          onKeyDown={onKeyDown}
        >
          {loading
            ? Array.from({ length: 14 }, (_, i) => <div key={i} className="cassette is-skeleton" style={{ '--d': i } as React.CSSProperties}><div className="cassette-spine" /></div>)
            : items.map((it, i) => {
                const open = i === focus;
                return (
                  <div
                    key={it.key}
                    id={`cassette-${title}-${i}`}
                    role="option"
                    aria-selected={open}
                    aria-label={`${it.title}${it.year ? ` (${it.year})` : ''}`}
                    className={`cassette ${open ? 'is-open' : ''}`}
                    style={{ '--hue': hueOf(it.title), '--d': Math.abs(i - focus), '--shift': i > focus ? 1 : 0 } as React.CSSProperties}
                    onClick={() => { interacted.current = true; if (open) onOpen(i); else setFocus(i); }}
                  >
                    {/* The outer slot never moves (it's the scroll-snap target); this layer does the sliding */}
                    <div className="cassette-inner">
                    <div className="cassette-spine">
                      {it.poster && <img className="spine-art" src={it.poster} alt="" loading="lazy" decoding="async" draggable={false} />}
                      <div className="spine-wear" />
                      <span className="spine-tag">{it.tag || 'VHS'}</span>
                      <span className="spine-title">{it.title}</span>
                      <span className="spine-year">{it.year || ''}</span>
                      {it.progress ? <span className="spine-progress" style={{ height: `${it.progress}%` }} /> : null}
                    </div>

                    {open && (
                      <div className="cassette-case">
                        <div className="case-sleeve back" />
                        <div className="case-sleeve mid" />
                        <div className="case-cover">
                          {it.poster
                            ? <img src={it.poster} alt={it.title} decoding="async" draggable={false} />
                            : <div className="case-cover-fallback"><Icon name="film" size={36} /><span>{it.title}</span></div>}
                          <div className="case-shine" />
                          {it.rating ? <span className="case-rating"><Icon name="star" size={12} /> {it.rating.toFixed(1)}</span> : null}
                          {it.progress ? <div className="case-progress"><div style={{ width: `${it.progress}%` }} /></div> : null}
                        </div>
                      </div>
                    )}
                    </div>
                  </div>
                );
              })}
          {!loading && loadingMore && Array.from({ length: 3 }, (_, i) => (
            <div key={`more-${i}`} className="cassette is-skeleton" style={{ '--d': i } as React.CSSProperties}><div className="cassette-spine" /></div>
          ))}
        </div>

        <button className="shelf-arrow right" onClick={() => move(1)} disabled={loading || (focus >= items.length - 1 && !hasMore)} aria-label="Next film">
          <Icon name="chevronRight" size={28} />
        </button>
      </div>

      <div className="shelf-info" aria-live="polite">
        {loading || !current ? (
          <div className="shelf-info-skeleton"><div /><div /></div>
        ) : (
          <div className="shelf-info-inner" key={current.key}>
            <h3 className="shelf-info-title">{current.title}</h3>
            {current.subtitle && <div className="shelf-info-subtitle">{current.subtitle}</div>}
            <div className="shelf-info-meta">
              {meta.map((m, i) => <span key={i}>{m}</span>)}
              {current.rating ? <span className="shelf-info-rating"><Icon name="star" size={13} /> {current.rating.toFixed(1)}</span> : null}
              {current.badges?.map(b => <span key={b} className="shelf-badge">{b}</span>)}
            </div>
            {current.genres && current.genres.length > 0 && (
              <div className="shelf-info-genres">{current.genres.slice(0, 4).join(' · ')}</div>
            )}
            {current.summary && <p className="shelf-info-summary">{current.summary}</p>}
            {renderActions && <div className="shelf-info-actions">{renderActions(focus)}</div>}
          </div>
        )}
      </div>
    </section>
  );
}
