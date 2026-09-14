import { DEFAULT_CLOUD_URL } from '@afrikaisse/core';
import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { normalizeServerUrl } from '@afrikaisse/core';

/**
 * Ce qui change entre le navigateur et l'application tablette.
 *
 * Navigateur : l'API est sur la même origine (`/api`), le jeton de renouvellement vit
 * dans un cookie httpOnly.
 * Tablette : l'API est sur le serveur choisi (Cloud ou serveur local), le jeton de
 * renouvellement vit dans le Keystore Android, jamais dans le stockage de la WebView.
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export const CLOUD_URL: string = import.meta.env.VITE_AFK_CLOUD_URL ?? DEFAULT_CLOUD_URL;

export interface ServerChoice {
  kind: 'cloud' | 'local';
  url: string;
}

const SERVER_KEY = 'afk.server';
const REFRESH_KEY = 'afk.refresh';
let cached: ServerChoice | null = null;

export function readServer(): ServerChoice | null {
  if (!isNativeApp()) return null;
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(SERVER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ServerChoice>;
    const check = normalizeServerUrl(String(parsed.url ?? ''));
    if (!check.ok) return null;
    cached = { kind: parsed.kind === 'local' ? 'local' : 'cloud', url: check.url };
    return cached;
  } catch {
    return null;
  }
}

export function saveServer(choice: ServerChoice): void {
  cached = choice;
  try {
    localStorage.setItem(SERVER_KEY, JSON.stringify(choice));
  } catch {
    /* le choix vaut pour la session : il sera redemandé au prochain démarrage */
  }
}

/** Préfixe des appels : vide dans le navigateur, adresse du serveur choisi sur la tablette. */
export function apiBase(): string {
  return isNativeApp() ? (readServer()?.url ?? '') : '';
}

/** Adresse d'une photo servie par l'API (`/api/media/…`), là où l'écran la trouvera. */
export function mediaSrc(url: string): string {
  return `${apiBase()}${url}`;
}

export async function readRefreshToken(): Promise<string | null> {
  try {
    const value = await SecureStorage.get(REFRESH_KEY);
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

export async function storeRefreshToken(token: string | null): Promise<void> {
  try {
    if (token) await SecureStorage.set(REFRESH_KEY, token);
    else await SecureStorage.remove(REFRESH_KEY);
  } catch {
    /* Keystore indisponible : la session ne survivra pas au redémarrage, rien de plus */
  }
}
