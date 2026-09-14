import { sql, type Selectable } from 'kysely';
import {
  ACTIVE_ORDER_STATUSES,
  AppError,
  ORDER_STATUS_LABELS,
  businessDate,
  canTransition,
  permissionsForTransition,
  priceLine,
  roleCan,
  uuidv7,
  type Activity,
  type Order,
  type OrderStatus,
  type PlaceQrOrderInput,
  type PricedLine,
  type PricingProduct,
  type PublicOrder,
  type ServiceRequest,
  type ServiceRequestInput,
} from '@afrikaisse/core';
import type { OrdersTable } from '@afrikaisse/database';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import { requireTenant, type AuthState, type TenantScope } from '../lib/access.ts';
import { isUniqueViolation, recordChange, writeAudit } from '../lib/journal.ts';

/**
 * Commandes, sessions de table et appels du client.
 *
 * Règles :
 * - le client n'envoie jamais de prix : tout est recalculé ici depuis le menu du moment ;
 * - une commande QR arrive « en attente » : le personnel la confirme (commandes farces, I-9) ;
 * - chaque changement de statut est une transition enregistrée, jamais un écrasement (§55) ;
 * - noms et prix sont copiés dans la commande : modifier le menu ne réécrit pas le passé.
 */

type OrderRow = Selectable<OrdersTable>;
type Priced = { productId: string; variantId: string | null; product: PricingProduct; line: Extract<PricedLine, { ok: true }>; quantity: number; note: string | null };

const MAX_ORDERS_PER_CLIENT_PER_MINUTE = 5;
const MAX_PENDING_PER_TABLE = 10;
const MAX_REQUESTS_PER_CLIENT_PER_MINUTE = 10;
const LOCAL_SERVER_SILENCE_MS = 20_000;

// --- QR ---------------------------------------------------------------------

async function resolveQr(db: Db, token: string) {
  const row = await db
    .selectFrom('qr_codes as q')
    .innerJoin('dining_tables as t', 't.id', 'q.table_id')
    .innerJoin('locations as l', 'l.id', 'q.location_id')
    .innerJoin('tenants as o', 'o.id', 'q.tenant_id')
    .select([
      'q.tenant_id',
      'q.location_id',
      'q.table_id',
      't.label as table_label',
      't.status as table_status',
      'l.status as location_status',
      'l.currency',
      'l.timezone',
      'l.business_day_cutoff_min',
      'l.operating_mode',
      'o.status as tenant_status',
    ])
    .where('q.token', '=', token)
    .where('q.revoked_at', 'is', null)
    .executeTakeFirst();
  if (!row || row.table_status !== 'ACTIVE' || row.location_status !== 'ACTIVE' || row.tenant_status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', "Ce QR code n'est plus valide. Demandez au personnel.");
  }
  return row;
}

