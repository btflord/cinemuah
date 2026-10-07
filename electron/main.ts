import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } from 'electron';
import path from 'path';
import { initDatabase, flushDb } from './database';
import { startMediaServer, stopMediaServer } from './media-server';
import { initTranscoder } from './transcoder';
import { listSeries, getSeries, prefetchSeries, SeriesListOptions } from './series-service';
import { scanLibrary } from './scanner';
import { 
  getMovies, getMovieById, updateMovie, searchMovies, 
  getMoviesByGenre, getContinueWatching, getRecentlyAdded,
  updateWatchProgress, toggleMyList, getMyList, getGenres,
  getMovieCount, deleteMovie, getSettings, setSetting, getMoviesFolder
} from './movie-store';
import { fetchMovieMetadata, searchMovieMetadata } from './metadata-service';
import { listYtsMovies, getYtsMovie, setYtsMirror, testYtsConnection, prefetchYts, YtsListOptions } from './yts-service';
import {
  startTorrent, stopTorrent, getTorrentStats, destroyTorrentClientSync,
  startDownload, getDownloads, cancelDownload, pauseDownload, resumeDownload,
  clearFinishedDownloads, setDownloadFinishedHandler, DownloadMeta,
} from './torrent-service';
import fs from 'fs';

// Own Windows app identity: the taskbar then shows this app's icon instead of Electron's
app.setAppUserModelId('com.cinelocal.app');

let mainWindow: BrowserWindow | null = null;
let mediaServerPort = 0;
let appReady = false;

// Last-resort logging so a stray error in a background task (torrents, scans, prefetch)
// is recorded instead of popping Electron's raw crash dialog or killing the app.
process.on('uncaughtException', err => console.error('[main] uncaught exception:', err));
process.on('unhandledRejection', reason => console.error('[main] unhandled rejection:', reason));

// Two copies would write the same SQLite file and fight over it; focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

const isSafeExternalUrl = (url: string) => {
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    // Native window controls: macOS traffic lights sit in the 28px strip above the navbar;
    // Windows/Linux get the system's own minimise/maximise/close buttons overlaid in the same strip.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 8 } }
      : { titleBarOverlay: { color: '#0a0a0a', symbolColor: '#ffffff', height: 28 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    icon: path.join(__dirname, '../../public', process.platform === 'win32' ? 'cinelocal.ico' : 'icon.png'),
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Links that try to open new windows go to the system browser instead (http/https only).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) event.preventDefault();
  });

  // Recover from a crashed or hung renderer instead of leaving a blank window.
  mainWindow.webContents.on('render-process-gone', async (_event, details) => {
    console.error('[main] renderer gone:', details.reason);
    if (details.reason === 'clean-exit' || !mainWindow) return;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'error',
      message: 'CineLocal stopped unexpectedly',
      detail: `The window crashed (${details.reason}). Your library and watch progress are saved.`,
      buttons: ['Reload', 'Quit'],
      defaultId: 0,
    });
    if (response === 0) mainWindow?.reload();
    else app.quit();
  });
  mainWindow.on('unresponsive', () => console.warn('[main] window is not responding'));
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (code === -3) return; // aborted navigation, harmless
    console.error(`[main] failed to load ${url}: ${description} (${code})`);
    // Make sure the user sees something rather than an invisible window
    if (!mainWindow?.isVisible()) mainWindow?.show();
  });

  const distIndex = path.join(__dirname, '../../dist/index.html');
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else if (fs.existsSync(distIndex)) {
    mainWindow.loadFile(distIndex);
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await initDatabase();
  } catch (err) {
    console.error('[main] database init failed:', err);
    dialog.showErrorBox(
      'CineLocal could not open its library',
      `The library database failed to load:\n\n${err instanceof Error ? err.message : err}\n\n` +
      `Location: ${app.getPath('userData')}`
    );
    app.exit(1);
    return;
  }

  try {
    mediaServerPort = await startMediaServer();
    console.log(`Media server started on port ${mediaServerPort}`);
  } catch (err) {
    // The UI still works for browsing; playback will report its own errors.
    console.error('[main] media server failed to start:', err);
  }

  appReady = true;
  await createWindow();

  // Background work starts after the window so a slow network can't delay launch.
  try { initTranscoder(); } catch (err) { console.error('[main] transcoder init failed:', err); }
  setYtsMirror(getSettings('ytsMirror') || '');
  prefetchYts().catch(() => undefined); // warm title/poster caches in the background
  prefetchSeries().catch(() => undefined);
}).catch(err => {
  console.error('[main] startup failed:', err);
  dialog.showErrorBox('CineLocal failed to start', err instanceof Error ? err.message : String(err));
  app.exit(1);
});

