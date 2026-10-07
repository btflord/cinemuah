// Keyless series source used when no TMDB key is configured, so the web app always has content.
// Series ids from here are negative (-tvmazeId) so /api/show knows which source to ask.
import { HttpError } from './_tmdb';

const TVMAZE = 'https://api.tvmaze.com';

async function tvmaze(path: string): Promise<any> {
  const res = await fetch(`${TVMAZE}${path}`, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Cinemuah/2.0' } });
  if (res.status === 404) throw new HttpError(404, 'Not found');
  if (res.status === 429) throw new HttpError(503, 'TVMaze is busy. Try again in a moment.');
  if (!res.ok) throw new HttpError(502, `TVMaze error ${res.status}`);
  return res.json();
}

const stripHtml = (s?: string | null) =>
  (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").trim();

export function mapTvmazeShow(s: any) {
  return {
    id: -s.id,
    imdbId: s.externals?.imdb || '',
    title: s.name,
    year: s.premiered ? parseInt(String(s.premiered).slice(0, 4), 10) : 0,
    summary: stripHtml(s.summary),
    poster: s.image?.medium || '',
    posterLarge: s.image?.original || s.image?.medium || '',
    genres: s.genres || [],
    language: s.language || '',
    rating: s.rating?.average || 0,
    status: s.status || '',
    network: s.network?.name || s.webChannel?.name || '',
    trailerCode: '',
    weight: s.weight || 0,
  };
}

/** Shows airing now (streaming + several countries), most popular first, by TVMaze's weight. */
export async function popularShows(): Promise<any[]> {
  const feeds = await Promise.all([
    tvmaze('/schedule/web').catch(() => []),
    ...['US', 'GB', 'IN', 'KR', 'JP'].map(c => tvmaze(`/schedule?country=${c}`).catch(() => [])),
  ]);
  const byId = new Map<number, any>();
  for (const feed of feeds) for (const ep of feed as any[]) {
    const show = ep._embedded?.show ?? ep.show;
    if (show?.id && show.image) byId.set(show.id, show);
  }
  return Array.from(byId.values()).sort((a, b) => (b.weight || 0) - (a.weight || 0)).map(mapTvmazeShow);
}

export async function searchShows(query: string): Promise<any[]> {
  const results = await tvmaze(`/search/shows?q=${encodeURIComponent(query)}`);
  return (results || []).map((r: any) => mapTvmazeShow(r.show));
}

export async function showWithEpisodes(tvmazeId: number) {
  const raw = await tvmaze(`/shows/${tvmazeId}?embed=episodes`);
  const episodes = (raw._embedded?.episodes || [])
    .filter((e: any) => e.number > 0)
    .map((e: any) => ({
      season: e.season,
      number: e.number,
      name: e.name || '',
      airdate: e.airdate || '',
      summary: stripHtml(e.summary),
      image: e.image?.medium || '',
      torrents: [],
    }));
  return { show: mapTvmazeShow(raw), episodes };
}
