/**
 * Adresse du serveur que la tablette appelle : le Cloud (HTTPS) ou le serveur local du
 * restaurant (souvent HTTP sur le Wi-Fi, faute de certificat).
 *
 * Règle de sécurité : HTTP en clair n'est accepté que vers une adresse du réseau local
 * (IPv4 privée, localhost, nom en .local). Vers Internet, les identifiants et les jetons
 * ne voyagent qu'en HTTPS.
 */
const PRIVATE_IPV4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^127\./, /^169\.254\./];

export function isLocalNetworkHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  if (h.split('.').some((part) => Number(part) > 255)) return false;
  return PRIVATE_IPV4.some((re) => re.test(h));
}

export type ServerUrlCheck = { ok: true; url: string } | { ok: false; message: string };

/** Normalise « 192.168.1.20:3000 », « app.afrikaisse.com », « https://x/api/ »… en origine sans /api. */
export function normalizeServerUrl(input: string): ServerUrlCheck {
  let raw = input.trim();
  if (!raw) return { ok: false, message: "Saisissez l'adresse du serveur." };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const host = raw.split(/[/:]/)[0] ?? '';
    raw = `${isLocalNetworkHost(host) ? 'http' : 'https'}://${raw}`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: 'Adresse invalide.' };
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || !url.hostname) {
    return { ok: false, message: 'Adresse invalide.' };
  }
  if (url.protocol === 'http:' && !isLocalNetworkHost(url.hostname)) {
    return { ok: false, message: 'Hors du réseau du restaurant, la connexion doit être chiffrée (https).' };
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
  return { ok: true, url: `${url.protocol}//${url.host}${path}` };
}

/** Adresse d'AfriKaisse Cloud : proposée par défaut (tablette, appairage) et repli des QR. À changer ici seulement. */
export const DEFAULT_CLOUD_URL = 'https://afrikaisse.dametta.com';
