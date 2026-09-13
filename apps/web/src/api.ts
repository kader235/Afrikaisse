import type { ErrorResponse, SessionResponse } from '@afrikaisse/core';

/**
 * Client HTTP du navigateur.
 * - Jeton d'accès en mémoire uniquement (jamais localStorage).
 * - Jeton de renouvellement en cookie httpOnly posé par l'API.
 * - Un seul renouvellement à la fois, partagé par les requêtes concurrentes.
 * - Réseau coupé ≠ session expirée : on ne renvoie JAMAIS vers la connexion
 *   parce que le Wi-Fi du restaurant a flanché.
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

export const OFFLINE = 'OFFLINE';

let accessToken: string | null = null;
let refreshing: Promise<SessionResponse | null> | null = null;

export function setSession(session: SessionResponse | null) {
  accessToken = session?.accessToken ?? null;
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'x-afk-client': 'web',
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(accessToken && { authorization: `Bearer ${accessToken}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, OFFLINE, 'Connexion impossible. Vérifiez le réseau puis réessayez.');
  }
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const data = (await res.json()) as ErrorResponse;
    return new ApiError(res.status, data.error.code, data.error.message, data.error.details);
  } catch {
    return new ApiError(res.status, 'INTERNAL', 'Réponse inattendue du serveur.');
  }
}

/** null = pas (ou plus) de session ; lève ApiError OFFLINE si le serveur est injoignable. */
export function refreshSession(): Promise<SessionResponse | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const res = await send('POST', '/auth/refresh', {});
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

const NO_RETRY = ['/auth/login', '/auth/register', '/auth/refresh'];

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res = await send(method, path, body);
  if (res.status === 401 && accessToken && !NO_RETRY.includes(path)) {
    const renewed = await refreshSession();
    if (renewed) res = await send(method, path, body);
  }
  if (!res.ok) throw await toError(res);
  return (res.status === 204 ? undefined : await res.json()) as T;
}
