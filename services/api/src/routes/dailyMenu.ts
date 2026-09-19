import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { dailyMenuInputSchema, dailyMenuStateSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import { archiveDailyMenu, getDailyMenuState, saveDailyMenu } from '../services/dailyMenu.ts';

/** Menu du jour : lecture par l'équipe, gestion par qui gère le menu. « Épuisé » reste POST /products/:id/availability. */
export function dailyMenuRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const tags = ['menu'];
    const security = [{ bearer: [] }];
    const location = z.object({ locationId: z.uuid() });
    const one = z.object({ menuId: z.uuid() });

    app.get('/locations/:locationId/daily-menu', { schema: { tags, summary: 'Menu du jour en vigueur et à venir', security, params: location, response: { 200: dailyMenuStateSchema } } }, async (request, reply) => {
      reply.header('cache-control', 'no-store');
      return getDailyMenuState(ctx, requireTenant(request.auth, 'menu.read'), request.params.locationId);
    });

    app.put(
      '/locations/:locationId/daily-menu',
      { schema: { tags, summary: 'Fixer ou ajuster le menu d’un jour ou d’une période', security, params: location, body: dailyMenuInputSchema, response: { 200: dailyMenuStateSchema } } },
      async (request) => saveDailyMenu(ctx, requireTenant(request.auth, 'menu.manage'), request.params.locationId, request.body, requestMeta(request)),
    );

    app.post('/daily-menus/:menuId/archive', { schema: { tags, summary: 'Retirer un menu du jour', security, params: one, response: { 200: dailyMenuStateSchema } } }, async (request) =>
      archiveDailyMenu(ctx, requireTenant(request.auth, 'menu.manage'), request.params.menuId, requestMeta(request)),
    );
  };
}
