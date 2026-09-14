import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  cashMovementSchema,
  cashSessionListSchema,
  cashSessionSchema,
  checkSchema,
  closeCashSessionSchema,
  createStaffOrderSchema,
  currentCashSessionSchema,
  discountSchema,
  openCashSessionSchema,
  orderSchema,
  paymentSchema,
  receiptSchema,
  recordPaymentSchema,
  transferTableSchema,
  voidPaymentSchema,
} from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import {
  addCashMovement,
  closeCashSession,
  createStaffOrder,
  getCashSession,
  getCurrentCashSession,
  getReceipt,
  listCashSessions,
  listChecks,
  openCashSession,
  recordPayment,
  setDiscount,
  transferTable,
  voidPayment,
} from '../services/pos.ts';

const security = [{ bearer: [] }];
const tags = ['pos'];

/** Caisse : prise de commande, remises, encaissement, sessions de caisse. */
export function posRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const location = z.object({ locationId: z.uuid() });
    const cashSession = z.object({ sessionId: z.uuid() });

    app.post(
      '/locations/:locationId/orders',
      { schema: { tags, summary: 'Commande saisie par le personnel (confirmée d’emblée)', security, params: location, body: createStaffOrderSchema, response: { 201: orderSchema } } },
      async (request, reply) => {
        const order = await createStaffOrder(ctx, requireTenant(request.auth, 'orders.create'), request.params.locationId, request.body, requestMeta(request));
        reply.code(201);
        return order;
      },
    );

    app.post(
      '/orders/:orderId/discount',
      { schema: { tags, summary: 'Remise sur une commande (valeur 0 : retirer la remise)', security, params: z.object({ orderId: z.uuid() }), body: discountSchema, response: { 200: orderSchema } } },
      async (request) => setDiscount(ctx, requireTenant(request.auth, 'orders.discount'), request.params.orderId, request.body, requestMeta(request)),
    );

    app.get(
      '/locations/:locationId/checks',
      { schema: { tags, summary: 'Notes à encaisser : tables occupées et commandes sans table', security, params: location, response: { 200: z.array(checkSchema) } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return listChecks(ctx, requireTenant(request.auth, 'orders.read'), request.params.locationId);
      },
    );

    app.post(
      '/locations/:locationId/payments',
      { schema: { tags, summary: 'Encaisser (réparti sur les commandes, la plus ancienne d’abord) ; renvoie le reçu', security, params: location, body: recordPaymentSchema, response: { 201: receiptSchema } } },
      async (request, reply) => {
        const receipt = await recordPayment(ctx, requireTenant(request.auth, 'payments.collect'), request.params.locationId, request.body);
        reply.code(201);
        return receipt;
      },
    );

    app.get(
      '/payments/:paymentId/receipt',
      { schema: { tags, summary: 'Reçu d’un paiement', security, params: z.object({ paymentId: z.uuid() }), response: { 200: receiptSchema } } },
      async (request) => getReceipt(ctx, requireTenant(request.auth, 'payments.collect'), request.params.paymentId),
    );

    app.post(
      '/payments/:paymentId/void',
      { schema: { tags, summary: 'Annuler un paiement (caisse encore ouverte, motif obligatoire)', security, params: z.object({ paymentId: z.uuid() }), body: voidPaymentSchema, response: { 200: paymentSchema } } },
      async (request) => voidPayment(ctx, requireTenant(request.auth, 'payments.refund'), request.params.paymentId, request.body.reason, requestMeta(request)),
    );

    app.get(
      '/locations/:locationId/cash-session',
      { schema: { tags, summary: 'Caisse ouverte (rapport X en direct), ou null', security, params: location, response: { 200: currentCashSessionSchema } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return getCurrentCashSession(ctx, requireTenant(request.auth, 'payments.collect'), request.params.locationId);
      },
    );

    app.get(
      '/locations/:locationId/cash-sessions',
      { schema: { tags, summary: 'Historique des sessions de caisse', security, params: location, response: { 200: cashSessionListSchema } } },
      async (request) => listCashSessions(ctx, requireTenant(request.auth, 'payments.collect'), request.params.locationId),
    );

    app.post(
      '/locations/:locationId/cash-sessions',
      { schema: { tags, summary: 'Ouvrir la caisse avec son fond', security, params: location, body: openCashSessionSchema, response: { 201: cashSessionSchema } } },
      async (request, reply) => {
        const session = await openCashSession(ctx, requireTenant(request.auth, 'payments.collect'), request.params.locationId, request.body, requestMeta(request));
        reply.code(201);
        return session;
      },
    );

    app.get(
      '/cash-sessions/:sessionId',
      { schema: { tags, summary: 'Détail d’une session de caisse (paiements, mouvements, rapport)', security, params: cashSession, response: { 200: cashSessionSchema } } },
      async (request) => getCashSession(ctx, requireTenant(request.auth, 'payments.collect'), request.params.sessionId),
    );

    app.post(
      '/cash-sessions/:sessionId/movements',
      { schema: { tags, summary: 'Entrée ou sortie d’espèces hors vente', security, params: cashSession, body: cashMovementSchema, response: { 200: cashSessionSchema } } },
      async (request) => addCashMovement(ctx, requireTenant(request.auth, 'payments.collect'), request.params.sessionId, request.body, requestMeta(request)),
    );

    app.post(
      '/cash-sessions/:sessionId/close',
      { schema: { tags, summary: 'Clôturer la caisse (Z) avec les espèces comptées', security, params: cashSession, body: closeCashSessionSchema, response: { 200: cashSessionSchema } } },
      async (request) => closeCashSession(ctx, requireTenant(request.auth, 'payments.collect'), request.params.sessionId, request.body, requestMeta(request)),
    );

    app.post(
      '/table-sessions/:sessionId/transfer',
      { schema: { tags, summary: 'Changer de table ; vers une table occupée, les additions sont regroupées', security, params: cashSession, body: transferTableSchema } },
      async (request, reply) => {
        await transferTable(ctx, requireTenant(request.auth, 'orders.create'), request.params.sessionId, request.body.tableId, requestMeta(request));
        return reply.code(204).send();
      },
    );
  };
}
