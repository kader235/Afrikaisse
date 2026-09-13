import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditEntrySchema, platformTenantSchema, tenantDetailsSchema, updateTenantSchema } from '@afrikaisse/core';
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
