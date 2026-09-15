import { z } from 'zod';
import { CURRENCY_CODES } from './currency.ts';
import { MONEY_MAX } from './money.ts';
import { appliedPromotionSchema, orderLineInputSchema, taxLineSchema } from './orders.ts';
import { PROMOTION_KINDS, PROMOTION_SCOPES } from './promotions.ts';
import { BASIS_POINTS, TAX_MODES } from './taxes.ts';

/**
 * Taxes et promotions (§47-48) : entrées et réponses de l'API. Les calculs sont dans taxes.ts et
 * promotions.ts (sans Zod, partagés avec la caisse et le menu client).
 */

const nonEmpty = (v: object) => Object.keys(v).length > 0;
const NO_CHANGE = { message: 'Aucune modification demandée' };
const money = z.number().int().min(0).max(MONEY_MAX);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const minute = z.number().int().min(0).max(1439);
const rateBp = z.number().int().min(0).max(BASIS_POINTS);

/** Code promo défini par le gérant : 3 à 20 caractères, rangé en majuscules. */
export const promoCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{3,20}$/, 'Code promo : 3 à 20 lettres sans accent, chiffres ou tirets.')
  .transform((v) => v.toUpperCase());

/** Code saisi par un client ou un caissier : lu tel quel, comparé sans tenir compte de la casse. */
export const promoCodeInputSchema = z.string().trim().min(1, 'Saisissez le code promo.').max(30);

// --- Entrées ----------------------------------------------------------------

export const taxRateInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  rateBp,
  /** true : devient le taux par défaut ; false : cesse de l'être. */
  isDefault: z.boolean().optional(),
});
export type TaxRateInput = z.infer<typeof taxRateInputSchema>;

export const updateTaxRateSchema = taxRateInputSchema.partial().refine(nonEmpty, NO_CHANGE);
export type UpdateTaxRateInput = z.infer<typeof updateTaxRateSchema>;

export const pricingSettingsInputSchema = z
  .object({ taxMode: z.enum(TAX_MODES), defaultTaxRateId: z.uuid().nullable() })
  .partial()
  .refine(nonEmpty, NO_CHANGE);
export type PricingSettingsInput = z.infer<typeof pricingSettingsInputSchema>;

/** Taux propre à une catégorie ou à un produit ; null : taux hérité. */
export const taxOverrideSchema = z.object({ taxRateId: z.uuid().nullable() });

export const promotionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(PROMOTION_KINDS),
    scope: z.enum(PROMOTION_SCOPES),
    targetId: z.uuid().nullable().default(null),
    /** PERCENT : points de base (1000 = 10 %) ; AMOUNT : unités mineures ; FREE_ITEM : 0. */
    value: z.number().int().min(0).max(MONEY_MAX).default(0),
    buyQuantity: z.number().int().min(1).max(99).nullable().default(null),
    freeQuantity: z.number().int().min(1).max(99).nullable().default(null),
    minAmount: money.nullable().default(null),
    code: promoCodeSchema.nullable().default(null),
    startDate: day.nullable().default(null),
    endDate: day.nullable().default(null),
    days: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    startMinute: minute.nullable().default(null),
    endMinute: minute.nullable().default(null),
    maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (p.kind === 'PERCENT' && (p.value < 1 || p.value > BASIS_POINTS)) issue('value', 'Pourcentage entre 0,01 % et 100 %.');
    if (p.kind === 'AMOUNT' && p.value < 1) issue('value', 'Indiquez le montant de la remise.');
    if (p.kind === 'FREE_ITEM') {
      if (p.scope === 'ORDER') issue('scope', 'Un article offert vise un produit ou une catégorie.');
      if (p.buyQuantity === null || p.freeQuantity === null) issue('buyQuantity', 'Indiquez les quantités achetée et offerte.');
      if (p.value !== 0) issue('value', 'Un article offert n’a pas de montant.');
    } else if (p.buyQuantity !== null || p.freeQuantity !== null) {
      issue('buyQuantity', 'Quantités réservées aux articles offerts.');
    }
    if (p.scope === 'ORDER' && p.targetId !== null) issue('targetId', 'Une promotion de commande ne vise ni produit ni catégorie.');
    if (p.scope !== 'ORDER' && p.targetId === null) issue('targetId', 'Choisissez le produit ou la catégorie.');
    if (p.minAmount !== null && p.scope !== 'ORDER') issue('minAmount', 'Le montant minimal concerne les promotions de commande.');
    if (p.startDate && p.endDate && p.startDate > p.endDate) issue('endDate', 'La date de fin précède la date de début.');
    if ((p.startMinute === null) !== (p.endMinute === null)) issue('endMinute', 'Indiquez l’heure de début et l’heure de fin.');
    if (p.startMinute !== null && p.startMinute === p.endMinute) issue('endMinute', 'L’heure de fin doit différer de l’heure de début.');
    if (new Set(p.days).size !== p.days.length) issue('days', 'Un jour est cité deux fois.');
  });
