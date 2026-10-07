// The search bar every browse page opens with: a large field that sticks under the navbar as you
// scroll, with the page's filters directly beneath it.
//
// Efficiency:
//  • Typing updates only this component; the page sees the query after a short debounce
//    (or immediately on Enter), so a fast typist triggers one search, not one per key.
//  • Recent searches are kept per page in localStorage and can be re-run with one click.
//  • ⌘K / Ctrl+K or "/" anywhere (see App) jumps to the right page and focuses its search.
//  • Once pinned, the bar slides away while you scroll (either direction) and slides back as soon
//    as scrolling stops. This toggles a class on the DOM node, so scrolling never re-renders React.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export const FOCUS_SEARCH_EVENT = 'cinelocal:focus-search';

/** Focuses the search bar on whatever page is showing (after it has rendered). */
export function requestSearchFocus() {
  requestAnimationFrame(() => window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT)));
}

const RECENT_LIMIT = 6;

function readRecent(scope: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(`cinelocal_recent_${scope}`) || '[]');
    return Array.isArray(raw) ? raw.filter(s => typeof s === 'string').slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeRecent(scope: string, list: string[]) {
  try { localStorage.setItem(`cinelocal_recent_${scope}`, JSON.stringify(list)); } catch { /* preference only */ }
}

/** Normalises what the user typed: trims and collapses runs of spaces. */
export const normalizeQuery = (q: string) => q.replace(/\s+/g, ' ').trim();

interface SearchHeroProps {
  /** Key for recent searches, e.g. "movies" or "series". */
  scope: string;
  title: string;
  subtitle?: ReactNode;
  placeholder: string;
  /** The committed (debounced) query. */
  query: string;
  onQueryChange: (query: string) => void;
  loading?: boolean;
  /** e.g. "1,204 results" */
  resultLabel?: string;
  filters?: ReactNode;
  /** Number of non-default filters, for the Reset button. */
  activeFilters?: number;
  onResetFilters?: () => void;
  debounceMs?: number;
}

