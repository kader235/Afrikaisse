import { menuTheme, menuThemeCss } from '@afrikaisse/core/menu-themes';

/**
 * Thème du menu client choisi par l'établissement : une feuille de variables injectée après menu.css
 * (palette claire, et sombre si le téléphone est en mode sombre ; « nuit » reste sombre partout),
 * et la couleur de la barre du navigateur. Le dernier thème reçu est gardé par QR code :
 * au prochain passage, le menu s'ouvre directement dans ses couleurs (même hors ligne).
 */

const STYLE_ID = 'm-theme';
let current: string | null = null;
let listening = false;

function darkQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
}

function updateThemeColor() {
  const theme = menuTheme(current);
  const palette = darkQuery()?.matches ? theme.dark : theme.light;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = palette.bg;
}

const storageKey = (token: string) => `afk.menuTheme.${token}`;

export function applyMenuTheme(id: string | null | undefined, token?: string) {
  const theme = menuTheme(id);
  if (token) {
    try {
      localStorage.setItem(storageKey(token), theme.id);
    } catch {
      /* stockage indisponible : le thème suit la visite */
    }
  }
  if (current === theme.id) return;
  current = theme.id;
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = menuThemeCss(theme.id);
  updateThemeColor();
  const query = darkQuery();
  if (query && !listening) {
    listening = true;
    // Chrome 83 et vieux Safari : addListener (addEventListener sur MediaQueryList arrive plus tard).
    if (typeof query.addEventListener === 'function') query.addEventListener('change', updateThemeColor);
    else query.addListener(updateThemeColor);
  }
}

/** Au démarrage : le thème déjà reçu pour ce QR code, s'il y en a un. */
export function restoreMenuTheme(token: string) {
  let stored: string | null = null;
  try {
    stored = token ? localStorage.getItem(storageKey(token)) : null;
  } catch {
    stored = null;
  }
  applyMenuTheme(stored);
}
