import type { ErrorResponse, SessionResponse } from '@afrikaisse/core';
import { apiBase, isNativeApp, readRefreshToken, storeRefreshToken } from './platform.ts';

/**
 * Client HTTP commun au navigateur et à la tablette.
 * - Jeton d'accès en mémoire uniquement (jamais localStorage).
 * - Jeton de renouvellement : cookie httpOnly (navigateur) ou Keystore (tablette).
 * - Un seul renouvellement à la fois, partagé par les requêtes concurrentes.
 * - Réseau coupé ≠ session expirée : on ne renvoie JAMAIS vers la connexion
 *   parce que le Wi-Fi du restaurant a flanché.
 * - Délai maximal : un serveur éteint se tait ; sans délai l'écran attendrait sans fin.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Erreur locale (photo illisible…) dont le message est écrit pour l'utilisateur. */
export class UserFacingError extends Error {}

export const OFFLINE = 'OFFLINE';
const TIMEOUT_MS = 15_000;

let accessToken: string | null = null;
let refreshing: Promise<SessionResponse | null> | null = null;

export function setSession(session: SessionResponse | null) {
  accessToken = session?.accessToken ?? null;
  if (!isNativeApp()) return;
  if (session === null) void storeRefreshToken(null);
  else if (session.refreshToken) void storeRefreshToken(session.refreshToken);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const native = isNativeApp();
  try {
    return await withTimeout(
      fetch(`${apiBase()}/api${path}`, {
        method,
        credentials: native ? 'omit' : 'same-origin',
        headers: {
          // Sans cet en-tête, l'API renvoie le jeton de renouvellement dans le corps (mode application).
          ...(!native && { 'x-afk-client': 'web' }),
          ...(body !== undefined && { 'content-type': 'application/json' }),
          ...(accessToken && { authorization: `Bearer ${accessToken}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      TIMEOUT_MS,
    );
  } catch {
    throw new ApiError(0, OFFLINE, 'Connexion impossible. Vérifiez le réseau puis réessayez.');
  }
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const data = (await res.json()) as ErrorResponse;
    return new ApiError(res.status, data.error.code, data.error.message, data.error.details);
  } catch {
    // Page d'erreur de l'hébergeur (pare-feu, application qui redémarre…) : le code HTTP aide à trouver la cause.
    return new ApiError(res.status, 'INTERNAL', `Réponse inattendue du serveur (HTTP ${res.status}).`);
  }
}

/** null = pas (ou plus) de session ; lève ApiError OFFLINE si le serveur est injoignable. */
export function refreshSession(): Promise<SessionResponse | null> {
  if (!refreshing) {
    refreshing = (async () => {
      let body: { refreshToken?: string } = {};
      if (isNativeApp()) {
        const token = await readRefreshToken();
        if (!token) return null;
        body = { refreshToken: token };
      }
      const res = await send('POST', '/auth/refresh', body);
      if (res.status === 401) {
        setSession(null);
        return null;
      }
      if (!res.ok) throw await toError(res);
      const session = (await res.json()) as SessionResponse;
      setSession(session);
      return session;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

const NO_RETRY = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/recovery/question', '/auth/recovery/reset'];

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res = await send(method, path, body);
  if (res.status === 401 && accessToken && !NO_RETRY.includes(path)) {
    const renewed = await refreshSession();
    if (renewed) res = await send(method, path, body);
  }
  if (!res.ok) throw await toError(res);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface ServerHealth {
  status: 'ok';
  profile: 'cloud' | 'local';
  database: 'postgres' | 'sqlite';
  version: string;
}

/** Vérifie qu'une adresse répond vraiment comme un serveur AfriKaisse avant de l'enregistrer. */
export async function checkServer(url: string): Promise<ServerHealth> {
  const res = await withTimeout(fetch(`${url}/api/health`, { credentials: 'omit' }), 8_000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const health = (await res.json()) as ServerHealth;
  if (health?.status !== 'ok') throw new Error('Réponse inattendue');
  return health;
}
