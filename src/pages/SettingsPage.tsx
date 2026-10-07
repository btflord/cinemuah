import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { LANGUAGES, setLanguages as saveLanguages, useLanguages } from '@/lib/languages';
import type { ScanProgress, ScanResult } from '@/types';
import type { PlaybackPrefs } from '@/App';
import { useToast } from '@/contexts/ToastContext';
import { Icon, type IconName } from '@/components/Icon';
import { errorMessage } from '@/lib/errors';
import { isImmersiveEnabled, setImmersiveEnabled } from '@/lib/immersive';
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '@/lib/theme';
import { IS_WEB, DESKTOP_APP_URL } from '@/lib/platform';

interface SettingsPageProps {
  onScanComplete: () => void;
  onSettingsSaved?: (prefs: PlaybackPrefs) => void;
}

const ALL_SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'library', label: 'Library', icon: 'folder' },
  { id: 'playback', label: 'Playback', icon: 'play' },
  { id: 'appearance', label: 'Appearance', icon: 'themeAuto' },
  { id: 'languages', label: 'Languages', icon: 'globe' },
  { id: 'metadata', label: 'Metadata', icon: 'info' },
  { id: 'connection', label: 'Connection', icon: 'cloud' },
  { id: 'about', label: 'About', icon: 'film' },
];

// The web app has no local library, player or YTS connection to configure
const WEB_SECTIONS = new Set(['appearance', 'languages', 'about']);
const SECTIONS = IS_WEB ? ALL_SECTIONS.filter(s => WEB_SECTIONS.has(s.id)) : ALL_SECTIONS;

const SPEEDS = ['0.5', '0.75', '1', '1.25', '1.5', '2'];
const ACCENTS = ['#e50914', '#ff6b35', '#f5c518', '#2ecc71', '#00b4d8', '#4361ee', '#9b5de5', '#f15bb5'];
const DEFAULT_ACCENT = '#e50914';

const SHORTCUTS: [string, string][] = [
  ['⌘K  or  /', 'Search the current section'],
  ['← →', 'Browse a shelf (when focused) · seek 10s in the player'],
  ['Enter', 'Open the selected cassette'],
  ['Space  or  K', 'Play / pause'],
  ['F', 'Fullscreen'],
  ['M', 'Mute'],
  ['↑ ↓', 'Volume'],
  ['Esc', 'Close the player or clear a search'],
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle-switch" onClick={() => onChange(!on)} />
  );
}

