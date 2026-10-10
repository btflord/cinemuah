# Cinemuah

A desktop movie and series player built around a **cassette shelf**: films stand on the shelf as VHS spines, and the one you pick slides out and opens to its cover, with its sleeves fanned behind it and its colours glowing behind the shelf.

It plays your own video library offline, and browses the YTS movie catalogue and popular series (TVMaze + EZTV) online.

**Web app:** https://cinemuah.vercel.app · **Downloads (Mac & Windows):** https://btflord.github.io/cinemuah/

---

## Features

**Browsing**
- **Shelf**: 30 endless cassette shelves covering every genre, New / Most Downloaded / Top Rated, popular series and series by genre. Shelves load as you scroll to them and fetch more as you browse to their end.
- **Cassettes**: fixed-slot layout with GPU transforms and native scroll snapping, so browsing stays at 60 fps and always lands centred. Arrow keys, Enter, trackpad and click all work.
- **Colour theme per film**: each poster's dominant colours are sampled and diffused behind its shelf.
- **Search-first pages**: Movies and Series open with a large search bar that pins under the navbar (and slides away while you scroll). Recent searches, suggestions as you type, ⌘K or `/` from anywhere.
- **Filters**: genre, quality, minimum rating, sort, decade, and a language picker that applies to every page at once (60 languages, including all major Indian languages).

**Playback**
- Direct playback for files Chromium can decode; anything else is converted on the fly with FFmpeg (hardware-accelerated with VideoToolbox on macOS).
- Resume where you left off, remembered volume, default speed, picture-in-picture, keyboard shortcuts.
- Torrent streaming and downloads into your library folder (via WebTorrent).

**App**
- Dark, light or match-system theme; accent colours; native window controls.
- Settings autosave; a recoverable error screen instead of a blank window; safe database writes.

## Web app

https://cinemuah.vercel.app is the same interface built for the browser (`vite build --mode web`), deployed on Vercel. It browses movies and series from TMDB through small serverless functions in `api/`, so the TMDB key stays on the server, and plays trailers in-app. Streaming, downloads and your own library need the desktop app.

To deploy your own copy: create a free key at themoviedb.org → Settings → API, add it to the Vercel project as the `TMDB_API_KEY` environment variable, and deploy (`vercel deploy --prod`).

## Running it (macOS, Apple Silicon)

1. Download **CineLocal-2.0.0-mac-arm64.dmg** from the [latest release](https://github.com/btflord/cinemuah/releases/latest) and open it.
2. Drag **CineLocal** onto the **Applications** folder in the window that opens.
3. Double-click **First Launch – Fix & Open** in the same window, once. The app isn't signed with an Apple Developer ID, so macOS quarantines it after download; this removes that flag from CineLocal only and opens it. If macOS asks about the helper itself, right-click it → Open.

## Running it (Windows 10/11, 64-bit)

Download from the [latest release](https://github.com/btflord/cinemuah/releases/latest):

- **CineLocal-Setup-2.0.0.exe**: installer with Start-menu and desktop shortcuts, or
- **CineLocal-2.0.0-portable.exe**: runs without installing.

The app isn't code-signed yet, so Windows SmartScreen may say "Windows protected your PC": click **More info → Run anyway**.

## Building from source

Requires Node.js 18+.

```bash
npm install
npm run dev          # Vite + Electron with hot reload
npm run build        # compile the Electron main process and the React UI
npm run package:mac  # build the signed macOS app + drag-to-install DMG into release/
npm run package:win  # build the Windows installer + portable .exe (works from macOS)
```

After `npm install` on a new machine, make sure Electron, esbuild and ffmpeg-static downloaded their platform binaries. If npm skipped their install scripts, run `node install.js` inside each of those three packages in `node_modules`.

## Project layout

```text
electron/            Main process: window, IPC, SQLite (sql.js), media server with
                     byte-range streaming, FFmpeg transcoder, torrents, YTS/TVMaze/EZTV clients
src/components/      CassetteShelf, SearchHero, LanguagePicker, VideoPlayer, …
src/pages/           Shelf (Home), Movies, Series, Settings, Downloads, …
src/lib/             Theme, languages, palette extraction, immersive effects
src/styles/          Global styles and design tokens (dark + light)
docs/                Website (GitHub Pages)
```

## Privacy

Your library database, settings and watch history are stored only on your computer (in the app's user-data folder). Nothing is uploaded.

## Note

This project is for personal use with media you have the right to watch. Respect the copyright laws where you live.
