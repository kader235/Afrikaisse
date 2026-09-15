import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { announcementInputSchema, announcementPublishedSchema, announcementSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import { archiveAnnouncement, createAnnouncement, listAnnouncements, setAnnouncementPublished, updateAnnouncement } from '../services/announcements.ts';

/** Annonces du menu client : lecture par l'équipe, gestion par qui gère le menu. */
export function announcementRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const tags = ['menu'];
    const security = [{ bearer: [] }];
    const location = z.object({ locationId: z.uuid() });
    const one = z.object({ announcementId: z.uuid() });
    const list = z.array(announcementSchema);

    app.get('/locations/:locationId/announcements', { schema: { tags, summary: 'Annonces du menu client', security, params: location, response: { 200: list } } }, async (request) =>
      listAnnouncements(ctx, requireTenant(request.auth, 'menu.read'), request.params.locationId),
    );

    app.post(
      '/locations/:locationId/announcements',
      { schema: { tags, summary: 'Créer une annonce', security, params: location, body: announcementInputSchema, response: { 201: list } } },
      async (request, reply) => {
        const result = await createAnnouncement(ctx, requireTenant(request.auth, 'menu.manage'), request.params.locationId, request.body, requestMeta(request));
        reply.code(201);
        return result;
      },
    );

    app.put('/announcements/:announcementId', { schema: { tags, summary: 'Modifier une annonce', security, params: one, body: announcementInputSchema, response: { 200: list } } }, async (request) =>
      updateAnnouncement(ctx, requireTenant(request.auth, 'menu.manage'), request.params.announcementId, request.body, requestMeta(request)),
    );

    app.post(
      '/announcements/:announcementId/published',
      { schema: { tags, summary: 'Publier ou retirer une annonce', security, params: one, body: announcementPublishedSchema, response: { 200: list } } },
      async (request) => setAnnouncementPublished(ctx, requireTenant(request.auth, 'menu.manage'), request.params.announcementId, request.body.isPublished, requestMeta(request)),
    );

    app.post('/announcements/:announcementId/archive', { schema: { tags, summary: 'Archiver une annonce', security, params: one, response: { 200: list } } }, async (request) =>
      archiveAnnouncement(ctx, requireTenant(request.auth, 'menu.manage'), request.params.announcementId, requestMeta(request)),
    );
  };
}