app.on('activate', () => {
  // macOS: clicking the Dock icon with no windows open reopens the main window
  if (appReady && BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  // On macOS the app stays alive in the Dock, so keep the media server for when the window reopens.
  if (process.platform !== 'darwin') app.quit();
});

// Cleanup is synchronous on purpose: cancelling 'before-quit' to await async work and then calling
// app.quit() again leaves a packaged macOS app running when the quit came from the Dock or Cmd+Q.
let cleanedUp = false;
app.on('before-quit', () => {
  if (cleanedUp) return;
  cleanedUp = true;
  try { destroyTorrentClientSync(); } catch (err) { console.error('[main] torrent cleanup failed:', err); }
  stopMediaServer();
  flushDb();
});

// --- IPC Handlers ---

// Window controls
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());
// Keeps the native window controls readable when the app switches between dark and light
ipcMain.handle('window:setTheme', (_event, theme: string) => {
  const light = theme === 'light';
  nativeTheme.themeSource = light ? 'light' : 'dark';
  if (process.platform !== 'darwin' && mainWindow) {
    try {
      mainWindow.setTitleBarOverlay({ color: light ? '#f3f0ea' : '#0a0a0a', symbolColor: light ? '#17140f' : '#ffffff', height: 28 });
    } catch { /* overlay not available on this platform */ }
  }
});

// Media server info
ipcMain.handle('media:getPort', () => mediaServerPort);

// Settings
ipcMain.handle('settings:get', (_event, key: string) => getSettings(key));
ipcMain.handle('settings:set', (_event, key: string, value: string) => setSetting(key, value));

// Movies
ipcMain.handle('movies:getAll', (_event, options?: { sortBy?: string; order?: string }) => 
  getMovies(options));
ipcMain.handle('movies:getById', (_event, id: number) => getMovieById(Number(id)));
ipcMain.handle('movies:search', (_event, query: string) => searchMovies(typeof query === 'string' ? query : ''));
ipcMain.handle('movies:getByGenre', (_event, genre: string, options?: { sortBy?: string; order?: string }) => 
  getMoviesByGenre(genre, options));
ipcMain.handle('movies:getContinueWatching', () => getContinueWatching());
ipcMain.handle('movies:getRecentlyAdded', () => getRecentlyAdded());
ipcMain.handle('movies:getMyList', () => getMyList());
ipcMain.handle('movies:getGenres', () => getGenres());
ipcMain.handle('movies:getCount', () => getMovieCount());
ipcMain.handle('movies:update', (_event, id: number, data: Record<string, unknown>) => updateMovie(id, data));
ipcMain.handle('movies:delete', (_event, id: number) => deleteMovie(id));

// Watch progress
ipcMain.handle('progress:update', (_event, movieId: number, position: number, duration: number) => 
  updateWatchProgress(movieId, position, duration));

// My List
ipcMain.handle('mylist:toggle', (_event, movieId: number) => toggleMyList(movieId));

// Library scanning
ipcMain.handle('library:scan', async (_event, folder?: string) => {
  const moviesFolder = folder || getMoviesFolder();
  
  const sendProgress = (data: { phase: string; current: number; total: number; message: string }) => {
    mainWindow?.webContents.send('library:scanProgress', data);
  };
  
  try {
    const result = await scanLibrary(moviesFolder, sendProgress);
    mainWindow?.webContents.send('library:scanComplete', result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    mainWindow?.webContents.send('library:scanError', { message });
    throw error;
  }
});

// Folder selection
ipcMain.handle('dialog:selectFolder', async () => {
  const options: Electron.OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Movie Folder',
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] || null;
});

// File validation
ipcMain.handle('file:exists', (_event, filePath: string) => {
  return typeof filePath === 'string' && filePath.length > 0 && fs.existsSync(filePath);
});

