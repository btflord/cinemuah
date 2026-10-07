// Build target. `vite build --mode web` loads .env.web (VITE_TARGET=web), so desktop-only code
// paths are statically removed from the web bundle.
export const IS_WEB = import.meta.env.VITE_TARGET === 'web';

/** Where the web app sends people for streaming, downloads and the local library. */
export const DESKTOP_APP_URL = 'https://btflord.github.io/cinemuah/';
