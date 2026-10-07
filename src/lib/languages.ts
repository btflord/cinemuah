import { useEffect, useSyncExternalStore } from 'react';

export interface LanguageInfo { code: string; label: string; region: 'india' | 'world' }

// ISO 639-1 codes. Indian languages first: they're grouped together in Settings.
export const LANGUAGES: LanguageInfo[] = [
  { code: 'hi', label: 'Hindi', region: 'india' },
  { code: 'bn', label: 'Bengali', region: 'india' },
  { code: 'ta', label: 'Tamil', region: 'india' },
  { code: 'te', label: 'Telugu', region: 'india' },
  { code: 'ml', label: 'Malayalam', region: 'india' },
  { code: 'kn', label: 'Kannada', region: 'india' },
  { code: 'mr', label: 'Marathi', region: 'india' },
  { code: 'gu', label: 'Gujarati', region: 'india' },
  { code: 'pa', label: 'Punjabi', region: 'india' },
  { code: 'or', label: 'Odia', region: 'india' },
  { code: 'as', label: 'Assamese', region: 'india' },
  { code: 'ur', label: 'Urdu', region: 'india' },
  { code: 'ne', label: 'Nepali', region: 'india' },
  { code: 'si', label: 'Sinhala', region: 'india' },
  { code: 'en', label: 'English', region: 'world' },
  { code: 'es', label: 'Spanish', region: 'world' },
  { code: 'fr', label: 'French', region: 'world' },
  { code: 'de', label: 'German', region: 'world' },
  { code: 'it', label: 'Italian', region: 'world' },
  { code: 'pt', label: 'Portuguese', region: 'world' },
  { code: 'ru', label: 'Russian', region: 'world' },
  { code: 'ja', label: 'Japanese', region: 'world' },
  { code: 'ko', label: 'Korean', region: 'world' },
  { code: 'zh', label: 'Chinese', region: 'world' },
  { code: 'th', label: 'Thai', region: 'world' },
  { code: 'vi', label: 'Vietnamese', region: 'world' },
  { code: 'id', label: 'Indonesian', region: 'world' },
  { code: 'ms', label: 'Malay', region: 'world' },
  { code: 'tl', label: 'Filipino', region: 'world' },
  { code: 'tr', label: 'Turkish', region: 'world' },
  { code: 'ar', label: 'Arabic', region: 'world' },
  { code: 'fa', label: 'Persian', region: 'world' },
  { code: 'he', label: 'Hebrew', region: 'world' },
  { code: 'pl', label: 'Polish', region: 'world' },
  { code: 'nl', label: 'Dutch', region: 'world' },
  { code: 'sv', label: 'Swedish', region: 'world' },
  { code: 'da', label: 'Danish', region: 'world' },
  { code: 'no', label: 'Norwegian', region: 'world' },
  { code: 'fi', label: 'Finnish', region: 'world' },
  { code: 'is', label: 'Icelandic', region: 'world' },
  { code: 'el', label: 'Greek', region: 'world' },
  { code: 'cs', label: 'Czech', region: 'world' },
  { code: 'sk', label: 'Slovak', region: 'world' },
  { code: 'hu', label: 'Hungarian', region: 'world' },
  { code: 'ro', label: 'Romanian', region: 'world' },
  { code: 'bg', label: 'Bulgarian', region: 'world' },
  { code: 'uk', label: 'Ukrainian', region: 'world' },
  { code: 'hr', label: 'Croatian', region: 'world' },
  { code: 'sr', label: 'Serbian', region: 'world' },
  { code: 'bs', label: 'Bosnian', region: 'world' },
  { code: 'sl', label: 'Slovenian', region: 'world' },
  { code: 'sq', label: 'Albanian', region: 'world' },
  { code: 'lt', label: 'Lithuanian', region: 'world' },
  { code: 'lv', label: 'Latvian', region: 'world' },
  { code: 'et', label: 'Estonian', region: 'world' },
  { code: 'ca', label: 'Catalan', region: 'world' },
  { code: 'eu', label: 'Basque', region: 'world' },
  { code: 'ga', label: 'Irish', region: 'world' },
  { code: 'af', label: 'Afrikaans', region: 'world' },
  { code: 'sw', label: 'Swahili', region: 'world' },
];

