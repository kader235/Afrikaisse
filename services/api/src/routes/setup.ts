import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { setupStatusSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import { loadDemoRestaurant, setupStatus } from '../services/demo.ts';

/** Mise en route d'un établissement et restaurant de démonstration. */
export function setupRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const params = z.object({ locationId: z.uuid() });
    const security = [{ bearer: [] }];

    app.get(
      '/locations/:locationId/setup',
      { schema: { tags: ['setup'], summary: 'Avancement de la mise en route (tables, produits, équipe, caisse, commandes)', security, params, response: { 200: setupStatusSchema } } },
      async (request) => setupStatus(ctx, requireTenant(request.auth, 'location.read'), request.params.locationId),
    );

    app.post(
      '/locations/:locationId/demo',
      { schema: { tags: ['setup'], summary: 'Installer le restaurant de démonstration (établissement vide uniquement)', security, params, response: { 201: setupStatusSchema } } },
      async (request, reply) => {
        const status = await loadDemoRestaurant(ctx, requireTenant(request.auth, 'menu.manage'), request.params.locationId, requestMeta(request));
        reply.code(201);
        return status;
      },
    );
  };
}
