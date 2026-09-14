import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createInventoryItemSchema,
  inventoryItemSchema,
  recipeInputSchema,
  recipeSchema,
  stockMovementInputSchema,
  stockMovementSchema,
  updateInventoryItemSchema,
} from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import {
  addStockMovement,
  archiveInventoryItem,
  createInventoryItem,
  getRecipe,
  listInventory,
  listStockMovements,
  setRecipe,
  updateInventoryItem,
} from '../services/stock.ts';

/** Stock : articles, mouvements, recettes. */
export function stockRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const security = [{ bearer: [] }];
    const tags = ['stock'];
    const item = z.object({ itemId: z.uuid() });
    const product = z.object({ productId: z.uuid() });

    app.get(
      '/locations/:locationId/inventory',
      { schema: { tags, summary: 'Articles de stock avec niveau, seuil, valeur et état', security, params: z.object({ locationId: z.uuid() }), response: { 200: z.array(inventoryItemSchema) } } },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return listInventory(ctx, requireTenant(request.auth, 'inventory.read'), request.params.locationId);
      },
    );

    app.post(
      '/locations/:locationId/inventory',
      { schema: { tags, summary: 'Créer un article de stock', security, params: z.object({ locationId: z.uuid() }), body: createInventoryItemSchema, response: { 201: inventoryItemSchema } } },
      async (request, reply) => {
        const created = await createInventoryItem(ctx, requireTenant(request.auth, 'inventory.manage'), request.params.locationId, request.body, requestMeta(request));
        reply.code(201);
        return created;
      },
    );

    app.patch(
      '/inventory/:itemId',
      { schema: { tags, summary: 'Modifier un article (nom, unité, seuil, coût)', security, params: item, body: updateInventoryItemSchema, response: { 200: inventoryItemSchema } } },
      async (request) => updateInventoryItem(ctx, requireTenant(request.auth, 'inventory.manage'), request.params.itemId, request.body, requestMeta(request)),
    );

    app.post(
      '/inventory/:itemId/archive',
      { schema: { tags, summary: "Archiver un article qui n'entre dans aucune recette", security, params: item } },
      async (request, reply) => {
        await archiveInventoryItem(ctx, requireTenant(request.auth, 'inventory.manage'), request.params.itemId, requestMeta(request));
        return reply.code(204).send();
      },
    );

    app.post(
      '/inventory/:itemId/movements',
      { schema: { tags, summary: 'Réception, sortie, perte (motif) ou inventaire compté', security, params: item, body: stockMovementInputSchema, response: { 200: inventoryItemSchema } } },
      async (request) => addStockMovement(ctx, requireTenant(request.auth, 'inventory.manage'), request.params.itemId, request.body, requestMeta(request)),
    );

    app.get(
      '/inventory/:itemId/movements',
      { schema: { tags, summary: '100 derniers mouvements', security, params: item, response: { 200: z.array(stockMovementSchema) } } },
      async (request) => listStockMovements(ctx, requireTenant(request.auth, 'inventory.read'), request.params.itemId),
    );

    app.get(
      '/products/:productId/recipe',
      { schema: { tags, summary: "Recette d'un produit", security, params: product, response: { 200: recipeSchema } } },
      async (request) => getRecipe(ctx, requireTenant(request.auth, 'inventory.read'), request.params.productId),
    );

    app.put(
      '/products/:productId/recipe',
      { schema: { tags, summary: "Remplacer la recette d'un produit", security, params: product, body: recipeInputSchema, response: { 200: recipeSchema } } },
      async (request) => setRecipe(ctx, requireTenant(request.auth, 'inventory.manage'), request.params.productId, request.body, requestMeta(request)),
    );
  };
}
