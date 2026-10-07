import { getDb, saveDb, defaultMoviesFolder } from './database';

export interface Movie {
  id: number;
  filePath: string;
  fileName: string;
  title: string;
  year: number | null;
  description: string;
  poster: string;
  backdrop: string;
  duration: number;
  rating: number;
  director: string;
  writers: string;
  cast: string;
  genres: string;
  tmdbId: number | null;
  dateAdded: number;
  lastModified: number;
  fileSize: number;
  isInMyList: number;
  position?: number;
  lastPlayed?: number;
  watchCount?: number;
  completed?: number;
}

function rowToMovie(row: any): Movie {
  return {
    id: row.id,
    filePath: row.filePath,
    fileName: row.fileName,
    title: row.title,
    year: row.year ?? null,
    description: row.description || '',
    poster: row.poster || '',
    backdrop: row.backdrop || '',
    duration: row.duration || 0,
    rating: row.rating || 0,
    director: row.director || '',
    writers: row.writers || '[]',
    cast: row.cast || '[]',
    genres: row.genres || '[]',
    tmdbId: row.tmdbId ?? null,
    dateAdded: row.dateAdded || 0,
    lastModified: row.lastModified || 0,
    fileSize: row.fileSize || 0,
    isInMyList: row.isInMyList ? 1 : 0,
    position: row.position ?? undefined,
    lastPlayed: row.lastPlayed ?? undefined,
    watchCount: row.watchCount ?? undefined,
    completed: row.completed ?? undefined,
  };
}

