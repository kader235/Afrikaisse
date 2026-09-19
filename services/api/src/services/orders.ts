import { sql, type Selectable } from 'kysely';
import {
  ACTIVE_ORDER_STATUSES,
  AppError,
  ORDER_STATUS_LABELS,
  billShares,
  businessDate,
  canTransition,
  formatMoney,
  generateTableCode,
  normalizeNickname,
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
import { notifyOrder, notifyRequest } from '../lib/notify.ts';
import { resolveDailyMenuProductIds } from './dailyMenu.ts';
import { findGuest, loadGuests, onlineOrderingOpen, upsertGuest, verifyTableCode } from './guests.ts';
import { enqueueKitchenTickets } from './printing.ts';
import { consumeStock, restoreStock } from './stock.ts';
import { orderPricingColumns, parseApplied, parseTaxes, priceOrderLines, reserveUses, type LinePricing } from './pricing.ts';

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
/** Ligne validée ; `pricing` : promotion et taux calculés par services/pricing.ts. */
export type Priced = { productId: string; variantId: string | null; product: PricingProduct; line: Extract<PricedLine, { ok: true }>; quantity: number; note: string | null; pricing?: LinePricing };

const MAX_ORDERS_PER_CLIENT_PER_MINUTE = 5;
const MAX_PENDING_PER_TABLE = 10;
const MAX_REQUESTS_PER_CLIENT_PER_MINUTE = 10;

// --- QR ---------------------------------------------------------------------

export async function resolveQr(db: Db, token: string) {
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
      'l.name as location_name',
      'l.table_code_required',
      'l.bill_mode',
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

/** `includeHidden` : la caisse vend aussi les catégories masquées au client (repas du personnel…). */
export async function loadPricingProducts(db: Db, locationId: string, productIds: string[], options: { includeHidden?: boolean; dailyMenu?: Set<string> | null } = {}): Promise<Map<string, PricingProduct>> {
  const ids = [...new Set(productIds)];
  const result = new Map<string, PricingProduct>();
  if (ids.length === 0) return result;
  let query = db
    .selectFrom('products as p')
    .innerJoin('menu_categories as c', 'c.id', 'p.category_id')
    .select(['p.id', 'p.name', 'p.price', 'p.promo_price', 'p.is_available'])
    .where('p.location_id', '=', locationId)
    .where('p.id', 'in', ids)
    .where('p.status', '=', 'ACTIVE')
    .where('c.status', '=', 'ACTIVE');
  if (!options.includeHidden) query = query.where('c.is_visible', '=', 1);
  const found = await query.execute();
  // `dailyMenu` : menu du jour en vigueur (chemins du client QR seulement) ; un plat hors menu est traité comme absent de la carte.
  const products = options.dailyMenu ? found.filter((p) => options.dailyMenu!.has(p.id)) : found;
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

export function priceLines(pricing: Map<string, PricingProduct>, lines: PlaceQrOrderInput['lines']): Priced[] {
  return lines.map((line, index) => {
    const product = pricing.get(line.productId);
    if (!product) throw new AppError('CONFLICT', "Un article du panier n'est plus au menu. Retirez-le puis recommandez.", { line: index });
    const priced = priceLine(product, { variantId: line.variantId ?? null, modifierIds: line.modifierIds, quantity: line.quantity });
    if (!priced.ok) throw new AppError('CONFLICT', priced.message, { line: index, code: priced.code });
    return { productId: product.id, variantId: priced.variant?.id ?? null, product, line: priced, quantity: line.quantity, note: line.note?.trim() || null };
  });
}

// --- Écritures communes -----------------------------------------------------

export async function openSession(trx: Db, ctx: AppContext, where: { tenantId: string; locationId: string; tableId: string; userId: string | null }, hlc: string): Promise<string> {
  const open = await trx.selectFrom('table_sessions').select('id').where('table_id', '=', where.tableId).where('status', '=', 'OPEN').executeTakeFirst();
  if (open) return open.id;
  const id = uuidv7();
  const now = ctx.now();
  await trx
    .insertInto('table_sessions')
    .values({ id, tenant_id: where.tenantId, location_id: where.locationId, table_id: where.tableId, status: 'OPEN', opened_at: now, opened_by: where.userId, closed_at: null, closed_by: null, join_code: generateTableCode(), updated_at: now, updated_hlc: hlc })
    .execute();
  const row = await trx.selectFrom('table_sessions').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: where.tenantId, locationId: where.locationId, entityType: 'table_session', entityId: id, operation: 'UPSERT', payload: row, hlc });
  return id;
}

/** Numéro suivant de la journée, atomique (upsert) : deux tablettes ne reçoivent jamais le même. */
export async function nextOrderNumber(trx: Db, locationId: string, date: string): Promise<number> {
  const row = await trx
    .insertInto('order_counters')
    .values({ location_id: locationId, business_date: date, last_number: 1 })
    .onConflict((oc) => oc.columns(['location_id', 'business_date']).doUpdateSet({ last_number: sql<number>`order_counters.last_number + 1` }))
    .returning('last_number')
    .executeTakeFirstOrThrow();
  return Number(row.last_number);
}

export async function addHistory(
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

export async function emitOrder(trx: Db, ctx: AppContext, orderId: string, operation: 'ORDER_PLACED' | 'ORDER_STATUS_CHANGED' | 'ORDER_UPDATED', hlc: string) {
  const rows = await trx.selectFrom('orders').selectAll().where('id', '=', orderId).execute();
  const [order] = await hydrateOrders(trx, rows);
  const row = rows[0]!;
  // Lignes brutes en plus de la commande lisible : le nœud qui reçoit les rejoue telles quelles (SYNC.md).
  const items = await trx.selectFrom('order_items').selectAll().where('order_id', '=', orderId).execute();
  const modifiers = items.length ? await trx.selectFrom('order_item_modifiers').selectAll().where('order_item_id', 'in', items.map((i) => i.id)).execute() : [];
  const history = await trx.selectFrom('order_status_history').selectAll().where('order_id', '=', orderId).execute();
  await recordChange(trx, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: 'order', entityId: orderId, operation, payload: { order: order!, rows: { order: row, items, modifiers, history } }, hlc });
}

// --- Lecture ----------------------------------------------------------------

export async function hydrateOrders(db: Db, rows: OrderRow[]): Promise<Order[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const tableIds = [...new Set(rows.map((r) => r.table_id).filter((x): x is string => x !== null))];
  const sessionIds = rows.filter((r) => r.client_token && r.table_session_id).map((r) => r.table_session_id!);
  const [items, history, tables, guests] = await Promise.all([
    db.selectFrom('order_items').selectAll().where('order_id', 'in', ids).orderBy('sort').execute(),
    db
      .selectFrom('order_status_history as h')
      .leftJoin('users as u', 'u.id', 'h.by_user_id')
      .select(['h.order_id', 'h.from_status', 'h.to_status', 'h.at', 'h.reason', 'h.source', 'h.by_user_id', 'u.display_name'])
      .where('h.order_id', 'in', ids)
      .orderBy('h.at')
      .orderBy('h.hlc')
      .execute(),
    tableIds.length ? db.selectFrom('dining_tables').select(['id', 'label']).where('id', 'in', tableIds).execute() : Promise.resolve([]),
    loadGuests(db, sessionIds),
  ]);
  const itemIds = items.map((i) => i.id);
  const modifiers = itemIds.length ? await db.selectFrom('order_item_modifiers').selectAll().where('order_item_id', 'in', itemIds).execute() : [];

  return rows.map((o) => {
    const own = items.filter((i) => i.order_id === o.id);
    const applied = parseApplied(o.applied_promotions);
    const names = new Map(applied.map((a) => [a.id, a.name]));
    const codeName = o.promo_code_promotion_id ? (names.get(o.promo_code_promotion_id) ?? o.promo_code) : null;
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
      guestName: (o.client_token && o.table_session_id && guests.get(o.table_session_id)?.find((g) => g.clientToken === o.client_token)?.name) || null,
      note: o.note,
      serviceType: o.service_type,
      customerName: o.customer_name,
      currency: o.currency,
      subtotal: o.subtotal,
      promotionDiscount: o.promotion_discount,
      promotions: applied,
      promoCode: o.promo_code,
      taxMode: o.tax_mode,
      taxTotal: o.tax_total,
      taxes: parseTaxes(o.taxes),
      discount: o.discount,
      discountReason: o.discount_reason,
      total: o.total,
      paid: o.paid_amount,
      paymentStatus: o.payment_status,
      itemCount: own.reduce((sum, i) => sum + i.quantity, 0),
      items: own.map((i) => ({
        id: i.id,
        productId: i.product_id,
        name: i.name,
        variantName: i.variant_name,
        unitPrice: i.unit_price,
        quantity: i.quantity,
        total: i.total,
        promotionName: [i.promotion_id ? names.get(i.promotion_id) : null, i.code_discount > 0 ? codeName : null].filter(Boolean).join(' + ') || null,
        promotionDiscount: i.promotion_discount + i.code_discount,
        note: i.note,
        modifiers: modifiers.filter((m) => m.order_item_id === i.id).map((m) => ({ groupName: m.group_name, name: m.name, priceDelta: m.price_delta })),
        stationId: i.station_id,
        kdsStatus: i.kds_status,
      })),
      createdAt: o.created_at,
      statusChangedAt: o.status_changed_at,
      history: history
        .filter((h) => h.order_id === o.id)
        .map((h) => ({ from: h.from_status, to: h.to_status, at: h.at, by: h.display_name ?? (h.source === 'QR' ? 'Client (QR)' : null), byUserId: h.by_user_id, reason: h.reason })),
    };
  });
}

