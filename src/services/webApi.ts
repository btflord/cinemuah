// Web implementation of the desktop bridge (window.electronAPI). The React app is unchanged:
// catalogue calls go to the serverless functions in /api (TMDB, key kept server-side) and
// settings live in localStorage. Desktop-only features (torrents, local library, FFmpeg)
// reject with a message pointing to the desktop app.
import type { ElectronAPI } from '@/types/electron';
import type { YtsListOptions } from '@/types';
import { getLanguagesSnapshot } from '@/lib/languages';

const DESKTOP_ONLY = 'Streaming, downloads and your own library are available in the Cinemuah desktop app.';
const desktopOnly = () => Promise.reject(new Error(DESKTOP_ONLY));

const SETTINGS_KEY = 'cinemuah_web_settings';
const readSettings = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
};

async function api<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(`/api/${path}${qs.toString() ? `?${qs}` : ''}`);
  } catch {
    throw new Error('You appear to be offline.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

const languagesParam = () => getLanguagesSnapshot().join(',') || undefined;

export const webApi: ElectronAPI = {
  window: {
    minimize: async () => undefined,
    maximize: async () => undefined,
    close: async () => undefined,
  },
  media: { getPort: async () => 0 },
  settings: {
    get: async key => readSettings()[key] ?? '',
    set: async (key, value) => {
      const all = readSettings();
      all[key] = String(value ?? '');
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(all)); } catch { throw new Error('Your browser blocked saving settings.'); }
    },
  },
  movies: {
    getAll: async () => [],
    getById: async () => null,
    search: async () => [],
    getByGenre: async () => [],
    getContinueWatching: async () => [],
    getRecentlyAdded: async () => [],
    getMyList: async () => [],
    getGenres: async () => [],
    getCount: async () => 0,
    update: desktopOnly,
    delete: desktopOnly,
  },
  progress: { update: async () => undefined },
  mylist: { toggle: desktopOnly },
  library: {
    scan: desktopOnly,
    onScanProgress: () => undefined,
    onScanComplete: () => undefined,
    onScanError: () => undefined,
    removeScanListeners: () => undefined,
  },
  dialog: { selectFolder: async () => null },
  file: { exists: async () => false },
  metadata: { search: async () => null, fetch: async () => null, refreshMovie: async () => null },
  yts: {
    list: (o: YtsListOptions = {}) => api('movies', {
      query: o.query, page: o.page, genre: o.genre, sortBy: o.sortBy, minimumRating: o.minimumRating,
      languages: languagesParam(),
    }),
    get: id => api('movie', { id }),
    test: async () => ({ ok: true, host: window.location.origin, ms: 0 }),
  },
  series: {
    list: (o = {}) => api('series', { query: o.query, page: o.page, languages: languagesParam() }),
    get: id => api('show', { id }),
  },
  downloads: {
    start: desktopOnly,
    list: async () => [],
    cancel: async () => undefined,
    pause: async () => undefined,
    resume: async () => undefined,
    clear: async () => undefined,
    onFinished: () => () => undefined,
  },
  torrent: { start: desktopOnly, stats: async () => null, stop: async () => undefined },
  shell: {
    openExternal: async url => {
      if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
    },
  },
};