export function SearchHero({
  scope, title, subtitle, placeholder, query, onQueryChange, loading = false,
  resultLabel, filters, activeFilters = 0, onResetFilters, debounceMs = 250,
}: SearchHeroProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(query);
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState(() => readRecent(scope));
  const committed = useRef(query);

  // Parent changed the query (e.g. a recent search or reset): reflect it in the field
  useEffect(() => {
    if (query !== committed.current) {
      committed.current = query;
      setText(query);
    }
  }, [query]);

  const commit = (value: string) => {
    const q = normalizeQuery(value);
    if (q === committed.current) return;
    committed.current = q;
    onQueryChange(q);
  };

  // Debounced commit while typing
  useEffect(() => {
    const q = normalizeQuery(text);
    if (q === committed.current) return;
    const t = setTimeout(() => commit(text), q === '' ? 0 : debounceMs);
    return () => clearTimeout(t);
  }, [text, debounceMs]);

  // Functional update: this is also called from timers, so it must not close over a stale list
  const remember = useCallback((value: string) => {
    const q = normalizeQuery(value);
    if (q.length < 2) return;
    setRecent(prev => {
      const next = [q, ...prev.filter(r => r.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_LIMIT);
      writeRecent(scope, next);
      return next;
    });
  }, [scope]);

  const forget = (value: string) => {
    setRecent(prev => {
      const next = prev.filter(r => r !== value);
      writeRecent(scope, next);
      return next;
    });
  };

  // Most people type, look at the results and move on without pressing Enter: a search that
  // stays on screen for a moment counts as a real search and goes into the history.
  useEffect(() => {
    if (normalizeQuery(query).length < 2) return;
    const t = setTimeout(() => remember(query), 1500);
    return () => clearTimeout(t);
  }, [query, remember]);

  const runRecent = (q: string) => {
    setText(q);
    commit(q);
    remember(q);
    setHighlight(-1);
    inputRef.current?.blur();
  };

  const [highlight, setHighlight] = useState(-1);

  const clear = () => {
    setText('');
    commit('');
    inputRef.current?.focus();
  };

  // Focus requests from the navbar button and the ⌘K / "/" shortcuts (handled in App)
  useEffect(() => {
    const focus = () => { inputRef.current?.focus(); inputRef.current?.select(); };
    window.addEventListener(FOCUS_SEARCH_EVENT, focus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focus);
  }, []);

  // Hide the pinned bar while scrolling; bring it back when scrolling stops
  useEffect(() => {
    const bar = stickyRef.current;
    const heading = headingRef.current;
    const scroller = bar?.closest<HTMLElement>('.main-content');
    if (!bar || !heading || !scroller) return;
    let frame = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const show = () => { clearTimeout(idle); bar.classList.remove('is-hidden'); };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Only once pinned (the title above it has scrolled away), and never while typing
        const pinned = heading.getBoundingClientRect().bottom < bar.getBoundingClientRect().top - 24;
        if (!pinned || bar.contains(document.activeElement)) { show(); return; }
        bar.classList.add('is-hidden');
        clearTimeout(idle);
        // Not 'scrollend': with smooth scrolling it fires after every wheel notch, which would
        // flash the bar between notches. A short idle timer bridges notches and trackpad momentum.
        idle = setTimeout(show, 280);
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(idle);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Empty field: the whole history. While typing: past searches that contain what's typed.
  const typed = normalizeQuery(text).toLowerCase();
  const suggestions = typed
    ? recent.filter(r => r.toLowerCase().includes(typed) && r.toLowerCase() !== typed)
    : recent;
  const showRecent = focused && suggestions.length > 0;
  useEffect(() => { setHighlight(-1); }, [typed, focused]);

  const highlightMatch = (r: string) => {
    if (!typed) return r;
    const i = r.toLowerCase().indexOf(typed);
    if (i < 0) return r;
    return <>{r.slice(0, i)}<mark>{r.slice(i, i + typed.length)}</mark>{r.slice(i + typed.length)}</>;
  };

  return (
    <section className="search-hero">
      <div className="search-hero-heading" ref={headingRef}>
        <h1 className="search-hero-title">{title}</h1>
        {subtitle && <p className="search-hero-subtitle">{subtitle}</p>}
      </div>

      <div className="search-hero-sticky" ref={stickyRef} onFocusCapture={() => stickyRef.current?.classList.remove('is-hidden')}>
        <div className={`search-hero-field ${focused ? 'is-focused' : ''}`}>
          <Icon name="search" size={24} className="search-hero-icon" />
          <input
            ref={inputRef}
            className="search-hero-input"
            type="search"
            value={text}
            placeholder={placeholder}
            aria-label={placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={e => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            // Delay so a click on a recent-search chip lands before the list closes
            onBlur={() => {
              // Leaving the field keeps whatever was searched
              if (normalizeQuery(text) === committed.current) remember(text);
              setTimeout(() => setFocused(false), 120);
            }}
            role="combobox"
            aria-expanded={showRecent}
            aria-controls={`recent-${scope}`}
            aria-activedescendant={highlight >= 0 ? `recent-${scope}-${highlight}` : undefined}
            onKeyDown={e => {
              if (showRecent && e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight(h => (h + 1) % suggestions.length);
              } else if (showRecent && e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight(h => (h <= 0 ? suggestions.length - 1 : h - 1));
              } else if (e.key === 'Enter') {
                if (showRecent && highlight >= 0) runRecent(suggestions[highlight]);
                else { commit(text); remember(text); }
              } else if (e.key === 'Escape') {
                if (highlight >= 0) setHighlight(-1);
                else if (text) clear();
                else inputRef.current?.blur();
              }
            }}
          />
          {loading && <span className="search-hero-spinner" aria-label="Searching" />}
          {text ? (
            <button className="search-hero-clear" onClick={clear} aria-label="Clear search">
              <Icon name="close" size={18} />
            </button>
          ) : (
            <kbd className="search-hero-kbd" aria-hidden="true">⌘K</kbd>
          )}

          {showRecent && (
            <div className="search-hero-recent" role="listbox" id={`recent-${scope}`} aria-label="Recent searches">
              <div className="search-hero-recent-head">
                <span className="search-hero-recent-label">{typed ? 'From your recent searches' : 'Recent searches'}</span>
                <button
                  className="recent-clear"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { setRecent([]); writeRecent(scope, []); }}
                >
                  Clear all
                </button>
              </div>
              {suggestions.map((r, i) => (
                <div
                  key={r}
                  id={`recent-${scope}-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  className={`recent-row ${i === highlight ? 'is-active' : ''}`}
                  onMouseDown={e => e.preventDefault()}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => runRecent(r)}
                >
                  <Icon name="refresh" size={14} className="recent-row-icon" />
                  <span className="recent-row-text">{highlightMatch(r)}</span>
                  <button
                    className="recent-row-remove"
                    aria-label={`Remove “${r}” from recent searches`}
                    onMouseDown={e => e.preventDefault()}
                    onClick={e => { e.stopPropagation(); forget(r); }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {(filters || resultLabel) && (
          <div className="search-hero-filters">
            {filters}
            <div className="search-hero-meta">
              {resultLabel && <span className="search-hero-count">{resultLabel}</span>}
              {activeFilters > 0 && onResetFilters && (
                <button className="filter-reset" onClick={onResetFilters}>
                  Reset filters ({activeFilters})
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Segmented single-choice filter, e.g. quality or minimum rating. */
export function FilterSegment<T extends string | number>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="filter-group" role="radiogroup" aria-label={label}>
      <span className="filter-label">{label}</span>
      <div className="filter-segment">
        {options.map(o => (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? 'active' : ''}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Horizontally scrolling chip row, e.g. genres. */
export function FilterChips({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="filter-group filter-group-wide" role="radiogroup" aria-label={label}>
      <span className="filter-label">{label}</span>
      <div className="filter-chips">
        {options.map(o => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            className={`filter-chip ${value === o.value ? 'active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Compact dropdown styled as a pill, for sort orders. */
export function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-group">
      <span className="filter-label">{label}</span>
      <span className="filter-select-wrap">
        <select className="filter-select" value={value} onChange={e => onChange(e.target.value)}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Icon name="arrowDown" size={14} className="filter-select-caret" />
      </span>
    </label>
  );
}