function queryAll(sql: string, params: any[] = []): any[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql: string, params: any[] = []): any | null {
  const db = getDb();
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  let result: any = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

export function getMovies(options?: { sortBy?: string; order?: string }): Movie[] {
  const sortBy = options?.sortBy || 'dateAdded';
  const order = options?.order === 'asc' ? 'ASC' : 'DESC';
  
  const validSortColumns: Record<string, string> = {
    title: 'm.title',
    year: 'm.year',
    dateAdded: 'm.dateAdded',
    rating: 'm.rating',
    duration: 'm.duration',
    lastPlayed: 'wp.lastPlayed',
    watchCount: 'wp.watchCount',
  };
  
  const sortColumn = validSortColumns[sortBy] || 'm.dateAdded';
  
  const rows = queryAll(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    LEFT JOIN watch_progress wp ON m.id = wp.movieId
    ORDER BY ${sortColumn} ${order}, m.title ASC
  `);

  return rows.map(rowToMovie);
}

export function getMovieById(id: number): Movie | null {
  const row = queryOne(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    LEFT JOIN watch_progress wp ON m.id = wp.movieId
    WHERE m.id = ?
  `, [id]);

  return row ? rowToMovie(row) : null;
}

export function searchMovies(query: string): Movie[] {
  if (!query.trim()) return getMovies();
  const like = `%${query.trim().toLowerCase()}%`;

  const rows = queryAll(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    LEFT JOIN watch_progress wp ON m.id = wp.movieId
    WHERE LOWER(m.title) LIKE ? 
       OR LOWER(m.description) LIKE ? 
       OR LOWER(m.director) LIKE ? 
       OR LOWER(m.cast) LIKE ? 
       OR LOWER(m.genres) LIKE ?
    ORDER BY m.title ASC
  `, [like, like, like, like, like]);

  return rows.map(rowToMovie);
}

export function getMoviesByGenre(genre: string, options?: { sortBy?: string; order?: string }): Movie[] {
  const sortBy = options?.sortBy || 'title';
  const order = options?.order === 'desc' ? 'DESC' : 'ASC';
  const like = `%${genre.toLowerCase()}%`;

  const rows = queryAll(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    LEFT JOIN watch_progress wp ON m.id = wp.movieId
    WHERE LOWER(m.genres) LIKE ?
    ORDER BY m.${sortBy === 'title' ? 'title' : 'year'} ${order}
  `, [like]);

  return rows.map(rowToMovie);
}

export function getContinueWatching(): Movie[] {
  const rows = queryAll(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    INNER JOIN watch_progress wp ON m.id = wp.movieId
    WHERE wp.position > 30 AND wp.completed = 0
    ORDER BY wp.lastPlayed DESC
    LIMIT 20
  `);

  return rows.map(rowToMovie);
}

export function getRecentlyAdded(): Movie[] {
  const rows = queryAll(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    LEFT JOIN watch_progress wp ON m.id = wp.movieId
    ORDER BY m.dateAdded DESC
    LIMIT 20
  `);

  return rows.map(rowToMovie);
}

export function getMyList(): Movie[] {
  const rows = queryAll(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    LEFT JOIN watch_progress wp ON m.id = wp.movieId
    WHERE m.isInMyList = 1
    ORDER BY m.title ASC
  `);

  return rows.map(rowToMovie);
}

export function getGenres(): string[] {
  const rows = queryAll("SELECT genres FROM movies WHERE genres != '[]' AND genres != ''");
  const genreSet = new Set<string>();

  for (const row of rows) {
    try {
      const genres = JSON.parse(row.genres);
      if (Array.isArray(genres)) {
        genres.forEach((g: string) => genreSet.add(g));
      }
    } catch {}
  }

  return Array.from(genreSet).sort();
}

export function getMovieCount(): number {
  const row = queryOne('SELECT COUNT(*) as count FROM movies');
  return row ? Number(row.count) : 0;
}

export function updateMovie(id: number, data: Record<string, unknown>): void {
  const db = getDb();
  const allowedFields = [
    'title', 'year', 'description', 'poster', 'backdrop', 'duration',
    'rating', 'director', 'writers', 'cast', 'genres', 'tmdbId', 'isInMyList'
  ];

  const updates = Object.entries(data)
    .filter(([key]) => allowedFields.includes(key))
    .map(([key, value]) => {
      // sql.js rejects undefined/objects, and NaN would silently store garbage
      let serialized: unknown = value;
      if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) serialized = null;
      else if (typeof value === 'object' && value !== null) serialized = JSON.stringify(value);
      else if (typeof value === 'boolean') serialized = value ? 1 : 0;
      return [key, serialized];
    });

  if (updates.length === 0) return;

  const setClause = updates.map(([key]) => `${key} = ?`).join(', ');
  const values = updates.map(([, value]) => value);

  db.run(`UPDATE movies SET ${setClause}, lastModified = strftime('%s', 'now') WHERE id = ?`, [...values, id] as any[]);
  saveDb();
}

export function deleteMovie(id: number): void {
  const db = getDb();
  db.run('DELETE FROM movies WHERE id = ?', [id]);
  db.run('DELETE FROM watch_progress WHERE movieId = ?', [id]);
  saveDb();
}

export function updateWatchProgress(movieId: number, position: number, duration: number): void {
  if (!Number.isFinite(position) || position < 0) return;
  if (!Number.isFinite(duration) || duration < 0) duration = 0;
  const db = getDb();
  const completed = duration > 0 && position / duration > 0.9 ? 1 : 0;

  const existing = queryOne('SELECT id, watchCount FROM watch_progress WHERE movieId = ?', [movieId]);

  if (existing) {
    db.run(`
      UPDATE watch_progress 
      SET position = ?, duration = ?, lastPlayed = strftime('%s', 'now'), completed = ?
      WHERE movieId = ?
    `, [position, duration, completed, movieId]);
  } else {
    db.run(`
      INSERT INTO watch_progress (movieId, position, duration, lastPlayed, watchCount, completed)
      VALUES (?, ?, ?, strftime('%s', 'now'), 1, ?)
    `, [movieId, position, duration, completed]);
  }
  saveDb();
}

export function toggleMyList(movieId: number): boolean {
  const db = getDb();
  const row = queryOne('SELECT isInMyList FROM movies WHERE id = ?', [movieId]);
  if (!row) return false;

  const newValue = row.isInMyList ? 0 : 1;
  db.run('UPDATE movies SET isInMyList = ? WHERE id = ?', [newValue, movieId]);
  saveDb();
  return newValue === 1;
}

/** The configured library folder, or the platform default. */
export function getMoviesFolder(): string {
  return getSettings('moviesFolder') || defaultMoviesFolder();
}

export function getSettings(key: string): string {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? String(row.value) : '';
}

export function setSetting(key: string, value: string): void {
  if (typeof key !== 'string' || !key) throw new Error('Invalid setting key');
  value = value == null ? '' : String(value);
  const db = getDb();
  const existing = queryOne('SELECT key FROM settings WHERE key = ?', [key]);
  if (existing) {
    db.run('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
  } else {
    db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
  saveDb();
}

export function upsertMovie(data: {
  filePath: string;
  fileName: string;
  title: string;
  year?: number;
  fileSize?: number;
}): number {
  const db = getDb();
  const existing = queryOne('SELECT id FROM movies WHERE filePath = ?', [data.filePath]);

  if (existing) {
    db.run(`
      UPDATE movies SET fileName = ?, fileSize = ?, lastModified = strftime('%s', 'now')
      WHERE filePath = ?
    `, [data.fileName, data.fileSize || 0, data.filePath]);
    saveDb();
    return Number(existing.id);
  } else {
    db.run(`
      INSERT INTO movies (filePath, fileName, title, year, fileSize, dateAdded)
      VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
    `, [data.filePath, data.fileName, data.title, data.year || null, data.fileSize || 0]);
    saveDb();
    const row = queryOne('SELECT last_insert_rowid() as id');
    return row ? Number(row.id) : 0;
  }
}

export function removeMovieByPath(filePath: string): void {
  const db = getDb();
  db.run('DELETE FROM movies WHERE filePath = ?', [filePath]);
  saveDb();
}

export function getAllMoviePaths(): string[] {
  const rows = queryAll('SELECT filePath FROM movies');
  return rows.map((r: any) => String(r.filePath));
}
