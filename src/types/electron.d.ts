// Type definitions for the Electron API exposed via preload/contextBridge
import type {
  Movie, ScanProgress, ScanResult, MovieSearchResult,
  YtsListOptions, YtsListResult, YtsMovie, TorrentStreamInfo, TorrentStats, DownloadInfo,
  SeriesDetail, SeriesListResult,
} from '@/types';

export interface ElectronAPI {
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    setTheme?: (theme: 'dark' | 'light') => Promise<void>;
  };
  media: {
    getPort: () => Promise<number>;
  };
  settings: {
    get: (key: string) => Promise<string>;
    set: (key: string, value: string) => Promise<void>;
  };
  movies: {
    getAll: (options?: { sortBy?: string; order?: string }) => Promise<Movie[]>;
    getById: (id: number) => Promise<Movie | null>;
    search: (query: string) => Promise<Movie[]>;
    getByGenre: (genre: string, options?: { sortBy?: string; order?: string }) => Promise<Movie[]>;
    getContinueWatching: () => Promise<Movie[]>;
    getRecentlyAdded: () => Promise<Movie[]>;
    getMyList: () => Promise<Movie[]>;
    getGenres: () => Promise<string[]>;
    getCount: () => Promise<number>;
    update: (id: number, data: Record<string, unknown>) => Promise<void>;
    delete: (id: number) => Promise<void>;
  };
  progress: {
    update: (movieId: number, position: number, duration: number) => Promise<void>;
  };
  mylist: {
    toggle: (movieId: number) => Promise<boolean>;
  };
  library: {
    scan: (folder?: string) => Promise<ScanResult>;
    onScanProgress: (callback: (data: ScanProgress) => void) => void;
    onScanComplete: (callback: (result: ScanResult) => void) => void;
    onScanError: (callback: (error: { message: string }) => void) => void;
    removeScanListeners: () => void;
  };
  dialog: {
    selectFolder: () => Promise<string | null>;
  };
  file: {
    exists: (filePath: string) => Promise<boolean>;
  };
  metadata: {
    search: (title: string, year?: number) => Promise<MovieSearchResult[] | null>;
    fetch: (tmdbId: number) => Promise<unknown>;
    refreshMovie: (movieId: number) => Promise<Movie | null>;
  };
  yts: {
    list: (options?: YtsListOptions) => Promise<YtsListResult>;
    get: (id: number) => Promise<YtsMovie | null>;
    test: () => Promise<{ ok: boolean; host?: string; ms?: number; error?: string }>;
  };
  series: {
    list: (options?: { query?: string; page?: number; limit?: number }) => Promise<SeriesListResult>;
    get: (id: number) => Promise<SeriesDetail>;
  };
  downloads: {
    start: (
      magnet: string,
      meta: {
        title: string;
        year: number;
        quality: string;
        series?: { showTitle: string; season: number; episode: number };
      }
    ) => Promise<DownloadInfo>;
    list: () => Promise<DownloadInfo[]>;
    cancel: (hash: string) => Promise<void>;
    pause: (hash: string) => Promise<void>;
    resume: (hash: string) => Promise<void>;
    clear: () => Promise<void>;
    onFinished: (callback: (info: DownloadInfo) => void) => () => void;
  };
  torrent: {
    start: (magnet: string) => Promise<TorrentStreamInfo>;
    stats: () => Promise<TorrentStats | null>;
    stop: () => Promise<void>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
