// TV / web series: show metadata + episode lists from TVMaze, episode torrents from EZTV.
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getJsonViaDoh } from './net-util';
import { fetchYtsImage } from './yts-service';

const TVMAZE = 'https://api.tvmaze.com';
// EZTV domains are blocked by DNS poisoning on some ISPs, so they are always reached via DNS-over-HTTPS.
const EZTV_HOSTS = ['https://eztv.yt', 'https://eztv.wf', 'https://eztv.re', 'https://eztvx.to', 'https://eztv.tf'];
let lastGoodEztv = '';

export interface SeriesTorrent {
  quality: string;
  codec: string;
  size: string;
  sizeBytes: number;
  seeds: number;
  peers: number;
  hash: string;
  magnet: string;
  release: string;
}

export interface SeriesEpisode {
  season: number;
  number: number;
  name: string;
  airdate: string;
  summary: string;
  image: string;
  torrents: SeriesTorrent[];
}

export interface SeriesShow {
  id: number;
  imdbId: string;
  title: string;
  year: number;
  summary: string;
  poster: string;
  posterLarge: string;
  genres: string[];
  language: string;
  rating: number;
  status: string;
  network: string;
}

export interface SeriesDetail {
  show: SeriesShow;
  episodes: SeriesEpisode[];
}

export interface SeriesListResult {
  shows: SeriesShow[];
  total: number;
  page: number;
  limit: number;
}

export interface SeriesListOptions {
  query?: string;
  page?: number;
  limit?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

const stripHtml = (s: string | null | undefined) => (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").trim();

function formatSize(bytes: number): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i < 2 ? 0 : 1)} ${units[i]}`;
}

async function tvmaze(pathAndQuery: string): Promise<any | null> {
  const res = await fetch(`${TVMAZE}${pathAndQuery}`, {
    signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': 'CineLocal/1.0' },
  });
  if (res.status === 404) return null;
  if (res.status === 429) throw new Error('TVMaze is rate limiting requests. Try again in a moment.');
  if (!res.ok) throw new Error(`TVMaze HTTP ${res.status}`);
  return res.json();
}

async function eztv(pathAndQuery: string): Promise<any> {
  const hosts = Array.from(new Set([lastGoodEztv, ...EZTV_HOSTS].filter(Boolean)));
  let lastError: unknown = null;
  for (const host of hosts) {
    try {
      const json = await getJsonViaDoh(`${host}${pathAndQuery}`, 12000);
      lastGoodEztv = host;
      return json;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not reach EZTV (${lastError instanceof Error ? lastError.message : 'unknown error'}).`);
}

function mapShow(s: any): SeriesShow {
  return {
    id: s.id,
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
  };
}

function mapTorrent(t: any): SeriesTorrent {
  const name: string = t.filename || t.title || '';
  const quality = /(2160p|1080p|720p|480p)/i.exec(name)?.[1].toLowerCase() || 'SD';
  const codec = /x265|hevc|h\.?265/i.test(name) ? 'x265' : /x264|h\.?264|avc/i.test(name) ? 'x264' : /xvid/i.test(name) ? 'xvid' : '';
  return {
    quality, codec,
    size: formatSize(Number(t.size_bytes) || 0),
    sizeBytes: Number(t.size_bytes) || 0,
    seeds: t.seeds || 0,
    peers: t.peers || 0,
    hash: String(t.hash || '').toLowerCase(),
    magnet: t.magnet_url || '',
    release: name,
  };
}

// ─── Persistent cache ───────────────────────────────────────────────

interface PoolEntry { imdbId: string; score: number }
interface SeriesCache {
  pool?: { time: number; list: PoolEntry[] };
  shows: Record<string, { time: number; show: SeriesShow | null }>;
}
const POOL_TTL_MS = 15 * 60 * 1000;
const SHOW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let cache: SeriesCache | null = null;
let saveTimer: NodeJS.Timeout | null = null;

const cacheFile = () => path.join(app.getPath('userData'), 'series-cache.json');

function getCache(): SeriesCache {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { cache = { shows: {} }; }
  if (!cache!.shows) cache!.shows = {};
  return cache!;
}

function saveCache() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(cacheFile(), JSON.stringify(getCache())); } catch { /* best effort */ }
  }, 2000);
}

// ─── Trending ───────────────────────────────────────────────────────

let poolPromise: Promise<PoolEntry[]> | null = null;