/** Activité récente d'un même téléphone DANS cet établissement (un autre restaurant ne compte pas). */
async function countSince(db: Db, table: 'orders' | 'service_requests', locationId: string, clientToken: string, since: number) {
  const row = await db
    .selectFrom(table as 'orders')
    .select((eb) => eb.fn.countAll().as('n'))
    .where('location_id', '=', locationId)
    .where('client_token', '=', clientToken)
    .where('created_at', '>', since)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

// --- Prix depuis le menu du moment ------------------------------------------

async function loadPricingProducts(db: Db, locationId: string, productIds: string[]): Promise<Map<string, PricingProduct>> {
  const ids = [...new Set(productIds)];
  const result = new Map<string, PricingProduct>();
  if (ids.length === 0) return result;
  const products = await db
    .selectFrom('products as p')
    .innerJoin('menu_categories as c', 'c.id', 'p.category_id')
    .select(['p.id', 'p.name', 'p.price', 'p.promo_price', 'p.is_available'])
    .where('p.location_id', '=', locationId)
    .where('p.id', 'in', ids)
    .where('p.status', '=', 'ACTIVE')
    .where('c.status', '=', 'ACTIVE')
    .where('c.is_visible', '=', 1)
    .execute();
  if (products.length === 0) return result;
  const pids = products.map((p) => p.id);
  const [variants, links] = await Promise.all([
    db.selectFrom('product_variants').select(['id', 'product_id', 'name', 'price_delta', 'is_available']).where('product_id', 'in', pids).where('status', '=', 'ACTIVE').orderBy('sort').execute(),
    db
      .selectFrom('product_modifier_groups as l')
      .innerJoin('modifier_groups as g', 'g.id', 'l.group_id')
      .select(['l.product_id', 'g.id', 'g.name', 'g.min_select', 'g.max_select'])
      .where('l.product_id', 'in', pids)
      .where('g.status', '=', 'ACTIVE')
      .orderBy('l.sort')
      .execute(),
  ]);
  const groupIds = [...new Set(links.map((l) => l.id))];
  const modifiers = groupIds.length
    ? await db.selectFrom('modifiers').select(['id', 'group_id', 'name', 'price_delta', 'is_available']).where('group_id', 'in', groupIds).where('status', '=', 'ACTIVE').orderBy('sort').execute()
    : [];
  const option = (o: { id: string; name: string; price_delta: number; is_available: 0 | 1 }) => ({ id: o.id, name: o.name, priceDelta: o.price_delta, isAvailable: o.is_available === 1 });
  for (const p of products) {
    result.set(p.id, {
      id: p.id,
      name: p.name,
      price: p.price,
      promoPrice: p.promo_price,
      isAvailable: p.is_available === 1,
      variants: variants.filter((v) => v.product_id === p.id).map(option),
      modifierGroups: links
        .filter((l) => l.product_id === p.id)
        .map((g) => ({ id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select, modifiers: modifiers.filter((m) => m.group_id === g.id).map(option) })),
    });
  }
  return result;
}

function priceLines(pricing: Map<string, PricingProduct>, lines: PlaceQrOrderInput['lines']): Priced[] {
  return lines.map((line, index) => {
    const product = pricing.get(line.productId);
    if (!product) throw new AppError('CONFLICT', "Un article du panier n'est plus au menu. Retirez-le puis recommandez.", { line: index });
    const priced = priceLine(product, { variantId: line.variantId ?? null, modifierIds: line.modifierIds, quantity: line.quantity });
    if (!priced.ok) throw new AppError('CONFLICT', priced.message, { line: index, code: priced.code });
    return { productId: product.id, variantId: priced.variant?.id ?? null, product, line: priced, quantity: line.quantity, note: line.note?.trim() || null };
  });
}

// --- Écritures communes -----------------------------------------------------

async function openSession(trx: Db, ctx: AppContext, where: { tenantId: string; locationId: string; tableId: string; userId: string | null }, hlc: string): Promise<string> {
  const open = await trx.selectFrom('table_sessions').select('id').where('table_id', '=', where.tableId).where('status', '=', 'OPEN').executeTakeFirst();
  if (open) return open.id;
  const id = uuidv7();
  const now = ctx.now();
  await trx
    .insertInto('table_sessions')
    .values({ id, tenant_id: where.tenantId, location_id: where.locationId, table_id: where.tableId, status: 'OPEN', opened_at: now, opened_by: where.userId, closed_at: null, closed_by: null, updated_at: now, updated_hlc: hlc })
    .execute();
  const row = await trx.selectFrom('table_sessions').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: where.tenantId, locationId: where.locationId, entityType: 'table_session', entityId: id, operation: 'UPSERT', payload: row, hlc });
  return id;
}

/** Numéro suivant de la journée, atomique (upsert) : deux tablettes ne reçoivent jamais le même. */
async function nextOrderNumber(trx: Db, locationId: string, date: string): Promise<number> {
  const row = await trx
    .insertInto('order_counters')
    .values({ location_id: locationId, business_date: date, last_number: 1 })
    .onConflict((oc) => oc.columns(['location_id', 'business_date']).doUpdateSet({ last_number: sql<number>`order_counters.last_number + 1` }))
    .returning('last_number')
    .executeTakeFirstOrThrow();
  return Number(row.last_number);
}

