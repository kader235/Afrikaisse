import type { MenuKey } from './i18n.tsx';

/** Appels du menu client. Une erreur garde le motif du serveur (`details.reason`) pour être traduite. */
export class MenuError extends Error {
  constructor(
    message: string,
    readonly reason: string | null,
    readonly status: number,
    /** Pas de réponse du tout : téléphone hors connexion ou restaurant injoignable. */
    readonly network: boolean,
  ) {
    super(message);
    this.name = 'MenuError';
  }
}

export async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new MenuError('', null, 0, true);
  }
  const data = (await res.json().catch(() => null)) as { error?: { message?: string; details?: { reason?: string } } } | null;
  if (!res.ok) throw new MenuError(data?.error?.message ?? '', data?.error?.details?.reason ?? null, res.status, false);
  return data as T;
}

const REASONS: Record<string, MenuKey> = {
  TABLE_CODE_REQUIRED: 'errCodeRequired',
  TABLE_CODE_INVALID: 'errCodeInvalid',
  TABLE_CODE_LOCKED: 'errCodeLocked',
  TABLE_NOT_OPEN: 'tableNotOpen',
  ORDERING_UNAVAILABLE: 'orderingPaused',
};

/** Message dans la langue du client quand le motif est connu ; sinon le message du serveur. */
export function errorText(err: unknown, t: (key: MenuKey) => string): string {
  if (err instanceof MenuError) {
    if (err.network) return t('errNetwork');
    if (err.reason && REASONS[err.reason]) return t(REASONS[err.reason]!);
    return err.message || t('errServer');
  }
  return t('errServer');
}

export const isNetworkError = (err: unknown) => err instanceof MenuError && err.network;
