// GET /api/movies?query&page&genre&sortBy&minimumRating&languages
// Lists or searches movies, shaped like the desktop app's YTS listing (without torrents).
import { tmdb, discover, handler, mapMovie, intParam, languageFilter, MOVIE_GENRE_IDS } from './_tmdb';

const today = () => new Date().toISOString().slice(0, 10);

// The app's sort options → TMDB discover sorting (+ a vote floor so obscure entries don't dominate)
const SORTS: Record<string, Record<string, string | number>> = {
  date_added: { sort_by: 'primary_release_date.desc', 'vote_count.gte': 10 },
  year: { sort_by: 'primary_release_date.desc', 'vote_count.gte': 10 },
  rating: { sort_by: 'vote_average.desc', 'vote_count.gte': 300 },
  download_count: { sort_by: 'popularity.desc' },
  seeds: { sort_by: 'popularity.desc' },
  like_count: { sort_by: 'vote_count.desc' },
  title: { sort_by: 'title.asc', 'vote_count.gte': 50 },
};

export default handler(async q => {
  const page = intParam(q.page, 1);
  const minRating = Math.max(0, Math.min(10, parseFloat(q.minimumRating || '0') || 0));
  const genreId = q.genre && q.genre !== 'all' ? MOVIE_GENRE_IDS[q.genre] : undefined;
  const languages = languageFilter(q.languages);

  // Free-text search can't be combined with discover filters on TMDB: filter the page here
  if (q.query && q.query.trim()) {
    const data = await tmdb('/search/movie', { query: q.query.trim().slice(0, 100), page });
    const langSet = languages ? new Set(languages.split('|')) : null;
    const movies = (data.results || [])
      .filter((m: any) => (!genreId || (m.genre_ids || []).includes(genreId))
        && (m.vote_average || 0) >= minRating
        && (!langSet || langSet.has(m.original_language)))
      .map(mapMovie);
    return { movies, total: data.total_results || 0, page, limit: 20 };
  }

  // A genre slug TMDB doesn't have (e.g. "sport") simply has no films
  if (q.genre && q.genre !== 'all' && !genreId) return { movies: [], total: 0, page, limit: 20 };

  const params: Record<string, string | number | undefined> = {
    page,
    ...(SORTS[q.sortBy || 'date_added'] || SORTS.date_added),
    'primary_release_date.lte': today(),
    with_genres: genreId,
    with_original_language: languages,
  };
  if (minRating > 0) {
    params['vote_average.gte'] = minRating;
    params['vote_count.gte'] = Math.max(Number(params['vote_count.gte'] || 0), 100);
  }
  const data = await discover('/discover/movie', params);
  return {
    movies: (data.results || []).map(mapMovie),
    total: Math.min(data.total_results || 0, 500 * 20), // TMDB serves at most 500 pages
    page,
    limit: 20,
  };
});
