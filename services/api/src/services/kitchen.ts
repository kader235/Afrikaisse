import {
  AppError,
  roleCan,
  stationPermission,
  uuidv7,
  type CreateStationInput,
  type KitchenActionInput,
  type Order,
  type OrderStatus,
  type Station,
  type StationKind,
  type UpdateStationInput,
} from '@afrikaisse/core';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import { requireTenant, type AuthState, type TenantScope } from '../lib/access.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';
import { loadStations } from './menu.ts';
import { addHistory, assertLocation, emitOrder, hydrateOrders } from './orders.ts';

/**
 * Postes de préparation et écran cuisine. Un poste avance SES articles ; la commande suit :
 * premier article commencé → « en préparation », dernier article prêt → « prête ».
 */

export const DEFAULT_STATIONS: readonly { name: string; kind: StationKind }[] = [
  { name: 'Cuisine', kind: 'KITCHEN' },
  { name: 'Bar', kind: 'BAR' },
];

/** Tout nouvel établissement a une cuisine et un bar : l'écran cuisine marche dès la première commande. */
export async function createDefaultStations(trx: Db, ctx: AppContext, tenantId: string, locationId: string, hlc: string) {
  const now = ctx.now();
  for (const [sort, s] of DEFAULT_STATIONS.entries()) {
    const row = { id: uuidv7(), tenant_id: tenantId, location_id: locationId, name: s.name, kind: s.kind, sort, status: 'ACTIVE' as const, created_at: now, updated_at: now, updated_hlc: hlc };
    await trx.insertInto('stations').values(row).execute();
    await recordChange(trx, ctx, { tenantId, locationId, entityType: 'station', entityId: row.id, operation: 'UPSERT', payload: row, hlc });
  }
}

async function emitStation(trx: Db, ctx: AppContext, id: string, hlc: string) {
  const row = await trx.selectFrom('stations').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: 'station', entityId: id, operation: 'UPSERT', payload: row, hlc });
}

async function findStation(db: Db, scope: TenantScope, stationId: string) {
  const row = await db.selectFrom('stations').selectAll().where('id', '=', stationId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row || row.status !== 'ACTIVE' || (scope.locationId && row.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Poste de préparation introuvable.');
  return row;
}

export async function listStations(ctx: AppContext, scope: TenantScope, locationId: string): Promise<Station[]> {
  await assertLocation(ctx.db, scope, locationId);
  return loadStations(ctx.db, locationId);
}

export async function createStation(ctx: AppContext, scope: TenantScope, locationId: string, input: CreateStationInput, meta: RequestMeta): Promise<Station[]> {
  await assertLocation(ctx.db, scope, locationId);
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const now = ctx.now();
    const top = await trx.selectFrom('stations').select((eb) => eb.fn.max('sort').as('m')).where('location_id', '=', locationId).executeTakeFirst();
    const id = uuidv7();
    await trx
      .insertInto('stations')
      .values({ id, tenant_id: scope.tenantId, location_id: locationId, name: input.name, kind: input.kind, sort: top?.m == null ? 0 : Number(top.m) + 1, status: 'ACTIVE', created_at: now, updated_at: now, updated_hlc: hlc })
      .execute();
    await emitStation(trx, ctx, id, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'station.created', entityType: 'station', entityId: id, data: input, meta });
  });
  return loadStations(ctx.db, locationId);
}

export async function updateStation(ctx: AppContext, scope: TenantScope, stationId: string, input: UpdateStationInput, meta: RequestMeta): Promise<Station[]> {
  const station = await findStation(ctx.db, scope, stationId);
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx
      .updateTable('stations')
      .set({ ...(input.name !== undefined && { name: input.name }), ...(input.kind !== undefined && { kind: input.kind }), ...(input.sort !== undefined && { sort: input.sort }), updated_at: ctx.now(), updated_hlc: hlc })
      .where('id', '=', stationId)
      .execute();
    await emitStation(trx, ctx, stationId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: station.location_id, actorUserId: scope.userId, action: 'station.updated', entityType: 'station', entityId: stationId, data: { before: { name: station.name, kind: station.kind }, changes: input }, meta });
  });
  return loadStations(ctx.db, station.location_id);
}

export async function archiveStation(ctx: AppContext, scope: TenantScope, stationId: string, meta: RequestMeta): Promise<Station[]> {
  const station = await findStation(ctx.db, scope, stationId);
  const products = await ctx.db.selectFrom('products').select('name').where('station_id', '=', stationId).where('status', '=', 'ACTIVE').orderBy('name').execute();
  if (products.length > 0) {
    throw new AppError('CONFLICT', `${products.length} produit(s) sont préparés à ce poste : affectez-les d'abord à un autre poste.`, { products: products.map((p) => p.name) });
  }
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('stations').set({ status: 'ARCHIVED', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', stationId).execute();
    await emitStation(trx, ctx, stationId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: station.location_id, actorUserId: scope.userId, action: 'station.archived', entityType: 'station', entityId: stationId, data: { name: station.name }, meta });
  });
  return loadStations(ctx.db, station.location_id);
}

