import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from './api.ts';
import { LANGUAGES, useI18n, type Language } from './i18n.tsx';

export const APP_VERSION = '0.1.0';

export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="4" fill="#ffffff" />
      <path d="M9 6h14v20l-2.33-1.75L18.33 26 16 24.25 13.67 26l-2.34-1.75L9 26z" fill="#1d4d82" />
      <path d="M12.5 12h7M12.5 16h4.5" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <BrandMark />
      AfriKaisse
    </div>
  );
}

const ICONS = {
  add: 'M8 3v10M3 8h10',
  edit: 'M3 13h3l7-7-3-3-7 7v3zM9 4l3 3',
  key: 'M10 6.5a3.5 3.5 0 1 1-1 2.45L3 15H1.5v-1.5L2.5 12h1.5v-1.5h1.5L7.55 8.5A3.5 3.5 0 0 1 10 6.5zM11.5 5.5h.01',
  power: 'M8 2v6M4.5 4.5a5 5 0 1 0 7 0',
  refresh: 'M13 3v3.5H9.5M3 13V9.5h3.5M12.6 6.5A5 5 0 0 0 3.8 5M3.4 9.5a5 5 0 0 0 8.8 1.5',
  more: 'M4 8h.01M8 8h.01M12 8h.01',
  building: 'M3 14V3h7v11M10 7h3v7M5 5.5h3M5 8h3M5 10.5h3M1.5 14h13',
  team: 'M6 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M11 7a2 2 0 1 0 0-4M12 10c1.6.4 2.5 1.8 2.5 4',
  journal: 'M3 2h8l2 2v10H3zM5.5 6h5M5.5 8.5h5M5.5 11h3',
  user: 'M8 7.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 14.5c.4-3 2.6-4.5 5.5-4.5s5.1 1.5 5.5 4.5',
  server: 'M2.5 2.5h11v4.5h-11zM2.5 9h11v4.5h-11zM5 4.75h.01M5 11.25h.01',
  logout: 'M6 2.5H3v11h3M10 5l3 3-3 3M13 8H6',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : 'Une erreur inattendue est survenue.';
  const details = error instanceof ApiError && Array.isArray(error.details) ? (error.details as { path: string; message: string }[]) : [];
  return (
    <div className="msg msg-error" role="alert">
      <strong>Erreur :</strong> {message}
      {details.length > 0 && (
        <ul>
          {details.map((d) => (
            <li key={d.path + d.message}>
              {d.path.replace(/^\//, '') || 'formulaire'} : {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OkMessage({ children }: { children: ReactNode }) {
  return (
    <div className="msg msg-ok" role="status">
      {children}
    </div>
  );
}

/** Fenêtre de travail : titre, barre d'outils, contenu. */
export function Window({ title, count, toolbar, children, bodyless }: { title: string; count?: string; toolbar?: ReactNode; children: ReactNode; bodyless?: boolean }) {
  return (
    <section className="window">
      <div className="window-title">
        <h1>{title}</h1>
        {count && <span className="count">{count}</span>}
      </div>
      {toolbar && <div className="toolbar">{toolbar}</div>}
      {bodyless ? children : <div className="window-body">{children}</div>}
    </section>
  );
}

/** Fenêtre de saisie modale. Échap ferme. */
export function Dialog({ title, onClose, children, footer, wide }: { title: string; onClose?: () => void; children: ReactNode; footer: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" role="presentation">
      <div className={wide ? 'dialog dialog-wide' : 'dialog'} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-title">
          <span>{title}</span>
          {onClose && (
            <button type="button" aria-label={t('common.close')} onClick={onClose}>
              ✕
            </button>
          )}
        </div>
        {children}
        <div className="dialog-foot">{footer}</div>
      </div>
    </div>
  );
}

type Theme = 'light' | 'dark' | 'system';

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

let currentTheme: Theme = (() => {
  try {
    return (localStorage.getItem('afk.theme') as Theme) || 'system';
  } catch {
    return 'system';
  }
})();

export function usePreferences() {
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
  const setTheme = (next: Theme) => {
    currentTheme = next;
    setThemeState(next);
    try {
      localStorage.setItem('afk.theme', next);
    } catch {
      /* préférence pour la session seulement */
    }
  };
  return { theme, setTheme };
}

export function Preferences() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = usePreferences();
  return (
    <span>
      <select aria-label={t('shell.language')} value={lang} onChange={(e) => setLang(e.target.value as Language)}>
        {Object.entries(LANGUAGES).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
      <select aria-label={t('shell.theme')} value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
        <option value="system">{t('theme.system')}</option>
        <option value="light">{t('theme.light')}</option>
        <option value="dark">{t('theme.dark')}</option>
      </select>
    </span>
  );
}
