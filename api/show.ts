// GET /api/show?id — a series with every episode of every season (specials excluded).
import { tmdb, handler, mapShow, intParam, HttpError, IMG } from './_tmdb';

const MAX_SEASONS = 30;

export default handler(async q => {
  const id = intParam(q.id, 0, 0, 1e9);
  if (!id) throw new HttpError(400, 'Missing series id');
  const raw = await tmdb(`/tv/${id}`, { append_to_response: 'videos,external_ids' });

  const seasonNumbers: number[] = (raw.seasons || [])
    .map((s: any) => s.season_number)
    .filter((n: number) => n > 0)
    .slice(-MAX_SEASONS);
  const seasons = await Promise.all(seasonNumbers.map(n =>
    tmdb(`/tv/${id}/season/${n}`).catch(() => null))); // one missing season shouldn't fail the show

  const episodes = seasons.flatMap((s: any) => (s?.episodes || []).map((e: any) => ({
    season: e.season_number,
    number: e.episode_number,
    name: e.name || '',
    airdate: e.air_date || '',
    summary: e.overview || '',
    image: e.still_path ? `${IMG}/w300${e.still_path}` : '',
    torrents: [],
  })));

  return { show: mapShow(raw), episodes };
}, 3600);
