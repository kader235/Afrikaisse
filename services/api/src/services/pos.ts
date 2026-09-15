import { sql, type Selectable } from 'kysely';
import {
  AppError,
  PAYMENT_METHODS,
  allocatePayment,
  businessDate,
  discountAmount,
  formatMoney,
  paymentStatusOf,
  uuidv7,
  type CashMovementInput,
  type CashSession,
  type CashSessionListItem,
  type CashSummary,
  type Check,
  type CloseCashSessionInput,
  type CreateStaffOrderInput,
  type DiscountInput,
  type OpenCashSessionInput,
  type Order,
  type Payment,
  type PaymentTarget,
  type Receipt,
  type RecordPaymentInput,
} from '@afrikaisse/core';
import type { CashSessionsTable } from '@afrikaisse/database';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { isUniqueViolation, recordChange, writeAudit } from '../lib/journal.ts';
import { enqueueKitchenTickets } from './printing.ts';
import { consumeStock } from './stock.ts';
import { upsertGuest } from './guests.ts';
import {
  addHistory,
  assertLocation,
  closeSessionIfSettled,
  closeSessionRow,
  emitOrder,
  hydrateOrders,
  insertItems,
  loadPricingProducts,
  nextOrderNumber,
  openSession,
  priceLines,
} from './orders.ts';

/**
 * Caisse. Règles :
 * - le personnel commande directement « confirmé » (pas d'étape de validation) ;
 * - un paiement est déclaré dans une session de caisse ouverte, jamais supprimé (annulé avec motif) ;
 * - une addition se règle en plusieurs fois : chaque paiement est réparti sur les commandes,
 *   la plus ancienne d'abord ;
 * - payée et servie, une commande se termine ; une table réglée se libère seule.
 */

type CashSessionRow = Selectable<CashSessionsTable>;

const conflict = (message: string) => new AppError('CONFLICT', message);

async function loadOrder(db: Db, id: string): Promise<Order> {
  return (await hydrateOrders(db, await db.selectFrom('orders').selectAll().where('id', '=', id).execute()))[0]!;
}

