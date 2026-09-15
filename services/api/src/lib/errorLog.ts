import { uuidv7 } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';

/**
 * Journal des erreurs serveur (§67), lu par le back-office. Borné (nombre et âge) et sans donnée
 * personnelle : ni corps de requête, ni en-têtes, ni adresse IP ; la route est le motif
 * (`/api/orders/:orderId`), et le message est nettoyé des e-mails, numéros et jetons.
 */

export const ERROR_LOG_MAX_ROWS = 2000;
export const ERROR_LOG_MAX_AGE_MS = 30 * 24 * 3600_000;

export interface CapturedError {
  requestId: string | null;
  method: string | null;
  route: string | null;
  status: number;
  code: string;
  message: string;
  tenantId: string | null;
}

export function scrubMessage(message: string): string {
  return message
    .replace(/[^\s@"'<>()]+@[^\s@"'<>()]+\.[A-Za-z]{2,}/g, '[e-mail]')
    .replace(/\b(?:bearer|basic)\s+\S+/gi, '[jeton]')
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, '[jeton]')
    .replace(/\+?\d[\d\s.-]{6,}\d/g, '[nombre]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export async function captureError(ctx: AppContext, e: CapturedError, maxRows = ERROR_LOG_MAX_ROWS): Promise<void> {
  const now = ctx.now();
  await ctx.db
    .insertInto('error_logs')
    .values({
      id: uuidv7(now),
      created_at: now,
      node_id: ctx.nodeId,
      request_id: e.requestId?.slice(0, 64) ?? null,
      method: e.method?.slice(0, 10) ?? null,
      route: e.route?.slice(0, 200) ?? null,
      status: e.status,
      code: e.code.slice(0, 40),
      message: scrubMessage(e.message) || 'Erreur sans message',
      tenant_id: e.tenantId,
    })
    .execute();
  await ctx.db.deleteFrom('error_logs').where('created_at', '<', now - ERROR_LOG_MAX_AGE_MS).execute();
  // Au-delà de maxRows, les plus anciennes partent. La sous-requête ne renvoie rien tant que la table est sous la borne.
  await ctx.db
    .deleteFrom('error_logs')
    .where('created_at', '<', (eb) => eb.selectFrom('error_logs').select('created_at').orderBy('created_at', 'desc').limit(1).offset(maxRows - 1))
    .execute();
}
