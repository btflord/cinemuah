import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface MediaContextType {
  mediaPort: number;
  getMediaUrl: (movieId: number) => string;
  getPosterUrl: (movieId: number, fallback?: string) => string;
  getBackdropUrl: (movieId: number, fallback?: string) => string;
}

const MediaContext = createContext<MediaContextType | null>(null);

export function MediaProvider({ children }: { children: ReactNode }) {
  const [mediaPort, setMediaPort] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // The media server can be a moment behind the window on startup, so retry briefly before giving up.
    const load = (attempt: number) => {
      window.electronAPI.media.getPort()
        .then(port => {
          if (cancelled) return;
          if (port) setMediaPort(port);
          else if (attempt < 10) setTimeout(() => load(attempt + 1), 500);
        })
        .catch(err => {
          console.error('Could not get media server port:', err);
          if (!cancelled && attempt < 10) setTimeout(() => load(attempt + 1), 500);
        });
    };
    load(0);
    return () => { cancelled = true; };
  }, []);

  const getMediaUrl = useCallback((movieId: number) => {
    if (typeof window !== 'undefined' && !(window as any).electronAPI?.window?.minimize) {
      return `/media/${movieId}`;
    }
    if (!mediaPort) return `/media/${movieId}`;
    return `http://127.0.0.1:${mediaPort}/media/${movieId}`;
  }, [mediaPort]);

  const getPosterUrl = useCallback((movieId: number, fallback?: string) => {
    if (fallback && fallback.startsWith('http')) return fallback;
    if (!mediaPort) return fallback || '';
    return `http://127.0.0.1:${mediaPort}/poster/${movieId}`;
  }, [mediaPort]);

  const getBackdropUrl = useCallback((movieId: number, fallback?: string) => {
    if (fallback && fallback.startsWith('http')) return fallback;
    if (!mediaPort) return fallback || '';
    return `http://127.0.0.1:${mediaPort}/thumbnail/${movieId}`;
  }, [mediaPort]);

  return (
    <MediaContext.Provider value={{ mediaPort, getMediaUrl, getPosterUrl, getBackdropUrl }}>
      {children}
    </MediaContext.Provider>
  );
}

export function useMedia() {
  const ctx = useContext(MediaContext);
  if (!ctx) throw new Error('useMedia must be used within MediaProvider');
  return ctx;
}