async function addHistory(
  trx: Db,
  ctx: AppContext,
  order: { id: string; tenant_id: string; location_id: string },
  from: OrderStatus | null,
  to: OrderStatus,
  by: { userId: string | null; source: 'QR' | 'STAFF' | 'SYSTEM'; reason?: string | null },
  hlc: string,
) {
  await trx
    .insertInto('order_status_history')
    .values({ id: uuidv7(), tenant_id: order.tenant_id, location_id: order.location_id, order_id: order.id, from_status: from, to_status: to, reason: by.reason ?? null, by_user_id: by.userId, source: by.source, at: ctx.now(), hlc })
    .execute();
}

async function emitOrder(trx: Db, ctx: AppContext, orderId: string, operation: 'ORDER_PLACED' | 'ORDER_STATUS_CHANGED', hlc: string) {
  const [order] = await hydrateOrders(trx, await trx.selectFrom('orders').selectAll().where('id', '=', orderId).execute());
  const row = await trx.selectFrom('orders').select(['tenant_id', 'location_id']).where('id', '=', orderId).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: 'order', entityId: orderId, operation, payload: order!, hlc });
}

// --- Lecture ----------------------------------------------------------------

export async function hydrateOrders(db: Db, rows: OrderRow[]): Promise<Order[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const tableIds = [...new Set(rows.map((r) => r.table_id).filter((x): x is string => x !== null))];
  const [items, history, tables] = await Promise.all([
    db.selectFrom('order_items').selectAll().where('order_id', 'in', ids).orderBy('sort').execute(),
    db
      .selectFrom('order_status_history as h')
      .leftJoin('users as u', 'u.id', 'h.by_user_id')
      .select(['h.order_id', 'h.from_status', 'h.to_status', 'h.at', 'h.reason', 'h.source', 'u.display_name'])
      .where('h.order_id', 'in', ids)
      .orderBy('h.at')
      .execute(),
    tableIds.length ? db.selectFrom('dining_tables').select(['id', 'label']).where('id', 'in', tableIds).execute() : Promise.resolve([]),
  ]);
  const itemIds = items.map((i) => i.id);
  const modifiers = itemIds.length ? await db.selectFrom('order_item_modifiers').selectAll().where('order_item_id', 'in', itemIds).execute() : [];

  return rows.map((o) => {
    const own = items.filter((i) => i.order_id === o.id);
    return {
      id: o.id,
      locationId: o.location_id,
      number: o.number,
      businessDate: o.business_date,
      source: o.source,
      status: o.status,
      tableId: o.table_id,
      tableLabel: tables.find((t) => t.id === o.table_id)?.label ?? null,
      sessionId: o.table_session_id,
      note: o.note,
      currency: o.currency,
      subtotal: o.subtotal,
      total: o.total,
      itemCount: own.reduce((sum, i) => sum + i.quantity, 0),
      items: own.map((i) => ({
        id: i.id,
        productId: i.product_id,
        name: i.name,
        variantName: i.variant_name,
        unitPrice: i.unit_price,
        quantity: i.quantity,
        total: i.total,
        note: i.note,
        modifiers: modifiers.filter((m) => m.order_item_id === i.id).map((m) => ({ groupName: m.group_name, name: m.name, priceDelta: m.price_delta })),
      })),
      createdAt: o.created_at,
      statusChangedAt: o.status_changed_at,
      history: history
        .filter((h) => h.order_id === o.id)
        .map((h) => ({ from: h.from_status, to: h.to_status, at: h.at, by: h.display_name ?? (h.source === 'QR' ? 'Client (QR)' : null), reason: h.reason })),
    };
  });
}

function toPublic(order: Order): PublicOrder {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    tableLabel: order.tableLabel,
    currency: order.currency,
    total: order.total,
    note: order.note,
    items: order.items.map((i) => ({ name: i.name, variantName: i.variantName, quantity: i.quantity, total: i.total, note: i.note, modifiers: i.modifiers.map((m) => m.name) })),
    createdAt: order.createdAt,
    statusChangedAt: order.statusChangedAt,
  };
}

// --- Côté client (QR) ---------------------------------------------------------

