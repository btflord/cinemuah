import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Movie } from '@/types';
import { formatSeconds } from '@/types';
import { useMedia } from '@/contexts/MediaContext';
import { useToast } from '@/contexts/ToastContext';
import { Icon } from './Icon';

interface VideoPlayerProps {
  /** Library movie to play. Omit when streaming from an explicit `src` (e.g. a torrent). */
  movie?: Movie;
  /** Explicit stream URL; overrides the library media URL. */
  src?: string;
  title?: string;
  /** Shown over the video while it is buffering (e.g. torrent download stats). */
  statusText?: string;
  startPosition?: number;
  /** Playback rate to start at (Settings → Default Playback Speed). */
  defaultSpeed?: number;
  /** When false, every video starts at full volume instead of the last-used level. */
  rememberVolume?: boolean;
  onClose: () => void;
  onProgressUpdate: (position: number, duration: number) => void;
}

/** Starts playback, swallowing the rejection Chromium raises when play() is interrupted by a pause/seek/unmount. */
function safePlay(video: HTMLVideoElement) {
  video.play().catch(err => {
    if (err?.name !== 'AbortError') console.warn('Play failed:', err);
  });
}

function readSavedVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem('player_volume') ?? '');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch {
    return 1;
  }
}

export function VideoPlayer({
  movie, src, title, statusText, startPosition = 0, defaultSpeed = 1, rememberVolume = true, onClose, onProgressUpdate,
}: VideoPlayerProps) {
  const { getMediaUrl } = useMedia();
  const { showToast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const progressSaveTimerRef = useRef<ReturnType<typeof setInterval>>();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(startPosition);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => (rememberVolume ? readSavedVolume() : 1));
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(() => (Number.isFinite(defaultSpeed) && defaultSpeed > 0 ? defaultSpeed : 1));
  const [, setSeekPreview] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const isDragging = false;

  const [isBuffering, setIsBuffering] = useState(true);

  const mediaUrl = src ?? (movie ? getMediaUrl(movie.id) : '');
  const displayTitle = title ?? movie?.title ?? '';

  // Playback mode: the media server probes the file and tells us whether Chromium can play it
  // directly or whether it must be transcoded (H.264 + AAC fragmented MP4 via FFmpeg).
  // In transcode mode the stream is not seekable, so seeking restarts it at `offset` seconds.
  const [mode, setMode] = useState<'probing' | 'direct' | 'transcode'>('probing');
  const [offset, setOffset] = useState(0);
  const [probedDuration, setProbedDuration] = useState(0);
  const modeRef = useRef(mode);
  const offsetRef = useRef(0);
  const durationRef = useRef(0);
  modeRef.current = mode;
  offsetRef.current = offset;

  const infoUrl = mediaUrl.replace(/^((?:https?:\/\/[^/]+)?)\/(media|torrent)\//, '$1/info/$2/');
  const transcodeUrl = mediaUrl.replace(/^((?:https?:\/\/[^/]+)?)\/(media|torrent)\//, '$1/transcode/$2/');
  const knownDuration = probedDuration || (movie?.duration ? movie.duration * 60 : 0);

  useEffect(() => {
    let cancelled = false;
    setMode('probing');
    setIsBuffering(true);
    if (!mediaUrl) {
      setError('Nothing to play.');
      return;
    }
    fetch(infoUrl)
      .then(async r => {
        if (r.ok) return r.json();
        // 404/403 from the media server carry a human-readable reason (e.g. file moved or drive unplugged)
        const reason = r.status === 404 || r.status === 403 ? (await r.text().catch(() => '')).trim() : '';
        throw Object.assign(new Error(reason || `HTTP ${r.status}`), { fatal: !!reason });
      })
      .then(info => {
        if (cancelled) return;
        setProbedDuration(info.duration || 0);
        if (info.direct) {
          setMode('direct');
        } else {
          setOffset(startPosition);
          setMode('transcode');
        }
      })
      .catch(err => {
        if (cancelled) return;
        if (err?.fatal) { setIsBuffering(false); setError(err.message); return; }
        setMode('direct'); // probing failed (e.g. ffmpeg missing): let Chromium try the file as-is
      });
    return () => { cancelled = true; };
  }, [infoUrl, retryCount]);

  const currentSrc = mode === 'transcode' ? `${transcodeUrl}?start=${Math.floor(offset)}` : mediaUrl;

  const getTime = () => offsetRef.current + (videoRef.current?.currentTime || 0);
  const getDuration = () =>
    modeRef.current === 'transcode' ? durationRef.current : (videoRef.current?.duration || 0);

  const seekTo = (t: number) => {
    const video = videoRef.current;
    if (!video) return;
    const dur = getDuration();
    const target = Math.max(0, dur > 0 ? Math.min(dur - 1, t) : t);
    if (modeRef.current === 'transcode') {
      setOffset(target);
      setCurrentTime(target);
      setIsBuffering(true);
    } else {
      video.currentTime = target;
    }
  };
  const seekRef = useRef(seekTo);
  seekRef.current = seekTo;

  // Initialize video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || mode === 'probing') return;

    video.src = currentSrc;
    video.volume = Number.isFinite(volume) ? volume : 1;
    video.playbackRate = playbackSpeed;
    if (mode === 'transcode') {
      durationRef.current = knownDuration;
      setDuration(knownDuration);
    }

    const handleLoaded = () => {
      if (mode === 'direct' && startPosition > 0 && startPosition < video.duration - 5) {
        video.currentTime = startPosition;
      }
      video.play().catch(err => {
        if (err?.name !== 'AbortError') console.warn('Play failed:', err);
        setIsPlaying(false);
      });
    };

    const handleTimeUpdate = () => {
      if (!isDragging) {
        setCurrentTime(offsetRef.current + video.currentTime);
      }
    };

    const handleDurationChange = () => {
      if (mode === 'direct') setDuration(video.duration);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => setIsBuffering(true);
    const handleReady = () => setIsBuffering(false);
    const handleError = () => {
      const err = video.error;
      if (mode === 'direct') {
        // Chromium can't decode this file — fall back to FFmpeg transcoding at the current position.
        const resumeAt = video.currentTime || startPosition;
        setOffset(resumeAt);
        setIsBuffering(true);
        setMode('transcode');
        return;
      }
      setIsBuffering(false);
      if (err?.code === 2) {
        setError(src
          ? 'The stream was interrupted. The torrent may have lost its peers.'
          : 'Lost access to the video file. Check that its drive is still connected.');
      } else if (err?.code === 4) {
        setError('This video could not be decoded, even after converting it with FFmpeg. The file may be damaged or incomplete.');
      } else {
        setError(`Video playback error: ${err?.message || 'Unknown error'}`);
      }
    };

    video.addEventListener('loadeddata', handleLoaded);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('error', handleError);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handleReady);
    video.addEventListener('canplay', handleReady);

    return () => {
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handleReady);
      video.removeEventListener('canplay', handleReady);
      video.removeEventListener('loadeddata', handleLoaded);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('error', handleError);
    };
  }, [currentSrc, mode, startPosition]);

  // Save progress periodically
  useEffect(() => {
    progressSaveTimerRef.current = setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && getTime() > 0) {
        onProgressUpdate(getTime(), getDuration());
      }
    }, 5000);

    return () => {
      clearInterval(progressSaveTimerRef.current);
      // Save on unmount
      if (videoRef.current && getTime() > 0) {
        onProgressUpdate(getTime(), getDuration());
      }
    };
  }, [onProgressUpdate]);

  // Controls auto-hide
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
      }
    }, 3000);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      showControlsTemporarily();

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          if (video.paused) safePlay(video);
          else video.pause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekRef.current(getTime() - 10);
          showToast('-10s');
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekRef.current(getTime() + 10);
          showToast('+10s');
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          setVolume(video.volume);
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          setVolume(video.volume);
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'Escape':
          if (!document.fullscreenElement) {
            handleClose();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showControlsTemporarily]);

  // Fullscreen change
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) safePlay(video);
    else video.pause();
    showControlsTemporarily();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const toggleFullscreen = async () => {
    const container = containerRef.current;
    if (!container) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await container.requestFullscreen();
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
    if (mode !== 'transcode') setCurrentTime(video.currentTime);
  };

  const handleSeekHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setSeekPreview(ratio * duration);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    const video = videoRef.current;
    if (video) video.volume = v;
    setVolume(v);
    setIsMuted(v === 0);
    try { localStorage.setItem('player_volume', String(v)); } catch { /* preference only */ }
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const speed = parseFloat(e.target.value);
    const video = videoRef.current;
    if (video) video.playbackRate = speed;
    setPlaybackSpeed(speed);
  };

  const handleClose = () => {
    const video = videoRef.current;
    if (video) {
      onProgressUpdate(getTime(), getDuration() || 0);
      video.pause();
    }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => undefined);
    onClose();
  };

  const skipSeconds = (secs: number) => {
    const video = videoRef.current;
    if (!video) return;
    seekTo(getTime() + secs);
    showControlsTemporarily();
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="player-overlay">
      <div
        ref={containerRef}
        className="player-container cursor-visible"
        onMouseMove={showControlsTemporarily}
        onClick={togglePlay}
      >
        {error ? (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', color: 'white', gap: 16, padding: 48,
            textAlign: 'center', background: '#000',
          }}>
            <Icon name="warning" size={48} />
            <h2>Playback Error</h2>
            <p style={{ color: '#aaa', maxWidth: 480 }}>{error}</p>
            <div style={{ display: 'flex', gap: 12 }} onClick={e => e.stopPropagation()}>
              <button
                className="btn btn-accent"
                onClick={() => {
                  setError(null);
                  setOffset(getTime() || startPosition);
                  setRetryCount(c => c + 1);
                }}
              >
                <Icon name="refresh" /> Try again
              </button>
              <button className="btn btn-ghost" onClick={handleClose}><Icon name="back" /> Back</button>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="player-video"
            onClick={e => e.stopPropagation()}
            onDoubleClick={toggleFullscreen}
          />
        )}

        {/* Buffering indicator + optional stream stats (outside the overlay so it never auto-hides) */}
        {isBuffering && !error && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            pointerEvents: 'none', color: 'white', textAlign: 'center', zIndex: 5,
          }}>
            <div className="spinner" />
            {statusText && <span style={{ fontSize: 13, color: '#ccc' }}>{statusText}</span>}
          </div>
        )}

        {/* Controls overlay */}
        <div className={`player-controls-overlay ${showControls ? 'visible' : 'hidden'}`}>
          <div className="player-gradient" />

          {/* Top bar */}
          <div className="player-top-bar">
            <button
              className="icon-btn"
              onClick={(e) => { e.stopPropagation(); handleClose(); }}
              style={{ color: 'white' }}
              title="Close (Esc)"
            >
              <Icon name="back" size={26} />
            </button>
            <span className="player-title">{displayTitle}</span>
          </div>

          {/* Center play/pause */}
          {!isPlaying && !isBuffering && (
            <div className="player-center-btn" onClick={(e) => { e.stopPropagation(); togglePlay(); }}>
              <Icon name="play" />
            </div>
          )}

          {/* Bottom bar */}
          <div className="player-bottom-bar" onClick={e => e.stopPropagation()}>
            {/* Seek bar */}
            <div
              className="seek-bar-container"
              onClick={handleSeek}
              onMouseMove={handleSeekHover}
              onMouseLeave={() => setSeekPreview(null)}
            >
              <div className="seek-bar">
                <div
                  className="seek-bar-fill"
                  style={{ width: `${progressPercent}%` }}
                />
                <div
                  className="seek-bar-thumb"
                  style={{ left: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="player-controls">
              {/* Skip back */}
              <button
                className="icon-btn"
                style={{ color: 'white' }}
                onClick={() => skipSeconds(-10)}
                title="Skip back 10s (Left arrow)"
              >
                <Icon name="skipBack" size={26} />
              </button>

              {/* Play/Pause */}
              <button
                className="icon-btn"
                style={{ color: 'white', fontSize: 22 }}
                onClick={togglePlay}
                title="Play/Pause (Space)"
              >
                {isPlaying ? <Icon name="pause" /> : <Icon name="play" />}
              </button>

              {/* Skip forward */}
              <button
                className="icon-btn"
                style={{ color: 'white' }}
                onClick={() => skipSeconds(10)}
                title="Skip forward 10s (Right arrow)"
              >
                <Icon name="skipForward" size={26} />
              </button>

              {/* Volume */}
              <div className="volume-container" onClick={e => e.stopPropagation()}>
                <button
                  className="icon-btn"
                  style={{ color: 'white' }}
                  onClick={toggleMute}
                  title="Mute (M)"
                >
                  {isMuted || volume === 0 ? <Icon name="volumeMute" /> : volume < 0.5 ? <Icon name="volumeLow" /> : <Icon name="volumeHigh" />}
                </button>
                <input
                  type="range"
                  className="volume-slider"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                />
              </div>

              {/* Time */}
              <div className="player-time">
                {formatSeconds(currentTime)} / {formatSeconds(duration)}
              </div>

              {/* Right controls */}
              <div className="player-right">
                {/* Playback speed */}
                <select
                  className="speed-select"
                  value={playbackSpeed}
                  onChange={handleSpeedChange}
                  onClick={e => e.stopPropagation()}
                  title="Playback speed"
                >
                  <option value="0.25">0.25×</option>
                  <option value="0.5">0.5×</option>
                  <option value="0.75">0.75×</option>
                  <option value="1">1×</option>
                  <option value="1.25">1.25×</option>
                  <option value="1.5">1.5×</option>
                  <option value="1.75">1.75×</option>
                  <option value="2">2×</option>
                </select>

                {/* PiP */}
                {document.pictureInPictureEnabled && (
                  <button
                    className="icon-btn"
                    style={{ color: 'white', fontSize: 14 }}
                    onClick={() => {
                      const v = videoRef.current;
                      if (!v) return;
                      const toggle = document.pictureInPictureElement
                        ? document.exitPictureInPicture()
                        : v.requestPictureInPicture();
                      Promise.resolve(toggle).catch(err => showToast(`Picture in Picture unavailable: ${err?.message || err}`, 'error'));
                    }}
                    title="Picture in Picture"
                  >
                    <Icon name="pip" size={20} />
                  </button>
                )}

                {/* Fullscreen */}
                <button
                  className="icon-btn"
                  style={{ color: 'white' }}
                  onClick={toggleFullscreen}
                  title="Fullscreen (F)"
                >
                  {isFullscreen ? <Icon name="fullscreenExit" /> : <Icon name="fullscreen" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
