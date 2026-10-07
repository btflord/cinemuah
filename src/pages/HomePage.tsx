import { useState, useEffect, useMemo } from 'react';
import type { Movie, AppMode } from '@/types';
import { parseMovieGenres, getProgressPercent } from '@/types';
import { Hero } from '@/components/Hero';
import { Icon } from '@/components/Icon';
import { YtsHomeRows } from '@/components/YtsHomeRows';
import { CassetteShelf, type CassetteItem } from '@/components/CassetteShelf';
import { useMedia } from '@/contexts/MediaContext';
import { DECADES, inDecade, type Decade } from '@/lib/decades';
import { LanguagePicker } from '@/components/LanguagePicker';

interface HomePageProps {
  mode: AppMode;
  movies: Movie[];
  continueWatching: Movie[];
  recentlyAdded: Movie[];
  genres: string[];
  onPlay: (movie: Movie, startPosition?: number) => void;
  onDetail: (movie: Movie) => void;
  onToggleList: (movie: Movie) => void;
  onNavigateGenre: (genre: string) => void;
  onNavigatePage: (page: string) => void;
}

let savedDecade: Decade = 'all'; // survives leaving and returning to Home

/** Decade chips + the language picker (online shelves follow the app-wide language setting). */
function ShelfToolbar({ decade, onDecade, showLanguages }: {
  decade: Decade;
  onDecade: (d: Decade) => void;
  showLanguages: boolean;
}) {
  return (
    <div className="shelf-toolbar">
      <div className="decade-chips" role="tablist" aria-label="Filter by decade">
        {DECADES.map(d => (
          <button
            key={d.id}
            role="tab"
            aria-selected={decade === d.id}
            className={`decade-chip ${decade === d.id ? 'active' : ''}`}
            onClick={() => onDecade(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>
      {showLanguages && <LanguagePicker />}
    </div>
  );
}

export function HomePage({
  mode,
  movies,
  continueWatching,
  recentlyAdded,
  genres,
  onPlay,
  onDetail,
  onToggleList,
  onNavigateGenre,
  onNavigatePage,
}: HomePageProps) {
  const { getPosterUrl } = useMedia();
  const [heroMovie, setHeroMovie] = useState<Movie | null>(null);
  const [decade, setDecadeState] = useState<Decade>(savedDecade);
  const setDecade = (d: Decade) => { savedDecade = d; setDecadeState(d); };

  useEffect(() => {
    if (movies.length === 0) return;
    // Hero: prefer movies with a backdrop, picked from the most recent
    const withBackdrop = movies.filter(m => m.backdrop);
    const pool = withBackdrop.length > 0 ? withBackdrop : movies;
    const top = pool.slice(0, Math.min(10, pool.length));
    setHeroMovie(top[Math.floor(Math.random() * top.length)]);
  }, [movies]);

  const toCassette = useMemo(() => (m: Movie): CassetteItem => {
    const genresList = parseMovieGenres(m.genres);
    const progress = getProgressPercent(m.position, m.duration > 0 ? m.duration * 60 : undefined);
    return {
      key: m.id,
      title: m.title,
      year: m.year,
      poster: getPosterUrl(m.id, m.poster),
      tag: m.isInMyList ? 'MY LIST' : 'LOCAL',
      subtitle: m.director ? `Directed by ${m.director}` : undefined,
      rating: m.rating,
      runtime: m.duration,
      genres: genresList,
      summary: m.description,
      progress: progress > 0 && progress < 95 ? progress : undefined,
    };
  }, [getPosterUrl]);

  const header = (
    <header className="home-header">
      <div>
        <div className="home-eyebrow">Cinemuah v2 · {mode === 'online' ? 'Online shelf' : 'Your collection'}</div>
        <h1 className="home-title">{mode === 'online' ? 'Pick a tape tonight' : 'From your shelf'}</h1>
      </div>
      <ShelfToolbar
        decade={decade}
        onDecade={setDecade}
        showLanguages={mode === 'online'}
      />
    </header>
  );

  const byDecade = (list: Movie[]) => list.filter(m => inDecade(m.year, decade));

  const shelf = (title: string, list: Movie[], opts: { seeAll?: () => void; resume?: boolean } = {}) => {
    const filtered = byDecade(list);
    if (filtered.length === 0) return null;
    return (
      <CassetteShelf
        key={title}
        title={title}
        items={filtered.map(toCassette)}
        onSeeAll={opts.seeAll}
        onOpen={i => onDetail(filtered[i])}
        renderActions={i => {
          const m = filtered[i];
          if (!m) return null;
          const progress = getProgressPercent(m.position, m.duration > 0 ? m.duration * 60 : undefined);
          const resumable = progress > 0 && progress < 95;
          return (
            <>
              <button className="btn btn-primary" onClick={() => onPlay(m, opts.resume || resumable ? m.position : 0)}>
                <Icon name="play" /> {resumable ? 'Resume' : 'Play'}
              </button>
              {resumable && (
                <button className="btn btn-secondary" onClick={() => onPlay(m, 0)}>
                  <Icon name="refresh" /> Start over
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => onToggleList(m)}>
                <Icon name={m.isInMyList ? 'check' : 'plus'} /> {m.isInMyList ? 'In My List' : 'My List'}
              </button>
              <button className="btn btn-ghost" onClick={() => onDetail(m)}><Icon name="info" /> Details</button>
            </>
          );
        }}
      />
    );
  };

  // Online mode: YTS + series shelves
  if (mode === 'online') {
    return (
      <div className="home-v2">
        {header}
        {movies.length > 0 && shelf('From your library', movies.slice(0, 40), { seeAll: () => onNavigatePage('movies') })}
        <YtsHomeRows
          localMovies={movies}
          decade={decade}
          onSeeAll={() => onNavigatePage('discover')}
          onSeeSeries={() => onNavigatePage('series')}
        />
      </div>
    );
  }

  if (movies.length === 0) {
    return (
      <div className="empty-state" style={{ paddingTop: 140, paddingBottom: 40 }}>
        <div className="empty-icon"><Icon name="film" /></div>
        <h2 className="empty-title">Your shelf is empty</h2>
        <p className="empty-subtitle">
          Choose your movie folder in Settings and scan it. Every film shows up here as a cassette.
        </p>
        <button className="btn btn-accent btn-lg" onClick={() => onNavigatePage('settings')}>
          <Icon name="settings" /> Open Settings
        </button>
      </div>
    );
  }

  // Genre shelves
  const genreShelves: { genre: string; movies: Movie[] }[] = [];
  for (const genre of genres) {
    const gMovies = byDecade(movies.filter(m => parseMovieGenres(m.genres).includes(genre)));
    if (gMovies.length >= 2) genreShelves.push({ genre, movies: gMovies.slice(0, 30) });
    if (genreShelves.length >= 6) break;
  }

  const anyVisible = byDecade(movies).length > 0;

  return (
    <div className="home-v2 has-hero">
      <Hero movie={heroMovie} onPlay={onPlay} onDetail={onDetail} onToggleList={onToggleList} />
      {header}
      {!anyVisible && (
        <div className="empty-state" style={{ paddingTop: 40 }}>
          <h2 className="empty-title">Nothing from the {DECADES.find(d => d.id === decade)?.label}</h2>
          <button className="btn btn-ghost" onClick={() => setDecade('all')}>Show all decades</button>
        </div>
      )}
      {shelf('Continue Watching', continueWatching, { seeAll: () => onNavigatePage('continue'), resume: true })}
      {shelf('Recently Added', recentlyAdded, { seeAll: () => onNavigatePage('movies') })}
      {genreShelves.map(g => shelf(g.genre, g.movies, { seeAll: () => onNavigateGenre(g.genre) }))}
      {shelf('All Movies', movies.slice(0, 40), { seeAll: () => onNavigatePage('movies') })}
    </div>
  );
}
