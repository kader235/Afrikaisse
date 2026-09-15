import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  pricingConfigSchema,
  pricingSettingsInputSchema,
  promoCodeCheckSchema,
  promotionActiveSchema,
  promotionInputSchema,
  promotionRuleSchema,
  publicPricingSchema,
  quoteInputSchema,
  quoteSchema,
  taxOverrideSchema,
  taxRateInputSchema,
  updateTaxRateSchema,
} from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import {
  archivePromotion,
  archiveTaxRate,
  checkPublicPromoCode,
  checkStaffPromoCode,
  createPromotion,
  createTaxRate,
  getPricingConfig,
  getPublicPricing,
  quotePublicOrder,
  quoteStaffOrder,
  setPromotionActive,
  setTaxOverride,
  updatePricingSettings,
  updatePromotion,
  updateTaxRate,
} from '../services/pricing.ts';

const security = [{ bearer: [] }];
const tags = ['pricing'];
const config = { 200: pricingConfigSchema };

/** Taxes et promotions : configuration (gérant), devis et contrôle de code (caisse). */
export function pricingRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const location = z.object({ locationId: z.uuid() });
    const rate = z.object({ taxRateId: z.uuid() });
    const promotion = z.object({ promotionId: z.uuid() });

    app.get('/locations/:locationId/pricing', { schema: { tags, summary: 'Taxes, promotions et taux par catégorie et produit', security, params: location, response: config } }, async (request) =>
      getPricingConfig(ctx, requireTenant(request.auth, 'menu.read'), request.params.locationId),
    );
    app.patch('/locations/:locationId/pricing', { schema: { tags, summary: 'Mode de taxe (TVA incluse ou hors taxe) et taux par défaut', security, params: location, body: pricingSettingsInputSchema, response: config } }, async (request) =>
      updatePricingSettings(ctx, requireTenant(request.auth, 'menu.manage'), request.params.locationId, request.body, requestMeta(request)),
    );

    app.post('/locations/:locationId/tax-rates', { schema: { tags, summary: 'Créer un taux de taxe (points de base : 1800 = 18 %)', security, params: location, body: taxRateInputSchema, response: { 201: pricingConfigSchema } } }, async (request, reply) => {
      const result = await createTaxRate(ctx, requireTenant(request.auth, 'menu.manage'), request.params.locationId, request.body, requestMeta(request));
      reply.code(201);
      return result;
    });
    app.patch('/tax-rates/:taxRateId', { schema: { tags, summary: 'Modifier un taux (les commandes passées gardent l’ancien)', security, params: rate, body: updateTaxRateSchema, response: config } }, async (request) =>
      updateTaxRate(ctx, requireTenant(request.auth, 'menu.manage'), request.params.taxRateId, request.body, requestMeta(request)),
    );
    app.post('/tax-rates/:taxRateId/archive', { schema: { tags, summary: 'Archiver un taux inutilisé', security, params: rate, response: config } }, async (request) =>
      archiveTaxRate(ctx, requireTenant(request.auth, 'menu.manage'), request.params.taxRateId, requestMeta(request)),
    );
    app.put('/categories/:categoryId/tax-rate', { schema: { tags, summary: 'Taux propre à une catégorie (null : taux par défaut)', security, params: z.object({ categoryId: z.uuid() }), body: taxOverrideSchema, response: config } }, async (request) =>
      setTaxOverride(ctx, requireTenant(request.auth, 'menu.manage'), 'category', request.params.categoryId, request.body.taxRateId, requestMeta(request)),
    );
    app.put('/products/:productId/tax-rate', { schema: { tags, summary: 'Taux propre à un produit (null : taux de sa catégorie)', security, params: z.object({ productId: z.uuid() }), body: taxOverrideSchema, response: config } }, async (request) =>
      setTaxOverride(ctx, requireTenant(request.auth, 'menu.manage'), 'product', request.params.productId, request.body.taxRateId, requestMeta(request)),
    );

    app.post('/locations/:locationId/promotions', { schema: { tags, summary: 'Créer une promotion', security, params: location, body: promotionInputSchema, response: { 201: pricingConfigSchema } } }, async (request, reply) => {
      const result = await createPromotion(ctx, requireTenant(request.auth, 'menu.manage'), request.params.locationId, request.body, requestMeta(request));
      reply.code(201);
      return result;
    });
    app.put('/promotions/:promotionId', { schema: { tags, summary: 'Remplacer les règles d’une promotion', security, params: promotion, body: promotionInputSchema, response: config } }, async (request) =>
      updatePromotion(ctx, requireTenant(request.auth, 'menu.manage'), request.params.promotionId, request.body, requestMeta(request)),
    );
    app.post('/promotions/:promotionId/active', { schema: { tags, summary: 'Suspendre ou reprendre une promotion', security, params: promotion, body: promotionActiveSchema, response: config } }, async (request) =>
      setPromotionActive(ctx, requireTenant(request.auth, 'menu.manage'), request.params.promotionId, request.body.isActive, requestMeta(request)),
    );
    app.post('/promotions/:promotionId/archive', { schema: { tags, summary: 'Archiver une promotion (son code se libère)', security, params: promotion, response: config } }, async (request) =>
      archivePromotion(ctx, requireTenant(request.auth, 'menu.manage'), request.params.promotionId, requestMeta(request)),
    );

    app.post('/locations/:locationId/orders/quote', { schema: { tags, summary: 'Calculer un ticket (promotions, code, taxes) sans l’enregistrer', security, params: location, body: quoteInputSchema, response: { 200: quoteSchema } } }, async (request) =>
      quoteStaffOrder(ctx, requireTenant(request.auth, 'orders.create'), request.params.locationId, request.body),
    );
    app.post('/locations/:locationId/promo-codes/check', { schema: { tags, summary: 'Vérifier un code promo saisi en caisse', security, params: location, body: promoCodeCheckSchema, response: { 200: promotionRuleSchema } } }, async (request) =>
      checkStaffPromoCode(ctx, requireTenant(request.auth, 'orders.create'), request.params.locationId, request.body.code),
    );
  };
}

/** Menu client (sans compte) : promotions et taxes à afficher, code promo, devis du panier. */
export function publicPricingRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    const token = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });

    app.get('/public/menu/:token/pricing', { schema: { tags: ['public'], summary: 'Promotions automatiques et taxes du menu client', params: token, response: { 200: publicPricingSchema } } }, async (request, reply) => {
      reply.header('cache-control', 'no-store');
      return getPublicPricing(ctx, request.params.token);
    });
    app.post('/public/menu/:token/promo-code', { schema: { tags: ['public'], summary: 'Vérifier un code promo du panier', params: token, body: promoCodeCheckSchema, response: { 200: promotionRuleSchema } } }, async (request, reply) => {
      reply.header('cache-control', 'no-store');
      return checkPublicPromoCode(ctx, request.params.token, request.body.code);
    });
    app.post('/public/menu/:token/quote', { schema: { tags: ['public'], summary: 'Calculer le panier (prix, promotions, taxes) comme le fera la commande', params: token, body: quoteInputSchema, response: { 200: quoteSchema } } }, async (request, reply) => {
      reply.header('cache-control', 'no-store');
      return quotePublicOrder(ctx, request.params.token, request.body);
    });
  };
}
