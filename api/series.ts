// GET /api/series?query&page&languages — popular or searched TV series.
import { tmdb, discover, handler, mapShow, intParam, languageFilter } from './_tmdb';
import { popularShows, searchShows } from './_tvmaze';

const NAMES: Record<string, string> = {
  hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada', mr: 'Marathi', en: 'English',
  es: 'Spanish', fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', it: 'Italian', pt: 'Portuguese',
};

const PAGE = 20;

export default handler(async q => {
  const page = intParam(q.page, 1);
  const languages = languageFilter(q.languages);

  // No TMDB key yet: serve series from TVMaze so the site still has content
  if (!process.env.TMDB_API_KEY) {
    const wanted = languages ? new Set(languages.split('|').map(c => NAMES[c] || c)) : null;
    const all = (q.query && q.query.trim() ? await searchShows(q.query.trim().slice(0, 100)) : await popularShows())
      .filter((s: any) => !wanted || wanted.has(s.language));
    return { shows: all.slice((page - 1) * PAGE, page * PAGE), total: all.length, page, limit: PAGE };
  }

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
