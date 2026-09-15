import { setSubscriptionSchema, subscriptionSchema } from '@afrikaisse/core';
import { setSubscription } from '../services/subscription.ts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditEntrySchema, demoTenantSchema, emailSchema, platformTenantSchema, tenantDetailsSchema, updateTenantSchema } from '@afrikaisse/core';
import { createDemoTenant } from '../services/demo.ts';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import { getTenant, listAudit, listTenants, renameTenant, requirePlatformAdmin, setTenantStatus } from '../services/tenant.ts';

const security = [{ bearer: [] }];

export function tenantRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));

    app.get(
      '/tenant',
      { schema: { tags: ['tenant'], summary: 'Organisation courante et ses établissements', security, response: { 200: tenantDetailsSchema } } },
      async (request) => getTenant(ctx, requireTenant(request.auth, 'tenant.read')),
    );

    app.patch(
      '/tenant',
      { schema: { tags: ['tenant'], summary: "Renommer l'organisation", security, body: updateTenantSchema, response: { 200: tenantDetailsSchema } } },
      async (request) => renameTenant(ctx, requireTenant(request.auth, 'tenant.update'), request.body.name, requestMeta(request)),
    );

    app.get(
      '/audit',
      {
        schema: {
          tags: ['audit'],
          summary: "Journal d'audit de l'organisation (du plus récent au plus ancien)",
          security,
          querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.coerce.number().int().optional() }),
          response: { 200: z.array(auditEntrySchema) },
        },
      },
      async (request) => listAudit(ctx, requireTenant(request.auth, 'audit.read'), request.query.limit, request.query.before),
    );
  };
}

/** Back-office GLOBALTECH BUSINESS TD. Enregistré uniquement dans le profil cloud. */
export function platformRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const params = z.object({ tenantId: z.uuid() });

    app.get(
      '/tenants',
      { schema: { tags: ['platform'], summary: 'Toutes les organisations clientes', security, response: { 200: z.array(platformTenantSchema) } } },
      async (request) => {
        requirePlatformAdmin(request.auth);
        return listTenants(ctx);
      },
    );

    app.post(
      '/tenants/:tenantId/subscription',
      {
        schema: { tags: ['platform'], summary: "Changer l'offre ou prolonger l'abonnement d'une organisation", security, params, body: setSubscriptionSchema, response: { 200: subscriptionSchema } },
      },
      async (request) => setSubscription(ctx, requirePlatformAdmin(request.auth), request.params.tenantId, request.body, requestMeta(request)),
    );

    app.post(
      '/demo-tenants',
      {
        schema: {
          tags: ['platform'],
          summary: 'Créer une organisation « AfriKaisse Demo Restaurant » pour un prospect (identifiants rendus une seule fois)',
          security,
          body: z.object({ email: emailSchema.optional() }).default({}),
          response: { 201: demoTenantSchema },
        },
      },
      async (request, reply) => {
        requirePlatformAdmin(request.auth);
        const demo = await createDemoTenant(ctx, requestMeta(request), { email: request.body.email });
        reply.code(201).header('cache-control', 'no-store');
        return demo;
      },
    );

    for (const [action, status] of [['suspend', 'SUSPENDED'], ['reactivate', 'ACTIVE']] as const) {
      app.post(
        `/tenants/:tenantId/${action}`,
        { schema: { tags: ['platform'], summary: action === 'suspend' ? 'Suspendre une organisation' : 'Réactiver une organisation', security, params } },
        async (request, reply) => {
          const admin = requirePlatformAdmin(request.auth);
          await setTenantStatus(ctx, admin, request.params.tenantId, status, requestMeta(request));
          return reply.code(204).send();
        },
      );
    }
  };
}
