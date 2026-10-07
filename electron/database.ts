import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import os from 'os';

let db: SqlJsDatabase;
let dbPath: string;
let saveTimer: NodeJS.Timeout | null = null;

const WINDOWS_DEFAULT_FOLDER = 'E:\\Personal\\Movies';

/** Default library folder for this platform (the original Windows path, or ~/Movies elsewhere). */
export function defaultMoviesFolder(): string {
  return process.platform === 'win32' ? WINDOWS_DEFAULT_FOLDER : path.join(os.homedir(), 'Movies');
}

export function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized');
  return db;
}

/** Writes the database to disk now. Writes to a temp file first so a crash can't leave a half-written DB. */
export function flushDb(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!db || !dbPath) return;
  try {
    const tmp = `${dbPath}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(db.export()));
    fs.renameSync(tmp, dbPath);
  } catch (err) {
    console.error('Failed to save database file:', err);
  }
}

/** Schedules a write. Scans call this per file, so writes are coalesced instead of rewriting the DB each time. */
export function saveDb(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(flushDb, 500);
}

export async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath('userData');
  dbPath = path.join(userDataPath, 'cinelocal.sqlite');
  
  console.log(`Database path: ${dbPath}`);

  let wasmPath = '';
  try {
    const sqlJsModulePath = require.resolve('sql.js');
    const cand = path.join(path.dirname(sqlJsModulePath), 'sql-wasm.wasm');
    if (fs.existsSync(cand)) wasmPath = cand;
  } catch {}

  if (!wasmPath) {
    const distWasm = path.join(__dirname, 'sql-wasm.wasm');
    if (fs.existsSync(distWasm)) wasmPath = distWasm;
    else wasmPath = path.join(__dirname, '../dist-electron/sql-wasm.wasm');
  }

  const SQL = await initSqlJs({
    locateFile: () => wasmPath
  });
  
  db = new SQL.Database();
  if (fs.existsSync(dbPath)) {
    try {
      const loaded = new SQL.Database(fs.readFileSync(dbPath));
      loaded.exec('SELECT count(*) FROM sqlite_master'); // throws if the file isn't a valid database
      db = loaded;
    } catch (err) {
      // Keep the unreadable file for recovery and start with a fresh library instead of failing to launch.
      const backup = `${dbPath}.corrupt-${Date.now()}`;
      console.error(`Database file is unreadable, moving it to ${backup}:`, err);
      try { fs.renameSync(dbPath, backup); } catch { /* best effort */ }
    }
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filePath TEXT UNIQUE NOT NULL,
      fileName TEXT NOT NULL,
      title TEXT NOT NULL,
      year INTEGER,
      description TEXT DEFAULT '',
      poster TEXT DEFAULT '',
      backdrop TEXT DEFAULT '',
      duration INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      director TEXT DEFAULT '',
      writers TEXT DEFAULT '[]',
      cast TEXT DEFAULT '[]',
      genres TEXT DEFAULT '[]',
      tmdbId INTEGER,
      dateAdded INTEGER DEFAULT (strftime('%s', 'now')),
      lastModified INTEGER DEFAULT (strftime('%s', 'now')),
      fileSize INTEGER DEFAULT 0,
      isInMyList INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS watch_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movieId INTEGER NOT NULL,
      position REAL DEFAULT 0,
      duration REAL DEFAULT 0,
      lastPlayed INTEGER DEFAULT (strftime('%s', 'now')),
      watchCount INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      UNIQUE(movieId)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Insert default settings
  const defaultSettings: [string, string][] = [
    ['moviesFolder', defaultMoviesFolder()],
    ['tmdbApiKey', ''],
    ['autoResume', 'true'],
    ['defaultSpeed', '1'],
    ['rememberVolume', 'true'],
    ['volume', '1'],
    ['accentColor', '#e50914'],
    ['cardSize', 'comfortable']
  ];

  for (const [k, v] of defaultSettings) {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = :key');
    stmt.bind({ ':key': k });
    if (!stmt.step()) {
      db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]);
    }
    stmt.free();
  }

  // Libraries created with the Windows default on another OS point at a path that can't exist here.
  if (process.platform !== 'win32') {
    db.run('UPDATE settings SET value = ? WHERE key = ? AND value = ?', [defaultMoviesFolder(), 'moviesFolder', WINDOWS_DEFAULT_FOLDER]);
  }

  flushDb();
  console.log('Database initialized successfully with sql.js');
}
