import { z } from 'zod';
import { roleCan, type Permission, type Role } from './roles.ts';
import { INVENTORY_UNIT_LABELS, INVENTORY_UNITS } from './stock.ts';

/**
 * Centre de notifications (§42). Une notification est écrite par le serveur DANS la transaction de
 * l'événement qui la cause, pour un établissement, et visible des rôles qui ont la permission de
 * son public. Lue / non lue par personne. Propre au nœud (jamais synchronisée, voir SYNC.md).
 */

export const NOTIFICATION_KINDS = ['ORDER_NEW', 'ORDER_READY', 'WAITER_CALL', 'BILL_REQUESTED', 'KITCHEN_PROBLEM', 'STOCK_LOW'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Public de chaque type : la salle et la caisse pour le service, le stock pour les ruptures. */
export const NOTIFICATION_AUDIENCE: Record<NotificationKind, Permission> = {
  ORDER_NEW: 'orders.create',
  ORDER_READY: 'orders.create',
  WAITER_CALL: 'orders.create',
  BILL_REQUESTED: 'orders.create',
  KITCHEN_PROBLEM: 'orders.create',
  STOCK_LOW: 'inventory.read',
};

/** Urgent : signal sonore sur les écrans. */
export const URGENT_NOTIFICATIONS: readonly NotificationKind[] = ['ORDER_NEW', 'ORDER_READY', 'WAITER_CALL', 'BILL_REQUESTED', 'KITCHEN_PROBLEM'];

export function canSeeNotification(role: Role, kind: NotificationKind): boolean {
  return roleCan(role, NOTIFICATION_AUDIENCE[kind]);
}

/** Écran ouvert en touchant la notification. */
export function notificationTarget(kind: NotificationKind): 'orders' | 'stock' {
  return kind === 'STOCK_LOW' ? 'stock' : 'orders';
}

export const KITCHEN_PROBLEM_REASONS = ['Produit manquant', 'Retard important', 'Commande incomplète', 'Question sur la commande'] as const;

export const notificationDataSchema = z
  .object({
    orderNumber: z.number(),
    tableLabel: z.string().nullable(),
    serviceType: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']),
    request: z.enum(['CALL_WAITER', 'BILL', 'HELP']),
    stationName: z.string().nullable(),
    message: z.string(),
    itemName: z.string(),
    level: z.number(),
    unit: z.enum(INVENTORY_UNITS),
    state: z.enum(['LOW', 'OUT']),
  })
  .partial();
export type NotificationData = z.infer<typeof notificationDataSchema>;

/** Jeton FCM opaque : seul l'appareil Android le fournit, le Cloud ne l'interprète jamais. */
export const pushTokenSchema = z.object({ token: z.string().trim().min(20).max(4096) });

function place(d: NotificationData): string {
  if (d.tableLabel) return `Table ${d.tableLabel}`;
  return d.serviceType === 'TAKEAWAY' ? 'À emporter' : d.serviceType === 'DELIVERY' ? 'Livraison' : 'Comptoir';
}

const quantity = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

/** Texte affiché (français), calculé depuis les données brutes : rien de figé en base. */
export function notificationText(kind: NotificationKind, d: NotificationData): { title: string; body: string | null } {
  const number = d.orderNumber === undefined ? '' : ` n°${d.orderNumber}`;
  switch (kind) {
    case 'ORDER_NEW':
      return { title: `Nouvelle commande${number}`, body: `${place(d)} · QR` };
    case 'ORDER_READY':
      return { title: `Commande${number} prête`, body: place(d) };
    case 'WAITER_CALL':
      return { title: d.request === 'HELP' ? `${place(d)} demande de l'aide` : `${place(d)} appelle un serveur`, body: null };
    case 'BILL_REQUESTED':
      return { title: `${place(d)} demande l'addition`, body: null };
    case 'KITCHEN_PROBLEM':
      return { title: `Problème cuisine · commande${number}`, body: [d.stationName, d.message].filter(Boolean).join(' : ') || null };
    case 'STOCK_LOW': {
      const unit = d.unit ? ` ${INVENTORY_UNIT_LABELS[d.unit]}` : '';
      return {
        title: d.state === 'OUT' ? `Rupture : ${d.itemName ?? ''}` : `Stock faible : ${d.itemName ?? ''}`,
        body: d.level === undefined ? null : `Reste ${quantity(Math.max(0, d.level))}${unit}`,
      };
    }
  }
}

export const notificationSchema = z.object({
  id: z.string(),
  seq: z.number(),
  locationId: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  urgent: z.boolean(),
  title: z.string(),
  body: z.string().nullable(),
  data: notificationDataSchema,
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  createdAt: z.number(),
  read: z.boolean(),
});
export type AppNotification = z.infer<typeof notificationSchema>;

export const notificationFeedSchema = z.object({
  /** Curseur à renvoyer au prochain appel (`since`). */
  cursor: z.number(),
  /** true : liste complète (premier appel) ; false : seulement les nouvelles. */
  full: z.boolean(),
  unread: z.number(),
  items: z.array(notificationSchema),
});
export type NotificationFeed = z.infer<typeof notificationFeedSchema>;

export const kitchenProblemSchema = z.object({
  /** null : écran « tous les postes ». */
  stationId: z.uuid().nullable().default(null),
  message: z.string().trim().min(1, 'Indiquez le problème.').max(200),
});
export type KitchenProblemInput = z.infer<typeof kitchenProblemSchema>;
