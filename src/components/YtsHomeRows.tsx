// The online Shelf: every YTS genre and the popular series, as endless cassette shelves.
//
// Efficiency:
//  • A shelf only fetches when it scrolls within ~1200px of the viewport.
//  • Each shelf fetches its next page as you approach its end (CassetteShelf `onNearEnd`).
//  • All series shelves share one pool of popular shows, so genre shelves cost no extra requests.
//  • Loaded shelves are cached for the session, so returning to the Shelf is instant.
import { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore, type RefObject } from 'react';
import { CassetteShelf } from './CassetteShelf';
import { openTrailer, seriesToCassette, ytsToCassette } from '@/lib/cassettes';
import { inDecade, type Decade } from '@/lib/decades';
import { errorMessage } from '@/lib/errors';
import type { Movie, YtsMovie, YtsTorrent, YtsListOptions, SeriesShow } from '@/types';
import { pickDefaultTorrent } from '@/types';
import { YtsDetail, TorrentPlayer, useYtsImage, presetMovieSearch } from '@/pages/DiscoverPage';
import { SeriesDetail, useSeriesActions, presetSeriesSearch } from '@/pages/SeriesPage';
import { useToast } from '@/contexts/ToastContext';
import { Icon } from './Icon';
import { MovieShelfActions } from './MovieActions';
import { watchableList } from '@/lib/yts';
import { useLanguages, matchesLanguageName } from '@/lib/languages';
import { IS_WEB } from '@/lib/platform';

// ─── Layout ─────────────────────────────────────────────────────────

interface MovieShelfConfig {
  title: string;
  options: YtsListOptions;
}

const PAGE_SIZE = 24;

// The first three match the lists the main process prefetches at startup, so they fill instantly.
const NEW: MovieShelfConfig = { title: IS_WEB ? 'New Releases' : 'New on YTS', options: { sortBy: 'date_added' } };
const POPULAR: MovieShelfConfig = { title: 'Most Downloaded', options: { sortBy: 'download_count' } };
const TOP: MovieShelfConfig = { title: 'Top Rated', options: { sortBy: 'rating', minimumRating: 7 } };

const genreShelf = (genre: string, title: string): MovieShelfConfig =>
  ({ title, options: { genre, sortBy: 'download_count' } });

const G = {
  action: genreShelf('action', 'Action'),
  comedy: genreShelf('comedy', 'Comedy'),
  drama: genreShelf('drama', 'Drama'),
  thriller: genreShelf('thriller', 'Thriller'),
  horror: genreShelf('horror', 'Horror'),
  scifi: genreShelf('sci-fi', 'Sci-Fi'),
  romance: genreShelf('romance', 'Romance'),
  animation: genreShelf('animation', 'Animation'),
  crime: genreShelf('crime', 'Crime'),
  adventure: genreShelf('adventure', 'Adventure'),
  fantasy: genreShelf('fantasy', 'Fantasy'),
  family: genreShelf('family', 'Family'),
  mystery: genreShelf('mystery', 'Mystery'),
  documentary: genreShelf('documentary', 'Documentary'),
  war: genreShelf('war', 'War'),
  history: genreShelf('history', 'History'),
  biography: genreShelf('biography', 'Biography'),
  music: genreShelf('music', 'Music'),
  sport: genreShelf('sport', 'Sport'),
  western: genreShelf('western', 'Western'),
};

type Entry =
  | { kind: 'movies'; config: MovieShelfConfig }
  | { kind: 'series-popular' }
  | { kind: 'series-genre'; index: number };

const m = (config: MovieShelfConfig): Entry => ({ kind: 'movies', config });
const sg = (index: number): Entry => ({ kind: 'series-genre', index });

// Movies and series interleave so the page never runs long on one kind
const FULL_LAYOUT: Entry[] = [
  { kind: 'series-popular' } as Entry, m(NEW), m(POPULAR), m(TOP),
  m(G.action), m(G.comedy), sg(0), m(G.drama), m(G.thriller), sg(1),
  m(G.horror), m(G.scifi), sg(2), m(G.romance), m(G.animation), sg(3),
  m(G.crime), m(G.adventure), sg(4), m(G.fantasy), m(G.family), m(G.mystery), sg(5),
  m(G.documentary), m(G.war), m(G.history), m(G.biography), m(G.music), m(G.sport), m(G.western),
];

// TMDB (the web catalogue) has no Biography or Sport genre
const LAYOUT = IS_WEB
  ? FULL_LAYOUT.filter(e => !(e.kind === 'movies' && (e.config === G.biography || e.config === G.sport)))
  : FULL_LAYOUT;

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

// ─── Helpers ────────────────────────────────────────────────────────