/** One setting: label + description on the left, control on the right (or below when `stacked`). */
function Row({ title, description, children, stacked = false }: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={`settings-row ${stacked ? 'is-stacked' : ''}`}>
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        {description && <div className="settings-row-desc">{description}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function Card({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="settings-card" id={`settings-${id}`} data-section={id}>
      <header className="settings-card-header">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}

export function SettingsPage({ onScanComplete, onSettingsSaved }: SettingsPageProps) {
  const { showToast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [moviesFolder, setMoviesFolder] = useState('');
  const [tmdbApiKey, setTmdbApiKey] = useState('');
  const [savedTmdbKey, setSavedTmdbKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [keyTesting, setKeyTesting] = useState(false);
  const [prefs, setPrefs] = useState<PlaybackPrefs>({ autoResume: true, defaultSpeed: 1, rememberVolume: true });
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const { languages } = useLanguages();
  const [ytsMirror, setYtsMirror] = useState('');
  const [savedMirror, setSavedMirror] = useState('');
  const [ytsTesting, setYtsTesting] = useState(false);
  const [ytsStatus, setYtsStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [immersive, setImmersive] = useState(isImmersiveEnabled);
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const [savedFlash, setSavedFlash] = useState(0);
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  // ── Load ──
  useEffect(() => {
    const keys = ['moviesFolder', 'tmdbApiKey', 'autoResume', 'defaultSpeed', 'rememberVolume', 'accentColor', 'ytsMirror'];
    Promise.all(keys.map(k => window.electronAPI.settings.get(k)))
      .then(([folder, key, resume, speed, vol, color, mirror]) => {
        setMoviesFolder(folder || '');
        setTmdbApiKey(key || '');
        setSavedTmdbKey(key || '');
        const parsedSpeed = parseFloat(speed);
        setPrefs({
          autoResume: resume !== 'false',
          defaultSpeed: Number.isFinite(parsedSpeed) && parsedSpeed > 0 ? parsedSpeed : 1,
          rememberVolume: vol !== 'false',
        });
        if (/^#[0-9a-f]{6}$/i.test(color)) setAccentColor(color);
        setYtsMirror(mirror || '');
        setSavedMirror(mirror || '');
        setLoaded(true);
      })
      .catch(err => showToast(errorMessage(err, 'Could not load settings'), 'error'));
    // Leaving the page mid-scan must not leave listeners writing into an unmounted component
    return () => window.electronAPI.library.removeScanListeners();
  }, [showToast]);

  // ── Autosave ──
  const save = useCallback(async (key: string, value: string) => {
    try {
      await window.electronAPI.settings.set(key, value);
      setSavedFlash(n => n + 1);
      return true;
    } catch (err) {
      showToast(errorMessage(err, 'Could not save that setting'), 'error');
      return false;
    }
  }, [showToast]);

  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (!savedFlash) return;
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 1600);
    return () => clearTimeout(t);
  }, [savedFlash]);

  const updatePrefs = (patch: Partial<PlaybackPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    onSettingsSaved?.(next);
    if ('autoResume' in patch) save('autoResume', String(next.autoResume));
    if ('rememberVolume' in patch) save('rememberVolume', String(next.rememberVolume));
    if ('defaultSpeed' in patch) save('defaultSpeed', String(next.defaultSpeed));
  };

  // Accent applies instantly; the write is debounced while dragging the colour picker
  const accentTimer = useRef<ReturnType<typeof setTimeout>>();
  const changeAccent = (color: string) => {
    setAccentColor(color);
    document.documentElement.style.setProperty('--accent', color);
    clearTimeout(accentTimer.current);
    accentTimer.current = setTimeout(() => save('accentColor', color), 300);
  };
  useEffect(() => () => clearTimeout(accentTimer.current), []);

  // An empty list means "every language"
  const setLanguageList = (next: string[]) => {
    saveLanguages(next)
      .then(() => setSavedFlash(n => n + 1))
      .catch(err => showToast(errorMessage(err, 'Could not save languages'), 'error'));
  };
  const toggleLanguage = (code: string) =>
    setLanguageList(languages.includes(code) ? languages.filter(c => c !== code) : [...languages, code]);

  const commitTmdbKey = async () => {
    const key = tmdbApiKey.trim();
    if (key === savedTmdbKey) return;
    if (await save('tmdbApiKey', key)) {
      setSavedTmdbKey(key);
      setKeyStatus(null);
    }
  };

  const testTmdbKey = async () => {
    await commitTmdbKey();
    if (!tmdbApiKey.trim()) {
      setKeyStatus({ ok: false, text: 'Enter a key first' });
      return;
    }
    setKeyTesting(true);
    setKeyStatus(null);
    try {
      const results = await window.electronAPI.metadata.search('Inception', 2010);
      setKeyStatus(results && results.length > 0
        ? { ok: true, text: 'Key works' }
        : { ok: false, text: 'TMDB did not answer. Check your connection.' });
    } catch (err) {
      setKeyStatus({ ok: false, text: errorMessage(err, 'Key check failed') });
    } finally {
      setKeyTesting(false);
    }
  };

  const mirrorValid = (m: string) => !m || /^https?:\/\/[^\s/]+/i.test(m);

  const commitMirror = async () => {
    const m = ytsMirror.trim();
    if (m === savedMirror) return true;
    if (!mirrorValid(m)) {
      showToast('The mirror must be a full URL, e.g. https://yts.example', 'error');
      return false;
    }
    if (await save('ytsMirror', m)) { setSavedMirror(m); return true; }
    return false;
  };

  const testMirror = async () => {
    if (!(await commitMirror())) return;
    setYtsTesting(true);
    setYtsStatus(null);
    try {
      const r = await window.electronAPI.yts.test();
      setYtsStatus(r.ok
        ? { ok: true, text: `Connected to ${new URL(r.host!).hostname} in ${r.ms} ms` }
        : { ok: false, text: r.error || 'Connection failed' });
    } catch (err) {
      setYtsStatus({ ok: false, text: errorMessage(err, 'Connection failed') });
    } finally {
      setYtsTesting(false);
    }
  };

  const selectFolder = async () => {
    try {
      const folder = await window.electronAPI.dialog.selectFolder();
      if (folder && await save('moviesFolder', folder)) {
        setMoviesFolder(folder);
        showToast('Folder updated. Scan it to add its films.', 'success');
      }
    } catch (err) {
      showToast(errorMessage(err, 'Could not change the folder'), 'error');
    }
  };

  const startScan = async () => {
    setScanning(true);
    setScanProgress(null);
    setScanResult(null);
    setScanError(null);
    window.electronAPI.library.removeScanListeners();
    window.electronAPI.library.onScanProgress(progress => setScanProgress(progress));
    window.electronAPI.library.onScanComplete(result => {
      setScanResult(result as ScanResult);
      setScanning(false);
      onScanComplete();
      window.electronAPI.library.removeScanListeners();
    });
    window.electronAPI.library.onScanError(error => {
      setScanError(errorMessage(error?.message, 'Scan failed'));
      setScanning(false);
      window.electronAPI.library.removeScanListeners();
    });
    try {
      await window.electronAPI.library.scan(moviesFolder || undefined);
    } catch (err) {
      setScanError(errorMessage(err, 'Scan failed'));
      setScanning(false);
      window.electronAPI.library.removeScanListeners();
    }
  };

  // ── Sidebar: highlight the section in view ──
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = contentRef.current?.closest('.main-content') ?? null;
    const cards = contentRef.current?.querySelectorAll<HTMLElement>('[data-section]');
    if (!cards?.length) return;
    const io = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveSection((visible[0].target as HTMLElement).dataset.section!);
    }, { root, rootMargin: '-120px 0px -55% 0px' });
    cards.forEach(c => io.observe(c));
    return () => io.disconnect();
  }, [loaded]);

  const jumpTo = (id: string) => {
    setActiveSection(id);
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const progressPercent = scanProgress && scanProgress.total > 0
    ? Math.round((scanProgress.current / scanProgress.total) * 100)
    : 0;

  return (
    <div className="settings-v2">
      <aside className="settings-nav" aria-label="Settings sections">
        <div className="settings-nav-title">Settings</div>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            className={`settings-nav-item ${activeSection === s.id ? 'active' : ''}`}
            onClick={() => jumpTo(s.id)}
            aria-current={activeSection === s.id ? 'true' : undefined}
          >
            <Icon name={s.icon} size={17} /> {s.label}
          </button>
        ))}
        <div className={`settings-saved ${showSaved ? 'visible' : ''}`} role="status" aria-live="polite">
          <Icon name="check" size={14} /> Saved
        </div>
      </aside>

      <div className={`settings-content ${loaded ? '' : 'is-loading'}`} ref={contentRef}>
        <header className="settings-header">
          <h1>Settings</h1>
          <p>Changes are saved automatically.</p>
        </header>

        {!IS_WEB && (
        <Card id="library" title="Library" subtitle="Where your own films live, for Offline mode.">
          <Row title="Movie folder" description="Scanned together with all of its subfolders for video files.">
            <button className="btn btn-secondary btn-sm" onClick={selectFolder}>
              <Icon name="folder" /> Change
            </button>
          </Row>
          <div className="settings-path-display" title={moviesFolder}>
            <Icon name="folder" size={16} />
            {/* rtl keeps the end of a long path visible; <bdi> stops it reordering the slashes */}
            <span><bdi>{moviesFolder || 'No folder selected'}</bdi></span>
          </div>

          <Row title="Scan library" description="Finds new files, removes missing ones and fetches posters when a TMDB key is set.">
            <button className="btn btn-accent btn-sm" onClick={startScan} disabled={scanning || !loaded}>
              {scanning ? <><span className="btn-spinner" /> Scanning…</> : <><Icon name="refresh" /> Scan now</>}
            </button>
          </Row>

          {scanning && (
            <div className="settings-scan">
              <div className="settings-scan-message">{scanProgress?.message || 'Starting…'}</div>
              <div className="settings-scan-track">
                <div className="settings-scan-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              {scanProgress && scanProgress.total > 0 && (
                <div className="settings-scan-count">{scanProgress.current} / {scanProgress.total} · {progressPercent}%</div>
              )}
            </div>
          )}

          {scanResult && !scanning && (
            <div className="settings-stats">
              {[
                ['Files found', scanResult.totalFiles],
                ['New films', scanResult.newMovies],
                ['Removed', scanResult.removedMovies],
                ['Need attention', scanResult.failedMovies],
              ].map(([label, value]) => (
                <div key={label as string} className="settings-stat">
                  <div className="settings-stat-value">{value}</div>
                  <div className="settings-stat-label">{label}</div>
                </div>
              ))}
            </div>
          )}

          {scanError && (
            <div className="settings-alert" role="alert"><Icon name="warning" size={16} /> {scanError}</div>
          )}
        </Card>
        )}

        {!IS_WEB && (
        <Card id="playback" title="Playback">
          <Row title="Resume where you left off" description="Films start from your last position. Continue Watching always resumes.">
            <Toggle on={prefs.autoResume} onChange={v => updatePrefs({ autoResume: v })} label="Resume where you left off" />
          </Row>
          <Row title="Remember volume" description="Start each video at the volume you last used.">
            <Toggle on={prefs.rememberVolume} onChange={v => updatePrefs({ rememberVolume: v })} label="Remember volume" />
          </Row>
          <Row title="Default speed" description="Playback rate every video starts at." stacked>
            <div className="filter-segment" role="radiogroup" aria-label="Default speed">
              {SPEEDS.map(sp => (
                <button
                  key={sp}
                  role="radio"
                  aria-checked={prefs.defaultSpeed === parseFloat(sp)}
                  className={prefs.defaultSpeed === parseFloat(sp) ? 'active' : ''}
                  onClick={() => updatePrefs({ defaultSpeed: parseFloat(sp) })}
                >
                  {sp}×
                </button>
              ))}
            </div>
          </Row>
        </Card>
        )}

        <Card id="appearance" title="Appearance">
          <Row title="Theme" description="Match system follows your Mac's light/dark setting." stacked>
            <div className="filter-segment" role="radiogroup" aria-label="Theme">
              {(['dark', 'light', 'system'] as ThemeChoice[]).map(t => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={theme === t}
                  className={theme === t ? 'active' : ''}
                  onClick={() => { setTheme(t); setThemeChoice(t); setSavedFlash(n => n + 1); }}
                >
                  <Icon name={t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'themeAuto'} size={14} />
                  {' '}{t === 'system' ? 'Match system' : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </Row>
          <Row title="Accent colour" description="Buttons, highlights and focus rings." stacked>
            <div className="accent-swatches" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map(c => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={accentColor.toLowerCase() === c}
                  aria-label={c}
                  className={`accent-swatch ${accentColor.toLowerCase() === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => changeAccent(c)}
                />
              ))}
              <label className="accent-custom" title="Custom colour">
                <input type="color" value={accentColor} onChange={e => changeAccent(e.target.value)} aria-label="Custom accent colour" />
                <span style={{ background: accentColor }} />
                Custom
              </label>
              {accentColor.toLowerCase() !== DEFAULT_ACCENT && (
                <button className="filter-reset" onClick={() => changeAccent(DEFAULT_ACCENT)}>Reset</button>
              )}
            </div>
          </Row>
          <Row title="Immersive effects" description="Floating cassettes and films zooming in as grids scroll. Turns off automatically if your Mac is set to reduce motion.">
            <Toggle on={immersive} onChange={v => { setImmersive(v); setImmersiveEnabled(v); setSavedFlash(n => n + 1); }} label="Immersive effects" />
          </Row>
        </Card>

        <Card id="languages" title="Languages" subtitle="The Movies and Series pages show these languages. The Shelf always shows every language.">
          <div className="settings-lang-summary">
            <span>
              {languages.length === 0
                ? 'Showing every language'
                : `Showing ${languages.length} language${languages.length === 1 ? '' : 's'}: ${languages.map(c => LANGUAGES.find(l => l.code === c)?.label ?? c).join(', ')}`}
            </span>
            <div className="settings-lang-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setLanguageList(LANGUAGES.filter(l => l.region === 'india').map(l => l.code))}
              >
                All Indian languages
              </button>
              <button className={`btn btn-sm ${languages.length === 0 ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setLanguageList([])}>
                All languages
              </button>
            </div>
          </div>
          {(['india', 'world'] as const).map(region => (
            <div key={region} className="settings-lang-group">
              <div className="settings-lang-heading">{region === 'india' ? 'Indian languages' : 'World languages'}</div>
              <div className="settings-chips">
                {LANGUAGES.filter(l => l.region === region).map(l => {
                  const on = languages.includes(l.code);
                  return (
                    <button key={l.code} className={`filter-chip ${on ? 'active' : ''}`} onClick={() => toggleLanguage(l.code)} aria-pressed={on}>
                      {on && <Icon name="check" size={13} />} {l.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Card>

        {!IS_WEB && (
        <Card id="metadata" title="Metadata" subtitle="Posters, cast, ratings and descriptions for your own films come from TMDB.">
          <Row
            title="TMDB API key"
            description={<>Free from <button className="settings-link" onClick={() => Promise.resolve(window.electronAPI.shell.openExternal('https://www.themoviedb.org/settings/api')).catch(() => undefined)}>themoviedb.org</button>. Saved when you leave the field.</>}
            stacked
          >
            <div className="settings-input-group">
              <input
                className="settings-text-input"
                type={showKey ? 'text' : 'password'}
                placeholder="Paste your API key"
                value={tmdbApiKey}
                spellCheck={false}
                autoComplete="off"
                onChange={e => { setTmdbApiKey(e.target.value); setKeyStatus(null); }}
                onBlur={commitTmdbKey}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
              <button className="btn btn-ghost btn-sm" onClick={() => setShowKey(v => !v)}>{showKey ? 'Hide' : 'Show'}</button>
              <button className="btn btn-secondary btn-sm" onClick={testTmdbKey} disabled={keyTesting}>
                {keyTesting ? <><span className="btn-spinner" /> Testing…</> : 'Test key'}
              </button>
            </div>
            {keyStatus && (
              <div className={`settings-status ${keyStatus.ok ? 'ok' : 'bad'}`}>
                <Icon name={keyStatus.ok ? 'check' : 'warning'} size={14} /> {keyStatus.text}
              </div>
            )}
          </Row>
        </Card>
        )}

        {!IS_WEB && (
        <Card id="connection" title="Connection" subtitle="Online mode streams from YTS mirrors. If they're blocked on your network, add one that works.">
          <Row title="Custom YTS mirror" description="Optional. Tried before the built-in mirrors." stacked>
            <div className="settings-input-group">
              <input
                className={`settings-text-input ${mirrorValid(ytsMirror.trim()) ? '' : 'is-invalid'}`}
                type="url"
                placeholder="https://movies-api.accel.li"
                value={ytsMirror}
                spellCheck={false}
                onChange={e => { setYtsMirror(e.target.value); setYtsStatus(null); }}
                onBlur={commitMirror}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
              <button className="btn btn-secondary btn-sm" onClick={testMirror} disabled={ytsTesting}>
                {ytsTesting ? <><span className="btn-spinner" /> Testing…</> : <><Icon name="link" /> Test connection</>}
              </button>
            </div>
            {ytsStatus && (
              <div className={`settings-status ${ytsStatus.ok ? 'ok' : 'bad'}`}>
                <Icon name={ytsStatus.ok ? 'check' : 'warning'} size={14} /> {ytsStatus.text}
              </div>
            )}
          </Row>
        </Card>
        )}

        <Card id="about" title="About">
          <div className="settings-about">
            <img src="./logo.png" alt="Cinemuah" className="settings-about-logo" draggable={false} />
            <div>
              <div className="settings-about-name">Cinemuah v2</div>
              <div className="settings-row-desc">
                Plays MP4, MKV, AVI, MOV, WebM and M4V. Anything the player can't decode directly is converted on the fly with FFmpeg.
              </div>
            </div>
          </div>
          {IS_WEB && (
            <div className="settings-alert" style={{ marginBottom: 18 }}>
              <Icon name="download" size={16} />
              <span>
                You're using the web version. Streaming, downloads and playing your own library are in the{' '}
                <a className="settings-link" href={DESKTOP_APP_URL} target="_blank" rel="noreferrer">Cinemuah desktop app</a>.
                Movie and series data from TMDB.
              </span>
            </div>
          )}
          <div className="settings-subheading">Keyboard shortcuts</div>
          <div className="settings-shortcuts">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys} className="settings-shortcut">
                <kbd>{keys}</kbd>
                <span>{what}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
