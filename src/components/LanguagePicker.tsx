// Language filter shared by every browse page. It edits the app-wide preference, so a change
// here re-filters the Shelf, Movies and Series pages at once and is saved to Settings.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { LANGUAGES, setLanguages, useLanguages } from '@/lib/languages';
import { useToast } from '@/contexts/ToastContext';
import { errorMessage } from '@/lib/errors';

const INDIAN = LANGUAGES.filter(l => l.region === 'india').map(l => l.code);

export function languageSummary(codes: string[]): string {
  if (codes.length === 0) return 'All languages';
  const labels = codes.map(c => LANGUAGES.find(l => l.code === c)?.label ?? c);
  return labels.length <= 2 ? labels.join(' · ') : `${labels.slice(0, 2).join(' · ')} +${labels.length - 2}`;
}

export function LanguagePicker({ align = 'right' }: { align?: 'left' | 'right' }) {
  const { languages, ready } = useLanguages();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const apply = (next: string[]) => {
    setLanguages(next).catch(err => showToast(errorMessage(err, 'Could not save languages'), 'error'));
  };
  const toggle = (code: string) => apply(languages.includes(code) ? languages.filter(c => c !== code) : [...languages, code]);

  const q = filter.trim().toLowerCase();
  const shown = useMemo(() => LANGUAGES.filter(l => !q || l.label.toLowerCase().includes(q) || l.code === q), [q]);
  const allIndian = INDIAN.every(c => languages.includes(c)) && languages.length === INDIAN.length;

  return (
    <div className="lang-picker" ref={rootRef}>
      <button
        className={`lang-picker-button ${languages.length > 0 ? 'is-filtered' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!ready}
        title="Choose which languages to show"
      >
        <Icon name="globe" size={15} />
        <span>{ready ? languageSummary(languages) : 'Languages'}</span>
        <Icon name="arrowDown" size={13} className="lang-picker-caret" />
      </button>

      {open && (
        <div className={`lang-popover align-${align}`} role="dialog" aria-label="Languages">
          <div className="lang-popover-search">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Find a language…"
              aria-label="Find a language"
            />
          </div>

          <div className="lang-popover-quick">
            <button className={`filter-chip ${languages.length === 0 ? 'active' : ''}`} onClick={() => apply([])}>
              All languages
            </button>
            <button className={`filter-chip ${allIndian ? 'active' : ''}`} onClick={() => apply(INDIAN)}>
              Indian languages
            </button>
          </div>

          <div className="lang-popover-list">
            {(['india', 'world'] as const).map(region => {
              const list = shown.filter(l => l.region === region);
              if (list.length === 0) return null;
              return (
                <div key={region}>
                  <div className="lang-popover-heading">{region === 'india' ? 'Indian' : 'World'}</div>
                  {list.map(l => {
                    const on = languages.includes(l.code);
                    return (
                      <button key={l.code} className={`lang-option ${on ? 'on' : ''}`} onClick={() => toggle(l.code)} role="checkbox" aria-checked={on}>
                        <span className="lang-check">{on && <Icon name="check" size={12} />}</span>
                        {l.label}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {shown.length === 0 && <div className="lang-popover-empty">No language matches “{filter}”</div>}
          </div>

          <div className="lang-popover-footer">
            <span>{languages.length === 0 ? 'Showing every language' : `${languages.length} selected`}</span>
            <button className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