async function findOrder(db: Db, scope: TenantScope, orderId: string) {
  const order = await db.selectFrom('orders').selectAll().where('id', '=', orderId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!order || (scope.locationId && order.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Commande introuvable.');
  return order;
}

async function nextDocumentNumber(trx: Db, locationId: string, kind: string): Promise<number> {
  const row = await trx
    .insertInto('document_counters')
    .values({ location_id: locationId, kind, last_number: 1 })
    .onConflict((oc) => oc.columns(['location_id', 'kind']).doUpdateSet({ last_number: sql<number>`document_counters.last_number + 1` }))
    .returning('last_number')
    .executeTakeFirstOrThrow();
  return Number(row.last_number);
}

// --- Prise de commande -------------------------------------------------------

export async function createStaffOrder(ctx: AppContext, scope: TenantScope, locationId: string, input: CreateStaffOrderInput, meta: RequestMeta): Promise<Order> {
  const location = await assertLocation(ctx.db, scope, locationId);
  const table = input.tableId
    ? await ctx.db.selectFrom('dining_tables').select(['id', 'label']).where('id', '=', input.tableId).where('location_id', '=', locationId).where('status', '=', 'ACTIVE').executeTakeFirst()
    : null;
  if (input.tableId && !table) throw new AppError('NOT_FOUND', 'Table introuvable.');

  const priced = priceLines(await loadPricingProducts(ctx.db, locationId, input.lines.map((l) => l.productId), { includeHidden: true }), input.lines);
  const total = priced.reduce((sum, p) => sum + p.line.total, 0);
  const now = ctx.now();

  for (let attempt = 1; ; attempt++) {
    const orderId = uuidv7();
    try {
      await ctx.db.transaction().execute(async (trx) => {
        const hlc = ctx.clock.now();
        const sessionId = table ? await openSession(trx, ctx, { tenantId: scope.tenantId, locationId, tableId: table.id, userId: scope.userId }, hlc) : null;
        const date = businessDate(now, location.timezone, location.business_day_cutoff_min);
        const number = await nextOrderNumber(trx, locationId, date);
        const order = { id: orderId, tenant_id: scope.tenantId, location_id: locationId };
        await trx
          .insertInto('orders')
          .values({
            ...order,
            table_session_id: sessionId,
            table_id: table?.id ?? null,
            number,
            business_date: date,
            source: scope.role === 'WAITER' ? 'WAITER' : 'POS',
            status: 'CONFIRMED',
            note: input.note?.trim() || null,
            service_type: table ? 'DINE_IN' : input.serviceType,
            customer_name: input.customerName?.trim() || null,
            currency: location.currency,
            subtotal: total,
            discount: 0,
            discount_reason: null,
            discount_by: null,
            total,
            paid_amount: 0,
            payment_status: paymentStatusOf(total, 0),
            client_token: null,
            created_by: scope.userId,
            created_at: now,
            updated_at: now,
            status_changed_at: now,
            updated_hlc: hlc,
          })
          .execute();
        await insertItems(trx, ctx, order, priced);
        await addHistory(trx, ctx, order, null, 'CONFIRMED', { userId: scope.userId, source: 'STAFF' }, hlc);
        await emitOrder(trx, ctx, orderId, 'ORDER_PLACED', hlc);
        await consumeStock(trx, ctx, order, scope.userId);
        await enqueueKitchenTickets(trx, ctx, order);
      });
      return loadOrder(ctx.db, orderId);
    } catch (err) {
      if (attempt < 2 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
}

// --- Remises ----------------------------------------------------------------

export async function setDiscount(ctx: AppContext, scope: TenantScope, orderId: string, input: DiscountInput, meta: RequestMeta): Promise<Order> {
  const order = await findOrder(ctx.db, scope, orderId);
  if (order.status === 'CANCELLED' || order.status === 'COMPLETED') throw conflict('Remise impossible sur une commande terminée ou annulée.');
  if (order.paid_amount > 0) throw conflict('Remise impossible : un paiement est déjà enregistré sur cette commande.');
  const discount = discountAmount(order.subtotal, input.kind, input.value);
  const total = order.subtotal - discount;

  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const now = ctx.now();
    const updated = await trx
      .updateTable('orders')
      .set({
        discount,
        discount_reason: discount > 0 ? input.reason : null,
        discount_by: discount > 0 ? scope.userId : null,
        total,
        payment_status: paymentStatusOf(total, 0),
        updated_at: now,
        updated_hlc: hlc,
      })
      .where('id', '=', orderId)
      .where('paid_amount', '=', 0)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) throw conflict('Cette commande vient de changer. Actualisez puis réessayez.');
    await emitOrder(trx, ctx, orderId, 'ORDER_UPDATED', hlc);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: order.location_id,
      actorUserId: scope.userId,
      action: 'order.discount',
      entityType: 'order',
      entityId: orderId,
      data: { number: order.number, kind: input.kind, value: input.value, before: order.discount, after: discount, total, reason: input.reason || null },
      meta,
    });
  });
  return loadOrder(ctx.db, orderId);
}

// --- Notes à encaisser ------------------------------------------------------