// Metadata
ipcMain.handle('metadata:search', async (_event, title: string, year?: number) => {
  const apiKey = getSettings('tmdbApiKey') || '';
  return searchMovieMetadata(title, year, apiKey);
});

ipcMain.handle('metadata:fetch', async (_event, tmdbId: number) => {
  const apiKey = getSettings('tmdbApiKey') || '';
  return fetchMovieMetadata(tmdbId, apiKey);
});

ipcMain.handle('metadata:refreshMovie', async (_event, movieId: number) => {
  const movie = getMovieById(movieId);
  if (!movie) return null;
  
  const apiKey = getSettings('tmdbApiKey') || '';
  if (!apiKey) return null;
  
  // Parse title and year from filename
  const titleMatch = movie.title.match(/^(.+?)\s*(?:\((\d{4})\))?$/);
  const title = titleMatch ? titleMatch[1].trim() : movie.title;
  const year = titleMatch && titleMatch[2] ? parseInt(titleMatch[2]) : undefined;
  
  const results = await searchMovieMetadata(title, year, apiKey);
  if (results && results.length > 0) {
    const metadata = await fetchMovieMetadata(results[0].id, apiKey);
    if (metadata) {
      updateMovie(movieId, {
        title: metadata.title,
        year: metadata.year,
        description: metadata.description,
        poster: metadata.poster,
        backdrop: metadata.backdrop,
        rating: metadata.rating,
        duration: metadata.duration,
        genres: metadata.genres,
        cast: metadata.cast,
        director: metadata.director,
        writers: metadata.writers,
        tmdbId: metadata.tmdbId,
      });
      return getMovieById(movieId);
    }
  }
  return null;
});

// YTS discovery
ipcMain.handle('yts:list', (_event, options?: YtsListOptions) => {
  setYtsMirror(getSettings('ytsMirror') || '');
  return listYtsMovies(options);
});
ipcMain.handle('yts:test', () => {
  setYtsMirror(getSettings('ytsMirror') || '');
  return testYtsConnection();
});
ipcMain.handle('yts:get', (_event, id: number) => {
  setYtsMirror(getSettings('ytsMirror') || '');
  return getYtsMovie(id);
});

// Series (TVMaze + EZTV)
ipcMain.handle('series:list', (_event, options?: SeriesListOptions) => listSeries(options));
ipcMain.handle('series:get', (_event, id: number) => getSeries(id));

// Downloads (saved into the movie library folder)
const getLibraryRoot = () => getMoviesFolder();

setDownloadFinishedHandler(async (info) => {
  try {
    await scanLibrary(getLibraryRoot(), () => undefined);
  } catch (err) {
    console.error('[downloads] rescan failed:', err);
  }
  mainWindow?.webContents.send('downloads:finished', info);
});

ipcMain.handle('downloads:start', (_event, magnet: string, meta: DownloadMeta) => {
  if (typeof magnet !== 'string' || !magnet.startsWith('magnet:?xt=urn:btih:')) throw new Error('Invalid magnet link');
  const root = getLibraryRoot();
  if (!fs.existsSync(root)) throw new Error(`Movie folder not found: ${root}. Set it in Settings.`);
  return startDownload(magnet, meta, root);
});
ipcMain.handle('downloads:list', () => getDownloads());
ipcMain.handle('downloads:cancel', (_event, hash: string) => cancelDownload(hash));
ipcMain.handle('downloads:pause', (_event, hash: string) => pauseDownload(hash));
ipcMain.handle('downloads:resume', (_event, hash: string) => resumeDownload(hash));
ipcMain.handle('downloads:clear', () => clearFinishedDownloads());

// Torrent streaming
ipcMain.handle('torrent:start', (_event, magnet: string) => {
  if (typeof magnet !== 'string' || !magnet.startsWith('magnet:?xt=urn:btih:')) {
    throw new Error('Invalid magnet link');
  }
  return startTorrent(magnet);
});
ipcMain.handle('torrent:stats', () => getTorrentStats());
ipcMain.handle('torrent:stop', () => stopTorrent());

// Open external URL
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  if (typeof url !== 'string' || !isSafeExternalUrl(url)) throw new Error('Only web links can be opened');
  await shell.openExternal(url);
});