/** Shows with the most active recent EZTV releases, ranked by seeders. */
async function trendingPool(force = false): Promise<PoolEntry[]> {
  const c = getCache();
  if (!force && c.pool && Date.now() - c.pool.time < POOL_TTL_MS) return c.pool.list;
  if (poolPromise) return poolPromise;

  poolPromise = (async () => {
    try {
      const scores = new Map<string, number>();
      const pages = await Promise.all([1, 2, 3, 4, 5].map(p =>
        eztv(`/api/get-torrents?limit=100&page=${p}`).then(j => j.torrents || []).catch(() => [])));
      for (const t of pages.flat()) {
        const id = String(t.imdb_id || '0');
        if (id === '0' || !(t.seeds > 0 || t.peers > 0)) continue;
        scores.set(id, (scores.get(id) || 0) + (t.seeds || 0) + 1);
      }
      const list = Array.from(scores, ([imdbId, score]) => ({ imdbId, score })).sort((a, b) => b.score - a.score);
      if (list.length === 0) throw new Error('No recent releases found');
      c.pool = { time: Date.now(), list };
      saveCache();
      return list;
    } catch (err) {
      if (c.pool) return c.pool.list; // stale beats nothing
      throw err;
    } finally {
      poolPromise = null;
    }
  })();
  return poolPromise;
}

async function showByImdb(imdbId: string): Promise<SeriesShow | null> {
  const c = getCache();
  const hit = c.shows[imdbId];
  if (hit && Date.now() - hit.time < SHOW_TTL_MS) return hit.show;
  try {
    const raw = await tvmaze(`/lookup/shows?imdb=tt${imdbId.padStart(7, '0')}`);
    const show = raw ? mapShow(raw) : null;
    c.shows[imdbId] = { time: Date.now(), show };
    saveCache();
    return show;
  } catch {
    return hit?.show ?? null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export async function listSeries(options: SeriesListOptions = {}): Promise<SeriesListResult> {
  const limit = options.limit || 24;
  const page = options.page || 1;
  const query = (options.query || '').trim();

  if (query) {
    if (page > 1) return { shows: [], total: 0, page, limit };
    const results = (await tvmaze(`/search/shows?q=${encodeURIComponent(query)}`)) || [];
    // Shows without an IMDb id cannot be matched to torrents
    const shows = results.map((r: any) => mapShow(r.show)).filter((s: SeriesShow) => s.imdbId);
    return { shows, total: shows.length, page, limit };
  }

  const pool = await trendingPool();
  const slice = pool.slice((page - 1) * limit, page * limit);
  const shows = (await mapLimit(slice, 6, e => showByImdb(e.imdbId))).filter((s): s is SeriesShow => !!s);
  return { shows, total: pool.length, page, limit };
}

// ─── Detail ─────────────────────────────────────────────────────────

const detailCache = new Map<number, { time: number; detail: SeriesDetail }>();

export async function getSeries(id: number): Promise<SeriesDetail> {
  const hit = detailCache.get(id);
  if (hit && Date.now() - hit.time < 10 * 60 * 1000) return hit.detail;

  const raw = await tvmaze(`/shows/${id}?embed=episodes`);
  if (!raw) throw new Error('Show not found');
  const show = mapShow(raw);
  const episodes: SeriesEpisode[] = (raw._embedded?.episodes || []).map((e: any): SeriesEpisode => ({
    season: e.season,
    number: e.number ?? 0,
    name: e.name || '',
    airdate: e.airdate || '',
    summary: stripHtml(e.summary),
    image: e.image?.medium || '',
    torrents: [],
  })).filter((e: SeriesEpisode) => e.number > 0);

  // Attach EZTV torrents by season/episode number
  if (show.imdbId) {
    const byKey = new Map(episodes.map(e => [`${e.season}x${e.number}`, e]));
    const numericId = show.imdbId.replace(/^tt/, '').replace(/^0+/, '');
    let fetched = 0;
    for (let p = 1; p <= 8; p++) {
      let json: any;
      try { json = await eztv(`/api/get-torrents?imdb_id=${numericId}&limit=100&page=${p}`); } catch (err) {
        if (p === 1) throw err;
        break;
      }
      const batch: any[] = json.torrents || [];
      for (const t of batch) {
        const ep = byKey.get(`${parseInt(t.season, 10)}x${parseInt(t.episode, 10)}`);
        const mapped = mapTorrent(t);
        if (ep && mapped.magnet && (mapped.seeds > 0 || mapped.peers > 0)) ep.torrents.push(mapped);
      }
      fetched += batch.length;
      if (batch.length < 100 || fetched >= (json.torrents_count || 0)) break;
    }
  }

  const detail = { show: { ...show, imdbId: show.imdbId }, episodes };
  detailCache.set(id, { time: Date.now(), detail });
  return detail;
}

/** Warms the trending list, the first page of shows and their posters at startup. */
export async function prefetchSeries() {
  try {
    const first = await listSeries({ page: 1, limit: 24 });
    await mapLimit(first.shows, 6, s => (s.poster ? fetchYtsImage(s.poster).catch(() => undefined) : Promise.resolve(undefined)));
    console.log(`[series] prefetched ${first.shows.length} shows`);
  } catch (err) {
    console.log('[series] prefetch skipped:', err instanceof Error ? err.message : err);
  }
}
