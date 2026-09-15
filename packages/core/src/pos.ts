import { z } from 'zod';
import { CURRENCY_CODES } from './currency.ts';
import { BILL_MODES } from './guests.ts';
import { MONEY_MAX } from './money.ts';
import { orderLineInputSchema, orderPromoCodeSchema, orderSchema } from './orders.ts';

/**
 * Caisse : prise de commande par le personnel, remises, encaissement, sessions de caisse.
 * Les paiements sont DÉCLARÉS (espèces, mobile money, carte sur un terminal séparé) :
 * AfriKaisse enregistre, il ne débite personne.
 */

export const SERVICE_TYPES = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  DINE_IN: 'Sur place',
  TAKEAWAY: 'À emporter',
  DELIVERY: 'Livraison',
};

export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Espèces',
  MOBILE_MONEY: 'Mobile money',
  CARD: 'Carte',
  OTHER: 'Autre',
};

/** Suggestions de saisie ; l'opérateur reste un texte libre (les offres changent d'un pays à l'autre). */
export const MOBILE_MONEY_PROVIDERS = ['Airtel Money', 'Moov Money', 'Orange Money', 'MTN MoMo', 'Wave', 'Free Money'] as const;

export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'À encaisser',
  PARTIAL: 'Payée en partie',
  PAID: 'Payée',
};

export const DISCOUNT_KINDS = ['PERCENT', 'AMOUNT'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

// --- Calculs (sans Zod : partagés avec l'écran de caisse) ---------------------

/** Montant de la remise, jamais supérieur au sous-total. Pourcentage arrondi à l'unité inférieure. */
export function discountAmount(subtotal: number, kind: DiscountKind, value: number): number {
  if (value <= 0 || subtotal <= 0) return 0;
  const raw = kind === 'PERCENT' ? Math.floor((subtotal * Math.min(value, 100)) / 100) : value;
  return Math.min(raw, subtotal);
}

export function paymentStatusOf(total: number, paid: number): PaymentStatus {
  if (paid <= 0) return total <= 0 ? 'PAID' : 'UNPAID';
  return paid >= total ? 'PAID' : 'PARTIAL';
}

/** Addition partagée en parts égales : le reste de la division va sur les premières parts. */
export function splitEvenly(amount: number, parts: number): number[] {
  const n = Math.max(1, Math.floor(parts));
  const base = Math.floor(amount / n);
  const rest = amount - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/** Répartit un paiement sur des commandes, la plus ancienne d'abord. */
export function allocatePayment(amount: number, dues: { id: string; remaining: number }[]): { id: string; amount: number }[] {
  const result: { id: string; amount: number }[] = [];
  let left = amount;
  for (const due of dues) {
    if (left <= 0) break;
    const take = Math.min(left, due.remaining);
    if (take > 0) {
      result.push({ id: due.id, amount: take });
      left -= take;
    }
  }
  return result;
}

/**
 * Montants proposés au client qui paie en espèces : l'exact, puis les coupures rondes
 * au-dessus (FCFA : 500, 1 000, 2 000, 5 000, 10 000).
 */
export function cashSuggestions(amount: number, step: number[] = [500, 1000, 2000, 5000, 10000]): number[] {
  const values = new Set<number>([amount]);
  for (const s of step) values.add(Math.ceil(amount / s) * s);
  return [...values].filter((v) => v >= amount && v <= MONEY_MAX).sort((a, b) => a - b).slice(0, 5);
}

// --- Entrées ----------------------------------------------------------------

const money = z.number().int().min(0).max(MONEY_MAX);
const positive = z.number().int().min(1).max(MONEY_MAX);
const reason = z.string().trim().min(1, 'Indiquez le motif.').max(200);

export const createStaffOrderSchema = z.object({
  serviceType: z.enum(SERVICE_TYPES).default('DINE_IN'),
  tableId: z.uuid().nullable().default(null),
  customerName: z.string().trim().max(60).nullable().optional(),
  lines: z.array(orderLineInputSchema).min(1, 'La commande est vide.').max(80),
  note: z.string().trim().max(300).nullable().optional(),
  promoCode: orderPromoCodeSchema,
});
export type CreateStaffOrderInput = z.infer<typeof createStaffOrderSchema>;

export const discountSchema = z
  .object({ kind: z.enum(DISCOUNT_KINDS), value: z.number().int().min(0).max(MONEY_MAX), reason: z.string().trim().max(200).default('') })
  .refine((d) => d.kind !== 'PERCENT' || d.value <= 100, { message: 'Une remise ne dépasse pas 100 %.', path: ['value'] })
  .refine((d) => d.value === 0 || d.reason.length > 0, { message: 'Indiquez le motif de la remise.', path: ['reason'] });
export type DiscountInput = z.infer<typeof discountSchema>;

export const paymentTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), id: z.uuid() }),
  z.object({ kind: z.literal('order'), id: z.uuid() }),
]);
export type PaymentTarget = z.infer<typeof paymentTargetSchema>;

