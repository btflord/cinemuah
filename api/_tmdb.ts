// Shared TMDB helpers for the web app's serverless functions. Files starting with "_" are not
// routes on Vercel. The API key comes from the TMDB_API_KEY environment variable and never
// reaches the browser.

const TMDB = 'https://api.themoviedb.org/3';
export const IMG = 'https://image.tmdb.org/t/p';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function tmdb<T = any>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new HttpError(503, 'This site is still being set up: its TMDB API key has not been added yet.');
  const qs = new URLSearchParams({ language: 'en-US', include_adult: 'false' });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  // v4 "read access tokens" are JWTs and go in a header; v3 keys go in the query string
  const isBearer = key.startsWith('eyJ');
  if (!isBearer) qs.set('api_key', key);
  const res = await fetch(`${TMDB}${path}?${qs}`, {
    headers: isBearer ? { Authorization: `Bearer ${key}`, Accept: 'application/json' } : { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 401) throw new HttpError(502, 'The TMDB API key configured for this site is invalid.');
  if (res.status === 404) throw new HttpError(404, 'Not found');
  if (res.status === 429) throw new HttpError(503, 'TMDB is rate limiting requests. Try again in a moment.');
  if (!res.ok) throw new HttpError(502, `TMDB error ${res.status}`);
  return res.json() as Promise<T>;
}

/** Wraps a handler with JSON errors and CDN caching (fresh 15 min, served stale for a day while refreshing). */
export function handler(fn: (q: Record<string, string>) => Promise<unknown>, maxAge = 900) {
  return async (req: any, res: any) => {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query || {})) q[k] = Array.isArray(v) ? String(v[0]) : String(v);
    try {
      const data = await fn(q);
      res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=86400`);
      res.status(200).json(data);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(err);
      res.setHeader('Cache-Control', 'no-store');
      res.status(status).json({ error: err instanceof Error ? err.message : 'Something went wrong' });
    }
  };
}

export const intParam = (v: string | undefined, fallback: number, min = 1, max = 500) => {
  const n = parseInt(v || '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const yearOf = (d?: string) => {
  const y = d ? parseInt(d.slice(0, 4), 10) : NaN;
  return Number.isFinite(y) ? y : 0;
};

// ─── Genres ─────────────────────────────────────────────────────────

/** The app's genre slugs (from the desktop YTS filters) → TMDB movie genre ids. */
export const MOVIE_GENRE_IDS: Record<string, number> = {
  action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80, documentary: 99, drama: 18,
  family: 10751, fantasy: 14, history: 36, horror: 27, music: 10402, mystery: 9648, romance: 10749,
  'sci-fi': 878, thriller: 53, war: 10752, western: 37,
};

const MOVIE_GENRES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama',
  10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery',
  10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};

const TV_GENRES: Record<number, string> = {
  10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama',
  10751: 'Family', 10762: 'Kids', 9648: 'Mystery', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy',
  10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics', 37: 'Western',
};

// TVMaze-style language names, which the app's series language filter matches on
const LANGUAGE_NAMES: Record<string, string> = {
  hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada', mr: 'Marathi',
  gu: 'Gujarati', pa: 'Punjabi', or: 'Odia', as: 'Assamese', ur: 'Urdu', ne: 'Nepali', si: 'Sinhala',
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
  ja: 'Japanese', ko: 'Korean', zh: 'Chinese', cn: 'Chinese', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
  ms: 'Malay', tl: 'Filipino', tr: 'Turkish', ar: 'Arabic', fa: 'Persian', he: 'Hebrew', pl: 'Polish',
  nl: 'Dutch', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', is: 'Icelandic', el: 'Greek',
  cs: 'Czech', sk: 'Slovak', hu: 'Hungarian', ro: 'Romanian', bg: 'Bulgarian', uk: 'Ukrainian', hr: 'Croatian',
  sr: 'Serbian', bs: 'Bosnian', sl: 'Slovenian', sq: 'Albanian', lt: 'Lithuanian', lv: 'Latvian', et: 'Estonian',
  ca: 'Catalan', eu: 'Basque', ga: 'Irish', af: 'Afrikaans', sw: 'Swahili',
};

/** "hi,ta" → TMDB with_original_language. Pipe means OR. */
export function languageFilter(raw?: string): string | undefined {
  const codes = (raw || '').split(',').map(s => s.trim().toLowerCase()).filter(c => /^[a-z]{2}$/.test(c));
  return codes.length ? codes.join('|') : undefined;
}

// ─── Mapping to the app's shapes ────────────────────────────────────

export function mapMovie(m: any) {
  const genres: string[] = m.genres
    ? m.genres.map((g: any) => MOVIE_GENRES[g.id] ?? g.name)
    : (m.genre_ids || []).map((id: number) => MOVIE_GENRES[id]).filter(Boolean);
  const trailer = (m.videos?.results || []).find((v: any) => v.site === 'YouTube' && v.type === 'Trailer')
    ?? (m.videos?.results || []).find((v: any) => v.site === 'YouTube');
  return {
    id: m.id,
    imdbCode: m.imdb_id || '',
    title: m.title || m.original_title || 'Untitled',
    year: yearOf(m.release_date),
    rating: Math.round((m.vote_average || 0) * 10) / 10,
    runtime: m.runtime || 0,
    genres,
    summary: m.overview || '',
    language: m.original_language || '',
    poster: m.poster_path ? `${IMG}/w500${m.poster_path}` : '',
    backdrop: m.backdrop_path ? `${IMG}/w1280${m.backdrop_path}` : '',
    trailerCode: trailer?.key || '',
    torrents: [],
  };
}

export function mapShow(s: any) {
  const genres: string[] = s.genres
    ? s.genres.map((g: any) => g.name)
    : (s.genre_ids || []).map((id: number) => TV_GENRES[id]).filter(Boolean);
  const trailer = (s.videos?.results || []).find((v: any) => v.site === 'YouTube' && v.type === 'Trailer')
    ?? (s.videos?.results || []).find((v: any) => v.site === 'YouTube');
  return {
    id: s.id,
    imdbId: s.external_ids?.imdb_id || '',
    title: s.name || s.original_name || 'Untitled',
    year: yearOf(s.first_air_date),
    summary: s.overview || '',
    poster: s.poster_path ? `${IMG}/w342${s.poster_path}` : '',
    posterLarge: s.poster_path ? `${IMG}/w780${s.poster_path}` : '',
    genres,
    language: LANGUAGE_NAMES[s.original_language] || s.original_language || '',
    rating: Math.round((s.vote_average || 0) * 10) / 10,
    status: s.status === 'Returning Series' ? 'Running' : s.status || '',
    network: s.networks?.[0]?.name || '',
    trailerCode: trailer?.key || '',
  };
}

/**
 * Discover with a language filter. Several languages are sent as an OR list; if TMDB rejects
 * that or finds nothing, retry without the filter (the app then filters client-side).
 */
export async function discover(path: string, params: Record<string, string | number | undefined>): Promise<any> {
  const langs = params.with_original_language;
  if (!langs || !String(langs).includes('|')) return tmdb(path, params);
  try {
    const data = await tmdb(path, params);
    if ((data.results || []).length > 0) return data;
  } catch (err) {
    if (err instanceof HttpError && (err.status === 503 || err.message.includes('invalid'))) throw err;
  }
  return tmdb(path, { ...params, with_original_language: undefined });
}
