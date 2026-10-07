import http from 'http';
import fs from 'fs';
import path from 'path';
import mime from 'mime';
import { getMovieById, getMoviesFolder } from './movie-store';
import { getTorrentFile } from './torrent-service';
import { probe, transcodeTo } from './transcoder';
import { fetchYtsImage } from './yts-service';

let server: http.Server | null = null;
let serverPort = 0;

// Allowed video extensions for security
const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.mpg', '.mpeg', '.flv', '.wmv']);

function isPathSafe(requestedPath: string, moviesFolder: string): boolean {
  // A plain prefix check would let "/Movies" also match "/Movies-private"; require a real child path.
  const fold = (p: string) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);
  const rel = path.relative(fold(path.resolve(moviesFolder)), fold(path.resolve(requestedPath)));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Parses a single `bytes=` Range header. Returns null for an unsatisfiable or malformed range. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2]) || size === 0) return null;
  let start: number;
  let end = size - 1;
  if (m[1]) {
    start = parseInt(m[1], 10);
    if (m[2]) end = Math.min(parseInt(m[2], 10), size - 1);
  } else {
    start = Math.max(0, size - parseInt(m[2], 10)); // suffix range: last N bytes
  }
  if (start >= size || start > end) return null;
  return { start, end };
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(message);
}

export function startMediaServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      try {
        handleRequest(req, res);
      } catch (err) {
        console.error('Media server request failed:', err);
        sendError(res, 500, 'Internal Server Error');
      }
    });

    function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
      // CORS headers for Electron renderer
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      const url = new URL(req.url || '/', `http://localhost`);
      
      // Route: /media/:movieId - serve movie by ID
      const mediaMatch = url.pathname.match(/^\/media\/(\d+)$/);
      if (mediaMatch) {
        const movieId = parseInt(mediaMatch[1]);
        serveMovieById(movieId, req, res);
        return;
      }

      // Route: /poster/:movieId - serve poster image
      const posterMatch = url.pathname.match(/^\/poster\/(\d+)$/);
      if (posterMatch) {
        const movieId = parseInt(posterMatch[1]);
        servePoster(movieId, req, res);
        return;
      }

      // Route: /thumbnail/:movieId - serve backdrop/thumbnail
      const thumbnailMatch = url.pathname.match(/^\/thumbnail\/(\d+)$/);
      if (thumbnailMatch) {
        const movieId = parseInt(thumbnailMatch[1]);
        serveBackdrop(movieId, req, res);
        return;
      }

      // Route: /yts-image?u=<https url> - YTS artwork, fetched around ISP DNS blocking
      if (url.pathname === '/yts-image') {
        const target = url.searchParams.get('u') || '';
        fetchYtsImage(target).then(img => {
          res.writeHead(200, { 'Content-Type': img.type, 'Content-Length': img.body.length, 'Cache-Control': 'max-age=86400' });
          res.end(img.body);
        }).catch(() => {
          res.writeHead(404);
          res.end();
        });
        return;
      }

      // Routes: /info/... (JSON: duration + whether direct play works) and
      //         /transcode/...?start=SECONDS (fragmented MP4) for media/:id and torrent/:hash/:idx
      const tcMatch = url.pathname.match(/^\/(info|transcode)\/(media\/\d+|torrent\/[0-9a-fA-F]{40}\/\d+)$/);
      if (tcMatch) {
        handleTranscodeRoute(tcMatch[1] as 'info' | 'transcode', tcMatch[2], parseFloat(url.searchParams.get('start') || '0') || 0, req, res);
        return;
      }

      // Route: /torrent/:infoHash/:fileIndex - stream the active torrent's video file
      const torrentMatch = url.pathname.match(/^\/torrent\/([0-9a-fA-F]{40})\/(\d+)$/);
      if (torrentMatch) {
        serveTorrent(torrentMatch[1].toLowerCase(), parseInt(torrentMatch[2]), req, res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }

    server.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (address && typeof address === 'object') {
        serverPort = address.port;
        resolve(address.port);
      } else {
        reject(new Error('Failed to get server port'));
      }
    });

    server.on('error', err => {
      console.error('Media server error:', err);
      reject(err);
    });
    server.on('clientError', (_err, socket) => socket.destroy());
  });
}