export const recordPaymentSchema = z
  .object({
    target: paymentTargetSchema,
    method: z.enum(PAYMENT_METHODS),
    amount: positive,
    /** Espèces : somme remise par le client (monnaie rendue = remis − montant). */
    tendered: money.nullable().optional(),
    provider: z.string().trim().max(40).nullable().optional(),
    reference: z.string().trim().max(60).nullable().optional(),
  })
  .refine((p) => p.method !== 'CASH' || p.tendered == null || p.tendered >= p.amount, { message: 'La somme remise est inférieure au montant.', path: ['tendered'] });
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const voidPaymentSchema = z.object({ reason });

export const openCashSessionSchema = z.object({ openingFloat: money });
export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>;

export const cashMovementSchema = z.object({ kind: z.enum(['IN', 'OUT']), amount: positive, reason });
export type CashMovementInput = z.infer<typeof cashMovementSchema>;

export const closeCashSessionSchema = z.object({ countedCash: money, note: z.string().trim().max(300).nullable().optional() });
export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>;

export const transferTableSchema = z.object({ tableId: z.uuid() });

// --- Réponses ---------------------------------------------------------------

export const paymentSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  cashSessionId: z.string(),
  receiptNumber: z.number(),
  method: z.enum(PAYMENT_METHODS),
  amount: z.number(),
  tendered: z.number(),
  change: z.number(),
  provider: z.string().nullable(),
  reference: z.string().nullable(),
  status: z.enum(['RECORDED', 'VOIDED']),
  voidReason: z.string().nullable(),
  createdAt: z.number(),
  by: z.string().nullable(),
  allocations: z.array(z.object({ orderId: z.string(), orderNumber: z.number(), amount: z.number() })),
});
export type Payment = z.infer<typeof paymentSchema>;

/** Note à encaisser : une table occupée, ou une commande sans table (à emporter, comptoir). */
export const checkSchema = z.object({
  kind: z.enum(['session', 'order']),
  id: z.string(),
  tableId: z.string().nullable(),
  tableLabel: z.string().nullable(),
  serviceType: z.enum(SERVICE_TYPES),
  customerName: z.string().nullable(),
  openedAt: z.number(),
  orders: z.array(orderSchema),
  total: z.number(),
  paid: z.number(),
  remaining: z.number(),
  currency: z.enum(CURRENCY_CODES),
  /** Table ouverte d'un établissement à code de table : code à donner aux clients (imprimé sur l'addition). */
  joinCode: z.string().nullable(),
  billMode: z.enum(BILL_MODES),
});
export type Check = z.infer<typeof checkSchema>;

export const cashSummarySchema = z.object({
  byMethod: z.array(z.object({ method: z.enum(PAYMENT_METHODS), count: z.number(), amount: z.number() })),
  paymentsTotal: z.number(),
  paymentCount: z.number(),
  cashPayments: z.number(),
  movementsIn: z.number(),
  movementsOut: z.number(),
  voidedCount: z.number(),
  voidedAmount: z.number(),
  expectedCash: z.number(),
});
export type CashSummary = z.infer<typeof cashSummarySchema>;

export const cashSessionSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  status: z.enum(['OPEN', 'CLOSED']),
  businessDate: z.string(),
  currency: z.enum(CURRENCY_CODES),
  openedAt: z.number(),
  openedBy: z.string().nullable(),
  openingFloat: z.number(),
  closedAt: z.number().nullable(),
  closedBy: z.string().nullable(),
  countedCash: z.number().nullable(),
  difference: z.number().nullable(),
  note: z.string().nullable(),
  summary: cashSummarySchema,
  movements: z.array(z.object({ id: z.string(), kind: z.enum(['IN', 'OUT']), amount: z.number(), reason: z.string(), at: z.number(), by: z.string().nullable() })),
  payments: z.array(paymentSchema),
});
export type CashSession = z.infer<typeof cashSessionSchema>;

export const currentCashSessionSchema = z.object({ session: cashSessionSchema.nullable() });

export const cashSessionListSchema = z.array(
  cashSessionSchema.omit({ movements: true, payments: true }),
);
export type CashSessionListItem = z.infer<typeof cashSessionListSchema>[number];

export const receiptSchema = z.object({
  payment: paymentSchema,
  location: z.object({ name: z.string(), address: z.string().nullable(), phone: z.string().nullable(), currency: z.enum(CURRENCY_CODES), logoUrl: z.string().nullable() }),
  organization: z.string(),
  cashier: z.string().nullable(),
  orders: z.array(orderSchema),
  /** Reste dû sur les commandes concernées après ce paiement. */
  remaining: z.number(),
});
export type Receipt = z.infer<typeof receiptSchema>;