export async function listChecks(ctx: AppContext, scope: TenantScope, locationId: string): Promise<Check[]> {
  const location = await assertLocation(ctx.db, scope, locationId);
  const db = ctx.db;
  const sessions = await db
    .selectFrom('table_sessions as s')
    .innerJoin('dining_tables as t', 't.id', 's.table_id')
    .select(['s.id', 's.table_id', 't.label', 's.opened_at', 's.join_code'])
    .where('s.location_id', '=', locationId)
    .where('s.status', '=', 'OPEN')
    .execute();
  const codes = location.table_code_required === 1;
  const sessionOrders = sessions.length
    ? await db.selectFrom('orders').selectAll().where('table_session_id', 'in', sessions.map((s) => s.id)).where('status', '!=', 'CANCELLED').orderBy('created_at').execute()
    : [];
  // Commandes sans table (à emporter, comptoir) ou restées impayées après la libération de leur table.
  const loose = await db
    .selectFrom('orders as o')
    .leftJoin('table_sessions as s', 's.id', 'o.table_session_id')
    .selectAll('o')
    .where('o.location_id', '=', locationId)
    .where('o.status', '!=', 'CANCELLED')
    .where('o.payment_status', '!=', 'PAID')
    .where((eb) => eb.or([eb('o.table_session_id', 'is', null), eb('s.status', '=', 'CLOSED')]))
    .orderBy('o.created_at')
    .limit(200)
    .execute();
  const hydrated = new Map((await hydrateOrders(db, [...sessionOrders, ...loose])).map((o) => [o.id, o]));
  const sums = (orders: Order[]) => {
    const total = orders.reduce((s, o) => s + o.total, 0);
    const paid = orders.reduce((s, o) => s + o.paid, 0);
    return { total, paid, remaining: total - paid };
  };

  const checks: Check[] = sessions.map((s) => {
    const orders = sessionOrders.filter((o) => o.table_session_id === s.id).map((o) => hydrated.get(o.id)!);
    return {
      kind: 'session',
      id: s.id,
      tableId: s.table_id,
      tableLabel: s.label,
      serviceType: 'DINE_IN',
      customerName: null,
      openedAt: s.opened_at,
      orders,
      currency: location.currency,
      ...sums(orders),
      joinCode: codes ? s.join_code : null,
      billMode: location.bill_mode,
    };
  });
  for (const row of loose) {
    const order = hydrated.get(row.id)!;
    checks.push({
      kind: 'order',
      id: order.id,
      tableId: order.tableId,
      tableLabel: order.tableLabel,
      serviceType: order.serviceType,
      customerName: order.customerName,
      openedAt: order.createdAt,
      orders: [order],
      currency: order.currency,
      ...sums([order]),
      joinCode: null,
      billMode: location.bill_mode,
    });
  }
  return checks.sort((a, b) => a.openedAt - b.openedAt);
}

// --- Paiements --------------------------------------------------------------

async function openDrawer(db: Db, locationId: string) {
  return db.selectFrom('cash_sessions').selectAll().where('location_id', '=', locationId).where('status', '=', 'OPEN').executeTakeFirst();
}

async function targetOrders(db: Db, scope: TenantScope, locationId: string, target: PaymentTarget) {
  if (target.kind === 'order') {
    const order = await findOrder(db, scope, target.id);
    if (order.location_id !== locationId) throw new AppError('NOT_FOUND', 'Commande introuvable.');
    if (order.status === 'CANCELLED') throw conflict('Cette commande est annulée.');
    return [order];
  }
  const session = await db.selectFrom('table_sessions').select(['id', 'status', 'location_id']).where('id', '=', target.id).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!session || session.location_id !== locationId) throw new AppError('NOT_FOUND', 'Table introuvable.');
  if (session.status !== 'OPEN') throw conflict('Cette table a déjà été libérée.');
  return db.selectFrom('orders').selectAll().where('table_session_id', '=', target.id).where('status', '!=', 'CANCELLED').orderBy('created_at').execute();
}

