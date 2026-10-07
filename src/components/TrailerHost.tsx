// In-app trailer player. Any component can call `playTrailer(youtubeKey, title)`; the single
// <TrailerHost/> mounted in App shows it in a modal (privacy-enhanced YouTube embed).
import { useEffect, useState } from 'react';
import { Icon } from './Icon';

interface TrailerRequest { key: string; title: string }

const EVENT = 'cinemuah:trailer';

export function playTrailer(key: string, title: string) {
  window.dispatchEvent(new CustomEvent<TrailerRequest>(EVENT, { detail: { key, title } }));
}

export function TrailerHost() {
  const [trailer, setTrailer] = useState<TrailerRequest | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => setTrailer((e as CustomEvent<TrailerRequest>).detail);
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!trailer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setTrailer(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [trailer]);

  if (!trailer) return null;

  return (
    <div className="trailer-overlay" role="dialog" aria-label={`${trailer.title} trailer`} onClick={() => setTrailer(null)}>
      <div className="trailer-frame" onClick={e => e.stopPropagation()}>
        <div className="trailer-head">
          <span>{trailer.title}</span>
          <button className="detail-close" style={{ position: 'static' }} onClick={() => setTrailer(null)} aria-label="Close trailer">
            <Icon name="close" />
          </button>
        </div>
        <div className="trailer-video">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.key)}?autoplay=1&rel=0&modestbranding=1`}
            title={`${trailer.title} trailer`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  );
}
