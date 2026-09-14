import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  adminMenuSchema,
  availabilitySchema,
  createCategorySchema,
  createModifierGroupSchema,
  createProductSchema,
  mediaSchema,
  reorderSchema,
  publicMenuSchema,
  qrListSchema,
  updateCategorySchema,
  updateModifierGroupSchema,
  updateProductSchema,
  uploadMediaSchema,
} from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import {
  archiveCategory,
  archiveModifierGroup,
  archiveProduct,
  createCategory,
  createModifierGroup,
  createProduct,
  getAdminMenu,
  getPublicMenu,
  readMedia,
  reorderCategories,
  reorderProducts,
  setModifierAvailability,
  setProductAvailability,
  updateCategory,
  updateModifierGroup,
  updateProduct,
  uploadMedia,
} from '../services/menu.ts';
import { listQrCodes, regenerateQrCode } from '../services/qr.ts';

const security = [{ bearer: [] }];
const id = (name: string) => z.object({ [name]: z.uuid() });
const menu = { 200: adminMenuSchema };

export function menuRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const params = {
      location: z.object({ locationId: z.uuid() }),
      category: z.object({ categoryId: z.uuid() }),
      product: z.object({ productId: z.uuid() }),
      group: z.object({ groupId: z.uuid() }),
      modifier: z.object({ modifierId: z.uuid() }),
      table: z.object({ tableId: z.uuid() }),
    };

    app.get('/locations/:locationId/menu', { schema: { tags: ['menu'], summary: "Menu complet d'un établissement (gestion)", security, params: params.location, response: menu } }, async (request) =>
      getAdminMenu(ctx, requireTenant(request.auth, 'menu.read'), request.params.locationId),
    );

    // Catégories
    app.post('/locations/:locationId/categories', { schema: { tags: ['menu'], summary: 'Créer une catégorie', security, params: params.location, body: createCategorySchema, response: { 201: adminMenuSchema } } }, async (request, reply) => {
      const result = await createCategory(ctx, requireTenant(request.auth, 'menu.manage'), request.params.locationId, request.body, requestMeta(request));
      reply.code(201);
      return result;
    });
    app.put('/locations/:locationId/categories/order', { schema: { tags: ['menu'], summary: 'Réordonner les catégories', security, params: params.location, body: reorderSchema, response: menu } }, async (request) =>
      reorderCategories(ctx, requireTenant(request.auth, 'menu.manage'), request.params.locationId, request.body.ids, requestMeta(request)),
    );
    app.patch('/categories/:categoryId', { schema: { tags: ['menu'], summary: 'Renommer, masquer ou afficher une catégorie', security, params: params.category, body: updateCategorySchema, response: menu } }, async (request) =>
      updateCategory(ctx, requireTenant(request.auth, 'menu.manage'), request.params.categoryId, request.body, requestMeta(request)),
    );
    app.post('/categories/:categoryId/archive', { schema: { tags: ['menu'], summary: 'Archiver une catégorie vide', security, params: params.category, response: menu } }, async (request) =>
      archiveCategory(ctx, requireTenant(request.auth, 'menu.manage'), request.params.categoryId, requestMeta(request)),
    );
    app.put('/categories/:categoryId/products/order', { schema: { tags: ['menu'], summary: "Réordonner les produits d'une catégorie", security, params: params.category, body: reorderSchema, response: menu } }, async (request) =>
      reorderProducts(ctx, requireTenant(request.auth, 'menu.manage'), request.params.categoryId, request.body.ids, requestMeta(request)),
    );

    // Produits
    app.post('/categories/:categoryId/products', { schema: { tags: ['menu'], summary: 'Créer un produit (variantes et options comprises)', security, params: params.category, body: createProductSchema, response: { 201: adminMenuSchema } } }, async (request, reply) => {
      const result = await createProduct(ctx, requireTenant(request.auth, 'menu.manage'), request.params.categoryId, request.body, requestMeta(request));
      reply.code(201);
      return result;
    });
    app.patch('/products/:productId', { schema: { tags: ['menu'], summary: 'Modifier un produit ; variantes et options remplacées si transmises', security, params: params.product, body: updateProductSchema, response: menu } }, async (request) =>
      updateProduct(ctx, requireTenant(request.auth, 'menu.manage'), request.params.productId, request.body, requestMeta(request)),
    );
    app.post('/products/:productId/archive', { schema: { tags: ['menu'], summary: 'Archiver un produit', security, params: params.product, response: menu } }, async (request) =>
      archiveProduct(ctx, requireTenant(request.auth, 'menu.manage'), request.params.productId, requestMeta(request)),
    );
    app.post('/products/:productId/availability', { schema: { tags: ['menu'], summary: 'Disponible / épuisé (pendant le service)', security, params: params.product, body: availabilitySchema, response: menu } }, async (request) =>
      setProductAvailability(ctx, requireTenant(request.auth, 'menu.availability'), request.params.productId, request.body.isAvailable, requestMeta(request)),
    );

    // Groupes d'options
    app.post('/locations/:locationId/modifier-groups', { schema: { tags: ['menu'], summary: "Créer un groupe d'options", security, params: params.location, body: createModifierGroupSchema, response: { 201: adminMenuSchema } } }, async (request, reply) => {
      const result = await createModifierGroup(ctx, requireTenant(request.auth, 'menu.manage'), request.params.locationId, request.body, requestMeta(request));
      reply.code(201);
      return result;
    });
    app.patch('/modifier-groups/:groupId', { schema: { tags: ['menu'], summary: "Modifier un groupe d'options ; options remplacées si transmises", security, params: params.group, body: updateModifierGroupSchema, response: menu } }, async (request) =>
      updateModifierGroup(ctx, requireTenant(request.auth, 'menu.manage'), request.params.groupId, request.body, requestMeta(request)),
    );
    app.post('/modifier-groups/:groupId/archive', { schema: { tags: ['menu'], summary: "Archiver un groupe d'options inutilisé", security, params: params.group, response: menu } }, async (request) =>
      archiveModifierGroup(ctx, requireTenant(request.auth, 'menu.manage'), request.params.groupId, requestMeta(request)),
    );
    app.post('/modifiers/:modifierId/availability', { schema: { tags: ['menu'], summary: 'Option disponible / épuisée', security, params: params.modifier, body: availabilitySchema, response: menu } }, async (request) =>
      setModifierAvailability(ctx, requireTenant(request.auth, 'menu.availability'), request.params.modifierId, request.body.isAvailable, requestMeta(request)),
    );

    // Photos (base64 : compatible navigateur et HTTP natif de la tablette)
    app.post(
      '/locations/:locationId/media',
      { bodyLimit: 1_200_000, schema: { tags: ['menu'], summary: 'Téléverser une photo compressée (JPEG, PNG, WebP, 800 Ko max)', security, params: params.location, body: uploadMediaSchema, response: { 201: mediaSchema } } },
      async (request, reply) => {
        const media = await uploadMedia(ctx, requireTenant(request.auth, 'menu.manage'), request.params.locationId, request.body, requestMeta(request));
        reply.code(201);
        return media;
      },
    );

    // QR des tables
    app.get('/locations/:locationId/qr-codes', { schema: { tags: ['floor'], summary: 'QR codes des tables actives', security, params: params.location, response: { 200: qrListSchema } } }, async (request) =>
      listQrCodes(ctx, requireTenant(request.auth, 'tables.read'), request.params.locationId, request.headers.origin),
    );
    app.post('/tables/:tableId/qr/regenerate', { schema: { tags: ['floor'], summary: "Régénérer le QR d'une table (l'ancien cesse de fonctionner)", security, params: params.table } }, async (request, reply) => {
      await regenerateQrCode(ctx, requireTenant(request.auth, 'tables.manage'), request.params.tableId, requestMeta(request));
      return reply.code(204).send();
    });
  };
}

/** Routes publiques, sans session : menu lu par QR et photos du menu. */
export function publicRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/public/menu/:token',
      { schema: { tags: ['public'], summary: 'Menu client ouvert par le QR d’une table', params: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }), response: { 200: publicMenuSchema } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return getPublicMenu(ctx, request.params.token);
      },
    );

    app.get('/media/:mediaId', { schema: { tags: ['public'], summary: 'Photo du menu (immuable)', params: id('mediaId') } }, async (request, reply) => {
      const media = await readMedia(ctx, (request.params as { mediaId: string }).mediaId);
      if (!media) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Photo introuvable.' } });
      const etag = `"${media.sha256}"`;
      // Une nouvelle photo a un nouvel identifiant : celle-ci ne change jamais.
      reply.header('cache-control', 'public, max-age=31536000, immutable').header('etag', etag).header('cross-origin-resource-policy', 'cross-origin');
      if (request.headers['if-none-match'] === etag) return reply.code(304).send();
      return reply.type(media.contentType).send(media.bytes);
    });
  };
}
