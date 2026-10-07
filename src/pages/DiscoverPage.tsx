import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { YtsMovie, YtsTorrent, TorrentStats } from '@/types';
import { formatBytes, pickDefaultTorrent } from '@/types';
import { VideoPlayer } from '@/components/VideoPlayer';
import { useMedia } from '@/contexts/MediaContext';
import { useToast } from '@/contexts/ToastContext';
import { Icon } from '@/components/Icon';
import { useLanguages } from '@/lib/languages';
import { watchable, watchableList } from '@/lib/yts';
import { errorMessage } from '@/lib/errors';
import { SearchHero, FilterChips, FilterSegment, FilterSelect } from '@/components/SearchHero';
import { CassetteShelf } from '@/components/CassetteShelf';
import { MovieShelfActions } from '@/components/MovieActions';
import { LanguagePicker } from '@/components/LanguagePicker';
import { IS_WEB, DESKTOP_APP_URL } from '@/lib/platform';
import { openTrailer, ytsToCassette } from '@/lib/cassettes';

const GENRES = [
  'all', 'action', 'adventure', 'animation', 'biography', 'comedy', 'crime', 'documentary',
  'drama', 'family', 'fantasy', 'history', 'horror', 'music', 'mystery', 'romance',
  'sci-fi', 'sport', 'thriller', 'war', 'western',
].map(g => ({ value: g, label: g === 'all' ? 'All' : g === 'sci-fi' ? 'Sci-Fi' : g[0].toUpperCase() + g.slice(1) }));

const QUALITIES = [
  { value: 'all', label: 'Any' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '2160p', label: '4K' },
];

const RATINGS = [
  { value: 0, label: 'Any' },
  { value: 6, label: '6+' },
  { value: 7, label: '7+' },
  { value: 8, label: '8+' },
];

const SORTS = [
  { value: 'date_added', label: 'Newest Added' },
  { value: 'year', label: 'Release Year' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'download_count', label: 'Most Downloaded' },
  { value: 'like_count', label: 'Most Liked' },
  { value: 'seeds', label: 'Most Seeded' },
  { value: 'title', label: 'Title' },
];

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  padding: '8px 12px',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};

const PAGE_SIZE = 24;

/** Routes YTS artwork through the local media server (works around ISP DNS blocking). */
export function useYtsImage() {
  const { mediaPort } = useMedia();
  return useCallback(
    (url: string) => (IS_WEB ? url : url && mediaPort ? `http://127.0.0.1:${mediaPort}/yts-image?u=${encodeURIComponent(url)}` : ''),
    [mediaPort]
  );
}

// Survives navigating away from the page, so coming back shows the feed instantly.
interface FeedState { movies: YtsMovie[]; total: number; page: number }
const feedCache = new Map<string, FeedState>();

// Search + filters survive leaving the page, so coming back restores exactly what you had.
interface MovieSearch { query: string; genre: string; quality: string; sortBy: string; minRating: number }
const DEFAULT_SEARCH: MovieSearch = { query: '', genre: 'all', quality: 'all', sortBy: 'date_added', minRating: 0 };
let savedSearch: MovieSearch = DEFAULT_SEARCH;

/** Opens the Movies page with these filters next time it mounts (used by Shelf "See all"). */
export function presetMovieSearch(patch: Partial<MovieSearch>) {
  savedSearch = { ...DEFAULT_SEARCH, ...patch };
}

