import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Movie, AppMode } from '@/types';
import { Navbar } from '@/components/Navbar';
import { HomePage } from '@/pages/HomePage';
import { MoviesPage } from '@/pages/MoviesPage';
import { GenresPage } from '@/pages/GenresPage';
import { ContinueWatchingPage } from '@/pages/ContinueWatchingPage';
import { MyListPage } from '@/pages/MyListPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { DiscoverPage } from '@/pages/DiscoverPage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { SeriesPage } from '@/pages/SeriesPage';
import { MovieDetail } from '@/components/MovieDetail';
import { VideoPlayer } from '@/components/VideoPlayer';
import { EditMovie } from '@/components/EditMovie';
import { useToast } from '@/contexts/ToastContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { requestSearchFocus } from '@/components/SearchHero';
import { Icon } from '@/components/Icon';
import { errorMessage } from '@/lib/errors';

export interface PlaybackPrefs {
  autoResume: boolean;
  defaultSpeed: number;
  rememberVolume: boolean;
}

type Page = 'home' | 'movies' | 'genres' | 'discover' | 'series' | 'downloads' | 'continue' | 'mylist' | 'settings';

export function App() {
  const { showToast } = useToast();

  // State
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [continueWatching, setContinueWatching] = useState<Movie[]>([]);
  const [recentlyAdded, setRecentlyAdded] = useState<Movie[]>([]);
  const [myList, setMyList] = useState<Movie[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [movieCount, setMovieCount] = useState(0);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [genreMovies, setGenreMovies] = useState<Movie[]>([]);

  // UI state
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [playingMovie, setPlayingMovie] = useState<Movie | null>(null);
  const [playStartPosition, setPlayStartPosition] = useState(0);
  const [editingMovie, setEditingMovie] = useState<Movie | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PlaybackPrefs>({ autoResume: true, defaultSpeed: 1, rememberVolume: true });
  const [downloadCount, setDownloadCount] = useState(0);
  const [mode, setMode] = useState<AppMode>(() => {
    try { return localStorage.getItem('cinelocal_mode') === 'offline' ? 'offline' : 'online'; } catch { return 'online'; }
  });
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Apply saved appearance/playback settings (Settings saves them; they were never read back on launch)
  useEffect(() => {
    Promise.all(['accentColor', 'autoResume', 'defaultSpeed', 'rememberVolume'].map(k => window.electronAPI.settings.get(k)))
      .then(([accent, resume, speed, vol]) => {
        if (/^#[0-9a-f]{6}$/i.test(accent)) document.documentElement.style.setProperty('--accent', accent);
        const parsedSpeed = parseFloat(speed);
        setPrefs({
          autoResume: resume !== 'false',
          defaultSpeed: Number.isFinite(parsedSpeed) && parsedSpeed > 0 ? parsedSpeed : 1,
          rememberVolume: vol !== 'false',
        });
      })
      .catch(err => console.error('Failed to load settings:', err));
  }, []);

  // Load all data
  const loadData = useCallback(async () => {
    try {
      const [
        allMovies,
        cw,
        recent,
        ml,
        g,
        count,
      ] = await Promise.all([
        window.electronAPI.movies.getAll({ sortBy: 'dateAdded', order: 'desc' }),
        window.electronAPI.movies.getContinueWatching(),
        window.electronAPI.movies.getRecentlyAdded(),
        window.electronAPI.movies.getMyList(),
        window.electronAPI.movies.getGenres(),
        window.electronAPI.movies.getCount(),
      ]);

      setMovies(allMovies);
      setContinueWatching(cw);
      setRecentlyAdded(recent);
      setMyList(ml);
      setGenres(g);
      setMovieCount(count);
      setLoadError(null);
    } catch (err) {
      console.error('Failed to load data:', err);
      setLoadError(errorMessage(err, 'Could not read your library'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + auto-scan
  useEffect(() => {
    loadData().then(async () => {
      // Auto-scan on startup (non-blocking)
      try {
        const folder = await window.electronAPI.settings.get('moviesFolder');
        if (folder) {
          window.electronAPI.library.scan(folder).then(() => {
            loadData();
          }).catch(err => {
            console.error('Auto-scan failed:', err);
            // Only worth interrupting people who use the local library
            if (modeRef.current === 'offline') showToast(`Library scan failed: ${errorMessage(err)}`, 'error');
          });
        }
      } catch (err) {
        console.error('Auto-scan failed:', err);
      }
    });
  }, [loadData]);

  // Active-download badge + refresh the library when a download lands in it
  useEffect(() => {
    const poll = () => window.electronAPI.downloads.list()
      .then(list => setDownloadCount(list.filter(d => d.status !== 'done' && d.status !== 'error').length))
      .catch(() => undefined);
    poll();
    const timer = setInterval(poll, 3000);
    const off = window.electronAPI.downloads.onFinished(info => {
      showToast(`${info.title} finished downloading and was added to your library`, 'success');
      loadData();
      poll();
    });
    return () => { clearInterval(timer); off(); };
  }, [loadData, showToast]);

  // Load genre movies
  useEffect(() => {
    if (!selectedGenre) return;
    let cancelled = false;
    window.electronAPI.movies.getByGenre(selectedGenre)
      .then(list => { if (!cancelled) setGenreMovies(list); })
      .catch(err => {
        if (cancelled) return;
        setGenreMovies([]);
        showToast(errorMessage(err, `Could not load ${selectedGenre} movies`), 'error');
      });
    return () => { cancelled = true; };
  }, [selectedGenre, showToast]);

  const handlePlay = useCallback((movie: Movie, startPosition?: number) => {
    setPlayingMovie(movie);
    // An explicit position (e.g. Continue Watching) always wins; otherwise honour the Auto Resume setting
    const resumeAt = startPosition ?? (prefs.autoResume ? movie.position || 0 : 0);
    setPlayStartPosition(Number.isFinite(resumeAt) && resumeAt > 0 ? resumeAt : 0);
    setSelectedMovie(null);
  }, [prefs.autoResume]);

  const handleClosePlayer = useCallback(() => {
    setPlayingMovie(null);
    loadData(); // Refresh to update progress
  }, [loadData]);

  const handleProgressUpdate = useCallback(async (position: number, duration: number) => {
    if (!playingMovie) return;
    try {
      await window.electronAPI.progress.update(playingMovie.id, position, duration);
    } catch (err) {
      console.error('Failed to update progress:', err);
    }
  }, [playingMovie]);

  const handleToggleList = useCallback(async (movie: Movie) => {
    try {
      const isNowInList = await window.electronAPI.mylist.toggle(movie.id);
      showToast(isNowInList ? 'Added to My List' : 'Removed from My List', 'success');
      loadData();
    } catch (err) {
      showToast('Failed to update list', 'error');
    }
  }, [loadData, showToast]);

  const handleModeChange = useCallback((next: AppMode) => {
    setMode(next);
    try { localStorage.setItem('cinelocal_mode', next); } catch { /* preference only */ }
    setSelectedGenre(null);
    // Pages that only exist in the other mode fall back to Home
    const hiddenInNext: Page[] = next === 'offline' ? ['discover', 'series'] : ['movies', 'genres', 'continue', 'mylist'];
    setCurrentPage(p => (hiddenInNext.includes(p) ? 'home' : p));
  }, []);

  const handleNavigate = useCallback((page: string) => {
    setCurrentPage(page as Page);
    setSelectedGenre(null);
    setSelectedMovie(null);
  }, []);

  // Search lives at the top of the Movies and Series pages. The navbar button and ⌘K / "/" jump
  // there (staying on Series if that's where you are) and put the cursor in the search field.
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const handleOpenSearch = useCallback(() => {
    const target: Page = currentPageRef.current === 'series' ? 'series' : modeRef.current === 'online' ? 'discover' : 'movies';
    if (currentPageRef.current !== target) {
      setSelectedGenre(null);
      setCurrentPage(target);
    }
    setSelectedMovie(null);
    requestSearchFocus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playingMovie) return; // the player owns the keyboard
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        handleOpenSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleOpenSearch, playingMovie]);

  const handleSelectGenre = useCallback((genre: string) => {
    setSelectedGenre(genre);
    setCurrentPage('movies');
  }, []);

  const handleDetail = useCallback((movie: Movie) => {
    setSelectedMovie(movie);
  }, []);

  const handleEditSave = useCallback(async (updated: Partial<Movie>): Promise<boolean> => {
    if (!editingMovie) return false;
    try {
      await window.electronAPI.movies.update(editingMovie.id, updated as Record<string, unknown>);
      setEditingMovie(null);
      await loadData();
      // If viewing detail, refresh selected movie
      if (selectedMovie?.id === editingMovie.id) {
        const fresh = await window.electronAPI.movies.getById(editingMovie.id);
        if (fresh) setSelectedMovie(fresh);
      }
      return true;
    } catch (err) {
      showToast(errorMessage(err, 'Failed to save changes'), 'error');
      return false;
    }
  }, [editingMovie, selectedMovie, loadData, showToast]);

  const handleRefreshMetadata = useCallback(async (movie: Movie) => {
    try {
      showToast('Refreshing metadata...', 'info');
      const updated = await window.electronAPI.metadata.refreshMovie(movie.id);
      if (updated) {
        showToast('Metadata refreshed!', 'success');
        await loadData();
        if (selectedMovie?.id === movie.id) {
          setSelectedMovie(updated);
        }
      } else {
        showToast('Could not find metadata. Check TMDB API key in Settings.', 'error');
      }
    } catch (err) {
      showToast(errorMessage(err, 'Metadata refresh failed'), 'error');
    }
  }, [loadData, selectedMovie, showToast]);

  // Render active page
  const renderPage = () => {
    if (loading) {
      return (
        <div className="empty-state" style={{ paddingTop: 200 }}>
          <div className="spinner" />
          <p style={{ color: 'var(--text-muted)', marginTop: 16 }}>Loading your library...</p>
        </div>
      );
    }

    if (loadError && movies.length === 0 && mode === 'offline') {
      return (
        <div className="empty-state" role="alert" style={{ paddingTop: 160 }}>
          <div className="empty-icon"><Icon name="warning" /></div>
          <h2 className="empty-title">Couldn't load your library</h2>
          <p className="empty-subtitle">{loadError}</p>
          <button className="btn btn-accent" onClick={() => { setLoading(true); loadData(); }}>
            <Icon name="refresh" /> Try again
          </button>
        </div>
      );
    }

    if (currentPage === 'movies') {
      const displayMovies = selectedGenre ? genreMovies : movies;
      return (
        <MoviesPage
          movies={displayMovies}
          onPlay={handlePlay}
          onDetail={handleDetail}
          onToggleList={handleToggleList}
          genre={selectedGenre || undefined}
          title={selectedGenre ? `${selectedGenre} Movies` : 'All Movies'}
        />
      );
    }

    if (currentPage === 'genres') {
      return (
        <GenresPage
          genres={genres}
          movies={movies}
          onSelectGenre={handleSelectGenre}
        />
      );
    }

    if (currentPage === 'discover') {
      return (
        <DiscoverPage />
      );
    }

    if (currentPage === 'series') {
      return <SeriesPage />;
    }

    if (currentPage === 'downloads') {
      return <DownloadsPage />;
    }

    if (currentPage === 'continue') {
      return (
        <ContinueWatchingPage
          movies={continueWatching}
          onPlay={handlePlay}
          onDetail={handleDetail}
          onToggleList={handleToggleList}
        />
      );
    }

    if (currentPage === 'mylist') {
      return (
        <MyListPage
          movies={myList}
          onPlay={handlePlay}
          onDetail={handleDetail}
          onToggleList={handleToggleList}
        />
      );
    }

    if (currentPage === 'settings') {
      return (
        <SettingsPage onScanComplete={loadData} onSettingsSaved={setPrefs} />
      );
    }

    // Home
    return (
      <HomePage
        mode={mode}
        movies={movies}
        continueWatching={continueWatching}
        recentlyAdded={recentlyAdded}
        genres={genres}
        onPlay={handlePlay}
        onDetail={handleDetail}
        onToggleList={handleToggleList}
        onNavigateGenre={handleSelectGenre}
        onNavigatePage={handleNavigate}
      />
    );
  };

  return (
    <div className="app-container">
      {/* Titlebar drag region */}
      <div className="titlebar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Navbar */}
      {!playingMovie && (
        <Navbar
          currentPage={currentPage}
          onNavigate={handleNavigate}
          onOpenSearch={handleOpenSearch}
          movieCount={movieCount}
          downloadCount={downloadCount}
          mode={mode}
          onModeChange={handleModeChange}
        />
      )}

      {/* Main content */}
      {!playingMovie && (
        <main className="main-content">
          <ErrorBoundary scope="this page" resetKey={`${currentPage}:${mode}`} onReset={() => handleNavigate('home')}>
            {renderPage()}
          </ErrorBoundary>
        </main>
      )}

      {/* Video Player */}
      {playingMovie && (
        <ErrorBoundary scope="the player" onReset={handleClosePlayer}>
          <VideoPlayer
            movie={playingMovie}
            startPosition={playStartPosition}
            defaultSpeed={prefs.defaultSpeed}
            rememberVolume={prefs.rememberVolume}
            onClose={handleClosePlayer}
            onProgressUpdate={handleProgressUpdate}
          />
        </ErrorBoundary>
      )}

      {/* Movie Detail Modal */}
      {selectedMovie && !playingMovie && (
        <MovieDetail
          movie={selectedMovie}
          allMovies={movies}
          onClose={() => setSelectedMovie(null)}
          onPlay={handlePlay}
          onToggleList={handleToggleList}
          onNavigate={handleDetail}
          onEdit={(m) => setEditingMovie(m)}
          onRefreshMetadata={handleRefreshMetadata}
        />
      )}

      {/* Edit Movie Modal */}
      {editingMovie && (
        <EditMovie
          movie={editingMovie}
          onSave={handleEditSave}
          onClose={() => setEditingMovie(null)}
          onRefreshMetadata={() => handleRefreshMetadata(editingMovie)}
        />
      )}
    </div>
  );
}