export async function recordPayment(ctx: AppContext, scope: TenantScope, locationId: string, input: RecordPaymentInput): Promise<Receipt> {
  const location = await assertLocation(ctx.db, scope, locationId);
  const drawer = await openDrawer(ctx.db, locationId);
  if (!drawer) throw conflict("Ouvrez la caisse avant d'encaisser.");
  const orders = await targetOrders(ctx.db, scope, locationId, input.target);
  const dues = orders.map((o) => ({ id: o.id, remaining: o.total - o.paid_amount })).filter((d) => d.remaining > 0);
  const remaining = dues.reduce((s, d) => s + d.remaining, 0);
  if (remaining <= 0) throw conflict('Rien à encaisser : tout est déjà payé.');
  if (input.amount > remaining) throw conflict(`Le montant dépasse le reste à payer (${formatMoney(remaining, location.currency)}).`);
  const tendered = input.method === 'CASH' ? (input.tendered ?? input.amount) : input.amount;
  const allocations = allocatePayment(input.amount, dues);
  const paymentId = uuidv7();

  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const now = ctx.now();
    const receiptNumber = await nextDocumentNumber(trx, locationId, 'RECEIPT');
    await trx
      .insertInto('payments')
      .values({
        id: paymentId,
        tenant_id: scope.tenantId,
        location_id: locationId,
        cash_session_id: drawer.id,
        receipt_number: receiptNumber,
        business_date: businessDate(now, location.timezone, location.business_day_cutoff_min),
        method: input.method,
        amount: input.amount,
        tendered,
        change_given: tendered - input.amount,
        provider: input.method === 'MOBILE_MONEY' ? input.provider?.trim() || null : null,
        reference: input.reference?.trim() || null,
        status: 'RECORDED',
        void_reason: null,
        voided_by: null,
        voided_at: null,
        created_by: scope.userId,
        created_at: now,
        updated_hlc: hlc,
      })
      .execute();

    for (const a of allocations) {
      const order = orders.find((o) => o.id === a.id)!;
      await trx.insertInto('payment_allocations').values({ id: uuidv7(), tenant_id: scope.tenantId, location_id: locationId, payment_id: paymentId, order_id: order.id, amount: a.amount, created_at: now }).execute();
      const paid = order.paid_amount + a.amount;
      const status = paymentStatusOf(order.total, paid);
      // Condition sur le montant déjà payé : deux caisses qui encaissent la même note, une seule passe.
      const updated = await trx
        .updateTable('orders')
        .set({ paid_amount: paid, payment_status: status, updated_at: now, updated_hlc: hlc })
        .where('id', '=', order.id)
        .where('paid_amount', '=', order.paid_amount)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) throw conflict("Cette note vient d'être modifiée. Actualisez puis réessayez.");
      if (status === 'PAID' && order.status === 'SERVED') {
        const hlc2 = ctx.clock.now();
        await trx.updateTable('orders').set({ status: 'COMPLETED', status_changed_at: now, updated_hlc: hlc2 }).where('id', '=', order.id).execute();
        await addHistory(trx, ctx, order, 'SERVED', 'COMPLETED', { userId: scope.userId, source: 'STAFF' }, hlc2);
        await emitOrder(trx, ctx, order.id, 'ORDER_STATUS_CHANGED', hlc2);
      } else {
        await emitOrder(trx, ctx, order.id, 'ORDER_UPDATED', hlc);
      }
    }

    const payment = await trx.selectFrom('payments').selectAll().where('id', '=', paymentId).executeTakeFirstOrThrow();
    const allocationRows = await trx.selectFrom('payment_allocations').selectAll().where('payment_id', '=', paymentId).execute();
    await recordChange(trx, ctx, { tenantId: scope.tenantId, locationId, entityType: 'payment', entityId: paymentId, operation: 'PAYMENT_RECORDED', payload: { payment, allocations: allocationRows }, hlc });
    for (const sessionId of new Set(orders.map((o) => o.table_session_id))) {
      await closeSessionIfSettled(trx, ctx, sessionId, scope.userId);
    }
  });
  return getReceipt(ctx, scope, paymentId);
}

async function loadPayments(db: Db, filter: { sessionId?: string; ids?: string[] }): Promise<Payment[]> {
  let q = db.selectFrom('payments as p').leftJoin('users as u', 'u.id', 'p.created_by').selectAll('p').select('u.display_name');
  if (filter.sessionId) q = q.where('p.cash_session_id', '=', filter.sessionId);
  if (filter.ids) q = q.where('p.id', 'in', filter.ids);
  const rows = await q.orderBy('p.created_at', 'desc').limit(1000).execute();
  if (rows.length === 0) return [];
  const allocations = await db
    .selectFrom('payment_allocations as a')
    .innerJoin('orders as o', 'o.id', 'a.order_id')
    .select(['a.payment_id', 'a.order_id', 'a.amount', 'o.number'])
    .where('a.payment_id', 'in', rows.map((r) => r.id))
    .execute();
  return rows.map((p) => ({
    id: p.id,
    locationId: p.location_id,
    cashSessionId: p.cash_session_id,
    receiptNumber: p.receipt_number,
    method: p.method,
    amount: p.amount,
    tendered: p.tendered,
    change: p.change_given,
    provider: p.provider,
    reference: p.reference,
    status: p.status,
    voidReason: p.void_reason,
    createdAt: p.created_at,
    by: p.display_name,
    allocations: allocations.filter((a) => a.payment_id === p.id).map((a) => ({ orderId: a.order_id, orderNumber: a.number, amount: a.amount })),
  }));
}

