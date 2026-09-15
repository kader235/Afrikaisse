import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { breakdownReportSchema, kitchenReportSchema, reportRangeSchema, stockReportSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requireAuth, requireTenant } from '../lib/access.ts';
import { breakdownReport, kitchenReport, stockReport } from '../services/analytics.ts';

const security = [{ bearer: [] }];
const tags = ['reports'];

/** Rapports détaillés : périodes, produits, catégories, personnel, paiements, cuisine, stock. */
export function analyticsRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const params = z.object({ locationId: z.uuid() });

    app.get(
      '/locations/:locationId/reports/breakdown',
      {
        schema: {
          tags,
          summary: 'Semaines, mois, produits, catégories, personnel et paiements d’une période',
          security,
          params,
          querystring: reportRangeSchema,
          response: { 200: breakdownReportSchema },
        },
      },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return breakdownReport(ctx, requireTenant(request.auth, 'reports.read'), request.params.locationId, request.query.from, request.query.to);
      },
    );

    app.get(
      '/locations/:locationId/reports/kitchen',
      {
        schema: {
          tags,
          summary: 'Temps de préparation : temps moyen, retards, temps par poste et par produit',
          security,
          params,
          querystring: reportRangeSchema,
          response: { 200: kitchenReportSchema },
        },
      },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return kitchenReport(ctx, requireTenant(request.auth, 'reports.read'), request.params.locationId, request.query.from, request.query.to);
      },
    );

    app.get(
      '/locations/:locationId/reports/stock',
      {
        schema: {
          tags,
          summary: 'Stock d’une période : début, réceptions, consommation, pertes, ajustements, fin',
          security,
          params,
          querystring: reportRangeSchema,
          response: { 200: stockReportSchema },
        },
      },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return stockReport(ctx, requireTenant(request.auth, 'inventory.read'), request.params.locationId, request.query.from, request.query.to);
      },
    );
  };
}
