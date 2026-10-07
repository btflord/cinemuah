// Shared mapping from YTS movies and series to cassette-shelf items (Shelf, Movies and Series pages).
import type { SeriesShow, YtsMovie } from '@/types';
import type { CassetteItem } from '@/components/CassetteShelf';
import { errorMessage } from './errors';

export function openTrailer(m: YtsMovie, showToast: (msg: string, type?: 'success' | 'error' | 'info') => void) {
  if (!m.trailerCode) return;
  Promise.resolve(window.electronAPI.shell.openExternal(`https://www.youtube.com/watch?v=${encodeURIComponent(m.trailerCode)}`))
    .catch(err => showToast(errorMessage(err, 'Could not open the trailer'), 'error'));
}

const QUALITY_ORDER = ['2160p', '1080p', '720p', '480p'];

export function ytsToCassette(m: YtsMovie, poster: string): CassetteItem {
  const qualities = Array.from(new Set(m.torrents.map(t => t.quality)))
    .sort((a, b) => QUALITY_ORDER.indexOf(a) - QUALITY_ORDER.indexOf(b));
  const seeds = Math.max(0, ...m.torrents.map(t => t.seeds || 0));
  return {
    key: m.id,
    title: m.title,
    year: m.year,
    poster,
    tag: qualities[0] === '2160p' ? '4K' : qualities[0] || 'VHS',
    rating: m.rating,
    runtime: m.runtime,
    genres: m.genres,
    language: m.language,
    summary: m.summary,
    badges: [...qualities.map(q => (q === '2160p' ? '4K' : q)), ...(seeds > 0 ? [`${seeds} seeds`] : [])],
  };
}

export function seriesToCassette(s: SeriesShow, poster: string): CassetteItem {
  return {
    key: s.id,
    title: s.title,
    year: s.year,
    poster,
    tag: s.network ? s.network.slice(0, 8) : 'TV',
    subtitle: [s.network, s.status].filter(Boolean).join(' · '),
    rating: s.rating,
    genres: s.genres,
    language: s.language,
    summary: s.summary,
    badges: ['Series'],
  };
}
