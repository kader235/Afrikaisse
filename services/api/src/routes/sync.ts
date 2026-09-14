import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  localPairRequestSchema,
  pairRequestSchema,
  pairResponseSchema,
  pairingCodeSchema,
  pullResponseSchema,
  pushRequestSchema,
  pushResponseSchema,
  syncRunSchema,
  syncStatusSchema,
} from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import { pairWithCloud, runSyncOnce, syncStatus } from '../services/sync/client.ts';
import { authenticateDevice, createPairingCode, pairDevice, pullEvents, pushEvents } from '../services/sync/server.ts';

/** Synchronisation : routes du Cloud (appairage, push, pull) ou du serveur local (état, appairage). */
export function syncRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    const security = [{ bearer: [] }];
    const tags = ['sync'];

    if (ctx.config.profile === 'cloud') {
      app.post(
        '/locations/:locationId/pairing-code',
        { preHandler: requireAuth(ctx), schema: { tags, summary: "Code d'appairage d'un serveur local (usage unique, 10 min)", security, params: z.object({ locationId: z.uuid() }), response: { 200: pairingCodeSchema } } },
        async (request) => createPairingCode(ctx, requireTenant(request.auth, 'location.manage'), request.params.locationId, requestMeta(request)),
      );

      app.post(
        '/sync/pair',
        { schema: { tags, summary: 'Appairer un serveur local avec un code (renvoie son identité et la copie initiale)', body: pairRequestSchema, response: { 200: pairResponseSchema } } },
        async (request) => pairDevice(ctx, request.body, requestMeta(request)),
      );

      app.post(
        '/sync/push',
        { bodyLimit: 30 * 1024 * 1024, schema: { tags, summary: 'Événements du serveur local (idempotents)', body: pushRequestSchema, response: { 200: pushResponseSchema } } },
        async (request) => pushEvents(ctx, await authenticateDevice(ctx, request), request.body.events),
      );

      app.get(
        '/sync/pull',
        { schema: { tags, summary: 'Événements des autres nœuds depuis un curseur', querystring: z.object({ since: z.coerce.number().int().min(0).default(0) }), response: { 200: pullResponseSchema } } },
        async (request, reply) => {
          reply.header('cache-control', 'no-store');
          return pullEvents(ctx, await authenticateDevice(ctx, request), request.query.since);
        },
      );
      return;
    }

    app.get(
      '/system/sync',
      { preHandler: requireAuth(ctx), schema: { tags, summary: 'État de la synchronisation avec le Cloud', security, response: { 200: syncStatusSchema } } },
      async (request) => {
        requireTenant(request.auth, 'settings.manage');
        return syncStatus(ctx);
      },
    );

    app.post(
      '/system/sync/now',
      { preHandler: requireAuth(ctx), schema: { tags, summary: 'Synchroniser maintenant', security, response: { 200: syncRunSchema } } },
      async (request) => {
        requireTenant(request.auth, 'settings.manage');
        return runSyncOnce(ctx);
      },
    );

    app.post(
      '/system/sync/pair',
      {
        schema: {
          tags,
          summary: 'Relier ce serveur neuf à un établissement AfriKaisse Cloud (code donné par le Cloud)',
          body: localPairRequestSchema,
          response: { 201: z.object({ organization: z.string(), location: z.string() }) },
        },
      },
      async (request, reply) => {
        const result = await pairWithCloud(ctx, request.body);
        reply.code(201);
        return result;
      },
    );
  };
}
