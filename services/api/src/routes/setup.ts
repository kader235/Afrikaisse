import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SETUP_STEPS, demoResultSchema, floorSchema, quickTablesSchema, setupStatusSchema, setupStepInputSchema, setupTestOrderSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import { loadDemoRestaurant } from '../services/demo.ts';
import { finishSetup, finishSetupTest, markSetupStep, quickTables, runSetupTest, setupStatus } from '../services/setup.ts';

/** Assistant de mise en route (§70) et restaurant de démonstration (§71). */
export function setupRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const params = z.object({ locationId: z.uuid() });
    const security = [{ bearer: [] }];
    const tags = ['setup'];

    app.get(
      '/locations/:locationId/setup',
      { schema: { tags, summary: 'Avancement de la mise en route, calculé depuis les données (étapes faites, passées, où reprendre)', security, params, response: { 200: setupStatusSchema } } },
      async (request) => setupStatus(ctx, requireTenant(request.auth, 'location.read'), request.params.locationId),
    );

    app.post(
      '/locations/:locationId/setup/steps/:step',
      {
        schema: {
          tags,
          summary: 'Valider (skipped=false) ou passer (skipped=true) une étape de l’assistant',
          security,
          params: z.object({ locationId: z.uuid(), step: z.enum(SETUP_STEPS) }),
          body: setupStepInputSchema,
          response: { 200: setupStatusSchema },
        },
      },
      async (request) => markSetupStep(ctx, requireTenant(request.auth, 'location.manage'), request.params.locationId, request.params.step, request.body.skipped, requestMeta(request)),
    );

    app.post(
      '/locations/:locationId/setup/finish',
      { schema: { tags, summary: 'Terminer l’assistant (toutes les étapes faites ou passées)', security, params, response: { 200: setupStatusSchema } } },
      async (request) => finishSetup(ctx, requireTenant(request.auth, 'location.manage'), request.params.locationId, requestMeta(request)),
    );

    app.post(
      '/locations/:locationId/setup/tables',
      { schema: { tags, summary: 'Générer des tables en série par zone (plan en rangées, QR compris)', security, params, body: quickTablesSchema, response: { 201: floorSchema } } },
      async (request, reply) => {
        const floor = await quickTables(ctx, requireTenant(request.auth, 'tables.manage'), request.params.locationId, request.body, requestMeta(request));
        reply.code(201);
        return floor;
      },
    );

    app.post(
      '/locations/:locationId/setup/test-order',
      { schema: { tags, summary: 'Commande de test : vraie commande envoyée aux postes de préparation', security, params, response: { 201: setupTestOrderSchema } } },
      async (request, reply) => {
        const scope = requireTenant(request.auth, 'location.manage');
        const result = await runSetupTest(ctx, scope, request.params.locationId, requestMeta(request));
        reply.code(201);
        return result;
      },
    );

    app.post(
      '/locations/:locationId/setup/test-order/:orderId/finish',
      { schema: { tags, summary: 'Nettoyer le test : annulation motivée et tracée de la commande de test', security, params: z.object({ locationId: z.uuid(), orderId: z.uuid() }), response: { 200: setupStatusSchema } } },
      async (request) =>
        finishSetupTest(ctx, request.auth, requireTenant(request.auth, 'location.manage'), request.params.locationId, request.params.orderId, requestMeta(request)),
    );

    app.post(
      '/locations/:locationId/demo',
      {
        schema: {
          tags,
          summary: 'Installer la démonstration (établissement vide, une fois par organisation ; équipe et historique dans une organisation de démonstration)',
          security,
          params,
          response: { 201: demoResultSchema },
        },
      },
      async (request, reply) => {
        const result = await loadDemoRestaurant(ctx, requireTenant(request.auth, 'menu.manage'), request.params.locationId, requestMeta(request));
        reply.code(201).header('cache-control', 'no-store');
        return result;
      },
    );
  };
}
