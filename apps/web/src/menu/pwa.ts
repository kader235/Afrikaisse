import { useCallback, useEffect, useState } from 'react';

/**
 * Menu installable et consultable hors ligne (§49, I-1, I-14 : HTTPS du Cloud uniquement).
 * Le service worker (public/m/sw.js) garde la page, les fichiers, la dernière carte et les photos.
 * Stockage local : favoris, surnom, langue et code de table restent sur ce téléphone.
 */

export function setupPwa(token: string, onMenuUpdated: () => void): () => void {
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = `/api/public/menu/${token}/manifest.webmanifest`;
    document.head.appendChild(link);
  }
  // Pas de service worker en développement (fichiers non figés) ni hors contexte sécurisé (http://192.168…).
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return () => undefined;

  const onMessage = (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === 'afk-menu-updated') onMenuUpdated();
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  navigator.serviceWorker
    .register('/m/sw.js', { scope: '/m/' })
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      // Ce qui a été chargé avant que le service worker ne contrôle la page : copié pour le hors ligne.
      const loaded = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => /\/assets\/|\/api\/media\//.test(name));
      registration.active?.postMessage({ type: 'afk-menu-warm', urls: [window.location.pathname, `/api/public/menu/${token}`, ...loaded] });
    })
    .catch(() => undefined);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}

/** Connexion du téléphone (événements du navigateur) ; l'échec d'un appel est traité à part. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* gardé pour la visite seulement */
  }
}

const FAVORITES_KEY = 'afk.menu.favorites';
const FAVORITES_MAX = 200;

/** Favoris : identifiants de produits, sur ce téléphone seulement. */
export function useFavorites(): [ReadonlySet<string>, (productId: string) => void] {
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(() => {
    try {
      const list = JSON.parse(read(FAVORITES_KEY) ?? '[]') as unknown;
      return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const toggle = useCallback((productId: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      write(FAVORITES_KEY, JSON.stringify([...next].slice(-FAVORITES_MAX)));
      return next;
    });
  }, []);
  return [favorites, toggle];
}

export const nicknameStore = {
  get: () => read('afk.menu.nickname') ?? '',
  set: (value: string) => write('afk.menu.nickname', value.trim() || null),
};

/** Code de table saisi une fois, gardé pour la durée de cette table ouverte. */
export const tableCodeStore = {
  get: (sessionId: string) => read(`afk.menu.code.${sessionId}`),
  set: (sessionId: string, code: string) => write(`afk.menu.code.${sessionId}`, code),
};
