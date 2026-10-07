// TMDB Metadata Service
// Design: Provider-agnostic interface. Swap provider by changing implementation.

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export interface MovieSearchResult {
  id: number;
  title: string;
  year?: number;
  poster?: string;
  overview?: string;
  rating?: number;
}

export interface MovieMetadata {
  tmdbId: number;
  title: string;
  year?: number;
  description: string;
  poster: string;
  backdrop: string;
  duration: number;
  rating: number;
  genres: string[];
  cast: string; // JSON string of CastMember[]
  director: string;
  writers: string; // JSON string of string[]
}

export interface CastMember {
  name: string;
  character: string;
  profilePhoto?: string;
}

async function tmdbFetch(endpoint: string, apiKey: string): Promise<unknown> {
  const url = `${TMDB_BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${apiKey}`;
  
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new Error(timedOut ? 'TMDB did not respond in time' : 'Could not reach TMDB. Check your internet connection.');
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Invalid TMDB API key');
    if (response.status === 404) throw new Error('Not found');
    if (response.status === 429) throw new Error('TMDB rate limit reached. Try again in a moment.');
    throw new Error(`TMDB API error: ${response.status}`);
  }
  
  return response.json();
}

/** "2019-05-03" -> 2019. Avoids `new Date()`, which shifts Jan 1 dates into the previous year west of UTC. */
const yearOf = (date?: string) => {
  const y = date ? parseInt(date.slice(0, 4), 10) : NaN;
  return Number.isFinite(y) ? y : undefined;
};

const isAuthError = (err: unknown) => err instanceof Error && /invalid tmdb api key/i.test(err.message);

export async function searchMovieMetadata(
  title: string,
  year?: number,
  apiKey?: string
): Promise<MovieSearchResult[] | null> {
  if (!apiKey) return null;
  
  try {
    const yearParam = year ? `&year=${year}` : '';
    const data = await tmdbFetch(
      `/search/movie?query=${encodeURIComponent(title)}${yearParam}&include_adult=false&language=en-US`,
      apiKey
    ) as { results: Array<{
      id: number;
      title: string;
      release_date?: string;
      poster_path?: string;
      overview?: string;
      vote_average?: number;
    }> };
    
    if (!data.results || data.results.length === 0) return [];
    
    return data.results.filter(movie => movie && movie.id).slice(0, 5).map(movie => ({
      id: movie.id,
      title: movie.title,
      year: yearOf(movie.release_date),
      poster: movie.poster_path ? `${TMDB_IMAGE_BASE}/w342${movie.poster_path}` : undefined,
      overview: movie.overview,
      rating: movie.vote_average,
    }));
  } catch (error) {
    console.error('TMDB search error:', error);
    if (isAuthError(error)) throw error; // the user needs to fix this, so don't hide it as "no results"
    return null;
  }
}

export async function fetchMovieMetadata(
  tmdbId: number,
  apiKey: string
): Promise<MovieMetadata | null> {
  if (!apiKey) return null;
  
  try {
    // Fetch movie details + credits in parallel
    const [details, credits] = await Promise.all([
      tmdbFetch(`/movie/${tmdbId}?language=en-US`, apiKey),
      tmdbFetch(`/movie/${tmdbId}/credits?language=en-US`, apiKey),
    ]) as [
      {
        id: number;
        title: string;
        release_date?: string;
        overview?: string;
        poster_path?: string;
        backdrop_path?: string;
        runtime?: number;
        vote_average?: number;
        genres?: Array<{ name: string }>;
      },
      {
        cast?: Array<{ name: string; character: string; profile_path?: string; order?: number }>;
        crew?: Array<{ name: string; job: string; department: string }>;
      }
    ];
    
    const director = credits.crew?.find(c => c.job === 'Director')?.name || '';
    
    const writers = credits.crew
      ?.filter(c => ['Writer', 'Screenplay', 'Story', 'Author'].includes(c.job))
      .map(c => c.name)
      .slice(0, 5) || [];
    
    const cast: CastMember[] = (credits.cast || [])
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .slice(0, 20)
      .map(member => ({
        name: member.name,
        character: member.character,
        profilePhoto: member.profile_path 
          ? `${TMDB_IMAGE_BASE}/w185${member.profile_path}` 
          : undefined,
      }));
    
    const genres = (details.genres || []).map(g => g.name);
    
    return {
      tmdbId: details.id,
      title: details.title,
      year: yearOf(details.release_date),
      description: details.overview || '',
      poster: details.poster_path ? `${TMDB_IMAGE_BASE}/w500${details.poster_path}` : '',
      backdrop: details.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${details.backdrop_path}` : '',
      duration: details.runtime || 0,
      rating: details.vote_average || 0,
      genres,
      cast: JSON.stringify(cast),
      director,
      writers: JSON.stringify(writers),
    };
  } catch (error) {
    console.error('TMDB fetch error:', error);
    if (isAuthError(error)) throw error;
    return null;
  }
}