async function findPayment(db: Db, scope: TenantScope, paymentId: string) {
  const payment = await db.selectFrom('payments').selectAll().where('id', '=', paymentId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!payment || (scope.locationId && payment.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Paiement introuvable.');
  return payment;
}

export async function getReceipt(ctx: AppContext, scope: TenantScope, paymentId: string): Promise<Receipt> {
  const row = await findPayment(ctx.db, scope, paymentId);
  const [payment] = await loadPayments(ctx.db, { ids: [paymentId] });
  const orderIds = payment!.allocations.map((a) => a.orderId);
  const orders = orderIds.length ? await hydrateOrders(ctx.db, await ctx.db.selectFrom('orders').selectAll().where('id', 'in', orderIds).orderBy('created_at').execute()) : [];
  const place = await ctx.db
    .selectFrom('locations as l')
    .innerJoin('tenants as t', 't.id', 'l.tenant_id')
    .select(['l.name', 'l.address', 'l.phone', 'l.currency', 't.name as organization'])
    .where('l.id', '=', row.location_id)
    .executeTakeFirstOrThrow();
  return {
    payment: payment!,
    location: { name: place.name, address: place.address, phone: place.phone, currency: place.currency },
    organization: place.organization,
    cashier: payment!.by,
    orders,
    remaining: orders.reduce((s, o) => s + (o.total - o.paid), 0),
  };
}

export async function voidPayment(ctx: AppContext, scope: TenantScope, paymentId: string, reason: string, meta: RequestMeta): Promise<Payment> {
  const payment = await findPayment(ctx.db, scope, paymentId);
  if (payment.status === 'RECORDED') {
    const drawer = await ctx.db.selectFrom('cash_sessions').select('status').where('id', '=', payment.cash_session_id).executeTakeFirstOrThrow();
    if (drawer.status !== 'OPEN') throw conflict('La caisse de ce paiement est clôturée : il ne peut plus être annulé.');
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      const now = ctx.now();
      const updated = await trx
        .updateTable('payments')
        .set({ status: 'VOIDED', void_reason: reason, voided_by: scope.userId, voided_at: now, updated_hlc: hlc })
        .where('id', '=', paymentId)
        .where('status', '=', 'RECORDED')
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) return;
      const allocations = await trx.selectFrom('payment_allocations').select(['order_id', 'amount']).where('payment_id', '=', paymentId).execute();
      for (const a of allocations) {
        const order = await trx.selectFrom('orders').select(['total', 'paid_amount']).where('id', '=', a.order_id).executeTakeFirstOrThrow();
        const paid = Math.max(0, order.paid_amount - a.amount);
        await trx.updateTable('orders').set({ paid_amount: paid, payment_status: paymentStatusOf(order.total, paid), updated_at: now, updated_hlc: hlc }).where('id', '=', a.order_id).execute();
        await emitOrder(trx, ctx, a.order_id, 'ORDER_UPDATED', hlc);
      }
      const row = await trx.selectFrom('payments').selectAll().where('id', '=', paymentId).executeTakeFirstOrThrow();
      await recordChange(trx, ctx, { tenantId: scope.tenantId, locationId: payment.location_id, entityType: 'payment', entityId: paymentId, operation: 'PAYMENT_VOIDED', payload: row, hlc });
      await writeAudit(trx, ctx, {
        tenantId: scope.tenantId,
        locationId: payment.location_id,
        actorUserId: scope.userId,
        action: 'payment.voided',
        entityType: 'payment',
        entityId: paymentId,
        data: { receiptNumber: payment.receipt_number, method: payment.method, amount: payment.amount, reason },
        meta,
      });
    });
  }
  return (await loadPayments(ctx.db, { ids: [paymentId] }))[0]!;
}

// --- Sessions de caisse -----------------------------------------------------

