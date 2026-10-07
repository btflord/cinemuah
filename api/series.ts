// GET /api/series?query&page&languages — popular or searched TV series.
import { tmdb, discover, handler, mapShow, intParam, languageFilter } from './_tmdb';

export default handler(async q => {
  const page = intParam(q.page, 1);
  const languages = languageFilter(q.languages);

  if (q.query && q.query.trim()) {
    const data = await tmdb('/search/tv', { query: q.query.trim().slice(0, 100), page });
    const langSet = languages ? new Set(languages.split('|')) : null;
    const shows = (data.results || [])
      .filter((s: any) => !langSet || langSet.has(s.original_language))
      .map(mapShow);
    return { shows, total: data.total_results || 0, page, limit: 20 };
  }

  const data = await discover('/discover/tv', {
    page,
    sort_by: 'popularity.desc',
    'vote_count.gte': 20,
    with_original_language: languages,
  });
  return {
    shows: (data.results || []).map(mapShow),
    total: Math.min(data.total_results || 0, 500 * 20),
    page,
    limit: 20,
  };
});
