import {
  AppError,
  NOTIFICATION_KINDS,
  ROLE_PERMISSIONS,
  notificationDataSchema,
  notificationText,
  roleCan,
  stationPermission,
  type AppNotification,
  type KitchenProblemInput,
  type NotificationFeed,
  type NotificationKind,
  type Permission,
  type StationKind,
} from '@afrikaisse/core';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import { requireTenant, type AuthState, type TenantScope } from '../lib/access.ts';
import { writeAudit } from '../lib/journal.ts';
import { notify } from '../lib/notify.ts';
import { assertLocation } from './orders.ts';

/**
 * Centre de notifications : lecture par interrogation régulière (`since=`, comme le flux
 * d'activité), lu / non lu par personne, et signalement d'un problème depuis l'écran cuisine.
 * Visibles : notifications de l'établissement dont le public est une permission du rôle,
 * sauf celles dont on est l'auteur, sur les 3 derniers jours.
 */

const WINDOW_MS = 3 * 86_400_000;
const LIST_LIMIT = 50;
const RETENTION_MS = 30 * 86_400_000;

function visible(db: Db, ctx: AppContext, scope: TenantScope, locationId: string) {
  return db
    .selectFrom('notifications as n')
    .leftJoin('notification_reads as r', (join) => join.onRef('r.notification_id', '=', 'n.id').on('r.user_id', '=', scope.userId))
    .where('n.location_id', '=', locationId)
    .where('n.audience', 'in', [...ROLE_PERMISSIONS[scope.role]])
    .where((eb) => eb.or([eb('n.created_by', 'is', null), eb('n.created_by', '!=', scope.userId)]))
    .where('n.created_at', '>', ctx.now() - WINDOW_MS);
}

async function readMark(db: Db, userId: string, locationId: string): Promise<number> {
  const mark = await db.selectFrom('notification_marks').select('read_seq').where('user_id', '=', userId).where('location_id', '=', locationId).executeTakeFirst();
  return Number(mark?.read_seq ?? 0);
}

async function countUnread(ctx: AppContext, scope: TenantScope, locationId: string, readSeq: number): Promise<number> {
  const row = await visible(ctx.db, ctx, scope, locationId)
    .select((eb) => eb.fn.countAll().as('c'))
    .where('n.seq', '>', readSeq)
    .where('r.notification_id', 'is', null)
    .executeTakeFirst();
  return Number(row?.c ?? 0);
}

export async function listNotifications(ctx: AppContext, scope: TenantScope, locationId: string, since: number): Promise<NotificationFeed> {
  await assertLocation(ctx.db, scope, locationId);
  const top = await ctx.db.selectFrom('notifications').select((eb) => eb.fn.max('seq').as('m')).where('location_id', '=', locationId).executeTakeFirst();
  const cursor = Number(top?.m ?? 0);
  const readSeq = await readMark(ctx.db, scope.userId, locationId);
  const full = since <= 0 || since > cursor;

  let query = visible(ctx.db, ctx, scope, locationId)
    .select(['n.id', 'n.seq', 'n.location_id', 'n.kind', 'n.urgent', 'n.data', 'n.entity_type', 'n.entity_id', 'n.created_at', 'r.read_at'])
    .where('n.seq', '<=', cursor)
    .orderBy('n.seq', 'desc')
    .limit(LIST_LIMIT);
  if (!full) query = query.where('n.seq', '>', since);
  const rows = await query.execute();

  const items: AppNotification[] = rows
    .filter((r) => (NOTIFICATION_KINDS as readonly string[]).includes(r.kind))
    .map((r) => {
      let data = {};
      try {
        data = notificationDataSchema.parse(JSON.parse(r.data));
      } catch {
        /* données illisibles : le titre reste générique */
      }
      const kind = r.kind as NotificationKind;
      const seq = Number(r.seq);
      return {
        id: r.id,
        seq,
        locationId: r.location_id,
        kind,
        urgent: Number(r.urgent) === 1,
        ...notificationText(kind, data),
        data,
        entityType: r.entity_type,
        entityId: r.entity_id,
        createdAt: Number(r.created_at),
        read: seq <= readSeq || r.read_at !== null,
      };
    });
  return { cursor, full, unread: await countUnread(ctx, scope, locationId, readSeq), items };
}

/** Enregistre ou actualise le token FCM de la tablette connectée. */
export async function registerPushToken(ctx: AppContext, scope: TenantScope, locationId: string, token: string): Promise<void> {
  await assertLocation(ctx.db, scope, locationId);
  await ctx.db
    .insertInto('push_tokens')
    .values({ token, tenant_id: scope.tenantId, location_id: locationId, user_id: scope.userId, updated_at: ctx.now() })
    .onConflict((oc) => oc.column('token').doUpdateSet({ tenant_id: scope.tenantId, location_id: locationId, user_id: scope.userId, updated_at: ctx.now() }))
    .execute();
}