async function summarize(db: Db, session: CashSessionRow): Promise<CashSummary> {
  const [payments, movements] = await Promise.all([
    db.selectFrom('payments').select(['method', 'amount', 'status']).where('cash_session_id', '=', session.id).execute(),
    db.selectFrom('cash_movements').select(['kind', 'amount']).where('cash_session_id', '=', session.id).execute(),
  ]);
  const recorded = payments.filter((p) => p.status === 'RECORDED');
  const voided = payments.filter((p) => p.status === 'VOIDED');
  const sum = (list: { amount: number }[]) => list.reduce((s, x) => s + x.amount, 0);
  const cashPayments = sum(recorded.filter((p) => p.method === 'CASH'));
  const movementsIn = sum(movements.filter((m) => m.kind === 'IN'));
  const movementsOut = sum(movements.filter((m) => m.kind === 'OUT'));
  return {
    byMethod: PAYMENT_METHODS.map((method) => {
      const list = recorded.filter((p) => p.method === method);
      return { method, count: list.length, amount: sum(list) };
    }).filter((m) => m.count > 0),
    paymentsTotal: sum(recorded),
    paymentCount: recorded.length,
    cashPayments,
    movementsIn,
    movementsOut,
    voidedCount: voided.length,
    voidedAmount: sum(voided),
    expectedCash: session.opening_float + cashPayments + movementsIn - movementsOut,
  };
}

async function names(db: Db, ids: (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length ? await db.selectFrom('users').select(['id', 'display_name']).where('id', 'in', list).execute() : [];
  return (id: string | null) => rows.find((r) => r.id === id)?.display_name ?? null;
}

async function listItem(db: Db, row: CashSessionRow, currency: CashSession['currency']): Promise<CashSessionListItem> {
  const name = await names(db, [row.opened_by, row.closed_by]);
  return {
    id: row.id,
    locationId: row.location_id,
    status: row.status,
    businessDate: row.business_date,
    currency,
    openedAt: row.opened_at,
    openedBy: name(row.opened_by),
    openingFloat: row.opening_float,
    closedAt: row.closed_at,
    closedBy: name(row.closed_by),
    countedCash: row.counted_cash,
    difference: row.difference,
    note: row.note,
    // Clôturée : le rapport figé à la clôture fait foi.
    summary: row.report ? (JSON.parse(row.report) as CashSummary) : await summarize(db, row),
  };
}

async function buildCashSession(db: Db, row: CashSessionRow): Promise<CashSession> {
  const location = await db.selectFrom('locations').select('currency').where('id', '=', row.location_id).executeTakeFirstOrThrow();
  const [item, movements, payments] = await Promise.all([
    listItem(db, row, location.currency),
    db.selectFrom('cash_movements as m').leftJoin('users as u', 'u.id', 'm.by_user_id').select(['m.id', 'm.kind', 'm.amount', 'm.reason', 'm.created_at', 'u.display_name']).where('m.cash_session_id', '=', row.id).orderBy('m.created_at').execute(),
    loadPayments(db, { sessionId: row.id }),
  ]);
  return { ...item, movements: movements.map((m) => ({ id: m.id, kind: m.kind, amount: m.amount, reason: m.reason, at: m.created_at, by: m.display_name })), payments };
}

async function findCashSession(db: Db, scope: TenantScope, sessionId: string) {
  const row = await db.selectFrom('cash_sessions').selectAll().where('id', '=', sessionId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row || (scope.locationId && row.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Session de caisse introuvable.');
  return row;
}

async function emitCashSession(trx: Db, ctx: AppContext, id: string, hlc: string) {
  const row = await trx.selectFrom('cash_sessions').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: 'cash_session', entityId: id, operation: 'UPSERT', payload: row, hlc });
}

export async function getCurrentCashSession(ctx: AppContext, scope: TenantScope, locationId: string): Promise<{ session: CashSession | null }> {
  await assertLocation(ctx.db, scope, locationId);
  const row = await openDrawer(ctx.db, locationId);
  return { session: row ? await buildCashSession(ctx.db, row) : null };
}

export async function getCashSession(ctx: AppContext, scope: TenantScope, sessionId: string): Promise<CashSession> {
  return buildCashSession(ctx.db, await findCashSession(ctx.db, scope, sessionId));
}

export async function listCashSessions(ctx: AppContext, scope: TenantScope, locationId: string): Promise<CashSessionListItem[]> {
  const location = await assertLocation(ctx.db, scope, locationId);
  const rows = await ctx.db.selectFrom('cash_sessions').selectAll().where('location_id', '=', locationId).orderBy('opened_at', 'desc').limit(60).execute();
  return Promise.all(rows.map((r) => listItem(ctx.db, r, location.currency)));
}

export async function openCashSession(ctx: AppContext, scope: TenantScope, locationId: string, input: OpenCashSessionInput, meta: RequestMeta): Promise<CashSession> {
  const location = await assertLocation(ctx.db, scope, locationId);
  if (await openDrawer(ctx.db, locationId)) throw conflict('La caisse est déjà ouverte.');
  const id = uuidv7();
  try {
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      const now = ctx.now();
      await trx
        .insertInto('cash_sessions')
        .values({
          id,
          tenant_id: scope.tenantId,
          location_id: locationId,
          status: 'OPEN',
          business_date: businessDate(now, location.timezone, location.business_day_cutoff_min),
          opening_float: input.openingFloat,
          opened_at: now,
          opened_by: scope.userId,
          closed_at: null,
          closed_by: null,
          counted_cash: null,
          expected_cash: null,
          difference: null,
          note: null,
          report: null,
          updated_at: now,
          updated_hlc: hlc,
        })
        .execute();
      await emitCashSession(trx, ctx, id, hlc);
      await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'cash.opened', entityType: 'cash_session', entityId: id, data: { openingFloat: input.openingFloat }, meta });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('La caisse est déjà ouverte.');
    throw err;
  }
  return getCashSession(ctx, scope, id);
}

