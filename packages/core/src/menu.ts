import { z } from 'zod';
import { CURRENCY_CODES, LOCATION_TYPES } from './currency.ts';
import { stationSchema } from './kitchen.ts';
import { MONEY_MAX } from './money.ts';

/**
 * Menu d'un établissement : catégories, produits, variantes, groupes d'options.
 * Le calcul du prix d'une ligne est dans pricing.ts (sans Zod, partagé avec le panier client).
 */

const nonEmpty = (v: object) => Object.keys(v).length > 0;
const NO_CHANGE = { message: 'Aucune modification demandée' };

const money = z.number().int().min(0).max(MONEY_MAX);
const delta = z.number().int().min(-MONEY_MAX).max(MONEY_MAX);
const productName = z.string().trim().min(1).max(80);
const tags = z.array(z.string().trim().min(1).max(30)).max(12);

/** Les 14 allergènes à déclaration obligatoire (règlement UE 1169/2011), référence la plus répandue. */
export const ALLERGENS = [
  'GLUTEN',
  'CRUSTACEANS',
  'EGGS',
  'FISH',
  'PEANUTS',
  'SOY',
  'MILK',
  'NUTS',
  'CELERY',
  'MUSTARD',
  'SESAME',
  'SULPHITES',
  'LUPIN',
  'MOLLUSCS',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
/** Après compression sur l'appareil, une photo de menu pèse 100 à 300 Ko. */
export const IMAGE_MAX_BYTES = 800_000;

// --- Entrées ----------------------------------------------------------------

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  isVisible: z.boolean().default(true),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({ name: z.string().trim().min(1).max(60), isVisible: z.boolean() })
  .partial()
  .refine(nonEmpty, NO_CHANGE);
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

/** Nouvel ordre d'affichage (catégories, produits). */
export const reorderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) });
export type ReorderInput = z.infer<typeof reorderSchema>;

const variantInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(40),
  priceDelta: delta.default(0),
  isAvailable: z.boolean().default(true),
});
export type VariantInput = z.infer<typeof variantInput>;

export const createProductSchema = z
  .object({
    name: productName,
    description: z.string().trim().max(500).nullable().default(null),
    price: money,
    promoPrice: money.nullable().default(null),
    prepTimeMin: z.number().int().min(0).max(240).nullable().default(null),
    /** Poste de préparation ; null : premier poste Cuisine de l'établissement. */
    stationId: z.uuid().nullable().default(null),
    isAvailable: z.boolean().default(true),
    tags: tags.default([]),
    allergens: z.array(z.enum(ALLERGENS)).max(14).default([]),
    photoMediaId: z.uuid().nullable().default(null),
    variants: z.array(variantInput).max(20).default([]),
    modifierGroupIds: z.array(z.uuid()).max(20).default([]),
  })
  .refine((p) => p.promoPrice === null || p.promoPrice < p.price, {
    message: 'Le prix promotionnel doit être inférieur au prix.',
    path: ['promoPrice'],
  });
export type CreateProductInput = z.infer<typeof createProductSchema>;

// Sans valeurs par défaut : un PATCH ne remet jamais à zéro un champ absent.
export const updateProductSchema = z
  .object({
    name: productName,
    description: z.string().trim().max(500).nullable(),
    price: money,
    promoPrice: money.nullable(),
    prepTimeMin: z.number().int().min(0).max(240).nullable(),
    stationId: z.uuid().nullable(),
    isAvailable: z.boolean(),
    tags,
    allergens: z.array(z.enum(ALLERGENS)).max(14),
    photoMediaId: z.uuid().nullable(),
    categoryId: z.uuid(),
    variants: z.array(variantInput).max(20),
    modifierGroupIds: z.array(z.uuid()).max(20),
  })
  .partial()
  .refine(nonEmpty, NO_CHANGE);
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const availabilitySchema = z.object({ isAvailable: z.boolean() });

const modifierInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(40),
  priceDelta: delta.default(0),
  isAvailable: z.boolean().default(true),
});
export type ModifierInput = z.infer<typeof modifierInput>;

const groupRules = <T extends { minSelect?: number; maxSelect?: number; modifiers?: unknown[] }>(schema: z.ZodType<T>) =>
  schema
    .refine((g) => g.minSelect === undefined || g.maxSelect === undefined || g.minSelect <= g.maxSelect, {
      message: 'Le minimum de choix dépasse le maximum.',
      path: ['minSelect'],
    })
    .refine((g) => g.maxSelect === undefined || g.modifiers === undefined || g.maxSelect <= g.modifiers.length, {
      message: "Le maximum de choix dépasse le nombre d'options.",
      path: ['maxSelect'],
    });

export const createModifierGroupSchema = groupRules(
  z.object({
    name: z.string().trim().min(1).max(60),
    minSelect: z.number().int().min(0).max(30).default(0),
    maxSelect: z.number().int().min(1).max(30).default(1),
    modifiers: z.array(modifierInput).min(1).max(30),
  }),
);
export type CreateModifierGroupInput = z.infer<typeof createModifierGroupSchema>;

