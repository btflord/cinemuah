// Dark / light / system theme. The choice lives on <html data-theme> so CSS tokens swap instantly
// (no React re-render), and is remembered per machine.
export type ThemeChoice = 'dark' | 'light' | 'system';

const KEY = 'cinelocal_theme';
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export function resolvedTheme(choice = getThemeChoice()): 'dark' | 'light' {
  if (choice === 'system') return media?.matches ? 'light' : 'dark';
  return choice;
}

function apply() {
  const theme = resolvedTheme();
  const root = document.documentElement;
  // Suppress every transition for one frame so the whole UI flips at once instead of fading piecemeal
  root.classList.add('theme-switching');
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  window.dispatchEvent(new Event('cinelocal:theme'));
  // Native window controls follow the theme too
  Promise.resolve(window.electronAPI?.window?.setTheme?.(theme)).catch(() => undefined);
}

export function setThemeChoice(choice: ThemeChoice) {
  try { localStorage.setItem(KEY, choice); } catch { /* preference only */ }
  apply();
}

export function cycleTheme(): ThemeChoice {
  const order: ThemeChoice[] = ['dark', 'light', 'system'];
  const next = order[(order.indexOf(getThemeChoice()) + 1) % order.length];
  setThemeChoice(next);
  return next;
}

export function initTheme() {
  apply();
  media?.addEventListener?.('change', () => { if (getThemeChoice() === 'system') apply(); });
}