export type PromotionInput = z.infer<typeof promotionInputSchema>;

export const promotionActiveSchema = z.object({ isActive: z.boolean() });

export const quoteInputSchema = z.object({
  lines: z.array(orderLineInputSchema).min(1, 'Le ticket est vide.').max(80),
  promoCode: promoCodeInputSchema.nullable().optional(),
});
export type QuoteInput = z.infer<typeof quoteInputSchema>;

export const promoCodeCheckSchema = z.object({ code: promoCodeInputSchema });

// --- Réponses ---------------------------------------------------------------

export const taxRateSchema = z.object({
  id: z.string(),
  name: z.string(),
  rateBp: z.number(),
  isDefault: z.boolean(),
  /** Catégories et produits qui l'utilisent explicitement. */
  overrides: z.number(),
});
export type TaxRate = z.infer<typeof taxRateSchema>;

/** Règle d'une promotion telle que la calcule `priceOrder` (menu client : sans compteur). */
export const promotionRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(PROMOTION_KINDS),
  scope: z.enum(PROMOTION_SCOPES),
  targetId: z.string().nullable(),
  value: z.number(),
  buyQuantity: z.number().nullable(),
  freeQuantity: z.number().nullable(),
  minAmount: z.number().nullable(),
  code: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  days: z.array(z.number()),
  startMinute: z.number().nullable(),
  endMinute: z.number().nullable(),
  isActive: z.boolean(),
});

export const promotionSchema = promotionRuleSchema.extend({
  locationId: z.string(),
  maxUses: z.number().nullable(),
  /** Commandes non annulées qui en ont bénéficié. */
  usesCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Promotion = z.infer<typeof promotionSchema>;

export const pricingConfigSchema = z.object({
  location: z.object({ id: z.string(), name: z.string(), currency: z.enum(CURRENCY_CODES), timezone: z.string() }),
  taxMode: z.enum(TAX_MODES),
  defaultTaxRateId: z.string().nullable(),
  taxRates: z.array(taxRateSchema),
  promotions: z.array(promotionSchema),
  categories: z.array(z.object({ id: z.string(), name: z.string(), taxRateId: z.string().nullable() })),
  products: z.array(z.object({ id: z.string(), name: z.string(), categoryId: z.string(), taxRateId: z.string().nullable(), promoPriced: z.boolean() })),
});
export type PricingConfig = z.infer<typeof pricingConfigSchema>;

/** Ce que le menu client doit savoir pour afficher promotions et taxes (promotions à code exclues). */
export const publicPricingSchema = z.object({
  timezone: z.string(),
  taxMode: z.enum(TAX_MODES),
  taxRates: z.array(z.object({ id: z.string(), name: z.string(), rateBp: z.number() })),
  /** Produit → taux applicable (déjà résolu : produit, catégorie, défaut). */
  productTaxRates: z.record(z.string(), z.string().nullable()),
  productCategories: z.record(z.string(), z.string()),
  promotions: z.array(promotionRuleSchema),
});
export type PublicPricing = z.infer<typeof publicPricingSchema>;

export const quoteSchema = z.object({
  currency: z.enum(CURRENCY_CODES),
  taxMode: z.enum(TAX_MODES),
  lines: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      variantName: z.string().nullable(),
      quantity: z.number(),
      unitPrice: z.number(),
      total: z.number(),
      promotionName: z.string().nullable(),
      promotionDiscount: z.number(),
      codeDiscount: z.number(),
    }),
  ),
  subtotal: z.number(),
  promotionDiscount: z.number(),
  promotions: z.array(appliedPromotionSchema),
  promoCode: z.string().nullable(),
  taxes: z.array(taxLineSchema),
  taxTotal: z.number(),
  total: z.number(),
});
export type Quote = z.infer<typeof quoteSchema>;