export async function placeQrOrder(ctx: AppContext, token: string, input: PlaceQrOrderInput, meta: RequestMeta): Promise<PublicOrder> {
  const qr = await resolveQr(ctx.db, token);

  // Établissement exploité par un serveur local : le Cloud ne peut pas faire préparer une
  // commande que la cuisine ne recevra pas (SYNC.md §6).
  if (ctx.config.profile === 'cloud' && qr.operating_mode === 'HYBRID') {
    const alive = await ctx.db
      .selectFrom('devices')
      .select('id')
      .where('location_id', '=', qr.location_id)
      .where('kind', '=', 'LOCAL_SERVER')
      .where('status', '=', 'ACTIVE')
      .where('last_seen_at', '>', ctx.now() - LOCAL_SERVER_SILENCE_MS)
      .executeTakeFirst();
    if (!alive) throw new AppError('SERVICE_UNAVAILABLE', 'La commande en ligne est momentanément indisponible. Adressez-vous à un serveur.');
  }

  const now = ctx.now();
  if ((await countSince(ctx.db, 'orders', qr.location_id, input.clientToken, now - 60_000)) >= MAX_ORDERS_PER_CLIENT_PER_MINUTE) {
    throw new AppError('TOO_MANY_ATTEMPTS', 'Trop de commandes en peu de temps. Patientez un instant.');
  }
  const pending = await ctx.db.selectFrom('orders').select((eb) => eb.fn.countAll().as('n')).where('table_id', '=', qr.table_id).where('status', '=', 'PENDING').executeTakeFirstOrThrow();
  if (Number(pending.n) >= MAX_PENDING_PER_TABLE) {
    throw new AppError('TOO_MANY_ATTEMPTS', 'Plusieurs commandes de cette table attendent déjà la confirmation du personnel.');
  }

  const priced = priceLines(await loadPricingProducts(ctx.db, qr.location_id, input.lines.map((l) => l.productId)), input.lines);
  const total = priced.reduce((sum, p) => sum + p.line.total, 0);

  // Deux clients de la même table au même instant : une seule session ouverte et des numéros
  // uniques sont garantis par des index ; en cas de collision, on rejoue une fois.
  for (let attempt = 1; ; attempt++) {
    const orderId = uuidv7();
    try {
      await ctx.db.transaction().execute(async (trx) => {
        const hlc = ctx.clock.now();
        const sessionId = await openSession(trx, ctx, { tenantId: qr.tenant_id, locationId: qr.location_id, tableId: qr.table_id, userId: null }, hlc);
        const date = businessDate(now, qr.timezone, qr.business_day_cutoff_min);
        const number = await nextOrderNumber(trx, qr.location_id, date);
        const order = { id: orderId, tenant_id: qr.tenant_id, location_id: qr.location_id };
        await trx
          .insertInto('orders')
          .values({
            ...order,
            table_session_id: sessionId,
            table_id: qr.table_id,
            number,
            business_date: date,
            source: 'QR',
            status: 'PENDING',
            note: input.note?.trim() || null,
            currency: qr.currency,
            subtotal: total,
            total,
            client_token: input.clientToken,
            created_by: null,
            created_at: now,
            updated_at: now,
            status_changed_at: now,
            updated_hlc: hlc,
          })
          .execute();
        await insertItems(trx, ctx, order, priced);
        await addHistory(trx, ctx, order, null, 'PENDING', { userId: null, source: 'QR' }, hlc);
        await emitOrder(trx, ctx, orderId, 'ORDER_PLACED', hlc);
        await writeAudit(trx, ctx, { tenantId: qr.tenant_id, locationId: qr.location_id, action: 'order.qr_placed', subject: `table ${qr.table_label}`, entityType: 'order', entityId: orderId, data: { number, total, lines: priced.length }, meta });
      });
      const [order] = await hydrateOrders(ctx.db, await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).execute());
      return toPublic(order!);
    } catch (err) {
      if (attempt < 2 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
}

async function insertItems(trx: Db, ctx: AppContext, order: { id: string; tenant_id: string; location_id: string }, priced: Priced[]) {
  const now = ctx.now();
  for (const [sort, p] of priced.entries()) {
    const itemId = uuidv7();
    await trx
      .insertInto('order_items')
      .values({
        id: itemId,
        tenant_id: order.tenant_id,
        location_id: order.location_id,
        order_id: order.id,
        product_id: p.productId,
        variant_id: p.variantId,
        name: p.product.name,
        variant_name: p.line.variant?.name ?? null,
        unit_price: p.line.unitPrice,
        quantity: p.quantity,
        total: p.line.total,
        note: p.note,
        sort,
        created_at: now,
      })
      .execute();
    for (const m of p.line.modifiers) {
      await trx
        .insertInto('order_item_modifiers')
        .values({
          id: uuidv7(),
          tenant_id: order.tenant_id,
          location_id: order.location_id,
          order_item_id: itemId,
          modifier_id: m.id,
          group_name: p.product.modifierGroups.find((g) => g.id === m.groupId)?.name ?? '',
          name: m.name,
          price_delta: m.priceDelta,
          created_at: now,
        })
        .execute();
    }
  }
}

/** Commandes de ce téléphone pour cette table, sur les 12 dernières heures. */
export async function listClientOrders(ctx: AppContext, token: string, clientToken: string): Promise<PublicOrder[]> {
  const qr = await resolveQr(ctx.db, token);
  const rows = await ctx.db
    .selectFrom('orders')
    .selectAll()
    .where('table_id', '=', qr.table_id)
    .where('client_token', '=', clientToken)
    .where('created_at', '>', ctx.now() - 12 * 3600_000)
    .orderBy('created_at', 'desc')
    .execute();
  return (await hydrateOrders(ctx.db, rows)).map(toPublic);
}

export async function createServiceRequest(ctx: AppContext, token: string, input: ServiceRequestInput): Promise<ServiceRequest> {
  const qr = await resolveQr(ctx.db, token);
  const now = ctx.now();
  if ((await countSince(ctx.db, 'service_requests', qr.location_id, input.clientToken, now - 60_000)) >= MAX_REQUESTS_PER_CLIENT_PER_MINUTE) {
    throw new AppError('TOO_MANY_ATTEMPTS', 'Votre demande a déjà été transmise. Patientez un instant.');
  }
  // Déjà signalé et pas encore traité : on ne fait pas sonner deux fois.
  const existing = await ctx.db.selectFrom('service_requests').select('id').where('table_id', '=', qr.table_id).where('kind', '=', input.kind).where('status', '=', 'OPEN').executeTakeFirst();
  if (existing) return (await loadRequests(ctx.db, (q) => q.where('r.id', '=', existing.id)))[0]!;

  const id = uuidv7();
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const session = await trx.selectFrom('table_sessions').select('id').where('table_id', '=', qr.table_id).where('status', '=', 'OPEN').executeTakeFirst();
    await trx
      .insertInto('service_requests')
      .values({ id, tenant_id: qr.tenant_id, location_id: qr.location_id, table_id: qr.table_id, table_session_id: session?.id ?? null, kind: input.kind, status: 'OPEN', client_token: input.clientToken, created_at: now, handled_at: null, handled_by: null, updated_hlc: hlc })
      .execute();
    await emitRequest(trx, ctx, id, hlc);
  });
  return (await loadRequests(ctx.db, (q) => q.where('r.id', '=', id)))[0]!;
}

