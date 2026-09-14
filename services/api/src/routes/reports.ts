import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { reportRangeSchema, salesReportSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requireAuth, requireTenant } from '../lib/access.ts';
import { salesReport } from '../services/reports.ts';

/** Rapports et tableau de bord. */
export function reportRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));

    app.get(
      '/locations/:locationId/reports/sales',
      {
        schema: {
          tags: ['reports'],
          summary: 'Ventes sur une période (journées d’exploitation) : totaux, jours, modes de paiement, heures, produits',
          security: [{ bearer: [] }],
          params: z.object({ locationId: z.uuid() }),
          querystring: reportRangeSchema,
          response: { 200: salesReportSchema },
        },
      },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return salesReport(ctx, requireTenant(request.auth, 'reports.read'), request.params.locationId, request.query.from, request.query.to);
      },
    );
  };
}