const KDS_ORDER_STATUSES: readonly OrderStatus[] = ['CONFIRMED', 'PREPARING', 'READY'];

export async function kitchenAction(ctx: AppContext, auth: AuthState | null, orderId: string, input: KitchenActionInput, meta: RequestMeta): Promise<Order> {
  const scope = requireTenant(auth);
  const order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!order || (scope.locationId && order.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Commande introuvable.');

  let station: { id: string; kind: StationKind } | null = null;
  if (input.stationId) {
    const row = await ctx.db.selectFrom('stations').select(['id', 'kind']).where('id', '=', input.stationId).where('location_id', '=', order.location_id).executeTakeFirst();
    if (!row) throw new AppError('NOT_FOUND', 'Poste de préparation introuvable.');
    station = row;
  }

  let itemsQuery = ctx.db
    .selectFrom('order_items as i')
    .leftJoin('stations as s', 's.id', 'i.station_id')
    .select(['i.id', 'i.kds_status', 's.kind'])
    .where('i.order_id', '=', orderId);
  if (station) itemsQuery = itemsQuery.where('i.station_id', '=', station.id);
  const items = await itemsQuery.execute();

  // Chaque poste touché exige sa permission : la cuisine ne marque pas le bar « prêt ».
  const kinds = new Set<StationKind>(items.map((i) => i.kind ?? 'KITCHEN'));
  if (station) kinds.add(station.kind);
  if (![...kinds].every((k) => roleCan(scope.role, stationPermission(k)))) {
    throw new AppError('FORBIDDEN', 'Votre rôle ne permet pas de faire avancer ce poste.');
  }
  if (order.status === 'PENDING') throw new AppError('CONFLICT', "Cette commande n'est pas encore confirmée par le personnel de salle.");
  if (!KDS_ORDER_STATUSES.includes(order.status)) throw new AppError('CONFLICT', 'Cette commande est déjà servie ou annulée.');
  if (items.length === 0) throw new AppError('CONFLICT', "Cette commande n'a aucun article pour ce poste.");
  if (input.action === 'RECALL' && order.status === 'READY') {
    throw new AppError('CONFLICT', 'La commande est déjà annoncée prête en salle : prévenez le serveur.');
  }

  const ids = items.map((i) => i.id);
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const now = ctx.now();
    if (input.action === 'START') {
      await trx.updateTable('order_items').set({ kds_status: 'PREPARING', kds_updated_at: now }).where('id', 'in', ids).where('kds_status', '=', 'QUEUED').execute();
    } else if (input.action === 'READY') {
      await trx.updateTable('order_items').set({ kds_status: 'READY', kds_updated_at: now }).where('id', 'in', ids).where('kds_status', '!=', 'READY').execute();
    } else {
      await trx.updateTable('order_items').set({ kds_status: 'PREPARING', kds_updated_at: now }).where('id', 'in', ids).where('kds_status', '=', 'READY').execute();
    }

    const all = await trx.selectFrom('order_items').select('kds_status').where('order_id', '=', orderId).execute();
    const next: OrderStatus =
      all.every((i) => i.kds_status === 'READY') ? 'READY' : order.status === 'CONFIRMED' && all.some((i) => i.kds_status !== 'QUEUED') ? 'PREPARING' : order.status;

    if (next !== order.status) {
      const updated = await trx.updateTable('orders').set({ status: next, status_changed_at: now, updated_at: now, updated_hlc: hlc }).where('id', '=', orderId).where('status', '=', order.status).executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) throw new AppError('CONFLICT', 'Cette commande vient de changer. Actualisez puis réessayez.');
      // Confirmée puis directement tout prête : on garde l'étape « en préparation » dans l'historique.
      if (order.status === 'CONFIRMED' && next === 'READY') {
        await addHistory(trx, ctx, order, 'CONFIRMED', 'PREPARING', { userId: scope.userId, source: 'STAFF' }, hlc);
        await addHistory(trx, ctx, order, 'PREPARING', 'READY', { userId: scope.userId, source: 'STAFF' }, ctx.clock.now());
      } else {
        await addHistory(trx, ctx, order, order.status, next, { userId: scope.userId, source: 'STAFF' }, hlc);
      }
      await emitOrder(trx, ctx, orderId, 'ORDER_STATUS_CHANGED', hlc);
    } else {
      await trx.updateTable('orders').set({ updated_at: now, updated_hlc: hlc }).where('id', '=', orderId).execute();
      await emitOrder(trx, ctx, orderId, 'ORDER_UPDATED', hlc);
    }
  });
  void meta;
  return (await hydrateOrders(ctx.db, await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).execute()))[0]!;
}