async function emitRequest(trx: Db, ctx: AppContext, id: string, hlc: string) {
  const row = await trx.selectFrom('service_requests').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: 'service_request', entityId: id, operation: 'UPSERT', payload: row, hlc });
}

type RequestQuery = Parameters<Parameters<typeof loadRequests>[1]>[0];

async function loadRequests(db: Db, where: (q: ReturnType<typeof requestBase>) => ReturnType<typeof requestBase>): Promise<ServiceRequest[]> {
  const rows = await where(requestBase(db)).orderBy('r.created_at').execute();
  return rows.map((r) => ({
    id: r.id,
    locationId: r.location_id,
    tableId: r.table_id,
    tableLabel: r.label,
    kind: r.kind,
    status: r.status,
    createdAt: r.created_at,
    handledAt: r.handled_at,
    handledBy: r.display_name,
  }));
}

function requestBase(db: Db) {
  return db
    .selectFrom('service_requests as r')
    .innerJoin('dining_tables as t', 't.id', 'r.table_id')
    .leftJoin('users as u', 'u.id', 'r.handled_by')
    .select(['r.id', 'r.location_id', 'r.table_id', 't.label', 'r.kind', 'r.status', 'r.created_at', 'r.handled_at', 'u.display_name']);
}

export type { RequestQuery };

