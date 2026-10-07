import { useState, useEffect } from 'react';
import { Icon } from './Icon';
import type { AppMode } from '@/types';
import { cycleTheme, getThemeChoice, type ThemeChoice } from '@/lib/theme';
import { IS_WEB, DESKTOP_APP_URL } from '@/lib/platform';

const THEME_META: Record<ThemeChoice, { icon: 'moon' | 'sun' | 'themeAuto'; label: string }> = {
  dark: { icon: 'moon', label: 'Dark theme' },
  light: { icon: 'sun', label: 'Light theme' },
  system: { icon: 'themeAuto', label: 'Match system theme' },
};

type Page = 'home' | 'movies' | 'genres' | 'discover' | 'series' | 'downloads' | 'continue' | 'mylist' | 'settings';

interface NavbarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  /** Opens the search bar of the current section (Movies or Series). */
  onOpenSearch: () => void;
  movieCount: number;
  downloadCount?: number;
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

export function Navbar({ currentPage, onNavigate, onOpenSearch, movieCount, downloadCount = 0, mode, onModeChange }: NavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  useEffect(() => {
    const sync = () => setTheme(getThemeChoice());
    window.addEventListener('cinelocal:theme', sync);
    return () => window.removeEventListener('cinelocal:theme', sync);
  }, []);

  useEffect(() => {
    const mainEl = document.querySelector('.main-content');
    if (!mainEl) return;
    const handleScroll = () => setScrolled(mainEl.scrollTop > 20);
    mainEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => mainEl.removeEventListener('scroll', handleScroll);
  }, []);

  // Offline mode browses the local library; online mode browses YTS.
  const links: { page: Page; label: string }[] = mode === 'online'
    ? [
        { page: 'home', label: 'Shelf' },
        { page: 'discover', label: 'Movies' },
        { page: 'series', label: 'Series' },
      ]
    : [
        { page: 'home', label: 'Shelf' },
        { page: 'movies', label: 'Movies' },
        { page: 'genres', label: 'Genres' },
        { page: 'continue', label: 'Continue Watching' },
        { page: 'mylist', label: 'My List' },
      ];

  return (
    <nav className={`navbar ${scrolled ? 'scrolled' : ''}`}>
      {!scrolled && <div className="navbar-gradient" />}

      {/* Logo */}
      <div className="navbar-logo" onClick={() => onNavigate('home')} style={{ cursor: 'pointer' }}>
        <img src="./logo.png" alt="Cinemuah" className="navbar-logo-img" draggable={false} />
      </div>

      {/* Nav links */}
      <div className="navbar-nav">
        {links.map(link => (
          <button
            key={link.page}
            className={`nav-link ${currentPage === link.page ? 'active' : ''}`}
            onClick={() => onNavigate(link.page)}
          >
            {link.label}
          </button>
        ))}
      </div>

      {/* Right side */}
      <div className="navbar-right">
        {/* Online / Offline switch */}
        {!IS_WEB && (
        <div className="mode-switch" role="group" aria-label="Library source">
          <button
            className={`mode-switch-btn ${mode === 'offline' ? 'active' : ''}`}
            onClick={() => onModeChange('offline')}
            title="Offline: show only your local library"
          >
            <Icon name="folder" size={14} /> Offline
          </button>
          <button
            className={`mode-switch-btn ${mode === 'online' ? 'active' : ''}`}
            onClick={() => onModeChange('online')}
            title="Online: show only YTS movies"
          >
            <Icon name="cloud" size={14} /> Online
          </button>
        </div>
        )}

        {/* Search: opens the search bar at the top of Movies / Series */}
        <button className="nav-search-trigger" onClick={onOpenSearch} title="Search (⌘K or /)">
          <Icon name="search" size={18} />
          <span>{currentPage === 'series' ? 'Search series' : mode === 'online' ? 'Search movies & series' : 'Search your library'}</span>
          <kbd>⌘K</kbd>
        </button>

        {mode === 'offline' && movieCount > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {movieCount} movies
          </span>
        )}

        {/* Downloads (desktop only) */}
        {!IS_WEB && (
        <button
          className="icon-btn"
          onClick={() => onNavigate('downloads')}
          title="Downloads"
          style={{ position: 'relative', color: currentPage === 'downloads' ? 'var(--text-primary)' : undefined }}
        >
          <Icon name="download" size={22} />
          {downloadCount > 0 && (
            <span style={{
              position: 'absolute', top: 2, right: 0, minWidth: 16, height: 16, padding: '0 4px',
              borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{downloadCount}</span>
          )}
        </button>
        )}

        {IS_WEB && (
          <a className="nav-get-app" href={DESKTOP_APP_URL} target="_blank" rel="noreferrer" title="Stream, download and play your own library">
            <Icon name="download" size={16} /> Get the app
          </a>
        )}

        {/* Theme: dark → light → system */}
        <button
          className="icon-btn theme-toggle"
          onClick={() => setTheme(cycleTheme())}
          title={`${THEME_META[theme].label} (click to change)`}
          aria-label={THEME_META[theme].label}
        >
          <Icon name={THEME_META[theme].icon} size={21} />
        </button>

        {/* Settings */}
        <button
          className={`icon-btn ${currentPage === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
          title="Settings"
          style={{ color: currentPage === 'settings' ? 'var(--text-primary)' : undefined }}
        >
          <Icon name="settings" size={22} />
        </button>
      </div>
    </nav>
  );
}