// YTS mixes ISO 639-1 with three-letter ISO 639-2 codes ("eng", "spa", "jpn") and a few
// non-standard ones ("cn"). Everything is normalised to the two-letter codes above.
const ALIASES: Record<string, string> = {
  cn: 'zh', zho: 'zh', chi: 'zh', cmn: 'zh', yue: 'zh',
  eng: 'en', spa: 'es', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', ita: 'it', por: 'pt', rus: 'ru',
  jpn: 'ja', kor: 'ko', tha: 'th', vie: 'vi', ind: 'id', msa: 'ms', may: 'ms', fil: 'tl', tgl: 'tl',
  tur: 'tr', ara: 'ar', fas: 'fa', per: 'fa', heb: 'he', iw: 'he', pol: 'pl', nld: 'nl', dut: 'nl',
  swe: 'sv', dan: 'da', nor: 'no', nob: 'no', nno: 'no', nb: 'no', nn: 'no', fin: 'fi', isl: 'is', ice: 'is',
  ell: 'el', gre: 'el', ces: 'cs', cze: 'cs', slk: 'sk', slo: 'sk', hun: 'hu', ron: 'ro', rum: 'ro',
  bul: 'bg', ukr: 'uk', hrv: 'hr', srp: 'sr', bos: 'bs', slv: 'sl', sqi: 'sq', alb: 'sq', lit: 'lt',
  lav: 'lv', est: 'et', cat: 'ca', eus: 'eu', baq: 'eu', gle: 'ga', afr: 'af', swa: 'sw',
  hin: 'hi', ben: 'bn', tam: 'ta', tel: 'te', mal: 'ml', kan: 'kn', mar: 'mr', guj: 'gu', pan: 'pa',
  ori: 'or', ory: 'or', asm: 'as', urd: 'ur', nep: 'ne', sin: 'si',
};

export const normLang = (code: string): string => {
  const base = (code || '').toLowerCase().trim().split(/[-_]/)[0];
  return ALIASES[base] || base;
};

export const languageLabel = (code: string): string =>
  LANGUAGES.find(l => l.code === normLang(code))?.label ?? code;

// TVMaze reports languages by English name
const NAME_TO_CODE: Record<string, string> = {
  ...Object.fromEntries(LANGUAGES.map(l => [l.label.toLowerCase(), l.code])),
  mandarin: 'zh', cantonese: 'zh', tagalog: 'tl', farsi: 'fa', flemish: 'nl', oriya: 'or',
  'norwegian bokmål': 'no', 'norwegian nynorsk': 'no',
};

/** Series language filter. Shows with no language listed are kept. */
export const matchesLanguageName = (name: string | null | undefined, selected: string[]): boolean => {
  if (selected.length === 0 || !name) return true;
  const code = NAME_TO_CODE[name.toLowerCase()];
  return code ? selected.includes(code) : false;
};

/** An empty selection means "all languages". */
export const matchesLanguages = (movieLanguage: string, selected: string[]): boolean =>
  selected.length === 0 || selected.includes(normLang(movieLanguage));

/** Parses the saved setting, normalising old/alias codes and dropping duplicates. */
export const parseLanguages = (raw: string | null | undefined): string[] =>
  Array.from(new Set((raw || '').split(',').map(s => normLang(s)).filter(Boolean)));

// ─── Shared language preference ─────────────────────────────────────
// One store for the whole app: changing it from any picker (Shelf, Movies, Series, Settings)
// re-filters every page instantly and is saved to the settings database.

let current: string[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

function ensureLoaded() {
  if (current !== null || loading) return;
  loading = Promise.resolve(window.electronAPI.settings.get('languages'))
    .then(raw => { current = parseLanguages(raw); })
    .catch(() => { current = []; })
    .finally(() => { loading = null; emit(); });
}

/** Current preference without subscribing (empty = every language, or not loaded yet). */
export function getLanguagesSnapshot(): string[] {
  return current ?? [];
}

/** Updates the in-memory preference (all pages re-filter) without saving. */
export function setLanguagesCache(languages: string[]) {
  current = Array.from(new Set(languages.map(normLang).filter(Boolean)));
  emit();
}

/** Updates and saves the preference. An empty list means every language. */
export async function setLanguages(languages: string[]): Promise<void> {
  setLanguagesCache(languages);
  await window.electronAPI.settings.set('languages', (current ?? []).join(','));
}

/** The user's preferred languages. `ready` is false until the saved value has loaded. */
export function useLanguages(): { languages: string[]; ready: boolean } {
  const snapshot = useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current
  );
  useEffect(ensureLoaded, []);
  return { languages: snapshot ?? EMPTY, ready: snapshot !== null };
}

const EMPTY: string[] = [];