// --- Côté personnel -----------------------------------------------------------

async function assertLocation(db: Db, scope: TenantScope, locationId: string) {
  const notFound = new AppError('NOT_FOUND', 'Établissement introuvable.');
  if (scope.locationId && scope.locationId !== locationId) throw notFound;
  const row = await db.selectFrom('locations').select(['id', 'timezone', 'business_day_cutoff_min']).where('id', '=', locationId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row) throw notFound;
  return row;
}

export async function listOrders(ctx: AppContext, scope: TenantScope, locationId: string, view: 'active' | 'today'): Promise<Order[]> {
  const location = await assertLocation(ctx.db, scope, locationId);
  let q = ctx.db.selectFrom('orders').selectAll().where('location_id', '=', locationId);
  q = view === 'active'
    ? q.where('status', 'in', [...ACTIVE_ORDER_STATUSES])
    : q.where('business_date', '=', businessDate(ctx.now(), location.timezone, location.business_day_cutoff_min));
  return hydrateOrders(ctx.db, await q.orderBy('created_at', 'desc').limit(300).execute());
}

export async function updateOrderStatus(ctx: AppContext, auth: AuthState | null, orderId: string, to: OrderStatus, reason: string | undefined, meta: RequestMeta): Promise<Order> {
  const scope = requireTenant(auth);
  const order = await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!order || (scope.locationId && order.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Commande introuvable.');
  if (order.status === to) return (await hydrateOrders(ctx.db, [order]))[0]!;
  if (!canTransition(order.status, to)) {
    throw new AppError('CONFLICT', `Impossible de passer de « ${ORDER_STATUS_LABELS[order.status]} » à « ${ORDER_STATUS_LABELS[to]} ».`);
  }
  if (!permissionsForTransition(order.status, to).some((p) => roleCan(scope.role, p))) {
    throw new AppError('FORBIDDEN', 'Votre rôle ne permet pas cette action sur la commande.');
  }
  const cleanReason = reason?.trim() || null;
  if (to === 'CANCELLED' && order.status !== 'PENDING' && !cleanReason) {
    throw new AppError('VALIDATION', "Indiquez le motif de l'annulation.");
  }

  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const now = ctx.now();
    // Condition sur l'ancien statut : deux personnes qui touchent en même temps, une seule gagne.
    const updated = await trx
      .updateTable('orders')
      .set({ status: to, status_changed_at: now, updated_at: now, updated_hlc: hlc })
      .where('id', '=', orderId)
      .where('status', '=', order.status)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) throw new AppError('CONFLICT', 'Cette commande vient de changer. Actualisez puis réessayez.');
    await addHistory(trx, ctx, order, order.status, to, { userId: scope.userId, source: 'STAFF', reason: cleanReason }, hlc);
    await emitOrder(trx, ctx, orderId, 'ORDER_STATUS_CHANGED', hlc);
    if (to === 'CANCELLED') {
      await writeAudit(trx, ctx, {
        tenantId: scope.tenantId,
        locationId: order.location_id,
        actorUserId: scope.userId,
        action: order.status === 'PENDING' ? 'order.rejected' : 'order.cancelled',
        entityType: 'order',
        entityId: orderId,
        data: { number: order.number, total: order.total, from: order.status, reason: cleanReason },
        meta,
      });
    }
  });
  return (await hydrateOrders(ctx.db, await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).execute()))[0]!;
}

export async function listOpenRequests(ctx: AppContext, scope: TenantScope, locationId: string): Promise<ServiceRequest[]> {
  await assertLocation(ctx.db, scope, locationId);
  return loadRequests(ctx.db, (q) => q.where('r.location_id', '=', locationId).where('r.status', '=', 'OPEN'));
}

