import { z } from 'zod';
import { CURRENCY_CODES } from './currency.ts';
import { BILL_SCOPES, CLIENT_PAYMENT_METHODS, NICKNAME_MAX } from './guests.ts';
import type { Permission } from './roles.ts';
import { TAX_MODES } from './taxes.ts';

/**
 * Commandes. Une commande confirmée est un événement métier : son état évolue par
 * transitions enregistrées (historique), jamais par écrasement (§55).
 */
export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'];

export const ORDER_SOURCES = ['QR', 'POS', 'WAITER'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'READY', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['SERVED', 'CANCELLED'],
  SERVED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

/**
 * Qui peut faire quelle transition (une permission suffit). Partagé par le serveur, qui
 * refuse, et par les écrans, qui ne montrent que les boutons utilisables.
 */
export function permissionsForTransition(from: OrderStatus, to: OrderStatus): Permission[] {
  switch (to) {
    case 'CONFIRMED':
    case 'SERVED':
      return ['orders.create'];
    case 'PREPARING':
    case 'READY':
      return ['kitchen.use', 'bar.use', 'orders.create'];
    case 'COMPLETED':
      return ['payments.collect'];
    case 'CANCELLED':
      // Refuser une commande QR en attente : le personnel de salle. Annuler une commande
      // déjà partie en cuisine : seulement un responsable.
      return from === 'PENDING' ? ['orders.create'] : ['orders.cancel'];
    default:
      return [];
  }
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: 'En attente de confirmation',
  CONFIRMED: 'Confirmée',
  PREPARING: 'En préparation',
  READY: 'Prête',
  SERVED: 'Servie',
  COMPLETED: 'Terminée',
  CANCELLED: 'Annulée',
};

export const SERVICE_REQUEST_KINDS = ['CALL_WAITER', 'BILL', 'HELP'] as const;
export type ServiceRequestKind = (typeof SERVICE_REQUEST_KINDS)[number];

export const SERVICE_REQUEST_LABELS: Record<ServiceRequestKind, string> = {
  CALL_WAITER: 'Appelle un serveur',
  BILL: "Demande l'addition",
  HELP: "Demande de l'aide",
};

/**
 * Journée d'exploitation (AAAA-MM-JJ) : une vente à 02:00 avec une bascule à 05:00 compte
 * pour la veille. Calculée dans le fuseau de l'établissement, jamais celui du serveur.
 */
export function businessDate(ms: number, timeZone: string, cutoffMin: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(ms - cutoffMin * 60_000),
  );
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// --- Entrées ----------------------------------------------------------------

/** Identifiant aléatoire du téléphone du client : suivi de ses commandes sans compte. */
export const clientTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Identifiant de client invalide');

export const orderLineInputSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().nullable().optional(),
  modifierIds: z.array(z.uuid()).max(30).default([]),
  quantity: z.number().int().min(1).max(99),
  note: z.string().trim().max(200).nullable().optional(),
});
export type OrderLineInput = z.infer<typeof orderLineInputSchema>;

/** Code promo saisi (casse indifférente) ; vérifié et appliqué par le serveur. */
export const orderPromoCodeSchema = z.string().trim().max(30).nullable().optional();
/** Code de table à 4 chiffres (I-9). */
export const tableCodeSchema = z.string().regex(/^\d{4}$/, 'Le code de table compte 4 chiffres.');
/** Surnom facultatif affiché aux autres clients de la table et au personnel. */
export const nicknameInputSchema = z.string().max(NICKNAME_MAX * 4).nullable().optional();

export const placeQrOrderSchema = z.object({
  clientToken: clientTokenSchema,
  lines: z.array(orderLineInputSchema).min(1, 'Le panier est vide.').max(50),
  note: z.string().trim().max(300).nullable().optional(),
  promoCode: orderPromoCodeSchema,
  /** Exigé à la première commande si l'établissement active le code de table. */
  tableCode: tableCodeSchema.optional(),
  nickname: nicknameInputSchema,
});
export type PlaceQrOrderInput = z.infer<typeof placeQrOrderSchema>;

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  reason: z.string().trim().max(200).optional(),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export const serviceRequestInputSchema = z.object({
  clientToken: clientTokenSchema,
  kind: z.enum(SERVICE_REQUEST_KINDS),
  /** Addition : comment le client compte payer (le serveur vient préparé, I-7). */
  paymentMethod: z.enum(CLIENT_PAYMENT_METHODS).optional(),
  /** Addition : toute la table ou la part de ce téléphone (établissement en addition par client). */
  scope: z.enum(BILL_SCOPES).optional(),
});
export type ServiceRequestInput = z.infer<typeof serviceRequestInputSchema>;

// --- Réponses ---------------------------------------------------------------

/** Détail d'un taux de taxe, figé sur la commande. */
export const taxLineSchema = z.object({ rateId: z.string(), name: z.string(), rateBp: z.number(), base: z.number(), tax: z.number() });

