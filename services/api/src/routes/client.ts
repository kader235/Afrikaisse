import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { clientSessionSchema, clientTokenSchema, joinTableSchema, openTableResultSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import { getClientSession, joinTable, menuManifest, openTableForGuests, renewJoinCode } from '../services/client.ts';

const security = [{ bearer: [] }];
const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });

/** Menu client, sans compte : table partagée, code de table, manifeste de l'application installable. */
export function publicClientRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/public/menu/:token/session',
      { schema: { tags: ['public'], summary: 'Ma table : clients, commandes de la table, parts et addition demandée', params: tokenParams, querystring: z.object({ clientToken: clientTokenSchema }), response: { 200: clientSessionSchema } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return getClientSession(ctx, request.params.token, request.query.clientToken);
      },
    );

    app.post(
      '/public/menu/:token/join',
      { schema: { tags: ['public'], summary: 'Rejoindre la table ouverte (code de table si exigé) et choisir un surnom', params: tokenParams, body: joinTableSchema, response: { 200: clientSessionSchema } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return joinTable(ctx, request.params.token, request.body, requestMeta(request));
      },
    );

    app.get('/public/menu/:token/manifest.webmanifest', { schema: { tags: ['public'], summary: "Manifeste de l'application web du menu (installable)", params: tokenParams } }, async (request, reply) => {
      const manifest = await menuManifest(ctx, (request.params as { token: string }).token);
      return reply.type('application/manifest+json; charset=utf-8').header('cache-control', 'public, max-age=3600').send(JSON.stringify(manifest));
    });
  };
}

/** Côté personnel : installer des clients et gérer le code de table. */
export function clientRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));

    app.post(
      '/tables/:tableId/open',
      { schema: { tags: ['orders'], summary: 'Ouvrir une table sans commande (code de table à donner aux clients)', security, params: z.object({ tableId: z.uuid() }), response: { 200: openTableResultSchema } } },
      async (request) => openTableForGuests(ctx, requireTenant(request.auth, 'orders.create'), request.params.tableId, requestMeta(request)),
    );

    app.post(
      '/table-sessions/:sessionId/code',
      { schema: { tags: ['orders'], summary: "Nouveau code de table (les clients déjà installés le restent)", security, params: z.object({ sessionId: z.uuid() }), response: { 200: openTableResultSchema } } },
      async (request) => renewJoinCode(ctx, requireTenant(request.auth, 'orders.create'), request.params.sessionId, requestMeta(request)),
    );
  };
}