function serveMovieById(movieId: number, req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const movie = getMovieById(movieId);
    
    if (!movie) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Movie not found');
      return;
    }

    // Security: validate path is within movies folder
    if (!isPathSafe(movie.filePath, getMoviesFolder())) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('This file is outside your movie folder. Rescan the library from Settings.');
      return;
    }

    if (!fs.existsSync(movie.filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Movie file not found. It may have been moved, deleted, or its drive disconnected.');
      return;
    }

    const ext = path.extname(movie.filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: unsupported file type');
      return;
    }

    serveFile(movie.filePath, req, res);
  } catch (error) {
    console.error('Error serving movie:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
}

function servePoster(movieId: number, req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const movie = getMovieById(movieId);
    
    if (!movie || !movie.poster) {
      res.writeHead(404);
      res.end();
      return;
    }

    if (movie.poster.startsWith('http')) {
      res.writeHead(302, { Location: movie.poster });
      res.end();
      return;
    }

    if (fs.existsSync(movie.poster)) {
      serveFile(movie.poster, req, res);
    } else {
      res.writeHead(404);
      res.end();
    }
  } catch (error) {
    res.writeHead(500);
    res.end();
  }
}

function serveBackdrop(movieId: number, req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const movie = getMovieById(movieId);
    
    if (!movie || !movie.backdrop) {
      res.writeHead(404);
      res.end();
      return;
    }

    if (movie.backdrop.startsWith('http')) {
      res.writeHead(302, { Location: movie.backdrop });
      res.end();
      return;
    }

    if (fs.existsSync(movie.backdrop)) {
      serveFile(movie.backdrop, req, res);
    } else {
      res.writeHead(404);
      res.end();
    }
  } catch (error) {
    res.writeHead(500);
    res.end();
  }
}

async function handleTranscodeRoute(
  kind: 'info' | 'transcode',
  target: string,
  startSec: number,
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  try {
    let input: string;
    const parts = target.split('/');
    if (parts[0] === 'media') {
      const movie = getMovieById(parseInt(parts[1]));
      if (!movie || !isPathSafe(movie.filePath, getMoviesFolder()) || !fs.existsSync(movie.filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      input = movie.filePath;
    } else {
      if (!getTorrentFile(parts[1].toLowerCase(), parseInt(parts[2]))) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Stream not active');
        return;
      }
      input = `http://127.0.0.1:${serverPort}/torrent/${parts[1].toLowerCase()}/${parts[2]}`;
    }

    if (kind === 'info') {
      const info = await probe(input);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(info));
    } else {
      await transcodeTo(input, Math.max(0, startSec), req, res);
    }
  } catch (error) {
    console.error('Transcode route error:', error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}

function serveTorrent(infoHash: string, fileIndex: number, req: http.IncomingMessage, res: http.ServerResponse) {
  const file = getTorrentFile(infoHash, fileIndex);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Stream not active');
    return;
  }

  const size = file.length;
  const mimeType = (mime as any).getType?.(file.name) || 'video/mp4';
  const range = req.headers.range;
  let start = 0;
  let end = size - 1;

  if (range) {
    const parsed = parseRange(range, size);
    if (!parsed) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    ({ start, end } = parsed);
  }

  const headers: http.OutgoingHttpHeaders = {
    'Content-Type': mimeType,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, headers);

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = file.createReadStream({ start, end });
  stream.pipe(res);
  // The player aborts requests constantly while seeking; stop downloading for them.
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
}

function serveFile(filePath: string, req: http.IncomingMessage, res: http.ServerResponse) {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    sendError(res, 404, 'File not found');
    return;
  }
  if (!stat.isFile()) {
    sendError(res, 404, 'File not found');
    return;
  }

  const fileSize = stat.size;
  const mimeType = (mime as any).getType?.(filePath) || (mime as any).lookup?.(filePath) || 'video/mp4';
  const range = req.headers.range;
  let start = 0;
  let end = fileSize - 1;

  if (range) {
    const parsed = parseRange(range, fileSize);
    if (!parsed) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      res.end();
      return;
    }
    ({ start, end } = parsed);
  }

  const headers: http.OutgoingHttpHeaders = {
    'Content-Length': fileSize === 0 ? 0 : end - start + 1,
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
  res.writeHead(range ? 206 : 200, headers);

  if (req.method === 'HEAD' || fileSize === 0) {
    res.end();
    return;
  }

  const fileStream = fs.createReadStream(filePath, { start, end });
  fileStream.pipe(res);
  // The player aborts range requests constantly while seeking; release the file handle with them.
  res.on('close', () => fileStream.destroy());
  fileStream.on('error', (err) => {
    console.error('Stream error:', err.message);
    res.destroy();
  });
}

export function stopMediaServer() {
  server?.close();
  server?.closeAllConnections?.();
  server = null;
}
