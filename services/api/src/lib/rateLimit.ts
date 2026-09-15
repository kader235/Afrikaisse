import { AppError } from '@afrikaisse/core';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

/**
 * Limites par adresse IP sur les routes ouvertes sans connexion (phase 18). En mémoire : l'API
 * tourne en un seul processus (Passenger o2switch ou serveur local). Les lectures ne sont pas
 * limitées : les téléphones d'un même Wi-Fi partagent une adresse publique et suivent leur
 * commande en boucle. Les commandes QR sont comptées par table, pour la même raison.
 */
export interface RateRule {
  method: 'POST';
  url: string;
  max: number;
  windowSec: number;
  /** Paramètre de route ajouté à la clé (compter par table plutôt que par IP seule). */
  perParam?: string;
}

export const RATE_RULES: RateRule[] = [
  { method: 'POST', url: '/api/auth/register', max: 10, windowSec: 3600 },
  { method: 'POST', url: '/api/auth/login', max: 30, windowSec: 600 },
  { method: 'POST', url: '/api/auth/refresh', max: 120, windowSec: 600 },
  { method: 'POST', url: '/api/auth/recovery/question', max: 30, windowSec: 600 },
  { method: 'POST', url: '/api/auth/recovery/reset', max: 20, windowSec: 600 },
  { method: 'POST', url: '/api/public/menu/:token/orders', max: 30, windowSec: 600, perParam: 'token' },
  { method: 'POST', url: '/api/public/menu/:token/requests', max: 30, windowSec: 600, perParam: 'token' },
  // Codes promo : pas de devinette en rafale depuis une table.
  { method: 'POST', url: '/api/public/menu/:token/promo-code', max: 30, windowSec: 600, perParam: 'token' },
  { method: 'POST', url: '/api/public/menu/:token/quote', max: 120, windowSec: 600, perParam: 'token' },
  // Code de table : s'ajoute au blocage par table ouverte (10 codes faux en 10 min, compté en base).
  { method: 'POST', url: '/api/public/menu/:token/join', max: 30, windowSec: 600, perParam: 'token' },
  { method: 'POST', url: '/api/sync/pair', max: 20, windowSec: 600 },
  { method: 'POST', url: '/api/system/sync/pair', max: 20, windowSec: 600 },
];

const MAX_KEYS = 50_000;

const isLoopback = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.');

function waitLabel(seconds: number) {
  return seconds < 90 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerRateLimits(app: FastifyInstance<any, any, any, any, any>, ctx: AppContext) {
  if (!ctx.config.rateLimit) return;
  const hits = new Map<string, { count: number; resetAt: number }>();

  app.addHook('onRequest', async (request, reply) => {
    const rule = RATE_RULES.find((r) => r.method === request.method && r.url === request.routeOptions.url);
    if (!rule) return;
    const now = ctx.now();
    const param = rule.perParam ? ((request.params as Record<string, string> | undefined)?.[rule.perParam] ?? '') : '';
    // Adresse du client inconnue (proxy qui ne transmet pas X-Forwarded-For) : ne jamais mettre tous
    // les clients dans le même compteur, sinon dix inscriptions dans l'heure fermeraient le service à tous.
    const ip = request.ip;
    if (!ip || (ctx.config.profile === 'cloud' && isLoopback(ip) && !request.headers['x-forwarded-for'])) return;
    const key = `${rule.url}|${ip}|${param}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (hits.size >= MAX_KEYS) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
        if (hits.size >= MAX_KEYS) hits.clear();
      }
      entry = { count: 0, resetAt: now + rule.windowSec * 1000 };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > rule.max) {
      const retry = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      reply.header('retry-after', String(retry));
      throw new AppError('TOO_MANY_ATTEMPTS', `Trop de demandes depuis cette adresse. Réessayez dans ${waitLabel(retry)}.`, { retryAfter: retry });
    }
  });
}
