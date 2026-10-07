// GET /api/movie?id — one movie with runtime, genres and its YouTube trailer.
import { tmdb, handler, mapMovie, intParam, HttpError } from './_tmdb';

export default handler(async q => {
  const id = intParam(q.id, 0, 0, 1e9);
  if (!id) throw new HttpError(400, 'Missing movie id');
  return mapMovie(await tmdb(`/movie/${id}`, { append_to_response: 'videos' }));
}, 3600);
