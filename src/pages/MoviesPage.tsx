import { useState, useMemo, useCallback } from 'react';
import type { Movie, SortOption, SortOrder } from '@/types';
import { parseMovieGenres, parseMovieCast } from '@/types';
import { MovieCard } from '@/components/MovieCard';
import { Icon } from '@/components/Icon';
import { SearchHero, FilterChips, FilterSelect, FilterSegment } from '@/components/SearchHero';

interface MoviesPageProps {
  movies: Movie[];
  onPlay: (movie: Movie, startPosition?: number) => void;
  onDetail: (movie: Movie) => void;
  onToggleList: (movie: Movie) => void;
  genre?: string;
  title?: string;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'dateAdded', label: 'Recently Added' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'year', label: 'Release Year' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'lastPlayed', label: 'Recently Watched' },
  { value: 'watchCount', label: 'Most Watched' },
];

const ORDER_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'desc', label: '↓' },
  { value: 'asc', label: '↑' },
];

interface LibrarySearch { query: string; genre: string; sortBy: SortOption; order: SortOrder }
let savedLibrarySearch: LibrarySearch = { query: '', genre: 'all', sortBy: 'dateAdded', order: 'desc' };

/** One lowercase string per movie with everything searchable, built once per library change. */
function buildIndex(movies: Movie[]) {
  return movies.map(m => {
    const genres = parseMovieGenres(m.genres);
    const cast = parseMovieCast(m.cast).map(c => c.name);
    return {
      movie: m,
      genres,
      title: m.title.toLowerCase(),
      haystack: [m.title, m.year ?? '', m.director, ...cast, ...genres, m.description, m.fileName]
        .join(' \u0001 ')
        .toLowerCase(),
    };
  });
}

export function MoviesPage({ movies, onPlay, onDetail, onToggleList, genre: routeGenre, title }: MoviesPageProps) {
  const [search, setSearchState] = useState<LibrarySearch>(savedLibrarySearch);
  const setSearch = useCallback((patch: Partial<LibrarySearch>) => {
    setSearchState(prev => (savedLibrarySearch = { ...prev, ...patch }));
  }, []);
  const { query, genre, sortBy, order } = search;

  const index = useMemo(() => buildIndex(movies), [movies]);

  const genreOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of index) for (const g of e.genres) counts.set(g, (counts.get(g) || 0) + 1);
    return [{ value: 'all', label: 'All' }, ...Array.from(counts).sort((a, b) => b[1] - a[1]).map(([g]) => ({ value: g, label: g }))];
  }, [index]);

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(' ').filter(Boolean);
    const matched = index.filter(e =>
      (genre === 'all' || e.genres.includes(genre)) &&
      terms.every(t => e.haystack.includes(t)));

    // While searching, titles that start with / contain the query rank above other matches
    const q = query.toLowerCase();
    const relevance = (e: typeof index[number]) => (!q ? 0 : e.title.startsWith(q) ? 2 : e.title.includes(q) ? 1 : 0);
    const dir = order === 'asc' ? 1 : -1;
    const value = (m: Movie): number | string => {
      if (sortBy === 'title') return m.title.toLowerCase();
      return Number(m[sortBy as keyof Movie]) || 0;
    };

    return matched
      .sort((a, b) => {
        const r = relevance(b) - relevance(a);
        if (r !== 0) return r;
        const va = value(a.movie);
        const vb = value(b.movie);
        if (typeof va === 'string' && typeof vb === 'string') return dir * va.localeCompare(vb);
        return dir * ((va as number) - (vb as number));
      })
      .map(e => e.movie);
  }, [index, query, genre, sortBy, order]);

  const pageTitle = title || routeGenre || 'All Movies';

  if (movies.length === 0) {
    return (
      <div className="empty-state" style={{ paddingTop: 160 }}>
        <div className="empty-icon"><Icon name="film" /></div>
        <h2 className="empty-title">No movies found</h2>
        <p className="empty-subtitle">
          {routeGenre ? `No movies in the ${routeGenre} genre yet.` : 'Scan your library to discover movies.'}
        </p>
      </div>
    );
  }

  const activeFilters = Number(genre !== 'all') + Number(sortBy !== 'dateAdded' || order !== 'desc');

  return (
    <div className="browse-page">
      <SearchHero
        scope="library"
        title={pageTitle}
        subtitle={query ? <>Results for <strong>“{query}”</strong> in your library</> : `${movies.length} movie${movies.length === 1 ? '' : 's'} in your library`}
        placeholder="Search your library by title, actor, director, genre or year…"
        query={query}
        onQueryChange={q => setSearch({ query: q })}
        debounceMs={80}
        resultLabel={`${results.length} of ${movies.length}`}
        activeFilters={activeFilters}
        onResetFilters={() => setSearch({ genre: 'all', sortBy: 'dateAdded', order: 'desc' })}
        filters={
          <>
            {genreOptions.length > 2 && (
              <FilterChips label="Genre" value={genre} options={genreOptions} onChange={g => setSearch({ genre: g })} />
            )}
            <FilterSelect label="Sort" value={sortBy} options={SORT_OPTIONS} onChange={v => setSearch({ sortBy: v as SortOption })} />
            <FilterSegment label="Order" value={order} options={ORDER_OPTIONS} onChange={o => setSearch({ order: o })} />
          </>
        }
      />

      {results.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 40 }}>
          <div className="empty-icon"><Icon name="search" /></div>
          <h2 className="empty-title">{query ? `Nothing in your library matches “${query}”` : 'No movies match these filters'}</h2>
          <p className="empty-subtitle">Try another title, actor or director, or switch to Online to search YTS.</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            {query && <button className="btn btn-secondary" onClick={() => setSearch({ query: '' })}>Clear search</button>}
            {genre !== 'all' && <button className="btn btn-ghost" onClick={() => setSearch({ genre: 'all' })}>All genres</button>}
          </div>
        </div>
      ) : (
        <div className="search-results-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          {results.map(movie => (
            <MovieCard
              key={movie.id}
              movie={movie}
              onPlay={onPlay}
              onDetail={onDetail}
              onToggleList={onToggleList}
              fluid
            />
          ))}
        </div>
      )}
    </div>
  );
}
