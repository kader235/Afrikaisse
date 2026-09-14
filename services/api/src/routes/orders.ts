import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  activitySchema,
  clientTokenSchema,
  orderSchema,
  placeQrOrderSchema,
  publicOrderSchema,
  serviceRequestInputSchema,
  serviceRequestSchema,
  updateOrderStatusSchema,
} from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import {
  closeTableSession,
  createServiceRequest,
  getActivity,
  listClientOrders,
  listOpenRequests,
  listOrders,
  placeQrOrder,
  resolveServiceRequest,
  updateOrderStatus,
} from '../services/orders.ts';

const security = [{ bearer: [] }];
const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });

/** Côté client : commande et appels depuis le QR de la table, sans compte. */
export function publicOrderRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/public/menu/:token/orders',
      { schema: { tags: ['public'], summary: 'Commander depuis le QR (prix recalculés par le serveur ; en attente de confirmation)', params: tokenParams, body: placeQrOrderSchema, response: { 201: publicOrderSchema } } },
      async (request, reply) => {
        const order = await placeQrOrder(ctx, request.params.token, request.body, requestMeta(request));
        reply.code(201).header('cache-control', 'no-store');
        return order;
      },
    );

    app.get(
      '/public/menu/:token/orders',
      { schema: { tags: ['public'], summary: 'Commandes de ce téléphone pour cette table (suivi)', params: tokenParams, querystring: z.object({ clientToken: clientTokenSchema }), response: { 200: z.array(publicOrderSchema) } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return listClientOrders(ctx, request.params.token, request.query.clientToken);
      },
    );

    app.post(
      '/public/menu/:token/requests',
      { schema: { tags: ['public'], summary: "Appeler un serveur, demander l'addition ou de l'aide", params: tokenParams, body: serviceRequestInputSchema, response: { 201: serviceRequestSchema } } },
      async (request, reply) => {
        const created = await createServiceRequest(ctx, request.params.token, request.body);
        reply.code(201);
        return created;
      },
    );
  };
}

/** Côté personnel. */
export function orderRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const location = z.object({ locationId: z.uuid() });

    app.get(
      '/locations/:locationId/orders',
      { schema: { tags: ['orders'], summary: 'Commandes en cours, ou toutes celles de la journée', security, params: location, querystring: z.object({ view: z.enum(['active', 'today']).default('active') }), response: { 200: z.array(orderSchema) } } },
      async (request) => listOrders(ctx, requireTenant(request.auth, 'orders.read'), request.params.locationId, request.query.view),
    );

    app.get(
      '/locations/:locationId/activity',
      { schema: { tags: ['orders'], summary: "Flux d'activité (commandes, appels) depuis un curseur", security, params: location, querystring: z.object({ since: z.coerce.number().int().min(0).default(0) }), response: { 200: activitySchema } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return getActivity(ctx, requireTenant(request.auth, 'orders.read'), request.params.locationId, request.query.since);
      },
    );

    app.post(
      '/orders/:orderId/status',
      { schema: { tags: ['orders'], summary: 'Faire avancer, confirmer ou annuler une commande', security, params: z.object({ orderId: z.uuid() }), body: updateOrderStatusSchema, response: { 200: orderSchema } } },
      async (request) => updateOrderStatus(ctx, request.auth, request.params.orderId, request.body.status, request.body.reason, requestMeta(request)),
    );

    app.get(
      '/locations/:locationId/requests',
      { schema: { tags: ['orders'], summary: 'Appels en attente (serveur, addition, aide)', security, params: location, response: { 200: z.array(serviceRequestSchema) } } },
      async (request) => listOpenRequests(ctx, requireTenant(request.auth, 'orders.read'), request.params.locationId),
    );

    app.post(
      '/requests/:requestId/resolve',
      { schema: { tags: ['orders'], summary: 'Marquer un appel comme traité', security, params: z.object({ requestId: z.uuid() }), response: { 200: serviceRequestSchema } } },
      async (request) => resolveServiceRequest(ctx, requireTenant(request.auth, 'orders.create'), request.params.requestId),
    );

    app.post(
      '/table-sessions/:sessionId/close',
      { schema: { tags: ['orders'], summary: 'Libérer une table (toutes ses commandes terminées)', security, params: z.object({ sessionId: z.uuid() }) } },
      async (request, reply) => {
        await closeTableSession(ctx, requireTenant(request.auth, 'orders.create'), request.params.sessionId, requestMeta(request));
        return reply.code(204).send();
      },
    );
  };
}
