import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorLogEntrySchema, platformDeviceSchema, platformRestaurantSchema, platformStatsSchema, platformSyncStateSchema, platformUserSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { authenticate, requestMeta } from '../lib/access.ts';
import { listDevices, listErrors, listRestaurants, listSyncStates, listUsers, platformStats, setUserStatus } from '../services/platform.ts';
import { requirePlatformAdmin } from '../services/tenant.ts';

const security = [{ bearer: [] }];
const tags = ['platform'];

/**
 * Back-office §67, profil cloud uniquement. Le contrôle se fait dès `onRequest`, AVANT la validation
 * des paramètres : un client connecté reçoit 404 partout, même avec un identifiant mal formé, et
 * n'apprend rien de l'existence de ces routes.
 */
export function platformBackOfficeRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('onRequest', async (request) => {
      request.auth = await authenticate(ctx, request);
      requirePlatformAdmin(request.auth);
    });
    const search = z.string().trim().max(100).optional();

    app.get(
      '/restaurants',
      { schema: { tags, summary: 'Organisations, établissements, offre, état, dernière activité', security, querystring: z.object({ q: search }), response: { 200: z.array(platformRestaurantSchema) } } },
      async (request) => listRestaurants(ctx, request.query.q),
    );

    app.get(
      '/users',
      {
        schema: {
          tags,
          summary: 'Comptes de toutes les organisations (recherche par nom ou e-mail)',
          security,
          querystring: z.object({ q: search, limit: z.coerce.number().int().min(1).max(200).default(50) }),
          response: { 200: z.array(platformUserSchema) },
        },
      },
      async (request) => listUsers(ctx, request.query.q, request.query.limit),
    );

    for (const [action, status] of [['suspend', 'DISABLED'], ['reactivate', 'ACTIVE']] as const) {
      app.post(
        `/users/:userId/${action}`,
        { schema: { tags, summary: action === 'suspend' ? 'Suspendre un compte (toutes organisations, sessions révoquées)' : 'Réactiver un compte', security, params: z.object({ userId: z.uuid() }) } },
        async (request, reply) => {
          await setUserStatus(ctx, request.auth!, request.params.userId, status, requestMeta(request));
          return reply.code(204).send();
        },
      );
    }

    app.get(
      '/devices',
      { schema: { tags, summary: 'Installations : serveurs locaux et appareils (version, dernier contact, révocation)', security, response: { 200: z.array(platformDeviceSchema) } } },
      async () => listDevices(ctx),
    );

    app.get(
      '/sync',
      { schema: { tags, summary: 'Synchronisation par serveur local : derniers envoi et réception, compteurs', security, response: { 200: z.array(platformSyncStateSchema) } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return listSyncStates(ctx);
      },
    );

    app.get(
      '/errors',
      {
        schema: {
          tags,
          summary: 'Erreurs serveur (500) du Cloud, les plus récentes d’abord',
          security,
          querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), before: z.coerce.number().int().optional() }),
          response: { 200: z.array(errorLogEntrySchema) },
        },
      },
      async (request) => listErrors(ctx, request.query.limit, request.query.before),
    );

    app.get(
      '/stats',
      { schema: { tags, summary: 'Statistiques globales : organisations, établissements, commandes et chiffre d’affaires sur 7 et 30 jours', security, response: { 200: platformStatsSchema } } },
      async () => platformStats(ctx),
    );
  };
}
