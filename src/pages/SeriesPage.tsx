import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { errorMessage } from '@/lib/errors';
import { SearchHero, FilterChips, FilterSegment, FilterSelect } from '@/components/SearchHero';
import { CassetteShelf } from '@/components/CassetteShelf';
import { LanguagePicker } from '@/components/LanguagePicker';
import { IS_WEB, DESKTOP_APP_URL } from '@/lib/platform';
import { playTrailer } from '@/components/TrailerHost';
import { seriesToCassette } from '@/lib/cassettes';
import type { SeriesShow, SeriesDetail as SeriesDetailData, SeriesEpisode, SeriesTorrent } from '@/types';
import { pickDefaultEpisodeTorrent } from '@/types';
import { TorrentPlayer, useYtsImage } from '@/pages/DiscoverPage';
import { useToast } from '@/contexts/ToastContext';
import { useLanguages, matchesLanguageName } from '@/lib/languages';
import { Icon } from '@/components/Icon';

const PAGE_SIZE = 24;
const cleanError = errorMessage;

const pad = (n: number) => String(n).padStart(2, '0');

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  padding: '8px 12px',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
};

// ─── Shared stream / download actions ───────────────────────────────

/** Stream + download handlers for episodes, shared by the Series page and the Home row. */
export function useSeriesActions() {
  const { showToast } = useToast();
  const [streaming, setStreaming] = useState<{ title: string; magnet: string } | null>(null);

  const stream = (show: SeriesShow, ep: SeriesEpisode, torrent: SeriesTorrent) => {
    setStreaming({ title: `${show.title} S${pad(ep.season)}E${pad(ep.number)} · ${torrent.quality}`, magnet: torrent.magnet });
  };

  const download = async (show: SeriesShow, ep: SeriesEpisode, torrent: SeriesTorrent): Promise<boolean> => {
    try {
      await window.electronAPI.downloads.start(torrent.magnet, {
        title: `${show.title} S${pad(ep.season)}E${pad(ep.number)}`,
        year: show.year,
        quality: torrent.quality,
        series: { showTitle: show.title, season: ep.season, episode: ep.number },
      });
      return true;
    } catch (err) {
      showToast(cleanError(err, 'Download failed'), 'error');
      return false;
    }
  };

  const player = streaming ? (
    <TorrentPlayer
      title={streaming.title}
      magnet={streaming.magnet}
      onClose={() => setStreaming(null)}
      onError={msg => { showToast(msg, 'error'); setStreaming(null); }}
    />
  ) : null;

  return { stream, download, player };
}

// ─── Card ───────────────────────────────────────────────────────────