/** Promotion appliquée à une commande (récapitulatif des tickets). */
export const appliedPromotionSchema = z.object({ id: z.string(), name: z.string(), code: z.string().nullable(), amount: z.number() });

export const orderItemSchema = z.object({
  id: z.string(),
  productId: z.string(),
  name: z.string(),
  variantName: z.string().nullable(),
  unitPrice: z.number(),
  quantity: z.number(),
  total: z.number(),
  /** Promotion de la ligne (automatique ou code) et sa remise. */
  promotionName: z.string().nullable(),
  promotionDiscount: z.number(),
  note: z.string().nullable(),
  modifiers: z.array(z.object({ groupName: z.string(), name: z.string(), priceDelta: z.number() })),
  stationId: z.string().nullable(),
  kdsStatus: z.enum(['QUEUED', 'PREPARING', 'READY']),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  number: z.number(),
  businessDate: z.string(),
  source: z.enum(ORDER_SOURCES),
  status: z.enum(ORDER_STATUSES),
  tableId: z.string().nullable(),
  tableLabel: z.string().nullable(),
  sessionId: z.string().nullable(),
  /** Commande QR : surnom du client à la table, sinon « Client n ». */
  guestName: z.string().nullable(),
  note: z.string().nullable(),
  serviceType: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']),
  customerName: z.string().nullable(),
  currency: z.enum(CURRENCY_CODES),
  subtotal: z.number(),
  /** Toutes promotions (lignes, commande, code). */
  promotionDiscount: z.number(),
  promotions: z.array(appliedPromotionSchema),
  promoCode: z.string().nullable(),
  /** Remise manuelle d'un responsable. */
  discount: z.number(),
  discountReason: z.string().nullable(),
  taxMode: z.enum(TAX_MODES),
  taxTotal: z.number(),
  taxes: z.array(taxLineSchema),
  total: z.number(),
  paid: z.number(),
  paymentStatus: z.enum(['UNPAID', 'PARTIAL', 'PAID']),
  itemCount: z.number(),
  items: z.array(orderItemSchema),
  createdAt: z.number(),
  statusChangedAt: z.number(),
  history: z.array(
    z.object({
      from: z.enum(ORDER_STATUSES).nullable(),
      to: z.enum(ORDER_STATUSES),
      at: z.number(),
      by: z.string().nullable(),
      /** Auteur du geste (null : client QR ou système). Absent avec un serveur plus ancien. */
      byUserId: z.string().nullable().optional(),
      reason: z.string().nullable(),
    }),
  ),
});
export type Order = z.infer<typeof orderSchema>;

export const publicOrderSchema = z.object({
  id: z.string(),
  number: z.number(),
  status: z.enum(ORDER_STATUSES),
  tableLabel: z.string().nullable(),
  /** Surnom du client qui a commandé (null : commande saisie par le personnel). */
  guestName: z.string().nullable(),
  /** Commande passée depuis ce téléphone. */
  mine: z.boolean(),
  currency: z.enum(CURRENCY_CODES),
  subtotal: z.number(),
  promotionDiscount: z.number(),
  promotions: z.array(appliedPromotionSchema),
  taxMode: z.enum(TAX_MODES),
  taxTotal: z.number(),
  taxes: z.array(taxLineSchema),
  total: z.number(),
  note: z.string().nullable(),
  items: z.array(
    z.object({
      name: z.string(),
      variantName: z.string().nullable(),
      quantity: z.number(),
      total: z.number(),
      note: z.string().nullable(),
      modifiers: z.array(z.string()),
    }),
  ),
  createdAt: z.number(),
  statusChangedAt: z.number(),
});
export type PublicOrder = z.infer<typeof publicOrderSchema>;

export const serviceRequestSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  tableId: z.string(),
  tableLabel: z.string(),
  kind: z.enum(SERVICE_REQUEST_KINDS),
  status: z.enum(['OPEN', 'DONE']),
  createdAt: z.number(),
  handledAt: z.number().nullable(),
  handledBy: z.string().nullable(),
  /** Addition : moyen annoncé par le client. */
  paymentMethod: z.enum(CLIENT_PAYMENT_METHODS).nullable(),
  /** Addition : toute la table ou la part d'un client. */
  billScope: z.enum(BILL_SCOPES).nullable(),
  /** Client qui appelle (surnom ou « Client n »), s'il est connu à la table. */
  guestName: z.string().nullable(),
  /** Addition : reste à payer au moment de la lecture (table ou part du client). */
  amount: z.number().nullable(),
});
export type ServiceRequest = z.infer<typeof serviceRequestSchema>;

export const activitySchema = z.object({
  /** Curseur à renvoyer au prochain appel. */
  cursor: z.number(),
  /** true : listes complètes (premier appel) ; false : seulement ce qui a changé. */
  full: z.boolean(),
  orders: z.array(orderSchema),
  requests: z.array(serviceRequestSchema),
});
export type Activity = z.infer<typeof activitySchema>;
