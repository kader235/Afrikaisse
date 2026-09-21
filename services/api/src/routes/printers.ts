import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createPrinterSchema, printAckSchema, printerSchema, printJobSchema, printQueueItemSchema, updatePrinterSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import { ackPrintJob, archivePrinter, createPrinter, listPrinters, listPrintJobs, printReceipt, pullPrintQueue, retryPrintJob, testPrinter, updatePrinter } from '../services/printing.ts';

/** Imprimantes réseau, file d'impression, impression des reçus. */
export function printerRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const security = [{ bearer: [] }];
    const tags = ['printing'];
    const location = z.object({ locationId: z.uuid() });
    const printer = z.object({ printerId: z.uuid() });

    app.get(
      '/locations/:locationId/printers',
      { schema: { tags, summary: "Imprimantes de l'établissement", security, params: location, response: { 200: z.array(printerSchema) } } },
      async (request) => listPrinters(ctx, requireTenant(request.auth, 'orders.read'), request.params.locationId),
    );

    app.post(
      '/locations/:locationId/printers',
      { schema: { tags, summary: 'Ajouter une imprimante réseau (ESC/POS, port 9100)', security, params: location, body: createPrinterSchema, response: { 201: printerSchema } } },
      async (request, reply) => {
        const created = await createPrinter(ctx, requireTenant(request.auth, 'devices.manage'), request.params.locationId, request.body, requestMeta(request));
        reply.code(201);
        return created;
      },
    );

    app.patch(
      '/printers/:printerId',
      { schema: { tags, summary: 'Modifier une imprimante', security, params: printer, body: updatePrinterSchema, response: { 200: printerSchema } } },
      async (request) => updatePrinter(ctx, requireTenant(request.auth, 'devices.manage'), request.params.printerId, request.body, requestMeta(request)),
    );

    app.post(
      '/printers/:printerId/archive',
      { schema: { tags, summary: 'Retirer une imprimante', security, params: printer } },
      async (request, reply) => {
        await archivePrinter(ctx, requireTenant(request.auth, 'devices.manage'), request.params.printerId, requestMeta(request));
        return reply.code(204).send();
      },
    );

    app.post(
      '/printers/:printerId/test',
      { schema: { tags, summary: "Imprimer un ticket de test (résultat dans lastOkAt / lastError)", security, params: printer, response: { 200: printerSchema } } },
      async (request) => testPrinter(ctx, requireTenant(request.auth, 'devices.manage'), request.params.printerId),
    );

    app.get(
      '/locations/:locationId/print-jobs',
      { schema: { tags, summary: "50 derniers travaux d'impression", security, params: location, response: { 200: z.array(printJobSchema) } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return listPrintJobs(ctx, requireTenant(request.auth, 'devices.manage'), request.params.locationId);
      },
    );

    // Impression depuis la tablette (restaurant sans PC) : elle vient chercher les tickets déjà
    // fabriqués, les envoie elle-même (Bluetooth ou Wi-Fi), puis accuse réception de chacun.
    app.get(
      '/locations/:locationId/print-queue',
      { schema: { tags, summary: 'Tickets à imprimer par cet appareil (imprimantes « appareil »)', security, params: location, response: { 200: z.array(printQueueItemSchema) } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return pullPrintQueue(ctx, requireTenant(request.auth, 'orders.read'), request.params.locationId);
      },
    );

    app.post(
      '/print-jobs/:jobId/ack',
      { schema: { tags, summary: "Accuser réception d'un ticket imprimé par l'appareil (réussi ou en échec)", security, params: z.object({ jobId: z.uuid() }), body: printAckSchema } },
      async (request, reply) => {
        await ackPrintJob(ctx, requireTenant(request.auth, 'orders.read'), request.params.jobId, request.body);
        return reply.code(204).send();
      },
    );

    app.post(
      '/print-jobs/:jobId/retry',
      { schema: { tags, summary: "Relancer un travail d'impression en échec", security, params: z.object({ jobId: z.uuid() }), response: { 200: printJobSchema } } },
      async (request) => retryPrintJob(ctx, requireTenant(request.auth, 'devices.manage'), request.params.jobId),
    );

    app.post(
      '/payments/:paymentId/print',
      { schema: { tags, summary: 'Imprimer le reçu sur les imprimantes de reçus', security, params: z.object({ paymentId: z.uuid() }), response: { 200: z.object({ jobs: z.number() }) } } },
      async (request) => printReceipt(ctx, requireTenant(request.auth, 'payments.collect'), request.params.paymentId),
    );
  };
}
