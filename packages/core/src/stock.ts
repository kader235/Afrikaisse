import { z } from 'zod';
import { MONEY_MAX } from './money.ts';

/**
 * Stock et recettes (phase 13). Les quantités circulent en décimal (1,5 kg ; 0,33 l) et sont
 * stockées en MILLIÈMES entiers : aucun arrondi flottant ne fausse un inventaire.
 * Le niveau d'un article n'est jamais saisi : c'est la somme de ses mouvements (ajout seulement).
 */

export const INVENTORY_UNITS = ['PIECE', 'PORTION', 'KG', 'G', 'L', 'CL', 'ML'] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];

export const INVENTORY_UNIT_LABELS: Record<InventoryUnit, string> = {
  PIECE: 'pièce',
  PORTION: 'portion',
  KG: 'kg',
  G: 'g',
  L: 'l',
  CL: 'cl',
  ML: 'ml',
};

export const MOVEMENT_KINDS = ['IN', 'OUT', 'LOSS', 'COUNT', 'SALE', 'SALE_CANCEL'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  IN: 'Réception',
  OUT: 'Sortie',
  LOSS: 'Perte',
  COUNT: 'Inventaire',
  SALE: 'Vente',
  SALE_CANCEL: 'Vente annulée',
};

export const STOCK_STATES = ['OK', 'LOW', 'OUT'] as const;
export type StockState = (typeof STOCK_STATES)[number];

export const toMilli = (quantity: number) => Math.round(quantity * 1000);
export const fromMilli = (milli: number) => Number(milli) / 1000;

export function stockState(levelMilli: number, minMilli: number): StockState {
  if (levelMilli <= 0) return 'OUT';
  return levelMilli < minMilli ? 'LOW' : 'OK';
}

const QUANTITY_MAX = 1_000_000;
const quantity = z
  .number()
  .min(0)
  .max(QUANTITY_MAX)
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, { message: 'Trois décimales au plus.' });
const positive = quantity.refine((v) => v > 0, { message: 'La quantité doit être supérieure à zéro.' });
const money = z.number().int().min(0).max(MONEY_MAX);

export const createInventoryItemSchema = z.object({
  name: z.string().trim().min(1).max(60),
  unit: z.enum(INVENTORY_UNITS),
  minLevel: quantity.default(0),
  unitCost: money.nullable().default(null),
});
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;

export const updateInventoryItemSchema = z
  .object({ name: z.string().trim().min(1).max(60), unit: z.enum(INVENTORY_UNITS), minLevel: quantity, unitCost: money.nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucune modification demandée' });
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>;

/** COUNT : quantité réellement comptée ; le mouvement enregistre l'écart. */
export const stockMovementInputSchema = z
  .object({
    kind: z.enum(['IN', 'OUT', 'LOSS', 'COUNT']),
    quantity,
    unitCost: money.nullable().optional(),
    reason: z.string().trim().max(200).default(''),
  })
  .refine((m) => m.kind === 'COUNT' || m.quantity > 0, { message: 'La quantité doit être supérieure à zéro.', path: ['quantity'] })
  .refine((m) => (m.kind !== 'LOSS' && m.kind !== 'OUT') || m.reason.length > 0, { message: 'Indiquez le motif.', path: ['reason'] });
export type StockMovementInput = z.infer<typeof stockMovementInputSchema>;

export const recipeInputSchema = z.object({
  items: z
    .array(z.object({ itemId: z.uuid(), variantId: z.uuid().nullable().default(null), quantity: positive }))
    .max(40),
});
export type RecipeInput = z.infer<typeof recipeInputSchema>;

export const inventoryItemSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  name: z.string(),
  unit: z.enum(INVENTORY_UNITS),
  level: z.number(),
  minLevel: z.number(),
  unitCost: z.number().nullable(),
  value: z.number(),
  state: z.enum(STOCK_STATES),
  usedBy: z.number(),
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export const stockMovementSchema = z.object({
  id: z.string(),
  kind: z.enum(MOVEMENT_KINDS),
  quantity: z.number(),
  unitCost: z.number().nullable(),
  reason: z.string().nullable(),
  orderNumber: z.number().nullable(),
  by: z.string().nullable(),
  at: z.number(),
});
export type StockMovement = z.infer<typeof stockMovementSchema>;

export const recipeSchema = z.object({
  productId: z.string(),
  items: z.array(
    z.object({
      itemId: z.string(),
      itemName: z.string(),
      unit: z.enum(INVENTORY_UNITS),
      variantId: z.string().nullable(),
      variantName: z.string().nullable(),
      quantity: z.number(),
    }),
  ),
});
export type Recipe = z.infer<typeof recipeSchema>;