export function toPublic(order: Order, mine: boolean): PublicOrder {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    tableLabel: order.tableLabel,
    guestName: order.guestName,
    mine,
    currency: order.currency,
    subtotal: order.subtotal,
    promotionDiscount: order.promotionDiscount,
    promotions: order.promotions,
    taxMode: order.taxMode,
    taxTotal: order.taxTotal,
    taxes: order.taxes,
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
  if (!(await onlineOrderingOpen(ctx, qr))) {
    throw new AppError('SERVICE_UNAVAILABLE', 'La commande en ligne est momentanément indisponible. Adressez-vous à un serveur.', { reason: 'ORDERING_UNAVAILABLE' });
  }

  // Code de table (I-9) : la table doit être ouverte par le personnel, et ce téléphone l'avoir
  // rejointe avec le code, ou le joindre à cette commande.
  const nickname = normalizeNickname(input.nickname);
  let codeSession: string | null = null;
  if (qr.table_code_required === 1) {
    const session = await ctx.db.selectFrom('table_sessions').select(['id', 'tenant_id', 'location_id', 'join_code']).where('table_id', '=', qr.table_id).where('status', '=', 'OPEN').executeTakeFirst();
    if (!session) throw new AppError('CONFLICT', "La table n'est pas encore ouverte. Demandez le code de table au serveur.", { reason: 'TABLE_NOT_OPEN' });
    if (!(await findGuest(ctx.db, session.id, input.clientToken))) await verifyTableCode(ctx, session, input.tableCode, meta);
    codeSession = session.id;
  }

  const now = ctx.now();
  if ((await countSince(ctx.db, 'orders', qr.location_id, input.clientToken, now - 60_000)) >= MAX_ORDERS_PER_CLIENT_PER_MINUTE) {
    throw new AppError('TOO_MANY_ATTEMPTS', 'Trop de commandes en peu de temps. Patientez un instant.');
  }
  const pending = await ctx.db.selectFrom('orders').select((eb) => eb.fn.countAll().as('n')).where('table_id', '=', qr.table_id).where('status', '=', 'PENDING').executeTakeFirstOrThrow();
  if (Number(pending.n) >= MAX_PENDING_PER_TABLE) {
    throw new AppError('TOO_MANY_ATTEMPTS', 'Plusieurs commandes de cette table attendent déjà la confirmation du personnel.');
  }

  const dailyMenu = await resolveDailyMenuProductIds(ctx.db, qr.location_id, qr.timezone, qr.business_day_cutoff_min, now);
  const priced = priceLines(await loadPricingProducts(ctx.db, qr.location_id, input.lines.map((l) => l.productId), { dailyMenu }), input.lines);
  // Promotions et taxes du moment, dans le fuseau de l'établissement ; un code refusé bloque la commande.
  const quote = await priceOrderLines(ctx.db, { id: qr.location_id, timezone: qr.timezone, currency: qr.currency }, priced, input.promoCode, now);
  const total = quote.pricing.total;

  // Deux clients de la même table au même instant : une seule session ouverte et des numéros
  // uniques sont garantis par des index ; en cas de collision, on rejoue une fois.
  for (let attempt = 1; ; attempt++) {
    const orderId = uuidv7();
    try {
      await ctx.db.transaction().execute(async (trx) => {
        const hlc = ctx.clock.now();
        await reserveUses(trx, ctx, quote);
        const sessionId = await openSession(trx, ctx, { tenantId: qr.tenant_id, locationId: qr.location_id, tableId: qr.table_id, userId: null }, hlc);
        if (codeSession && sessionId !== codeSession) throw new AppError('CONFLICT', 'La table vient d’être libérée. Demandez le nouveau code au serveur.', { reason: 'TABLE_NOT_OPEN' });
        await upsertGuest(trx, ctx, { id: sessionId, tenant_id: qr.tenant_id, location_id: qr.location_id }, input.clientToken, nickname, hlc);
        const date = businessDate(now, qr.timezone, qr.business_day_cutoff_min);
        // Établissement hybride : le Cloud numérote ses commandes QR à partir de 901, le serveur local
        // garde 1, 2, 3… : les deux ne se marchent jamais dessus en se synchronisant.
        const number =
          ctx.config.profile === 'cloud' && qr.operating_mode === 'HYBRID' ? 900 + (await nextOrderNumber(trx, qr.location_id, `${date}#cloud`)) : await nextOrderNumber(trx, qr.location_id, date);
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
            ...orderPricingColumns(quote),
            service_type: 'DINE_IN',
            customer_name: null,
            discount: 0,
            discount_reason: null,
            discount_by: null,
            paid_amount: 0,
            payment_status: 'UNPAID',
            client_token: input.clientToken,
            created_by: null,
            created_at: now,
            updated_at: now,
            status_changed_at: now,
            updated_hlc: hlc,
          })
          .execute();
        await insertItems(trx, ctx, order, quote.lines);
        await addHistory(trx, ctx, order, null, 'PENDING', { userId: null, source: 'QR' }, hlc);
        await emitOrder(trx, ctx, orderId, 'ORDER_PLACED', hlc);
        await notifyOrder(trx, ctx, orderId, 'ORDER_NEW', null);
        await writeAudit(trx, ctx, { tenantId: qr.tenant_id, locationId: qr.location_id, action: 'order.qr_placed', subject: `table ${qr.table_label}`, entityType: 'order', entityId: orderId, data: { number, total, lines: priced.length, promoCode: quote.pricing.code?.code ?? null }, meta });
      });
      const [order] = await hydrateOrders(ctx.db, await ctx.db.selectFrom('orders').selectAll().where('id', '=', orderId).execute());
      return toPublic(order!, true);
    } catch (err) {
      if (attempt < 2 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
}

export async function insertItems(trx: Db, ctx: AppContext, order: { id: string; tenant_id: string; location_id: string }, priced: Priced[]) {
  const now = ctx.now();
  const stationOf = await resolveItemStations(trx, order.location_id, priced.map((p) => p.productId));
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
        station_id: stationOf.get(p.productId) ?? null,
        kds_status: 'QUEUED',
        kds_updated_at: null,
        promotion_id: p.pricing?.promotionId ?? null,
        promotion_discount: p.pricing?.promotionDiscount ?? 0,
        code_discount: p.pricing?.codeDiscount ?? 0,
        tax_rate_id: p.pricing?.taxRateId ?? null,
        tax_rate_bp: p.pricing?.taxRateBp ?? null,
        tax_name: p.pricing?.taxName ?? null,
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

/** Poste de chaque produit ; sans poste (ou poste archivé) : le premier poste Cuisine de l'établissement. */
export async function resolveItemStations(db: Db, locationId: string, productIds: string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(productIds)];
  const products = ids.length
    ? await db
        .selectFrom('products as p')
        .leftJoin('stations as s', (join) => join.onRef('s.id', '=', 'p.station_id').on('s.status', '=', 'ACTIVE'))
        .select(['p.id', 's.id as station_id'])
        .where('p.id', 'in', ids)
        .execute()
    : [];
  const fallback = await db.selectFrom('stations').select('id').where('location_id', '=', locationId).where('status', '=', 'ACTIVE').where('kind', '=', 'KITCHEN').orderBy('sort').executeTakeFirst();
  return new Map(products.map((p) => [p.id, p.station_id ?? fallback?.id ?? null]));
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
  return (await hydrateOrders(ctx.db, rows)).map((o) => toPublic(o, true));
}

export async function createServiceRequest(ctx: AppContext, token: string, input: ServiceRequestInput): Promise<ServiceRequest> {
  const qr = await resolveQr(ctx.db, token);
  const now = ctx.now();
  if ((await countSince(ctx.db, 'service_requests', qr.location_id, input.clientToken, now - 60_000)) >= MAX_REQUESTS_PER_CLIENT_PER_MINUTE) {
    throw new AppError('TOO_MANY_ATTEMPTS', 'Votre demande a déjà été transmise. Patientez un instant.');
  }
  // Addition : moyen annoncé par le client (le paiement se fait auprès du personnel, I-7) ; en
  // addition par client, chacun demande sa part, sauf s'il demande toute la table.
  const bill = input.kind === 'BILL';
  const billScope = bill ? (qr.bill_mode === 'PER_CUSTOMER' ? (input.scope ?? 'MINE') : 'TABLE') : null;
  const paymentMethod = bill ? (input.paymentMethod ?? null) : null;

  // Déjà signalé et pas encore traité : on ne fait pas sonner deux fois (on met seulement à jour le moyen choisi).
  let duplicate = ctx.db.selectFrom('service_requests').select(['id', 'payment_method', 'bill_scope']).where('table_id', '=', qr.table_id).where('kind', '=', input.kind).where('status', '=', 'OPEN');
  if (billScope === 'MINE') duplicate = duplicate.where('client_token', '=', input.clientToken).where('bill_scope', '=', 'MINE');
  if (billScope === 'TABLE' && qr.bill_mode === 'PER_CUSTOMER') duplicate = duplicate.where('bill_scope', '=', 'TABLE');
  const existing = await duplicate.executeTakeFirst();
  if (existing) {
    if (bill && paymentMethod && paymentMethod !== existing.payment_method) {
      await ctx.db.transaction().execute(async (trx) => {
        const hlc = ctx.clock.now();
        await trx.updateTable('service_requests').set({ payment_method: paymentMethod, updated_hlc: hlc }).where('id', '=', existing.id).execute();
        await emitRequest(trx, ctx, existing.id, hlc);
      });
    }
    return (await loadRequests(ctx.db, (q) => q.where('r.id', '=', existing.id)))[0]!;
  }

  const id = uuidv7();
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const session = await trx.selectFrom('table_sessions').select('id').where('table_id', '=', qr.table_id).where('status', '=', 'OPEN').executeTakeFirst();
    await trx
      .insertInto('service_requests')
      .values({
        id,
        tenant_id: qr.tenant_id,
        location_id: qr.location_id,
        table_id: qr.table_id,
        table_session_id: session?.id ?? null,
        kind: input.kind,
        status: 'OPEN',
        client_token: input.clientToken,
        created_at: now,
        handled_at: null,
        handled_by: null,
        payment_method: paymentMethod,
        bill_scope: billScope,
        updated_hlc: hlc,
      })
      .execute();
    await emitRequest(trx, ctx, id, hlc);
    await notifyRequest(trx, ctx, id);
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
  // Qui appelle, et pour une addition, combien reste à payer (table ou part du client).
  const sessionIds = [...new Set(rows.map((r) => r.table_session_id).filter((x): x is string => x !== null))];
  const billSessions = [...new Set(rows.filter((r) => r.kind === 'BILL' && r.table_session_id).map((r) => r.table_session_id!))];
  const [guests, billOrders] = await Promise.all([
    loadGuests(db, sessionIds),
    billSessions.length ? db.selectFrom('orders').select(['table_session_id', 'client_token', 'status', 'total', 'paid_amount']).where('table_session_id', 'in', billSessions).execute() : Promise.resolve([]),
  ]);
  return rows.map((r) => {
    const guest = r.table_session_id && r.client_token ? guests.get(r.table_session_id)?.find((g) => g.clientToken === r.client_token) : undefined;
    let amount: number | null = null;
    if (r.kind === 'BILL' && r.table_session_id) {
      const shares = billShares(billOrders.filter((o) => o.table_session_id === r.table_session_id).map((o) => ({ clientToken: o.client_token, status: o.status, total: o.total, paid: o.paid_amount })));
      amount = r.bill_scope === 'MINE' ? (shares.byClient.get(r.client_token ?? '')?.remaining ?? 0) : shares.table.remaining;
    }
    return {
      id: r.id,
      locationId: r.location_id,
      tableId: r.table_id,
      tableLabel: r.label,
      kind: r.kind,
      status: r.status,
      createdAt: r.created_at,
      handledAt: r.handled_at,
      handledBy: r.display_name,
      paymentMethod: r.payment_method,
      billScope: r.bill_scope,
      guestName: guest?.name ?? null,
      amount,
    };
  });
}

function requestBase(db: Db) {
  return db
    .selectFrom('service_requests as r')
    .innerJoin('dining_tables as t', 't.id', 'r.table_id')
    .leftJoin('users as u', 'u.id', 'r.handled_by')
    .select(['r.id', 'r.location_id', 'r.table_id', 't.label', 'r.kind', 'r.status', 'r.created_at', 'r.handled_at', 'u.display_name', 'r.table_session_id', 'r.client_token', 'r.payment_method', 'r.bill_scope']);
}

export type { RequestQuery };

// --- Côté personnel -----------------------------------------------------------

export async function assertLocation(db: Db, scope: TenantScope, locationId: string) {
  const notFound = new AppError('NOT_FOUND', 'Établissement introuvable.');
  if (scope.locationId && scope.locationId !== locationId) throw notFound;
  const row = await db
    .selectFrom('locations')
    .select(['id', 'timezone', 'business_day_cutoff_min', 'currency', 'table_code_required', 'bill_mode'])
    .where('id', '=', locationId)
    .where('tenant_id', '=', scope.tenantId)
    .executeTakeFirst();
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
  if (to === 'COMPLETED' && order.payment_status !== 'PAID') {
    throw new AppError('CONFLICT', `Encaissez la commande avant de la terminer (reste ${formatMoney(order.total - order.paid_amount, order.currency)}).`);
  }
  if (to === 'CANCELLED' && order.paid_amount > 0) {
    throw new AppError('CONFLICT', "Un paiement est enregistré sur cette commande : annulez d'abord le paiement.");
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
    // Annoncée prête depuis l'écran Commandes : tous les postes sont considérés comme terminés.
    if (to === 'READY') {
      await trx.updateTable('order_items').set({ kds_status: 'READY', kds_updated_at: now }).where('order_id', '=', orderId).where('kds_status', '!=', 'READY').execute();
    }
    await addHistory(trx, ctx, order, order.status, to, { userId: scope.userId, source: 'STAFF', reason: cleanReason }, hlc);
    await emitOrder(trx, ctx, orderId, 'ORDER_STATUS_CHANGED', hlc);
    if (to === 'READY') await notifyOrder(trx, ctx, orderId, 'ORDER_READY', scope.userId);
    // Stock : consommé à la confirmation, restitué si la commande est annulée ensuite.
    if (to === 'CONFIRMED') {
      await consumeStock(trx, ctx, order, scope.userId);
      await enqueueKitchenTickets(trx, ctx, order);
    }
    if (to === 'CANCELLED') await restoreStock(trx, ctx, order, scope.userId);
    let final = to;
    // Payée d'avance (comptoir) puis servie : rien ne reste à faire, la commande se termine seule.
    if (to === 'SERVED' && order.payment_status === 'PAID') {
      const hlc2 = ctx.clock.now();
      await trx.updateTable('orders').set({ status: 'COMPLETED', status_changed_at: now, updated_at: now, updated_hlc: hlc2 }).where('id', '=', orderId).execute();
      await addHistory(trx, ctx, order, 'SERVED', 'COMPLETED', { userId: scope.userId, source: 'SYSTEM' }, hlc2);
      await emitOrder(trx, ctx, orderId, 'ORDER_STATUS_CHANGED', hlc2);
      final = 'COMPLETED';
    }
    if (final === 'COMPLETED' || final === 'CANCELLED') await closeSessionIfSettled(trx, ctx, order.table_session_id, scope.userId);
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
    await closeSessionRow(trx, ctx, session, scope.userId);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: session.location_id, actorUserId: scope.userId, action: 'table.freed', entityType: 'table_session', entityId: sessionId, meta });
  });
}