export function SeriesCard({ show, posterUrl, onSelect }: { show: SeriesShow; posterUrl: string; onSelect: (s: SeriesShow) => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="movie-card" style={{ width: '100%' }} onClick={() => onSelect(show)}>
      <div className="movie-card-poster">
        <div className="movie-card-poster-placeholder" style={{ display: 'flex' }}>
          <span className="placeholder-title">{show.title}</span>
        </div>
        {posterUrl && (
          <img
            src={posterUrl}
            alt={show.title}
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
            <button className="card-action-btn play" title="Episodes" onClick={e => { e.stopPropagation(); onSelect(show); }}>
              <Icon name="play" />
            </button>
          </div>
          <div className="card-overlay-title">{show.title}</div>
          <div className="card-overlay-meta">
            <span>{show.year || ''}</span>
            {show.rating > 0 && <span> · <Icon name="star" size={12} /> {show.rating.toFixed(1)}</span>}
          </div>
        </div>
      </div>
      <div className="movie-card-info">
        <div className="movie-card-title">{show.title}</div>
        <div className="movie-card-meta">{[show.year || null, show.network || null].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
  );
}

// ─── Detail ─────────────────────────────────────────────────────────

const QUALITIES = ['auto', '2160p', '1080p', '720p', '480p'];

export function SeriesDetail({ show, onClose, onStream, onDownload }: {
  show: SeriesShow;
  onClose: () => void;
  onStream: (show: SeriesShow, ep: SeriesEpisode, torrent: SeriesTorrent) => void;
  onDownload: (show: SeriesShow, ep: SeriesEpisode, torrent: SeriesTorrent) => Promise<boolean>;
}) {
  const { showToast } = useToast();
  const ytsImage = useYtsImage();
  const [detail, setDetail] = useState<SeriesDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [quality, setQuality] = useState('auto');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    window.electronAPI.series.get(show.id)
      .then(d => {
        if (cancelled) return;
        setDetail(d);
        // Open on the newest season that has something to watch
        const withTorrents = d.episodes.filter(e => e.torrents.length > 0).map(e => e.season);
        const all = d.episodes.map(e => e.season);
        setSeason(withTorrents.length ? Math.max(...withTorrents) : all.length ? Math.max(...all) : null);
      })
      .catch(err => { if (!cancelled) setError(cleanError(err, 'Could not load episodes')); });
    return () => { cancelled = true; };
  }, [show.id, reloadKey]);

  const seasons = useMemo(
    () => Array.from(new Set((detail?.episodes ?? []).map(e => e.season))).sort((a, b) => a - b),
    [detail]
  );
  const episodes = useMemo(
    () => (detail?.episodes ?? []).filter(e => e.season === season).sort((a, b) => a.number - b.number),
    [detail, season]
  );

  const choose = (ep: SeriesEpisode): SeriesTorrent | undefined => {
    if (quality !== 'auto') {
      const wanted = ep.torrents
        .filter(t => t.quality === quality && (t.seeds > 0 || t.peers > 0))
        .sort((a, b) => (b.seeds * 2 + b.peers) - (a.seeds * 2 + a.peers))[0];
      if (wanted) return wanted;
    }
    return pickDefaultEpisodeTorrent(ep.torrents);
  };

  const downloadSeason = async () => {
    const targets = episodes.map(ep => ({ ep, t: choose(ep) })).filter((x): x is { ep: SeriesEpisode; t: SeriesTorrent } => !!x.t);
    if (targets.length === 0) { showToast('No episodes with peers in this season', 'error'); return; }
    let ok = 0;
    for (const { ep, t } of targets) if (await onDownload(show, ep, t)) ok++;
    if (ok > 0) showToast(`Downloading ${ok} episode${ok === 1 ? '' : 's'} of ${show.title} season ${season}. They will appear in your library when finished.`, 'success');
  };

  const downloadOne = async (ep: SeriesEpisode, t: SeriesTorrent) => {
    if (await onDownload(show, ep, t)) {
      showToast(`Downloading ${show.title} S${pad(ep.season)}E${pad(ep.number)} (${t.quality})`, 'success');
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const availableCount = episodes.filter(e => choose(e)).length;

  return (
    <div className="movie-detail-overlay" onClick={onClose}>
      <div className="movie-detail" onClick={e => e.stopPropagation()} style={{ maxWidth: 980 }}>
        <div style={{ position: 'relative', display: 'flex', gap: 28, padding: '36px 40px 20px' }}>
          <button className="detail-close" onClick={onClose}><Icon name="close" /></button>
          <div style={{ width: 170, flexShrink: 0, aspectRatio: '2 / 3', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-tertiary)' }}>
            {show.posterLarge && (
              <img src={ytsImage(show.posterLarge)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="detail-title" style={{ fontSize: 34 }}>{show.title}</h1>
            <div className="detail-meta">
              {show.year > 0 && <span>{show.year}</span>}
              {show.status && <span>{show.status}</span>}
              {show.rating > 0 && <span><Icon name="star" size={14} /> {show.rating.toFixed(1)}</span>}
              {show.network && <span>{show.network}</span>}
              {show.genres.length > 0 && <span>{show.genres.slice(0, 3).join(' · ')}</span>}
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, fontSize: 14, maxHeight: 130, overflow: 'auto' }}>
              {show.summary || 'No synopsis available.'}
            </p>
            {IS_WEB && (
              <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                {(detail?.show.trailerCode || show.trailerCode) && (
                  <button className="btn btn-primary" onClick={() => playTrailer((detail?.show.trailerCode || show.trailerCode)!, show.title)}>
                    <Icon name="play" /> Watch trailer
                  </button>
                )}
                <a className="btn btn-secondary" href={DESKTOP_APP_URL} target="_blank" rel="noreferrer">
                  <Icon name="download" /> Watch episodes in the desktop app
                </a>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '0 40px 40px' }}>
          {error && (
            <div style={{ padding: '24px 0', color: 'var(--text-muted)' }}>
              <p style={{ marginBottom: 12 }}>{error}</p>
              <button className="btn btn-ghost btn-sm" onClick={() => setReloadKey(k => k + 1)}>Retry</button>
            </div>
          )}

          {!error && !detail && (
            <div className="empty-state" style={{ padding: '40px 0' }}><div className="spinner" /></div>
          )}

          {detail && seasons.length === 0 && <p style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No episodes listed for this show.</p>}

          {detail && seasons.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0 16px' }}>
                <select value={season ?? ''} onChange={e => setSeason(Number(e.target.value))} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {seasons.map(s => <option key={s} value={s}>Season {s}</option>)}
                </select>
                {!IS_WEB && (
                  <>
                    <select value={quality} onChange={e => setQuality(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }} title="Preferred quality">
                      {QUALITIES.map(q => <option key={q} value={q}>{q === 'auto' ? 'Quality: Auto (1080p first)' : q}</option>)}
                    </select>
                    <button className="btn btn-secondary btn-sm" disabled={availableCount === 0} onClick={downloadSeason} style={{ marginLeft: 'auto' }}>
                      <Icon name="download" /> Download season ({availableCount})
                    </button>
                  </>
                )}
                {IS_WEB && <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)' }}>{episodes.length} episodes</span>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {episodes.map(ep => {
                  const t = choose(ep);
                  return (
                    <div
                      key={`${ep.season}x${ep.number}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px',
                        background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                      }}
                    >
                      <span style={{ width: 34, color: 'var(--text-muted)', fontWeight: 700, textAlign: 'center' }}>{ep.number}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ep.name || `Episode ${ep.number}`}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {ep.airdate && ep.airdate > today ? `Airs ${ep.airdate}` : ep.airdate}
                          {t && <> · {t.quality}{t.codec ? ` ${t.codec}` : ''} · {t.size} · {t.seeds} seeds</>}
                          {!IS_WEB && !t && ep.airdate && ep.airdate <= today && <> · No torrents with peers</>}
                        </div>
                      </div>
                      {t && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-primary btn-sm" onClick={() => onStream(show, ep, t)} title={`Stream ${t.quality}`}>
                            <Icon name="play" /> Play
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => downloadOne(ep, t)} title="Download to library">
                            <Icon name="download" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────

interface FeedState { shows: SeriesShow[]; total: number; page: number }
const feedCache = new Map<string, FeedState>();

// TVMaze only searches by text, so these filters run on the loaded results (instant, no requests).
interface SeriesSearch { query: string; genre: string; status: string; minRating: number; sortBy: string }
const DEFAULT_SERIES_SEARCH: SeriesSearch = { query: '', genre: 'all', status: 'all', minRating: 0, sortBy: 'popular' };
let savedSeriesSearch: SeriesSearch = DEFAULT_SERIES_SEARCH;

/** Opens the Series page with these filters next time it mounts (used by Shelf "See all"). */
export function presetSeriesSearch(patch: Partial<SeriesSearch>) {
  savedSeriesSearch = { ...DEFAULT_SERIES_SEARCH, ...patch };
}

const SERIES_SORTS = [
  { value: 'popular', label: 'Most Popular' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'newest', label: 'Newest' },
  { value: 'title', label: 'Title A–Z' },
];

const SERIES_STATUS = [
  { value: 'all', label: 'Any' },
  { value: 'Running', label: 'Airing' },
  { value: 'Ended', label: 'Ended' },
];

const SERIES_RATINGS = [
  { value: 0, label: 'Any' },
  { value: 7, label: '7+' },
  { value: 8, label: '8+' },
];

export function SeriesPage() {
  const ytsImage = useYtsImage();
  const { languages, ready: languagesReady } = useLanguages();
  const { stream, download, player } = useSeriesActions();
  const [search, setSearchState] = useState<SeriesSearch>(savedSeriesSearch);
  const setSearch = useCallback((patch: Partial<SeriesSearch>) => {
    setSearchState(prev => (savedSeriesSearch = { ...prev, ...patch }));
  }, []);
  const { query: debouncedQuery, genre, status, minRating, sortBy } = search;
  // On the web the server filters by language, so a language change needs a fresh feed
  const feedKey = debouncedQuery.toLowerCase() + (IS_WEB ? `|${languages.join(',')}` : '');
  const initial = feedCache.get(feedKey);
  const [shows, setShows] = useState<SeriesShow[]>(initial?.shows ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [page, setPage] = useState(initial?.page ?? 0);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SeriesShow | null>(null);
  const requestId = useRef(0);
  const loadingRef = useRef(false);

  const loadPage = useCallback(async (pageToLoad: number, append: boolean) => {
    const id = ++requestId.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.series.list({ query: debouncedQuery, page: pageToLoad, limit: PAGE_SIZE });
      if (id !== requestId.current) return;
      const prev = append ? feedCache.get(feedKey)?.shows ?? [] : [];
      const merged = [...prev, ...result.shows.filter(s => !prev.some(p => p.id === s.id))];
      feedCache.set(feedKey, { shows: merged, total: result.total, page: pageToLoad });
      setShows(merged); setTotal(result.total); setPage(pageToLoad);
      result.shows.forEach(s => { if (s.poster) new Image().src = ytsImage(s.poster); });
    } catch (err) {
      if (id !== requestId.current) return;
      if (!append) { setShows([]); setTotal(0); }
      setError(cleanError(err, 'Failed to load series'));
    } finally {
      if (id === requestId.current) { loadingRef.current = false; setLoading(false); }
    }
  }, [debouncedQuery, feedKey, ytsImage]);

  useEffect(() => {
    const cached = feedCache.get(feedKey);
    if (cached) {
      setShows(cached.shows); setTotal(cached.total); setPage(cached.page); setLoading(false); setError(null);
      loadingRef.current = false;
    } else {
      setPage(0); // keep current results on screen (dimmed) until the new ones arrive
      loadPage(1, false);
    }
  }, [feedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pool size is known up front for trending; search results come back in one page.
  const hasMore = page > 0 && !debouncedQuery && page * PAGE_SIZE < total;
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || error || !languagesReady) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loadingRef.current) loadPage(page + 1, true);
    }, { rootMargin: '1500px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, error, languagesReady, page, loadPage, loading]);

  const languageMatched = useMemo(
    () => (languagesReady ? shows.filter(s => matchesLanguageName(s.language, languages)) : []),
    [shows, languages, languagesReady]
  );

  // Genre chips come from what's actually loaded, most common first
  const genreOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of languageMatched) for (const g of s.genres) counts.set(g, (counts.get(g) || 0) + 1);
    const top = Array.from(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([g]) => ({ value: g, label: g }));
    if (genre !== 'all' && !top.some(o => o.value === genre)) top.push({ value: genre, label: genre });
    return [{ value: 'all', label: 'All' }, ...top];
  }, [languageMatched, genre]);

  const visible = useMemo(() => {
    const list = languageMatched.filter(s =>
      (genre === 'all' || s.genres.includes(genre)) &&
      (status === 'all' || s.status === status) &&
      (minRating === 0 || s.rating >= minRating));
    if (sortBy === 'rating') return [...list].sort((a, b) => b.rating - a.rating);
    if (sortBy === 'newest') return [...list].sort((a, b) => b.year - a.year);
    if (sortBy === 'title') return [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list; // popular: the order TVMaze/EZTV returned
  }, [languageMatched, genre, status, minRating, sortBy]);

  // The first results also stand on a cassette shelf above the grid
  const shelfShows = useMemo(() => visible.slice(0, 20), [visible]);
  const shelfItems = useMemo(() => shelfShows.map(s => seriesToCassette(s, ytsImage(s.poster))), [shelfShows, ytsImage]);
  const shelfKey = JSON.stringify([feedKey, genre, status, minRating, sortBy]);

  if (player) return player;

  const stale = loading && page === 0 && shows.length > 0;
  const activeFilters = Number(genre !== 'all') + Number(status !== 'all') + Number(minRating > 0) + Number(sortBy !== 'popular');
  const resetFilters = () => setSearch({ genre: 'all', status: 'all', minRating: 0, sortBy: 'popular' });

  return (
    <div className="browse-page">
      <SearchHero
        scope="series"
        title="Series"
        subtitle={debouncedQuery ? <>Results for <strong>“{debouncedQuery}”</strong></> : IS_WEB ? 'Popular right now. Episodes, ratings and trailers.' : 'Popular right now. Stream or download any episode.'}
        placeholder="Search series by title…"
        query={debouncedQuery}
        onQueryChange={q => setSearch({ query: q })}
        loading={loading && page <= 1}
        resultLabel={loading && page === 0 ? 'Searching…' : `${visible.length} show${visible.length === 1 ? '' : 's'}`}
        activeFilters={activeFilters}
        onResetFilters={resetFilters}
        filters={
          <>
            {genreOptions.length > 1 && (
              <FilterChips label="Genre" value={genre} options={genreOptions} onChange={g => setSearch({ genre: g })} />
            )}
            <FilterSegment label="Status" value={status} options={SERIES_STATUS} onChange={v => setSearch({ status: v })} />
            <FilterSegment label="Rating" value={minRating} options={SERIES_RATINGS} onChange={r => setSearch({ minRating: r })} />
            <FilterSelect label="Sort" value={sortBy} options={SERIES_SORTS} onChange={v => setSearch({ sortBy: v })} />
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
            key={shelfKey /* a new search or filter starts the shelf from the top */}
            title={debouncedQuery ? 'Top matches' : SERIES_SORTS.find(o => o.value === sortBy)?.label ?? 'Featured'}
            items={shelfItems}
            onOpen={i => setSelected(shelfShows[i])}
            renderActions={i => {
              const s = shelfShows[i];
              if (!s) return null;
              return (
                <>
                  <button className="btn btn-primary" onClick={() => setSelected(s)}><Icon name="play" /> Episodes</button>
                  {s.imdbId && (
                    <button
                      className="btn btn-ghost"
                      onClick={() => Promise.resolve(window.electronAPI.shell.openExternal(`https://www.imdb.com/title/${s.imdbId.startsWith('tt') ? s.imdbId : `tt${s.imdbId}`}/`)).catch(() => undefined)}
                    >
                      <Icon name="link" /> IMDb
                    </button>
                  )}
                </>
              );
            }}
          />
          <h2 className="browse-grid-title">{debouncedQuery ? 'All results' : 'All series'}</h2>
        </div>
      )}

      {error && visible.length === 0 && (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="empty-icon"><Icon name="warning" /></div>
          <h2 className="empty-title">Couldn't load series</h2>
          <p className="empty-subtitle">{error}</p>
          <button className="btn btn-accent" style={{ marginTop: 16 }} onClick={() => loadPage(1, false)}>Retry</button>
        </div>
      )}

      {!error && visible.length === 0 && !loading && !hasMore && (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="empty-icon"><Icon name="search" /></div>
          <h2 className="empty-title">{debouncedQuery ? `No series found for “${debouncedQuery}”` : 'No series match these filters'}</h2>
          <p className="empty-subtitle">Try another title, loosen the filters, or check your language settings.</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            {debouncedQuery && <button className="btn btn-secondary" onClick={() => setSearch({ query: '' })}>Clear search</button>}
            {activeFilters > 0 && <button className="btn btn-ghost" onClick={resetFilters}>Reset filters</button>}
          </div>
        </div>
      )}

      <div className={`search-results-grid ${stale ? 'is-stale' : ''}`} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {visible.map(show => (
          <SeriesCard key={show.id} show={show} posterUrl={ytsImage(show.poster)} onSelect={setSelected} />
        ))}
        {((loading && !stale) || !languagesReady) && Array.from({ length: visible.length === 0 ? 12 : 6 }, (_, i) => (
          <div key={`s${i}`} className="movie-card" style={{ width: '100%' }}>
            <div className="movie-card-poster yts-skeleton" />
            <div className="movie-card-info">
              <div className="yts-skeleton-line" style={{ width: '80%' }} />
              <div className="yts-skeleton-line" style={{ width: '40%', marginTop: 6 }} />
            </div>
          </div>
        ))}
      </div>

      <div ref={sentinelRef} style={{ height: 1 }} />

      {selected && (
        <SeriesDetail
          show={selected}
          onClose={() => setSelected(null)}
          onStream={(s, ep, t) => { setSelected(null); stream(s, ep, t); }}
          onDownload={download}
        />
      )}
    </div>
  );
}
