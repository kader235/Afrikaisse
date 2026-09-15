import {
  NOTIFICATION_AUDIENCE,
  URGENT_NOTIFICATIONS,
  fromMilli,
  stockState,
  uuidv7,
  type InventoryUnit,
  type NotificationData,
  type NotificationKind,
  type WireEvent,
} from '@afrikaisse/core';
import type { AppContext, Db } from '../context.ts';

/**
 * Écriture des notifications (§42), appelée avec la TRANSACTION de l'événement : une commande
 * annulée par une erreur n'a pas de notification, et une notification n'existe pas sans son
 * événement. Aucune dépendance vers les services : orders, kitchen et stock l'appellent.
 */

export interface NotifyInput {
  tenantId: string;
  locationId: string;
  kind: NotificationKind;
  data: NotificationData;
  entityType?: string | null;
  entityId?: string | null;
  /** Auteur du geste : il ne reçoit pas sa propre notification. */
  createdBy?: string | null;
  /** Clé anti-doublon (même événement reçu deux fois, rejeu de synchronisation). */
  dedupeKey?: string | null;
}

export async function notify(db: Db, ctx: AppContext, n: NotifyInput): Promise<void> {
  await db
    .insertInto('notifications')
    .values({
      id: uuidv7(),
      tenant_id: n.tenantId,
      location_id: n.locationId,
      kind: n.kind,
      audience: NOTIFICATION_AUDIENCE[n.kind],
      urgent: URGENT_NOTIFICATIONS.includes(n.kind) ? 1 : 0,
      data: JSON.stringify(n.data),
      entity_type: n.entityType ?? null,
      entity_id: n.entityId ?? null,
      dedupe_key: n.dedupeKey ?? null,
      created_by: n.createdBy ?? null,
      created_at: ctx.now(),
    })
    // ON CONFLICT et non un try/catch : sous PostgreSQL, une violation d'unicité annulerait la transaction de l'événement.
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .execute();
}

/** Nouvelle commande QR ou commande prête. */
export async function notifyOrder(db: Db, ctx: AppContext, orderId: string, kind: 'ORDER_NEW' | 'ORDER_READY', createdBy: string | null): Promise<void> {
  const order = await db
    .selectFrom('orders as o')
    .leftJoin('dining_tables as t', 't.id', 'o.table_id')
    .select(['o.id', 'o.tenant_id', 'o.location_id', 'o.number', 'o.service_type', 't.label'])
    .where('o.id', '=', orderId)
    .executeTakeFirst();
  if (!order) return;
  await notify(db, ctx, {
    tenantId: order.tenant_id,
    locationId: order.location_id,
    kind,
    data: { orderNumber: Number(order.number), tableLabel: order.label ?? null, serviceType: order.service_type },
    entityType: 'order',
    entityId: order.id,
    createdBy,
    dedupeKey: `${kind}:${order.id}`,
  });
}

/** Appel d'un serveur, demande d'aide ou d'addition depuis le QR de la table. */
export async function notifyRequest(db: Db, ctx: AppContext, requestId: string): Promise<void> {
  const request = await db
    .selectFrom('service_requests as r')
    .innerJoin('dining_tables as t', 't.id', 'r.table_id')
    .select(['r.id', 'r.tenant_id', 'r.location_id', 'r.kind', 't.label'])
    .where('r.id', '=', requestId)
    .executeTakeFirst();
  if (!request) return;
  await notify(db, ctx, {
    tenantId: request.tenant_id,
    locationId: request.location_id,
    kind: request.kind === 'BILL' ? 'BILL_REQUESTED' : 'WAITER_CALL',
    data: { tableLabel: request.label, request: request.kind },
    entityType: 'service_request',
    entityId: request.id,
    dedupeKey: `REQUEST:${request.id}`,
  });
}

export interface StockLevelChange {
  itemId: string;
  name: string;
  unit: InventoryUnit;
  minMilli: number;
  beforeMilli: number;
  afterMilli: number;
}

/** Stock faible ou rupture : seulement au franchissement du seuil, pas à chaque vente sous le seuil. */
export async function notifyStockLevels(db: Db, ctx: AppContext, where: { tenantId: string; locationId: string; createdBy: string | null }, changes: StockLevelChange[]): Promise<void> {
  for (const c of changes) {
    const before = stockState(c.beforeMilli, c.minMilli);
    const after = stockState(c.afterMilli, c.minMilli);
    if (after === 'OK' || after === before || (before === 'OUT' && after === 'LOW')) continue;
    await notify(db, ctx, {
      tenantId: where.tenantId,
      locationId: where.locationId,
      kind: 'STOCK_LOW',
      data: { itemName: c.name, unit: c.unit, level: fromMilli(c.afterMilli), state: after },
      entityType: 'inventory_item',
      entityId: c.itemId,
      createdBy: where.createdBy,
    });
  }
}

/** Au-delà, un événement reçu est de l'histoire ancienne (serveur resté hors ligne) : pas d'alerte. */
export const RECEIVED_FRESH_MS = 10 * 60_000;

/**
 * Événement reçu par synchronisation et appliqué : le nœud qui le reçoit écrit ses propres
 * notifications (commande QR passée dans le Cloud et descendue sur le serveur local, appel de table…).
 */
export async function notifyReceived(db: Db, ctx: AppContext, event: WireEvent): Promise<void> {
  if (!event.locationId || ctx.now() - Number(event.createdAt) > RECEIVED_FRESH_MS) return;
  const payload = event.payload as { rows?: { order?: { status?: string; source?: string } }; status?: string };
  if (event.entityType === 'order') {
    const order = payload.rows?.order;
    if (!order) return;
    if (event.operation === 'ORDER_PLACED' && order.status === 'PENDING' && order.source === 'QR') await notifyOrder(db, ctx, event.entityId, 'ORDER_NEW', null);
    else if (event.operation === 'ORDER_STATUS_CHANGED' && order.status === 'READY') await notifyOrder(db, ctx, event.entityId, 'ORDER_READY', null);
    return;
  }
  if (event.entityType === 'service_request' && event.operation === 'UPSERT' && payload.status === 'OPEN') {
    await notifyRequest(db, ctx, event.entityId);
  }
}