/** Ferme la session (table libérée) et clôt les appels restés ouverts. */
export async function closeSessionRow(trx: Db, ctx: AppContext, session: { id: string; tenant_id: string; location_id: string }, userId: string | null) {
  const hlc = ctx.clock.now();
  const now = ctx.now();
  await trx.updateTable('table_sessions').set({ status: 'CLOSED', closed_at: now, closed_by: userId, updated_at: now, updated_hlc: hlc }).where('id', '=', session.id).where('status', '=', 'OPEN').execute();
  const row = await trx.selectFrom('table_sessions').selectAll().where('id', '=', session.id).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: session.tenant_id, locationId: session.location_id, entityType: 'table_session', entityId: session.id, operation: 'UPSERT', payload: row, hlc });
  const open = await trx.selectFrom('service_requests').select('id').where('table_session_id', '=', session.id).where('status', '=', 'OPEN').execute();
  for (const r of open) {
    await trx.updateTable('service_requests').set({ status: 'DONE', handled_at: now, handled_by: userId, updated_hlc: hlc }).where('id', '=', r.id).execute();
    await emitRequest(trx, ctx, r.id, hlc);
  }
}

/** Table réglée (toutes ses commandes terminées et payées, ou annulées) : elle se libère seule. */
export async function closeSessionIfSettled(trx: Db, ctx: AppContext, sessionId: string | null, userId: string | null) {
  if (!sessionId) return;
  const session = await trx.selectFrom('table_sessions').select(['id', 'tenant_id', 'location_id', 'status']).where('id', '=', sessionId).executeTakeFirst();
  if (!session || session.status !== 'OPEN') return;
  const rows = await trx.selectFrom('orders').select(['status', 'payment_status']).where('table_session_id', '=', sessionId).execute();
  if (rows.length === 0) return;
  if (rows.every((r) => r.status === 'CANCELLED' || (r.status === 'COMPLETED' && r.payment_status === 'PAID'))) {
    await closeSessionRow(trx, ctx, session, userId);
  }
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