export function DiscoverPage() {
  const { showToast } = useToast();
  const ytsImage = useYtsImage();
  const [search, setSearchState] = useState<MovieSearch>(savedSearch);
  const setSearch = useCallback((patch: Partial<MovieSearch>) => {
    setSearchState(prev => (savedSearch = { ...prev, ...patch }));
  }, []);
  const { query: debouncedQuery, genre, quality, sortBy, minRating } = search;

  const { languages, ready: languagesReady } = useLanguages();
  // On the web the server filters by language, so a language change needs a fresh feed
  const feedKey = JSON.stringify([debouncedQuery.toLowerCase(), genre, quality, sortBy, minRating, IS_WEB ? languages.join(',') : '']);
  const initial = feedCache.get(feedKey);
  const [ytsMovies, setYtsMovies] = useState<YtsMovie[]>(initial?.movies ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [page, setPage] = useState(initial?.page ?? 0);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<YtsMovie | null>(null);
  const [streaming, setStreaming] = useState<{ movie: YtsMovie; torrent: YtsTorrent } | null>(null);

  const [mirror, setMirror] = useState('');
  useEffect(() => {
    window.electronAPI.settings.get('ytsMirror').then(v => setMirror(v || '')).catch(() => undefined);
  }, []);

  // Guards against out-of-order responses when filters change quickly
  const requestId = useRef(0);
  const loadingRef = useRef(false);

  const fetchPage = useCallback((pageToLoad: number) => window.electronAPI.yts.list({
    query: debouncedQuery, genre, quality, sortBy, minimumRating: minRating, page: pageToLoad, limit: PAGE_SIZE,
  }), [debouncedQuery, genre, quality, sortBy, minRating]);

  const loadPage = useCallback(async (pageToLoad: number, append: boolean): Promise<YtsMovie[] | null> => {
    const id = ++requestId.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPage(pageToLoad);
      if (id !== requestId.current) return null;
      const merged = append
        ? [...(feedCache.get(feedKey)?.movies ?? []), ...result.movies.filter(
            m => !(feedCache.get(feedKey)?.movies ?? []).some(x => x.id === m.id))]
        : result.movies;
      feedCache.set(feedKey, { movies: merged, total: result.total, page: pageToLoad });
      setYtsMovies(merged);
      setTotal(result.total);
      setPage(pageToLoad);

      // Warm the next page (titles cached in main) and this page's posters (browser cache),
      // so scrolling never reveals blank tiles.
      result.movies.forEach(m => { if (m.poster) new Image().src = ytsImage(m.poster); });
      if (merged.length < result.total) fetchPage(pageToLoad + 1).then(next =>
        next.movies.forEach(m => { if (m.poster) new Image().src = ytsImage(m.poster); })).catch(() => undefined);
      return result.movies;
    } catch (err) {
      if (id !== requestId.current) return null;
      if (!append) { setYtsMovies([]); setTotal(0); } // don't leave the previous search's results on screen
      setError(errorMessage(err, 'Failed to load movies'));
      return null;
    } finally {
      if (id === requestId.current) { loadingRef.current = false; setLoading(false); }
    }
  }, [fetchPage, feedKey, ytsImage]);

  // Filters changed: show cached feed immediately, or load page 1
  useEffect(() => {
    const cached = feedCache.get(feedKey);
    if (cached) {
      setYtsMovies(cached.movies); setTotal(cached.total); setPage(cached.page);
      setLoading(false); setError(null);
      loadingRef.current = false;
    } else {
      // Keep the current results on screen (dimmed) until the new ones arrive: no blank flash
      setPage(0);
      loadPage(1, false);
    }
  }, [feedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Language preference (Settings). YTS has no language filter, so results are filtered here.
  const visibleMovies = useMemo(
    () => (languagesReady ? watchableList(ytsMovies, languages) : []),
    [ytsMovies, languages, languagesReady]
  );
  const [stalled, setStalled] = useState(false);
  useEffect(() => { setStalled(false); }, [feedKey, languages]);

  // Fetch pages until enough movies in the preferred languages turn up. Stops after a few
  // pages without a single match so a rare language can't crawl the whole catalogue.
  const fillingRef = useRef(false);
  const fillFeed = useCallback(async () => {
    if (fillingRef.current) return;
    fillingRef.current = true;
    try {
      let gained = 0;
      let tries = 0;
      while (tries < 8 && gained < 12) {
        const cur = feedCache.get(feedKey);
        if (!cur || cur.movies.length >= cur.total) break;
        const fetched = await loadPage(cur.page + 1, true);
        if (!fetched) break;
        gained += fetched.filter(m => watchable(m, languages)).length;
        tries++;
      }
      if (gained === 0 && tries >= 8) setStalled(true);
    } finally {
      fillingRef.current = false;
    }
  }, [feedKey, languages, loadPage]);

  // Infinite scroll: load the next page as soon as the end of the feed approaches.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = page > 0 && ytsMovies.length < total;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || error || stalled || !languagesReady) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loadingRef.current) fillFeed();
    }, { rootMargin: '1500px 0px' });
    io.observe(el);
    return () => io.disconnect();
    // re-observe after every page so a still-visible sentinel keeps pulling pages
  }, [hasMore, error, stalled, languagesReady, page, fillFeed, loading]);

  const handleStream = (movie: YtsMovie, torrent: YtsTorrent) => {
    setSelected(null);
    setStreaming({ movie, torrent });
  };

  const handleDownload = async (movie: YtsMovie, torrent: YtsTorrent) => {
    try {
      await window.electronAPI.downloads.start(torrent.magnet, {
        title: movie.title, year: movie.year, quality: torrent.quality,
      });
      showToast(`Downloading ${movie.title} (${torrent.quality}). It will appear in your library when finished.`, 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Download failed'), 'error');
    }
  };

  // Card shortcuts use the default pick: 1080p with the most peers.
  const streamDefault = (movie: YtsMovie) => {
    const t = pickDefaultTorrent(movie.torrents);
    if (t) handleStream(movie, t); else setSelected(movie);
  };
  const downloadDefault = (movie: YtsMovie) => {
    const t = pickDefaultTorrent(movie.torrents);
    if (t) handleDownload(movie, t); else setSelected(movie);
  };

  // The first results also stand on a cassette shelf above the grid
  const SHELF_SIZE = 20;
  const shelfMovies = useMemo(() => visibleMovies.slice(0, SHELF_SIZE), [visibleMovies]);
  const shelfItems = useMemo(() => shelfMovies.map(m => ytsToCassette(m, ytsImage(m.poster))), [shelfMovies, ytsImage]);

  if (streaming) {
    return (
      <TorrentPlayer
        title={`${streaming.movie.title} (${streaming.movie.year}) · ${streaming.torrent.quality}`}
        magnet={streaming.torrent.magnet}
        onClose={() => setStreaming(null)}
        onError={(msg) => { showToast(msg, 'error'); setStreaming(null); }}
      />
    );
  }

  const showEmptyError = !!error && ytsMovies.length === 0;
  const stale = loading && page === 0 && ytsMovies.length > 0;
  const activeFilters = Number(genre !== 'all') + Number(quality !== 'all') + Number(minRating > 0) + Number(sortBy !== 'date_added');
  const resultLabel = loading && page === 0
    ? 'Searching…'
    : debouncedQuery
      ? `${total.toLocaleString()} result${total === 1 ? '' : 's'}`
      : languages.length === 0 && total > 0 ? `${total.toLocaleString()} movies` : undefined;

  return (
    <div className="browse-page">
      <SearchHero
        scope="movies"
        title="Movies"
        subtitle={debouncedQuery ? <>Results for <strong>“{debouncedQuery}”</strong></> : IS_WEB ? 'Discover films, ratings and trailers' : 'Stream or download from YTS'}
        placeholder="Search movies by title, actor or year…"
        query={debouncedQuery}
        onQueryChange={q => setSearch({ query: q })}
        loading={loading && page <= 1}
        resultLabel={resultLabel}
        activeFilters={activeFilters}
        onResetFilters={() => setSearch({ genre: 'all', quality: 'all', sortBy: 'date_added', minRating: 0 })}
        filters={
          <>
            <FilterChips label="Genre" value={genre} options={GENRES} onChange={g => setSearch({ genre: g })} />
            <FilterSegment label="Quality" value={quality} options={QUALITIES} onChange={q => setSearch({ quality: q })} />
            <FilterSegment label="Rating" value={minRating} options={RATINGS} onChange={r => setSearch({ minRating: r })} />
            <FilterSelect label="Sort" value={sortBy} options={SORTS} onChange={v => setSearch({ sortBy: v })} />
            <div className="filter-group">
              <span className="filter-label">Language</span>
              <LanguagePicker align="left" />
            </div>
          </>
        }
      />

      {shelfItems.length >= 3 && (
        <div className={`browse-shelf ${stale ? 'is-stale' : ''}`}>
          <CassetteShelf
            key={feedKey /* a new search starts the shelf from the top */}
            title={debouncedQuery ? 'Top matches' : SORTS.find(o => o.value === sortBy)?.label ?? 'Featured'}
            items={shelfItems}
            onOpen={i => setSelected(shelfMovies[i])}
            renderActions={i => shelfMovies[i] && (
              <MovieShelfActions
                movie={shelfMovies[i]}
                onStream={streamDefault}
                onDownload={downloadDefault}
                onTrailer={m => openTrailer(m, showToast)}
                onDetails={setSelected}
              />
            )}
          />
          <h2 className="browse-grid-title">{debouncedQuery ? 'All results' : 'All movies'}</h2>
        </div>
      )}

      {showEmptyError && (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="empty-icon"><Icon name="warning" /></div>
          <h2 className="empty-title">{IS_WEB ? "Couldn't load movies" : "Couldn't load YTS"}</h2>
          <p className="empty-subtitle">{error}</p>
          {IS_WEB ? (
            <button className="btn btn-accent" style={{ marginTop: 16 }} onClick={() => loadPage(1, false)}>Try again</button>
          ) : (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Custom YTS mirror, e.g. https://yts.example"
              value={mirror}
              onChange={e => setMirror(e.target.value)}
              style={{ ...selectStyle, minWidth: 320, cursor: 'text' }}
            />
            <button
              className="btn btn-accent"
              onClick={async () => {
                try {
                  await window.electronAPI.settings.set('ytsMirror', mirror.trim());
                } catch (err) {
                  showToast(errorMessage(err, 'Could not save the mirror'), 'error');
                  return;
                }
                loadPage(1, false);
              }}
            >
              Save &amp; Retry
            </button>
          </div>
          )}
        </div>
      )}

      {!error && visibleMovies.length === 0 && !loading && !hasMore && (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="empty-icon"><Icon name="search" /></div>
          <h2 className="empty-title">{debouncedQuery ? `Nothing found for “${debouncedQuery}”` : 'No movies match these filters'}</h2>
          <p className="empty-subtitle">Check the spelling, try fewer words, or loosen the filters.</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            {debouncedQuery && <button className="btn btn-secondary" onClick={() => setSearch({ query: '' })}>Clear search</button>}
            {activeFilters > 0 && (
              <button className="btn btn-ghost" onClick={() => setSearch({ genre: 'all', quality: 'all', sortBy: 'date_added', minRating: 0 })}>Reset filters</button>
            )}
          </div>
        </div>
      )}

      <div className={`search-results-grid ${stale ? 'is-stale' : ''}`} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {visibleMovies.map(movie => (
          <YtsCard
            key={movie.id}
            movie={movie}
            posterUrl={ytsImage(movie.poster)}
            onSelect={setSelected}
            onStream={streamDefault}
            onDownload={downloadDefault}
          />
        ))}

        {/* Skeleton tiles while a page is loading, so the grid never looks empty */}
        {((loading && !stale) || !languagesReady) && Array.from({ length: visibleMovies.length === 0 ? 12 : 6 }, (_, i) => (
          <div key={`s${i}`} className="movie-card" style={{ width: '100%' }}>
            <div className="movie-card-poster yts-skeleton" />
            <div className="movie-card-info">
              <div className="yts-skeleton-line" style={{ width: '80%' }} />
              <div className="yts-skeleton-line" style={{ width: '40%', marginTop: 6 }} />
            </div>
          </div>
        ))}
      </div>

      {error && ytsMovies.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 24, color: 'var(--text-muted)', fontSize: 13 }}>
          Couldn't load more.{' '}
          <button className="btn btn-ghost btn-sm" onClick={() => loadPage(page + 1, true)}>Retry</button>
        </div>
      )}

      {/* Sentinel: when this nears the viewport the next page is fetched automatically */}
      <div ref={sentinelRef} style={{ height: 1 }} />

      {stalled && (
        <div style={{ textAlign: 'center', marginTop: 24, color: 'var(--text-muted)', fontSize: 13 }}>
          No more watchable movies in your selected languages found yet.{' '}
          <button className="btn btn-ghost btn-sm" onClick={() => { setStalled(false); }}>Keep searching</button>
        </div>
      )}

      {selected && (
        <YtsDetail movie={selected} onClose={() => setSelected(null)} onStream={handleStream} onDownload={handleDownload} />
      )}
    </div>
  );
}

