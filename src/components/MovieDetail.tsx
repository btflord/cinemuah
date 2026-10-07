import React, { useState, useEffect } from 'react';
import type { Movie } from '@/types';
import { formatDuration, parseMovieGenres, parseMovieCast, parseMovieWriters, formatSeconds, getProgressPercent } from '@/types';
import { useMedia } from '@/contexts/MediaContext';
import { MovieRow } from './MovieRow';
import { Icon } from './Icon';

interface MovieDetailProps {
  movie: Movie;
  allMovies: Movie[];
  onClose: () => void;
  onPlay: (movie: Movie, startPosition?: number) => void;
  onToggleList: (movie: Movie) => void;
  onNavigate: (movie: Movie) => void;
  onEdit?: (movie: Movie) => void;
  onRefreshMetadata?: (movie: Movie) => void;
}

export function MovieDetail({
  movie,
  allMovies,
  onClose,
  onPlay,
  onToggleList,
  onNavigate,
  onEdit,
  onRefreshMetadata,
}: MovieDetailProps) {
  const { getBackdropUrl, getPosterUrl } = useMedia();
  const [imageError, setImageError] = useState(false);
  const [fileExists, setFileExists] = useState(true);

  const genres = parseMovieGenres(movie.genres);
  const cast = parseMovieCast(movie.cast);
  const writers = parseMovieWriters(movie.writers);
  const backdropUrl = getBackdropUrl(movie.id, movie.backdrop);
  const posterUrl = getPosterUrl(movie.id, movie.poster);

  const progressPercent = getProgressPercent(movie.position, movie.duration > 0 ? movie.duration * 60 : undefined);

  // Check file existence
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.file.exists(movie.filePath)
      .then(exists => { if (!cancelled) setFileExists(!!exists); })
      .catch(() => { if (!cancelled) setFileExists(true); }); // unknown: don't block playback
    return () => { cancelled = true; };
  }, [movie.filePath]);

  // Similar movies by genre
  const similarMovies = allMovies
    .filter(m => {
      if (m.id === movie.id) return false;
      const mGenres = parseMovieGenres(m.genres);
      return genres.some(g => mGenres.includes(g));
    })
    .slice(0, 10);

  // Close on overlay click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="movie-detail-overlay" onClick={handleOverlayClick}>
      <div className="movie-detail">
        {/* Backdrop */}
        <div className="detail-backdrop">
          {backdropUrl && !imageError ? (
            <img
              src={backdropUrl}
              alt={movie.title}
              onError={() => setImageError(true)}
            />
          ) : posterUrl ? (
            <img src={posterUrl} alt={movie.title} style={{ objectPosition: 'top' }} />
          ) : (
            <div className="detail-backdrop-placeholder" />
          )}
          <div className="detail-backdrop-gradient" />
          <button className="detail-close" onClick={onClose} title="Close (Esc)"><Icon name="close" /></button>
        </div>

        {/* Content */}
        <div className="detail-content">
          <h1 className="detail-title">{movie.title}</h1>

          <div className="detail-meta">
            {movie.year && <span>{movie.year}</span>}
            {movie.year && movie.duration > 0 && <span className="dot" />}
            {movie.duration > 0 && <span>{formatDuration(movie.duration)}</span>}
            {movie.rating > 0 && (
              <>
                <span className="dot" />
                <span className="rating"><Icon name="star" size={14} /> {movie.rating.toFixed(1)}</span>
              </>
            )}
            {!fileExists && (
              <>
                <span className="dot" />
                <span style={{ color: 'var(--accent)' }}><Icon name="warning" size={14} /> File not found</span>
              </>
            )}
          </div>

          {genres.length > 0 && (
            <div className="detail-genres">
              {genres.map(g => (
                <span key={g} className="genre-tag">{g}</span>
              ))}
            </div>
          )}

          {/* Resume progress */}
          {progressPercent > 0 && progressPercent < 95 && movie.position && movie.duration > 0 && (
            <div className="detail-resume-bar">
              <div className="detail-progress-track">
                <div className="detail-progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <span className="detail-resume-text">
                {formatSeconds(movie.position)} / {formatDuration(movie.duration)}
              </span>
            </div>
          )}

          {movie.description && (
            <p className="detail-description">{movie.description}</p>
          )}

          {/* Actions */}
          <div className="detail-actions">
            {!fileExists ? (
              <button className="btn btn-ghost" disabled>
                <Icon name="warning" size={14} /> File Missing
              </button>
            ) : progressPercent > 0 && progressPercent < 95 ? (
              <>
                <button className="btn btn-primary" onClick={() => onPlay(movie, movie.position)}>
                  <Icon name="play" /> Resume
                </button>
                <button className="btn btn-secondary" onClick={() => onPlay(movie, 0)}>
                  <Icon name="refresh" /> Start Over
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => onPlay(movie)}>
                <Icon name="play" /> Play
              </button>
            )}
            <button
              className={`btn ${movie.isInMyList ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => onToggleList(movie)}
            >
              {movie.isInMyList ? <><Icon name="check" /> In My List</> : <><Icon name="plus" /> My List</>}
            </button>
            {onEdit && (
              <button className="btn btn-ghost btn-sm" onClick={() => onEdit(movie)} style={{ marginLeft: 'auto' }}>
                <Icon name="edit" /> Edit
              </button>
            )}
            {onRefreshMetadata && (
              <button className="btn btn-ghost btn-sm" onClick={() => onRefreshMetadata(movie)}>
                <Icon name="refresh" /> Refresh
              </button>
            )}
          </div>

          {/* Cast */}
          {cast.length > 0 && (
            <div className="detail-section">
              <h3 className="detail-section-title">Cast</h3>
              <div className="cast-grid">
                {cast.map((member, i) => (
                  <div key={i} className="cast-card">
                    <div className="cast-photo">
                      {member.profilePhoto ? (
                        <img src={member.profilePhoto} alt={member.name} />
                      ) : (
                        <div className="cast-photo-placeholder"><Icon name="user" size={28} /></div>
                      )}
                    </div>
                    <div className="cast-name">{member.name}</div>
                    <div className="cast-character">{member.character}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Crew */}
          {(movie.director || writers.length > 0) && (
            <div className="detail-section">
              <h3 className="detail-section-title">Crew</h3>
              <div className="crew-grid">
                {movie.director && (
                  <div className="crew-item">
                    <span className="crew-role">Director</span>
                    <span className="crew-name">{movie.director}</span>
                  </div>
                )}
                {writers.length > 0 && (
                  <div className="crew-item">
                    <span className="crew-role">Writers</span>
                    <span className="crew-name">{writers.join(', ')}</span>
                  </div>
                )}
                <div className="crew-item">
                  <span className="crew-role">File</span>
                  <span className="crew-name" style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {movie.fileName}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* More Like This */}
          {similarMovies.length > 0 && (
            <div className="detail-section">
              <h3 className="detail-section-title">More Like This</h3>
              <MovieRow
                title=""
                movies={similarMovies}
                onPlay={onPlay}
                onDetail={onNavigate}
                onToggleList={onToggleList}
                cardSize="sm"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
