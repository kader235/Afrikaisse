import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Écrans de l'application web ouverts par la console. */
export type AppSection = 'caisse' | 'supervision';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `http://localhost` est un contexte sécurisé : c'est l'adresse retenue pour la caisse du PC. */
export function appUrl(port: number, section: AppSection = 'caisse'): string {
  return `http://localhost:${port}/${section === 'supervision' ? '#supervision' : ''}`;
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Seules pages web autorisées dans les fenêtres : le serveur local de CE PC, sur son port actuel. */
export function isAppUrl(raw: string, port: number | null): boolean {
  const url = parse(raw);
  if (!url || !port) return false;
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname) && url.port === String(port) && !url.username && !url.password;
}

/** Fenêtres locales de la console (attente, appairage) : fichiers du dossier `fenetres`, rien d'autre. */
export function isLocalWindowUrl(raw: string, windowsDir: string): boolean {
  const url = parse(raw);
  if (!url || url.protocol !== 'file:') return false;
  let file: string;
  try {
    file = fileURLToPath(url, { windows: true });
  } catch {
    return false;
  }
  const root = win32.normalize(windowsDir).replace(/\\+$/, '').toLowerCase();
  return win32.normalize(file).toLowerCase().startsWith(`${root}\\`);
}

function isLocalNetworkHost(host: string): boolean {
  return LOOPBACK.has(host) || /^10\.\d+\.\d+\.\d+$/.test(host) || /^192\.168\.\d+\.\d+$/.test(host) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host);
}

/**
 * Liens ouverts dans le navigateur de Windows, jamais dans la console : téléchargement d'une mise à jour
 * (https), menu client d'un QR de table (http sur le réseau du restaurant). Tout le reste est ignoré.
 */
export function isExternalLink(raw: string): boolean {
  const url = parse(raw);
  if (!url || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLocalNetworkHost(url.hostname);
}
