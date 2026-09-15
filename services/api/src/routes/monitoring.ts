import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, RELEASE_CHANNELS, monitoringSchema, screenHeartbeatSchema, signedReleaseSchema, updateStatusSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requireAuth, requireTenant } from '../lib/access.ts';
import { locationMonitoring, recordScreenHeartbeat } from '../services/monitoring.ts';
import { checkForUpdate, latestRelease, updateStatus } from '../services/releases.ts';

const security = [{ bearer: [] }];
const tags = ['system'];

/** Supervision (§68-69), signe de vie des écrans cuisine, mises à jour du serveur local (§73). */
export function monitoringRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const location = z.object({ locationId: z.uuid() });

    app.get(
      '/locations/:locationId/monitoring',
      { schema: { tags, summary: "État du système de l'établissement : Cloud, base, API, serveur local, synchronisation, imprimantes, écrans cuisine, sauvegarde", security, params: location, response: { 200: monitoringSchema } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        // Propriétaire, administrateur, responsable (devices.manage).
        return locationMonitoring(ctx, requireTenant(request.auth, 'devices.manage'), request.params.locationId);
      },
    );

    app.post(
      '/locations/:locationId/screens/heartbeat',
      { schema: { tags, summary: 'Signe de vie d’un écran cuisine (appelé toutes les 30 s par l’écran ouvert)', security, params: location, body: screenHeartbeatSchema } },
      async (request, reply) => {
        await recordScreenHeartbeat(ctx, requireTenant(request.auth, 'orders.read'), request.params.locationId, request.body);
        return reply.code(204).send();
      },
    );

    app.get(
      '/system/update',
      { schema: { tags, summary: 'Version actuelle et dernière version annoncée (signature vérifiée)', security, response: { 200: updateStatusSchema } } },
      async (request) => {
        requireTenant(request.auth, 'settings.manage');
        return updateStatus(ctx);
      },
    );

    app.post(
      '/system/update/check',
      { schema: { tags, summary: 'Rechercher une mise à jour maintenant (serveur local ; n’installe rien)', security, response: { 200: updateStatusSchema } } },
      async (request) => {
        requireTenant(request.auth, 'settings.manage');
        return checkForUpdate(ctx);
      },
    );
  };
}

/** Annonce publique de la dernière version (Cloud). Sans connexion : le serveur local la vérifie par signature. */
export function releaseRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/public/releases/latest',
      {
        schema: {
          tags,
          summary: 'Dernière version du serveur local, signée Ed25519',
          querystring: z.object({ channel: z.enum(RELEASE_CHANNELS).default('stable') }),
          response: { 200: signedReleaseSchema },
        },
      },
      async (request, reply) => {
        const release = await latestRelease(ctx.db, request.query.channel);
        if (!release) throw new AppError('NOT_FOUND', 'Aucune version publiée sur ce canal.');
        reply.header('cache-control', 'public, max-age=300');
        return release;
      },
    );
  };
}