export async function addCashMovement(ctx: AppContext, scope: TenantScope, sessionId: string, input: CashMovementInput, meta: RequestMeta): Promise<CashSession> {
  const session = await findCashSession(ctx.db, scope, sessionId);
  if (session.status !== 'OPEN') throw conflict('Cette caisse est clôturée.');
  if (input.kind === 'OUT') {
    const { expectedCash } = await summarize(ctx.db, session);
    const currency = (await ctx.db.selectFrom('locations').select('currency').where('id', '=', session.location_id).executeTakeFirstOrThrow()).currency;
    if (input.amount > expectedCash) throw conflict(`Sortie supérieure aux espèces en caisse (${formatMoney(expectedCash, currency)}).`);
  }
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const id = uuidv7();
    await trx
      .insertInto('cash_movements')
      .values({ id, tenant_id: scope.tenantId, location_id: session.location_id, cash_session_id: sessionId, kind: input.kind, amount: input.amount, reason: input.reason, by_user_id: scope.userId, created_at: ctx.now(), hlc })
      .execute();
    const row = await trx.selectFrom('cash_movements').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    await recordChange(trx, ctx, { tenantId: scope.tenantId, locationId: session.location_id, entityType: 'cash_movement', entityId: id, operation: 'UPSERT', payload: row, hlc });
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: session.location_id, actorUserId: scope.userId, action: input.kind === 'IN' ? 'cash.in' : 'cash.out', entityType: 'cash_session', entityId: sessionId, data: { amount: input.amount, reason: input.reason }, meta });
  });
  return getCashSession(ctx, scope, sessionId);
}

export async function closeCashSession(ctx: AppContext, scope: TenantScope, sessionId: string, input: CloseCashSessionInput, meta: RequestMeta): Promise<CashSession> {
  const session = await findCashSession(ctx.db, scope, sessionId);
  if (session.status !== 'OPEN') throw conflict('Cette caisse est déjà clôturée.');
  await ctx.db.transaction().execute(async (trx) => {
    const summary = await summarize(trx, session);
    const hlc = ctx.clock.now();
    const now = ctx.now();
    const difference = input.countedCash - summary.expectedCash;
    const updated = await trx
      .updateTable('cash_sessions')
      .set({
        status: 'CLOSED',
        closed_at: now,
        closed_by: scope.userId,
        counted_cash: input.countedCash,
        expected_cash: summary.expectedCash,
        difference,
        note: input.note?.trim() || null,
        report: JSON.stringify(summary),
        updated_at: now,
        updated_hlc: hlc,
      })
      .where('id', '=', sessionId)
      .where('status', '=', 'OPEN')
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) throw conflict('Cette caisse est déjà clôturée.');
    await emitCashSession(trx, ctx, sessionId, hlc);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: session.location_id,
      actorUserId: scope.userId,
      action: 'cash.closed',
      entityType: 'cash_session',
      entityId: sessionId,
      data: { expectedCash: summary.expectedCash, countedCash: input.countedCash, difference, paymentsTotal: summary.paymentsTotal },
      meta,
    });
  });
  return getCashSession(ctx, scope, sessionId);
}