export const updateModifierGroupSchema = groupRules(
  z
    .object({
      name: z.string().trim().min(1).max(60),
      minSelect: z.number().int().min(0).max(30),
      maxSelect: z.number().int().min(1).max(30),
      modifiers: z.array(modifierInput).min(1).max(30),
    })
    .partial(),
).refine(nonEmpty, NO_CHANGE);
export type UpdateModifierGroupInput = z.infer<typeof updateModifierGroupSchema>;

export const uploadMediaSchema = z.object({
  contentType: z.enum(IMAGE_TYPES),
  // Base64 : passe partout (navigateur, HTTP natif de la tablette) sans multipart.
  dataBase64: z.string().min(16).max(Math.ceil((IMAGE_MAX_BYTES * 4) / 3) + 16),
});
export type UploadMediaInput = z.infer<typeof uploadMediaSchema>;

// --- Réponses ---------------------------------------------------------------

export const categorySchema = z.object({
  id: z.string(),
  locationId: z.string(),
  name: z.string(),
  isVisible: z.boolean(),
  sort: z.number(),
});
export type Category = z.infer<typeof categorySchema>;

export const variantSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceDelta: z.number(),
  isAvailable: z.boolean(),
  sort: z.number(),
});
export type Variant = z.infer<typeof variantSchema>;

export const productSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  categoryId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.number(),
  promoPrice: z.number().nullable(),
  prepTimeMin: z.number().nullable(),
  stationId: z.string().nullable(),
  isAvailable: z.boolean(),
  tags: z.array(z.string()),
  allergens: z.array(z.enum(ALLERGENS)),
  photoMediaId: z.string().nullable(),
  photoUrl: z.string().nullable(),
  sort: z.number(),
  variants: z.array(variantSchema),
  modifierGroupIds: z.array(z.string()),
});
export type Product = z.infer<typeof productSchema>;

export const modifierSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  name: z.string(),
  priceDelta: z.number(),
  isAvailable: z.boolean(),
  sort: z.number(),
});
export type Modifier = z.infer<typeof modifierSchema>;

export const modifierGroupSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  name: z.string(),
  minSelect: z.number(),
  maxSelect: z.number(),
  sort: z.number(),
  modifiers: z.array(modifierSchema),
  productCount: z.number(),
});
export type ModifierGroup = z.infer<typeof modifierGroupSchema>;

export const adminMenuSchema = z.object({
  location: z.object({ id: z.string(), name: z.string(), currency: z.enum(CURRENCY_CODES) }),
  stations: z.array(stationSchema),
  categories: z.array(categorySchema),
  products: z.array(productSchema),
  modifierGroups: z.array(modifierGroupSchema),
});
export type AdminMenu = z.infer<typeof adminMenuSchema>;

export const mediaSchema = z.object({
  id: z.string(),
  url: z.string(),
  contentType: z.enum(IMAGE_TYPES),
  size: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Media = z.infer<typeof mediaSchema>;

export const qrCodeSchema = z.object({
  tableId: z.string(),
  tableLabel: z.string(),
  zoneName: z.string(),
  token: z.string(),
  url: z.string(),
  createdAt: z.number(),
});
export type QrCode = z.infer<typeof qrCodeSchema>;

export const qrListSchema = z.object({
  locationName: z.string(),
  organizationName: z.string(),
  menuBaseUrl: z.string(),
  /** Faux : l'adresse n'est joignable que depuis le réseau du restaurant (le client devrait rejoindre son Wi-Fi). */
  reachableFromInternet: z.boolean(),
  codes: z.array(qrCodeSchema),
});
export type QrList = z.infer<typeof qrListSchema>;

const publicModifier = z.object({ id: z.string(), name: z.string(), priceDelta: z.number(), isAvailable: z.boolean() });

export const publicProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.number(),
  promoPrice: z.number().nullable(),
  photoUrl: z.string().nullable(),
  isAvailable: z.boolean(),
  tags: z.array(z.string()),
  allergens: z.array(z.enum(ALLERGENS)),
  variants: z.array(publicModifier),
  modifierGroups: z.array(
    z.object({ id: z.string(), name: z.string(), minSelect: z.number(), maxSelect: z.number(), modifiers: z.array(publicModifier) }),
  ),
});
export type PublicProduct = z.infer<typeof publicProductSchema>;

export const publicMenuSchema = z.object({
  restaurant: z.object({
    name: z.string(),
    organization: z.string(),
    type: z.enum(LOCATION_TYPES),
    currency: z.enum(CURRENCY_CODES),
  }),
  table: z.object({ label: z.string() }),
  categories: z.array(z.object({ id: z.string(), name: z.string(), products: z.array(publicProductSchema) })),
});
export type PublicMenu = z.infer<typeof publicMenuSchema>;