export async function resolveServiceRequest(ctx: AppContext, scope: TenantScope, requestId: string): Promise<ServiceRequest> {
  const request = await ctx.db.selectFrom('service_requests').selectAll().where('id', '=', requestId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!request || (scope.locationId && request.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Demande introuvable.');
  if (request.status === 'OPEN') {
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      await trx.updateTable('service_requests').set({ status: 'DONE', handled_at: ctx.now(), handled_by: scope.userId, updated_hlc: hlc }).where('id', '=', requestId).where('status', '=', 'OPEN').execute();
      await emitRequest(trx, ctx, requestId, hlc);
    });
  }
  return (await loadRequests(ctx.db, (q) => q.where('r.id', '=', requestId)))[0]!;
}

export async function closeTableSession(ctx: AppContext, scope: TenantScope, sessionId: string, meta: RequestMeta) {
  const session = await ctx.db.selectFrom('table_sessions').selectAll().where('id', '=', sessionId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!session || (scope.locationId && session.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Table introuvable.');
  if (session.status === 'CLOSED') return;
  const active = await ctx.db
    .selectFrom('orders')
    .select((eb) => eb.fn.countAll().as('n'))
    .where('table_session_id', '=', sessionId)
    .where('status', 'in', [...ACTIVE_ORDER_STATUSES])
    .executeTakeFirstOrThrow();
  if (Number(active.n) > 0) {
    throw new AppError('CONFLICT', `${Number(active.n)} commande(s) de cette table ne sont pas terminées.`);
  }
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const now = ctx.now();
    await trx.updateTable('table_sessions').set({ status: 'CLOSED', closed_at: now, closed_by: scope.userId, updated_at: now, updated_hlc: hlc }).where('id', '=', sessionId).execute();
    const row = await trx.selectFrom('table_sessions').selectAll().where('id', '=', sessionId).executeTakeFirstOrThrow();
    await recordChange(trx, ctx, { tenantId: scope.tenantId, locationId: session.location_id, entityType: 'table_session', entityId: sessionId, operation: 'UPSERT', payload: row, hlc });
    const open = await trx.selectFrom('service_requests').select('id').where('table_session_id', '=', sessionId).where('status', '=', 'OPEN').execute();
    for (const r of open) {
      await trx.updateTable('service_requests').set({ status: 'DONE', handled_at: now, handled_by: scope.userId, updated_hlc: hlc }).where('id', '=', r.id).execute();
      await emitRequest(trx, ctx, r.id, hlc);
    }
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: session.location_id, actorUserId: scope.userId, action: 'table.freed', entityType: 'table_session', entityId: sessionId, meta });
  });
}

/**
 * Flux d'activité des écrans du personnel. Le journal de synchronisation sert de flux de
 * changements : depuis un curseur, on renvoie les commandes et appels modifiés. Fonctionne
 * par simple interrogation régulière, donc partout (o2switch sans WebSocket, vieille WebView).
 */
export async function getActivity(ctx: AppContext, scope: TenantScope, locationId: string, since: number): Promise<Activity> {
  await assertLocation(ctx.db, scope, locationId);
  const top = await ctx.db.selectFrom('sync_events').select((eb) => eb.fn.max('seq').as('m')).where('location_id', '=', locationId).executeTakeFirst();
  const cursor = Number(top?.m ?? 0);

  if (since <= 0 || since > cursor) {
    const [orders, requests] = await Promise.all([listOrders(ctx, scope, locationId, 'active'), listOpenRequests(ctx, scope, locationId)]);
    return { cursor, full: true, orders, requests };
  }
  const changed = await ctx.db
    .selectFrom('sync_events')
    .select(['entity_type', 'entity_id'])
    .where('location_id', '=', locationId)
    .where('seq', '>', since)
    .where('seq', '<=', cursor)
    .where('entity_type', 'in', ['order', 'service_request'])
    .execute();
  const orderIds = [...new Set(changed.filter((c) => c.entity_type === 'order').map((c) => c.entity_id))];
  const requestIds = [...new Set(changed.filter((c) => c.entity_type === 'service_request').map((c) => c.entity_id))];
  const [orders, requests] = await Promise.all([
    orderIds.length ? hydrateOrders(ctx.db, await ctx.db.selectFrom('orders').selectAll().where('id', 'in', orderIds).execute()) : Promise.resolve([]),
    requestIds.length ? loadRequests(ctx.db, (q) => q.where('r.id', 'in', requestIds)) : Promise.resolve([]),
  ]);
  return { cursor, full: false, orders, requests };
}