// ─── Grid card ──────────────────────────────────────────────────────

export function YtsCard({ movie: m, posterUrl, onSelect, onStream, onDownload }: {
  movie: YtsMovie;
  posterUrl: string;
  onSelect: (m: YtsMovie) => void;
  onStream: (m: YtsMovie) => void;
  onDownload: (m: YtsMovie) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const qualities = Array.from(new Set(m.torrents.map(t => t.quality))).join(' / ');
  return (
    <div className="movie-card" style={{ width: '100%' }} onClick={() => onSelect(m)}>
      <div className="movie-card-poster">
        {/* Title shows immediately; the poster fades in over it when it arrives */}
        <div className="movie-card-poster-placeholder" style={{ display: 'flex' }}>
          <span className="placeholder-title">{m.title}</span>
        </div>
        {posterUrl && (
          <img
            src={posterUrl}
            alt={m.title}
            decoding="async"
            onLoad={() => setLoaded(true)}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
              opacity: loaded ? 1 : 0, transition: 'opacity 250ms ease',
            }}
          />
        )}
        <div className="movie-card-overlay">
          <div className="card-overlay-actions">
            <button
              className="card-action-btn play"
              title={IS_WEB ? 'Watch trailer' : 'Stream (1080p, most peers)'}
              onClick={e => { e.stopPropagation(); onStream(m); }}
            ><Icon name="play" /></button>
            {!IS_WEB && (
              <button
                className="card-action-btn list"
                title="Download to library"
                onClick={e => { e.stopPropagation(); onDownload(m); }}
              ><Icon name="download" /></button>
            )}
            <button
              className="card-action-btn info"
              title="Details and other qualities"
              onClick={e => { e.stopPropagation(); onSelect(m); }}
            ><Icon name="info" /></button>
          </div>
          <div className="card-overlay-title">{m.title}</div>
          <div className="card-overlay-meta">
            <span>{m.year}</span>
            <span> · <Icon name="star" size={12} /> {m.rating.toFixed(1)}</span>
          </div>
        </div>
      </div>
      <div className="movie-card-info">
        <div className="movie-card-title">{m.title}</div>
        <div className="movie-card-meta">{m.year}{qualities ? ` · ${qualities}` : m.rating > 0 ? ` · ★ ${m.rating.toFixed(1)}` : ''}</div>
      </div>
    </div>
  );
}

