import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { kitchenProblemSchema, notificationFeedSchema, pushTokenSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import { listNotifications, markAllNotificationsRead, markNotificationRead, registerPushToken, reportKitchenProblem, unregisterPushToken } from '../services/notifications.ts';

const security = [{ bearer: [] }];
const tags = ['notifications'];

/** Centre de notifications (interrogation régulière, sans WebSocket) et problème signalé par la cuisine. */
export function notificationRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const location = z.object({ locationId: z.uuid() });

    app.get(
      '/locations/:locationId/notifications',
      {
        schema: {
          tags,
          summary: 'Notifications visibles par ce rôle depuis un curseur (liste complète si since=0), avec le nombre de non lues',
          security,
          params: location,
          querystring: z.object({ since: z.coerce.number().int().min(0).default(0) }),
          response: { 200: notificationFeedSchema },
        },
      },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return listNotifications(ctx, requireTenant(request.auth), request.params.locationId, request.query.since);
      },
    );

    app.post(
      '/locations/:locationId/push-tokens',
      { schema: { tags, summary: 'Enregistrer le token FCM de cette tablette', security, params: location, body: pushTokenSchema } },
      async (request, reply) => {
        await registerPushToken(ctx, requireTenant(request.auth), request.params.locationId, request.body.token);
        return reply.code(204).send();
      },
    );

    app.post(
      '/push-tokens/remove',
      { schema: { tags, summary: "Retirer le token FCM de cette tablette (déconnexion) : elle ne reçoit plus d'alertes", security, body: pushTokenSchema } },
      async (request, reply) => {
        await unregisterPushToken(ctx, requireTenant(request.auth), request.body.token);
        return reply.code(204).send();
      },
    );

    app.post(
      '/notifications/:notificationId/read',
      { schema: { tags, summary: 'Marquer une notification comme lue', security, params: z.object({ notificationId: z.uuid() }) } },
      async (request, reply) => {
        await markNotificationRead(ctx, requireTenant(request.auth), request.params.notificationId);
        return reply.code(204).send();
      },
    );

    app.post(
      '/locations/:locationId/notifications/read-all',
      {
        schema: {
          tags,
          summary: 'Tout marquer lu jusqu’au curseur affiché',
          security,
          params: location,
          body: z.object({ upTo: z.number().int().min(0).optional() }).optional(),
          response: { 200: z.object({ unread: z.number() }) },
        },
      },
      async (request) => markAllNotificationsRead(ctx, requireTenant(request.auth), request.params.locationId, request.body?.upTo),
    );

    app.post(
      '/orders/:orderId/kitchen/problem',
      { schema: { tags: ['kitchen'], summary: 'Écran cuisine : signaler un problème sur un ticket (prévient la salle et la caisse)', security, params: z.object({ orderId: z.uuid() }), body: kitchenProblemSchema } },
      async (request, reply) => {
        await reportKitchenProblem(ctx, request.auth, request.params.orderId, request.body, requestMeta(request));
        return reply.code(204).send();
      },
    );
  };
}