// --- Tables : transfert et regroupement --------------------------------------

export async function transferTable(ctx: AppContext, scope: TenantScope, sessionId: string, tableId: string, meta: RequestMeta): Promise<void> {
  const session = await ctx.db.selectFrom('table_sessions').selectAll().where('id', '=', sessionId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!session || (scope.locationId && session.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Table introuvable.');
  if (session.status !== 'OPEN') throw conflict('Cette table a déjà été libérée.');
  if (session.table_id === tableId) return;
  const [from, to] = await Promise.all([
    ctx.db.selectFrom('dining_tables').select(['id', 'label']).where('id', '=', session.table_id).executeTakeFirstOrThrow(),
    ctx.db.selectFrom('dining_tables').select(['id', 'label']).where('id', '=', tableId).where('location_id', '=', session.location_id).where('status', '=', 'ACTIVE').executeTakeFirst(),
  ]);
  if (!to) throw new AppError('NOT_FOUND', 'Table de destination introuvable.');

  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const now = ctx.now();
    const target = await trx.selectFrom('table_sessions').select(['id']).where('table_id', '=', tableId).where('status', '=', 'OPEN').executeTakeFirst();
    const orderIds = (await trx.selectFrom('orders').select('id').where('table_session_id', '=', sessionId).execute()).map((o) => o.id);
    if (target) {
      // Regroupement : tout part sur la table déjà occupée, la table d'origine se libère.
      await trx.updateTable('orders').set({ table_session_id: target.id, table_id: tableId, updated_at: now, updated_hlc: hlc }).where('table_session_id', '=', sessionId).execute();
      await trx.updateTable('service_requests').set({ table_session_id: target.id, table_id: tableId, updated_hlc: hlc }).where('table_session_id', '=', sessionId).execute();
      // Les clients de la table d'origine rejoignent la table d'accueil (sans redemander le code).
      const guests = await trx.selectFrom('session_guests').select(['client_token', 'nickname']).where('table_session_id', '=', sessionId).orderBy('joined_at').execute();
      for (const g of guests) await upsertGuest(trx, ctx, { id: target.id, tenant_id: session.tenant_id, location_id: session.location_id }, g.client_token, g.nickname, hlc);
      await closeSessionRow(trx, ctx, session, scope.userId);
    } else {
      await trx.updateTable('table_sessions').set({ table_id: tableId, updated_at: now, updated_hlc: hlc }).where('id', '=', sessionId).execute();
      await trx.updateTable('orders').set({ table_id: tableId, updated_at: now, updated_hlc: hlc }).where('table_session_id', '=', sessionId).execute();
      await trx.updateTable('service_requests').set({ table_id: tableId, updated_hlc: hlc }).where('table_session_id', '=', sessionId).execute();
      const row = await trx.selectFrom('table_sessions').selectAll().where('id', '=', sessionId).executeTakeFirstOrThrow();
      await recordChange(trx, ctx, { tenantId: scope.tenantId, locationId: session.location_id, entityType: 'table_session', entityId: sessionId, operation: 'UPSERT', payload: row, hlc });
    }
    for (const id of orderIds) await emitOrder(trx, ctx, id, 'ORDER_UPDATED', hlc);
    await writeAudit(trx, ctx, {
      tenantId: scope.tenantId,
      locationId: session.location_id,
      actorUserId: scope.userId,
      action: target ? 'table.merged' : 'table.transferred',
      entityType: 'table_session',
      entityId: sessionId,
      data: { from: from.label, to: to.label, orders: orderIds.length },
      meta,
    });
  });
}