// ─── Detail modal ───────────────────────────────────────────────────

/** Web: fetch the full record (runtime + trailer), offer the trailer and point to the desktop app. */
function WebMovieActions({ movie }: { movie: YtsMovie }) {
  const { showToast } = useToast();
  const [full, setFull] = useState<YtsMovie | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.yts.get(movie.id).then(m => { if (!cancelled) setFull(m); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [movie.id]);
  const m = full ?? movie;
  return (
    <>
      {full && full.runtime > 0 && !movie.runtime && (
        <p style={{ color: 'var(--text-muted)', marginTop: -12, marginBottom: 20, fontSize: 14 }}>
          {Math.floor(full.runtime / 60)}h {full.runtime % 60}m
        </p>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-lg" onClick={() => openTrailer(m, showToast)} disabled={!!full && !full.trailerCode}>
          <Icon name="play" /> {full && !full.trailerCode ? 'No trailer available' : 'Watch trailer'}
        </button>
        <a className="btn btn-secondary btn-lg" href={DESKTOP_APP_URL} target="_blank" rel="noreferrer">
          <Icon name="download" /> Stream in the desktop app
        </a>
      </div>
    </>
  );
}

export function YtsDetail({ movie, onClose, onStream, onDownload }: {
  movie: YtsMovie;
  onClose: () => void;
  onStream: (movie: YtsMovie, torrent: YtsTorrent) => void;
  onDownload: (movie: YtsMovie, torrent: YtsTorrent) => void;
}) {
  const ytsImage = useYtsImage();
  // Default: 1080p with the most peers
  const initial = pickDefaultTorrent(movie.torrents);
  const [hash, setHash] = useState(initial?.hash || '');
  const torrent = movie.torrents.find(t => t.hash === hash);

  return (
    <div className="movie-detail-overlay" onClick={onClose}>
      <div className="movie-detail" onClick={e => e.stopPropagation()}>
        <div className="detail-backdrop">
          {movie.backdrop ? <img src={ytsImage(movie.backdrop)} alt="" /> : <div className="detail-backdrop-placeholder" />}
          <div className="detail-backdrop-gradient" />
          <button className="detail-close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="detail-content">
          <h1 className="detail-title">{movie.title}</h1>
          <div className="detail-meta">
            <span>{movie.year}</span>
            {movie.runtime > 0 && <span>{Math.floor(movie.runtime / 60)}h {movie.runtime % 60}m</span>}
            <span><Icon name="star" size={14} /> {movie.rating.toFixed(1)}</span>
            {movie.genres.length > 0 && <span>{movie.genres.join(' · ')}</span>}
          </div>

          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
            {movie.summary || 'No synopsis available.'}
          </p>

          {IS_WEB ? (
            <WebMovieActions movie={movie} />
          ) : movie.torrents.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No torrents available for this movie.</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {movie.torrents.map(t => (
                  <label
                    key={t.hash}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                      background: t.hash === hash ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                      border: `1px solid ${t.hash === hash ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 14,
                    }}
                  >
                    <input type="radio" name="torrent" checked={t.hash === hash} onChange={() => setHash(t.hash)} />
                    <strong style={{ minWidth: 56 }}>{t.quality}</strong>
                    <span style={{ color: 'var(--text-muted)', minWidth: 70 }}>{t.type}</span>
                    <span style={{ color: 'var(--text-muted)', minWidth: 60 }}>{t.videoCodec}</span>
                    <span style={{ minWidth: 70 }}>{t.size}</span>
                    <span style={{ color: t.seeds > 0 ? '#46d369' : '#e50914', marginLeft: 'auto' }}>
                      {t.seeds} seeds · {t.peers} peers
                    </span>
                  </label>
                ))}
              </div>

              {torrent && /^(x265|hevc)/i.test(torrent.videoCodec) && (
                <p style={{ color: '#f5a623', fontSize: 13, marginBottom: 16 }}>
                  <Icon name="warning" size={14} /> This is an HEVC/x265 encode. It will be converted on the fly for playback (GPU accelerated), so an x264 version starts faster.
                </p>
              )}

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  className="btn btn-primary btn-lg"
                  disabled={!torrent}
                  onClick={() => torrent && onStream(movie, torrent)}
                >
                  <Icon name="play" /> Stream{torrent ? ` ${torrent.quality}` : ''}
                </button>
                <button
                  className="btn btn-secondary btn-lg"
                  disabled={!torrent}
                  onClick={() => torrent && onDownload(movie, torrent)}
                >
                  <Icon name="download" /> Download
                </button>
                {movie.trailerCode && (
                  <button
                    className="btn btn-secondary btn-lg"
                    onClick={() => window.electronAPI.shell.openExternal(`https://www.youtube.com/watch?v=${encodeURIComponent(movie.trailerCode)}`)}
                  >
                    Trailer
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Streaming player ───────────────────────────────────────────────

/** Streams any magnet link through the local media server and plays it. */
export function TorrentPlayer({ title, magnet, onClose, onError }: {
  title: string;
  magnet: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const { mediaPort } = useMedia();
  const [streamPath, setStreamPath] = useState<string | null>(null);
  const [stats, setStats] = useState<TorrentStats | null>(null);

  // Start the torrent; stop it when the player closes.
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.torrent.start(magnet)
      .then(info => { if (!cancelled) setStreamPath(info.streamPath); })
      .catch(err => {
        if (cancelled) return;
        onError(errorMessage(err, 'Failed to start stream'));
      });
    return () => {
      cancelled = true;
      window.electronAPI.torrent.stop().catch(() => undefined);
    };
  }, [magnet]);

  useEffect(() => {
    const timer = setInterval(() => {
      window.electronAPI.torrent.stats().then(setStats).catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const statusText = !streamPath
    ? `Connecting to peers…${stats ? ` ${stats.peers} peers` : ''}`
    : stats
      ? `Buffering · ${formatBytes(stats.downloadSpeed)}/s · ${stats.peers} peers · ${(stats.fileProgress * 100).toFixed(1)}% downloaded`
      : 'Buffering…';

  const src = streamPath && mediaPort ? `http://127.0.0.1:${mediaPort}${streamPath}` : null;

  if (!src) {
    return (
      <div className="player-overlay">
        <div className="player-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, color: 'white' }}>
          <button className="icon-btn" style={{ position: 'absolute', top: 24, left: 24, color: 'white' }} onClick={onClose} title="Cancel"><Icon name="back" size={24} /></button>
          <div className="spinner" />
          <p style={{ fontSize: 14, color: '#ccc' }}>{title}</p>
          <p style={{ fontSize: 13, color: '#888' }}>{statusText}</p>
        </div>
      </div>
    );
  }

  return (
    <VideoPlayer
      src={src}
      title={title}
      statusText={statusText}
      onClose={onClose}
      onProgressUpdate={() => undefined}
    />
  );
}