/** Latches true once the element comes within `margin` of the scroll viewport. */
function useNearViewport<T extends HTMLElement>(margin = '1200px'): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { root: el.closest('.main-content'), rootMargin: `${margin} 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near];
}

// Last catalogue error (cleared by any success), so the Shelf can explain an empty page
const catalogue = { error: null as string | null, listeners: new Set<() => void>() };
function setCatalogueError(message: string | null) {
  if (catalogue.error === message) return;
  catalogue.error = message;
  catalogue.listeners.forEach(l => l());
}
function useCatalogueError() {
  return useSyncExternalStore(
    cb => { catalogue.listeners.add(cb); return () => { catalogue.listeners.delete(cb); }; },
    () => catalogue.error
  );
}

interface PagedMovies { movies: YtsMovie[]; page: number; total: number }
const movieCache = new Map<string, PagedMovies>();

function useMovieShelf(config: MovieShelfConfig, enabled: boolean, languageKey: string) {
  // Web: the server filters by language, so each language selection is its own list
  const key = IS_WEB ? `${config.title}|${languageKey}` : config.title;
  const [state, setState] = useState<PagedMovies | null>(() => movieCache.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async (page: number) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const r = await window.electronAPI.yts.list({ ...config.options, page, limit: PAGE_SIZE });
      setState(prev => {
        const base = page === 1 ? [] : prev?.movies ?? [];
        const seen = new Set(base.map(x => x.id));
        const next = { movies: [...base, ...r.movies.filter(x => !seen.has(x.id))], page, total: r.total };
        movieCache.set(key, next);
        return next;
      });
      setFailed(false);
      setCatalogueError(null);
    } catch (err) {
      if (page === 1) {
        setFailed(true);
        setCatalogueError(errorMessage(err, 'Could not load the catalogue'));
      }
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [config, key]);

  const catalogueError = useCatalogueError();
  useEffect(() => {
    const cached = movieCache.get(key);
    setState(cached ?? null);
    // Once the catalogue is known to be unreachable, don't fire a request per shelf
    // (a failed shelf collapses, which pulls the next ones into view: a cascade).
    if (enabled && !cached && !catalogueError) load(1);
  }, [enabled, key, load, catalogueError]);

  const hasMore = !!state && state.movies.length < state.total;
  const loadMore = useCallback(() => {
    if (state && hasMore) load(state.page + 1);
  }, [state, hasMore, load]);

  return { state, loading, failed: failed || (!!catalogueError && !state), hasMore, loadMore };
}

// ─── Shared series pool ─────────────────────────────────────────────

const seriesPool = {
  shows: [] as SeriesShow[],
  page: 0,
  total: Infinity,
  loading: false,
  failed: false,
  languageKey: '',
  version: 0,
  listeners: new Set<() => void>(),
};

const emitSeries = () => { seriesPool.version++; seriesPool.listeners.forEach(l => l()); };

/** Web: the series list is fetched per language selection; start over when it changes. */
function resetSeriesPoolFor(languageKey: string) {
  if (!IS_WEB || seriesPool.languageKey === languageKey) return;
  seriesPool.languageKey = languageKey;
  seriesPool.shows = [];
  seriesPool.page = 0;
  seriesPool.total = Infinity;
  seriesPool.failed = false;
  emitSeries();
}

async function loadMoreSeries() {
  if (seriesPool.loading || seriesPool.shows.length >= seriesPool.total) return;
  seriesPool.loading = true;
  emitSeries();
  try {
    const r = await window.electronAPI.series.list({ page: seriesPool.page + 1, limit: PAGE_SIZE });
    const seen = new Set(seriesPool.shows.map(s => s.id));
    seriesPool.shows = [...seriesPool.shows, ...r.shows.filter(s => !seen.has(s.id))];
    seriesPool.page += 1;
    // An empty page means the pool is exhausted, even if the reported total says otherwise
    seriesPool.total = r.shows.length === 0 ? seriesPool.shows.length : r.total;
    seriesPool.failed = false;
  } catch {
    if (seriesPool.page === 0) seriesPool.failed = true;
  } finally {
    seriesPool.loading = false;
    emitSeries();
  }
}

function useSeriesPool() {
  useSyncExternalStore(
    cb => { seriesPool.listeners.add(cb); return () => seriesPool.listeners.delete(cb); },
    () => seriesPool.version
  );
  return seriesPool;
}

/** Genres with enough shows in the pool for a shelf, most common first. */
function seriesGenres(shows: SeriesShow[]): string[] {
  const counts = new Map<string, number>();
  for (const s of shows) for (const g of s.genres) counts.set(g, (counts.get(g) || 0) + 1);
  return Array.from(counts).filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]).map(([g]) => g);
}

// ─── Component ──────────────────────────────────────────────────────

interface YtsHomeRowsProps {
  localMovies: Movie[];
  decade?: Decade;
  onSeeAll: () => void;
  onSeeSeries: () => void;
}

export function YtsHomeRows({ localMovies, decade = 'all', onSeeAll, onSeeSeries }: YtsHomeRowsProps) {
  const { showToast } = useToast();
  const ytsImage = useYtsImage();
  const [selected, setSelected] = useState<YtsMovie | null>(null);
  const [streaming, setStreaming] = useState<{ movie: YtsMovie; torrent: YtsTorrent } | null>(null);
  const seriesActions = useSeriesActions();
  const [selectedShow, setSelectedShow] = useState<SeriesShow | null>(null);
  const owned = useMemo(() => new Set(localMovies.map(x => normTitle(x.title))), [localMovies]);

  const stream = (movie: YtsMovie, torrent: YtsTorrent) => {
    setSelected(null);
    setStreaming({ movie, torrent });
  };

  const download = async (movie: YtsMovie, torrent: YtsTorrent) => {
    try {
      await window.electronAPI.downloads.start(torrent.magnet, {
        title: movie.title, year: movie.year, quality: torrent.quality,
      });
      showToast(`Downloading ${movie.title} (${torrent.quality}). It will appear in your library when finished.`, 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Download failed'), 'error');
    }
  };

  const movieActions: MovieActions = {
    onSelect: setSelected,
    onStream: mv => { const t = pickDefaultTorrent(mv.torrents); if (t) stream(mv, t); else setSelected(mv); },
    onDownload: mv => { const t = pickDefaultTorrent(mv.torrents); if (t) download(mv, t); else setSelected(mv); },
    onTrailer: mv => openTrailer(mv, showToast),
  };

  const seeAllMovies = (config: MovieShelfConfig) => {
    presetMovieSearch({
      genre: config.options.genre ?? 'all',
      sortBy: config.options.sortBy ?? 'date_added',
      minRating: config.options.minimumRating ?? 0,
    });
    onSeeAll();
  };

  const seeAllSeries = (genre = 'all') => {
    presetSeriesSearch({ genre });
    onSeeSeries();
  };

  if (streaming) {
    return (
      <TorrentPlayer
        title={`${streaming.movie.title} (${streaming.movie.year}) · ${streaming.torrent.quality}`}
        magnet={streaming.torrent.magnet}
        onClose={() => setStreaming(null)}
        onError={msg => { showToast(msg, 'error'); setStreaming(null); }}
      />
    );
  }

  if (seriesActions.player) return seriesActions.player;

  return (
    <>
      <CatalogueNotice />
      {LAYOUT.map((entry, i) => {
        if (entry.kind === 'movies') {
          return (
            <MovieShelf
              key={entry.config.title}
              config={entry.config}
              decade={decade}
              owned={owned}
              ytsImage={ytsImage}
              actions={movieActions}
              onSeeAll={() => seeAllMovies(entry.config)}
            />
          );
        }
        return (
          <SeriesShelf
            key={`series-${i}`}
            genreIndex={entry.kind === 'series-genre' ? entry.index : null}
            decade={decade}
            ytsImage={ytsImage}
            onSelect={setSelectedShow}
            onSeeAll={seeAllSeries}
          />
        );
      })}

      {selectedShow && (
        <SeriesDetail
          show={selectedShow}
          onClose={() => setSelectedShow(null)}
          onStream={(s, ep, t) => { setSelectedShow(null); seriesActions.stream(s, ep, t); }}
          onDownload={seriesActions.download}
        />
      )}
      {selected && <YtsDetail movie={selected} onClose={() => setSelected(null)} onStream={stream} onDownload={download} />}
    </>
  );
}

/** Shown when the catalogue can't be reached at all, instead of a silently empty Shelf. */
function CatalogueNotice() {
  const error = useCatalogueError();
  if (!error) return null;
  return (
    <div className="empty-state" role="alert" style={{ paddingTop: 48, paddingBottom: 24 }}>
      <div className="empty-icon"><Icon name="warning" /></div>
      <h2 className="empty-title">Movies aren't available right now</h2>
      <p className="empty-subtitle">{error}</p>
      <button
        className="btn btn-accent"
        onClick={() => { movieCache.clear(); setCatalogueError(null); window.location.reload(); }}
      >
        <Icon name="refresh" /> Try again
      </button>
    </div>
  );
}

interface MovieActions {
  onSelect: (m: YtsMovie) => void;
  onStream: (m: YtsMovie) => void;
  onDownload: (m: YtsMovie) => void;
  onTrailer: (m: YtsMovie) => void;
}

function MovieShelf({ config, decade, owned, ytsImage, actions, onSeeAll }: {
  config: MovieShelfConfig;
  decade: Decade;
  owned: Set<string>;
  ytsImage: (url: string) => string;
  actions: MovieActions;
  onSeeAll: () => void;
}) {
  const [slotRef, near] = useNearViewport<HTMLDivElement>();
  const { languages, ready: languagesReady } = useLanguages();
  const { state, loading, failed, hasMore, loadMore } = useMovieShelf(config, near && languagesReady, languages.join(','));

  // Language preference, live torrents only, not already in the library, and the decade chip
  const visible = useMemo(
    () => watchableList(state?.movies ?? [], languages).filter(x => !owned.has(normTitle(x.title)) && inDecade(x.year, decade)),
    [state, owned, decade, languages]
  );
  const items = useMemo(() => visible.map(x => ytsToCassette(x, ytsImage(x.poster))), [visible, ytsImage]);

  // A language or decade filter can leave a shelf nearly empty: pull a few more pages (at most 6) to fill it
  const MAX_FILL_PAGES = 6;
  const narrowed = decade !== 'all' || languages.length > 0;
  const filling = narrowed && !!state && visible.length < 8 && hasMore && state.page < MAX_FILL_PAGES;
  useEffect(() => {
    if (filling && !loading) loadMore();
  }, [filling, loading, loadMore]);

  if (failed && !state) return null; // YTS unreachable and nothing cached: skip quietly
  const initialLoading = !state || !languagesReady;
  if (!initialLoading && items.length === 0 && !filling) return null;

  return (
    <div ref={slotRef}>
      <CassetteShelf
        title={config.title}
        items={items}
        loading={initialLoading || items.length === 0}
        hasMore={hasMore}
        loadingMore={loading && !!state}
        onNearEnd={loadMore}
        onSeeAll={onSeeAll}
        onOpen={i => actions.onSelect(visible[i])}
        renderActions={i => visible[i] && (
          <MovieShelfActions
            movie={visible[i]}
            onStream={actions.onStream}
            onDownload={actions.onDownload}
            onTrailer={actions.onTrailer}
            onDetails={actions.onSelect}
          />
        )}
      />
    </div>
  );
}

function SeriesShelf({ genreIndex, decade, ytsImage, onSelect, onSeeAll }: {
  /** null = the "Popular Series" shelf; otherwise the n-th most common genre in the pool */
  genreIndex: number | null;
  decade: Decade;
  ytsImage: (url: string) => string;
  onSelect: (s: SeriesShow) => void;
  onSeeAll: (genre?: string) => void;
}) {
  const pool = useSeriesPool();
  const [slotRef, near] = useNearViewport<HTMLDivElement>();
  const isGenre = genreIndex !== null;
  const { languages, ready: languagesReady } = useLanguages();
  const languageKey = languages.join(',');
  useEffect(() => { if (languagesReady) resetSeriesPoolFor(languageKey); }, [languageKey, languagesReady]);
  const inLanguage = useMemo(() => pool.shows.filter(s => matchesLanguageName(s.language, languages)), [pool.shows, languages]);

  // Popular loads the first page as soon as it's near; genre shelves top the pool up to 4 pages
  useEffect(() => {
    if (!near || !languagesReady || pool.loading || pool.failed) return;
    if (pool.page === 0 || (isGenre && pool.page < 4 && pool.shows.length < pool.total)) loadMoreSeries();
  }, [near, languagesReady, isGenre, pool.loading, pool.failed, pool.page, pool.shows.length, pool.total]);

  const genre = isGenre ? seriesGenres(inLanguage)[genreIndex!] : undefined;
  const visible = useMemo(
    () => inLanguage.filter(s => inDecade(s.year, decade) && (!genre || s.genres.includes(genre))),
    [inLanguage, decade, genre]
  );
  const items = useMemo(() => visible.map(s => seriesToCassette(s, ytsImage(s.poster))), [visible, ytsImage]);
  const hasMore = pool.shows.length < pool.total;

  if (pool.failed && pool.shows.length === 0) return null;
  // A genre slot with no matching genre yet: keep a sentinel so it can trigger loading, but show nothing
  if (isGenre && (!genre || items.length < 3)) return <div ref={slotRef} style={{ height: 1 }} />;
  if (!isGenre && pool.page > 0 && items.length === 0) return null;

  return (
    <div ref={slotRef}>
      <CassetteShelf
        title={genre ? `${genre} Series` : 'Popular Series'}
        items={items}
        loading={pool.page === 0}
        hasMore={hasMore}
        loadingMore={pool.loading && pool.page > 0}
        onNearEnd={loadMoreSeries}
        onSeeAll={() => onSeeAll(genre)}
        onOpen={i => onSelect(visible[i])}
        renderActions={i => {
          const s = visible[i];
          if (!s) return null;
          return (
            <>
              <button className="btn btn-primary" onClick={() => onSelect(s)}><Icon name="play" /> Episodes</button>
              <button className="btn btn-ghost" onClick={() => onSeeAll(genre)}><Icon name="film" /> {genre ? `All ${genre.toLowerCase()} series` : 'All series'}</button>
            </>
          );
        }}
      />
    </div>
  );
}