export async function markNotificationRead(ctx: AppContext, scope: TenantScope, notificationId: string): Promise<void> {
  const row = await ctx.db.selectFrom('notifications').select(['id', 'location_id', 'audience']).where('id', '=', notificationId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row || (scope.locationId && row.location_id !== scope.locationId) || !ROLE_PERMISSIONS[scope.role].includes(row.audience as Permission)) {
    throw new AppError('NOT_FOUND', 'Notification introuvable.');
  }
  await ctx.db
    .insertInto('notification_reads')
    .values({ notification_id: notificationId, user_id: scope.userId, read_at: ctx.now() })
    .onConflict((oc) => oc.columns(['notification_id', 'user_id']).doNothing())
    .execute();
}

/** Tout marquer lu jusqu'à `upTo` (le curseur affiché), sans effacer ce qui arrive entre-temps. */
export async function markAllNotificationsRead(ctx: AppContext, scope: TenantScope, locationId: string, upTo: number | undefined): Promise<{ unread: number }> {
  await assertLocation(ctx.db, scope, locationId);
  const now = ctx.now();
  await ctx.db.transaction().execute(async (trx) => {
    const top = await trx.selectFrom('notifications').select((eb) => eb.fn.max('seq').as('m')).where('location_id', '=', locationId).executeTakeFirst();
    const target = Math.min(upTo ?? Number.MAX_SAFE_INTEGER, Number(top?.m ?? 0));
    const next = Math.max(await readMark(trx, scope.userId, locationId), target);
    await trx
      .insertInto('notification_marks')
      .values({ user_id: scope.userId, location_id: locationId, read_seq: next, updated_at: now })
      .onConflict((oc) => oc.columns(['user_id', 'location_id']).doUpdateSet({ read_seq: next, updated_at: now }))
      .execute();
    const covered = trx.selectFrom('notifications').select('id').where('location_id', '=', locationId).where('seq', '<=', next);
    await trx.deleteFrom('notification_reads').where('user_id', '=', scope.userId).where('notification_id', 'in', covered).execute();
    // Ménage : au-delà de 30 jours une notification ne sert plus à rien.
    const old = trx.selectFrom('notifications').select('id').where('location_id', '=', locationId).where('created_at', '<', now - RETENTION_MS);
    await trx.deleteFrom('notification_reads').where('notification_id', 'in', old).execute();
    await trx.deleteFrom('notifications').where('location_id', '=', locationId).where('created_at', '<', now - RETENTION_MS).execute();
  });
  return { unread: await countUnread(ctx, scope, locationId, await readMark(ctx.db, scope.userId, locationId)) };
}

const KITCHEN_STATUSES = ['CONFIRMED', 'PREPARING', 'READY'];

/** « Problème cuisine » : un poste signale un souci sur un ticket, la salle et la caisse sont prévenues. */
export async function reportKitchenProblem(ctx: AppContext, auth: AuthState | null, orderId: string, input: KitchenProblemInput, meta: RequestMeta): Promise<void> {
  const scope = requireTenant(auth);
  const order = await ctx.db
    .selectFrom('orders as o')
    .leftJoin('dining_tables as t', 't.id', 'o.table_id')
    .select(['o.id', 'o.tenant_id', 'o.location_id', 'o.number', 'o.status', 'o.service_type', 't.label'])
    .where('o.id', '=', orderId)
    .where('o.tenant_id', '=', scope.tenantId)
    .executeTakeFirst();
  if (!order || (scope.locationId && order.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Commande introuvable.');

  let station: { id: string; kind: StationKind; name: string } | null = null;
  if (input.stationId) {
    station = (await ctx.db.selectFrom('stations').select(['id', 'kind', 'name']).where('id', '=', input.stationId).where('location_id', '=', order.location_id).executeTakeFirst()) ?? null;
    if (!station) throw new AppError('NOT_FOUND', 'Poste de préparation introuvable.');
  }
  let itemsQuery = ctx.db.selectFrom('order_items as i').leftJoin('stations as s', 's.id', 'i.station_id').select('s.kind').where('i.order_id', '=', orderId);
  if (station) itemsQuery = itemsQuery.where('i.station_id', '=', station.id);
  const kinds = new Set<StationKind>((await itemsQuery.execute()).map((i) => i.kind ?? 'KITCHEN'));
  if (station) kinds.add(station.kind);
  const allowed = (roleCan(scope.role, 'kitchen.use') || roleCan(scope.role, 'bar.use')) && [...kinds].every((k) => roleCan(scope.role, stationPermission(k)));
  if (!allowed) throw new AppError('FORBIDDEN', 'Votre rôle ne permet pas de signaler un problème sur ce poste.');
  if (!KITCHEN_STATUSES.includes(order.status)) throw new AppError('CONFLICT', "Cette commande n'est pas en cuisine.");

  await ctx.db.transaction().execute(async (trx) => {
    await notify(trx, ctx, {
      tenantId: order.tenant_id,
      locationId: order.location_id,
      kind: 'KITCHEN_PROBLEM',
      data: { orderNumber: Number(order.number), tableLabel: order.label ?? null, serviceType: order.service_type, stationName: station?.name ?? null, message: input.message },
      entityType: 'order',
      entityId: order.id,
      createdBy: scope.userId,
    });
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: order.location_id,
      actorUserId: scope.userId,
      action: 'kitchen.problem',
      entityType: 'order',
      entityId: order.id,
      data: { number: Number(order.number), station: station?.name ?? null, message: input.message },
      meta,
    });
  });
}
