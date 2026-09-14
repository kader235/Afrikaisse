import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createStationSchema, kitchenActionSchema, orderSchema, stationSchema, updateStationSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import { archiveStation, createStation, kitchenAction, listStations, updateStation } from '../services/kitchen.ts';

const security = [{ bearer: [] }];
const tags = ['kitchen'];

/** Postes de préparation et écran cuisine. */
export function kitchenRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const location = z.object({ locationId: z.uuid() });
    const station = z.object({ stationId: z.uuid() });
    const list = { 200: z.array(stationSchema) };

    app.get(
      '/locations/:locationId/stations',
      { schema: { tags, summary: 'Postes de préparation actifs', security, params: location, response: list } },
      async (request) => listStations(ctx, requireTenant(request.auth, 'menu.read'), request.params.locationId),
    );

    app.post(
      '/locations/:locationId/stations',
      { schema: { tags, summary: 'Créer un poste (cuisine, grill, bar…)', security, params: location, body: createStationSchema, response: { 201: z.array(stationSchema) } } },
      async (request, reply) => {
        const stations = await createStation(ctx, requireTenant(request.auth, 'menu.manage'), request.params.locationId, request.body, requestMeta(request));
        reply.code(201);
        return stations;
      },
    );

    app.patch(
      '/stations/:stationId',
      { schema: { tags, summary: 'Renommer ou changer le type d’un poste', security, params: station, body: updateStationSchema, response: list } },
      async (request) => updateStation(ctx, requireTenant(request.auth, 'menu.manage'), request.params.stationId, request.body, requestMeta(request)),
    );

    app.post(
      '/stations/:stationId/archive',
      { schema: { tags, summary: 'Archiver un poste sans produit', security, params: station, response: list } },
      async (request) => archiveStation(ctx, requireTenant(request.auth, 'menu.manage'), request.params.stationId, requestMeta(request)),
    );

    app.post(
      '/orders/:orderId/kitchen',
      { schema: { tags, summary: 'Écran cuisine : commencer, marquer prêt ou rappeler les articles d’un poste', security, params: z.object({ orderId: z.uuid() }), body: kitchenActionSchema, response: { 200: orderSchema } } },
      async (request) => kitchenAction(ctx, request.auth, request.params.orderId, request.body, requestMeta(request)),
    );
  };
}
