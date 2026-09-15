import {
  PAYMENT_METHODS,
  buildKitchenReport,
  businessDate,
  dateRange,
  fromMilli,
  groupDays,
  type BreakdownReport,
  type KitchenReport,
  type PrepOrderInput,
  type StockReport,
} from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { assertLocation } from './orders.ts';

/**
 * Rapports détaillés d'une période de journées d'exploitation : périodes, produits, catégories,
 * personnel, paiements (breakdown), cuisine (temps de préparation) et stock.
 * Une vente = commande confirmée non annulée (une commande QR en attente n'en est pas une).
 */

const NOT_SOLD = ['CANCELLED', 'PENDING'] as const;
const DAY = 86_400_000;
const sum = <T>(list: T[], pick: (x: T) => number) => list.reduce((s, x) => s + Number(pick(x)), 0);

export async function breakdownReport(ctx: AppContext, scope: TenantScope, locationId: string, from: string, to: string): Promise<BreakdownReport> {
  const location = await assertLocation(ctx.db, scope, locationId);
  const [orders, confirmations, payments, items] = await Promise.all([
    ctx.db
      .selectFrom('orders')
      .select(['id', 'business_date', 'total', 'created_by'])
      .where('location_id', '=', locationId)
      .where('business_date', '>=', from)
      .where('business_date', '<=', to)
      .where('status', 'not in', [...NOT_SOLD])
      .execute(),
    ctx.db
      .selectFrom('order_status_history as h')
      .innerJoin('orders as o', 'o.id', 'h.order_id')
      .select(['h.order_id', 'h.by_user_id'])
      .where('o.location_id', '=', locationId)
      .where('o.business_date', '>=', from)
      .where('o.business_date', '<=', to)
      .where('h.to_status', '=', 'CONFIRMED')
      .orderBy('h.at')
      .execute(),
    ctx.db
      .selectFrom('payments')
      .select(['business_date', 'method', 'amount', 'status', 'created_by'])
      .where('location_id', '=', locationId)
      .where('business_date', '>=', from)
      .where('business_date', '<=', to)
      .execute(),
    ctx.db
      .selectFrom('order_items as i')
      .innerJoin('orders as o', 'o.id', 'i.order_id')
      .leftJoin('products as p', 'p.id', 'i.product_id')
      .leftJoin('menu_categories as c', 'c.id', 'p.category_id')
      .select(['i.product_id', 'i.name', 'i.quantity', 'i.total', 'i.created_at', 'c.name as category_name'])
      .where('o.location_id', '=', locationId)
      .where('o.business_date', '>=', from)
      .where('o.business_date', '<=', to)
      .where('o.status', 'not in', [...NOT_SOLD])
      .orderBy('i.created_at')
      .execute(),
  ]);
  const recorded = payments.filter((p) => p.status === 'RECORDED');
  const voided = payments.filter((p) => p.status === 'VOIDED');

  const byDay = dateRange(from, to).map((date) => ({
    date,
    revenue: sum(
      orders.filter((o) => o.business_date === date),
      (o) => o.total,
    ),
    orders: orders.filter((o) => o.business_date === date).length,
    collected: sum(
      recorded.filter((p) => p.business_date === date),
      (p) => p.amount,
    ),
  }));

  const products = new Map<string, { name: string; categoryName: string; quantity: number; revenue: number }>();
  for (const i of items) {
    const p = products.get(i.product_id) ?? { name: i.name, categoryName: i.category_name ?? 'Sans catégorie', quantity: 0, revenue: 0 };
    p.name = i.name; // le nom le plus récent
    p.quantity += Number(i.quantity);
    p.revenue += Number(i.total);
    products.set(i.product_id, p);
  }
  const productList = [...products.entries()].map(([productId, p]) => ({ productId, ...p })).sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.name.localeCompare(b.name));
  const categories = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const p of productList) {
    const c = categories.get(p.categoryName) ?? { name: p.categoryName, quantity: 0, revenue: 0 };
    c.quantity += p.quantity;
    c.revenue += p.revenue;
    categories.set(p.categoryName, c);
  }

  // Commande saisie par le personnel : son auteur ; commande QR : qui l'a confirmée.
  const confirmer = new Map<string, string | null>();
  for (const c of confirmations) if (!confirmer.has(c.order_id)) confirmer.set(c.order_id, c.by_user_id);
  const staff = new Map<string, { userId: string | null; orders: number; revenue: number; payments: number; collected: number }>();
  const member = (userId: string | null) => {
    const key = userId ?? '';
    const s = staff.get(key) ?? { userId, orders: 0, revenue: 0, payments: 0, collected: 0 };
    staff.set(key, s);
    return s;
  };
  for (const o of orders) {
    const s = member(o.created_by ?? confirmer.get(o.id) ?? null);
    s.orders += 1;
    s.revenue += Number(o.total);
  }
  for (const p of recorded) {
    const s = member(p.created_by);
    s.payments += 1;
    s.collected += Number(p.amount);
  }
  const userIds = [...staff.values()].map((s) => s.userId).filter((id): id is string => id !== null);
  const users = userIds.length ? await ctx.db.selectFrom('users').select(['id', 'display_name']).where('id', 'in', userIds).execute() : [];

  return {
    currency: location.currency,
    from,
    to,
    byWeek: groupDays(byDay, 'week'),
    byMonth: groupDays(byDay, 'month'),
    categories: [...categories.values()].sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name)),
    products: productList,
    staff: [...staff.values()]
      .map((s) => ({
        ...s,
        name: s.userId === null ? 'Non attribué' : (users.find((u) => u.id === s.userId)?.display_name ?? 'Compte supprimé'),
        averageTicket: s.orders ? Math.floor(s.revenue / s.orders) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.collected - a.collected || a.name.localeCompare(b.name)),
    payments: {
      byMethod: PAYMENT_METHODS.map((method) => {
        const list = recorded.filter((p) => p.method === method);
        return { method, count: list.length, amount: sum(list, (p) => p.amount) };
      }).filter((m) => m.count > 0),
      byDay: dateRange(from, to).flatMap((date) =>
        PAYMENT_METHODS.map((method) => {
          const list = recorded.filter((p) => p.business_date === date && p.method === method);
          return { date, method, count: list.length, amount: sum(list, (p) => p.amount) };
        }).filter((m) => m.count > 0),
      ),
      voidedCount: voided.length,
      voidedAmount: sum(voided, (p) => p.amount),
    },
  };
}

export async function kitchenReport(ctx: AppContext, scope: TenantScope, locationId: string, from: string, to: string): Promise<KitchenReport> {
  await assertLocation(ctx.db, scope, locationId);
  const [orders, history, items, stations] = await Promise.all([
    ctx.db
      .selectFrom('orders as o')
      .leftJoin('dining_tables as t', 't.id', 'o.table_id')
      .select(['o.id', 'o.number', 'o.business_date', 't.label'])
      .where('o.location_id', '=', locationId)
      .where('o.business_date', '>=', from)
      .where('o.business_date', '<=', to)
      .where('o.status', 'not in', [...NOT_SOLD])
      .execute(),
    ctx.db
      .selectFrom('order_status_history as h')
      .innerJoin('orders as o', 'o.id', 'h.order_id')
      .select(['h.order_id', 'h.to_status', 'h.at'])
      .where('o.location_id', '=', locationId)
      .where('o.business_date', '>=', from)
      .where('o.business_date', '<=', to)
      .where('h.to_status', 'in', ['CONFIRMED', 'READY'])
      .orderBy('h.at')
      .orderBy('h.hlc')
      .execute(),
    ctx.db
      .selectFrom('order_items as i')
      .innerJoin('orders as o', 'o.id', 'i.order_id')
      .leftJoin('products as p', 'p.id', 'i.product_id')
      .select(['i.order_id', 'i.product_id', 'i.name', 'i.station_id', 'i.quantity', 'i.kds_status', 'i.kds_updated_at', 'p.prep_time_min'])
      .where('o.location_id', '=', locationId)
      .where('o.business_date', '>=', from)
      .where('o.business_date', '<=', to)
      .where('o.status', 'not in', [...NOT_SOLD])
      .orderBy('i.sort')
      .execute(),
    ctx.db.selectFrom('stations').select(['id', 'name']).where('location_id', '=', locationId).execute(),
  ]);

  const confirmedAt = new Map<string, number>();
  const readyAt = new Map<string, number>();
  for (const h of history) {
    const map = h.to_status === 'CONFIRMED' ? confirmedAt : readyAt;
    if (!map.has(h.order_id)) map.set(h.order_id, Number(h.at));
  }
  const input: PrepOrderInput[] = orders.map((o) => ({
    id: o.id,
    number: Number(o.number),
    businessDate: o.business_date,
    tableLabel: o.label ?? null,
    confirmedAt: confirmedAt.get(o.id) ?? null,
    readyAt: readyAt.get(o.id) ?? null,
    items: items
      .filter((i) => i.order_id === o.id)
      .map((i) => ({
        productId: i.product_id,
        name: i.name,
        stationId: i.station_id,
        quantity: Number(i.quantity),
        // Articles marqués prêts avant la phase 7 (migration) : pas d'heure, donc pas de mesure.
        readyAt: i.kds_status === 'READY' && i.kds_updated_at !== null ? Number(i.kds_updated_at) : null,
        prepTimeMin: i.prep_time_min === null || i.prep_time_min === undefined ? null : Number(i.prep_time_min),
      })),
  }));
  return buildKitchenReport(from, to, input, stations);
}

export async function stockReport(ctx: AppContext, scope: TenantScope, locationId: string, from: string, to: string): Promise<StockReport> {
  const location = await assertLocation(ctx.db, scope, locationId);
  // Les mouvements n'ont qu'une heure : on lit une fenêtre élargie puis on classe chacun dans sa journée d'exploitation.
  const startMs = Date.parse(`${from}T00:00:00Z`) - 2 * DAY;
  const endMs = Date.parse(`${to}T00:00:00Z`) + 3 * DAY;
  const [items, before, moves] = await Promise.all([
    ctx.db.selectFrom('inventory_items').selectAll().where('location_id', '=', locationId).orderBy('name').execute(),
    ctx.db
      .selectFrom('inventory_movements')
      .select('item_id')
      .select((eb) => eb.fn.sum<number>('quantity_milli').as('milli'))
      .where('location_id', '=', locationId)
      .where('created_at', '<', startMs)
      .groupBy('item_id')
      .execute(),
    ctx.db
      .selectFrom('inventory_movements as m')
      .leftJoin('users as u', 'u.id', 'm.by_user_id')
      .select(['m.id', 'm.item_id', 'm.kind', 'm.quantity_milli', 'm.unit_cost', 'm.reason', 'm.created_at', 'u.display_name'])
      .where('m.location_id', '=', locationId)
      .where('m.created_at', '>=', startMs)
      .where('m.created_at', '<', endMs)
      .orderBy('m.created_at')
      .execute(),
  ]);

  type Acc = { opening: number; received: number; consumed: number; losses: number; outs: number; adjustments: number; receivedValue: number; moved: boolean };
  const acc = new Map<string, Acc>(items.map((i) => [i.id, { opening: Number(before.find((b) => b.item_id === i.id)?.milli ?? 0), received: 0, consumed: 0, losses: 0, outs: 0, adjustments: 0, receivedValue: 0, moved: false }]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const events: StockReport['events'] = [];
  const cost = (itemId: string) => Number(itemById.get(itemId)?.unit_cost ?? 0);
  const value = (milli: number, unitCost: number) => Math.round((milli * unitCost) / 1000);

  for (const m of moves) {
    const a = acc.get(m.item_id);
    const item = itemById.get(m.item_id);
    if (!a || !item) continue;
    const q = Number(m.quantity_milli);
    const date = businessDate(Number(m.created_at), location.timezone, location.business_day_cutoff_min);
    if (date < from) {
      a.opening += q;
      continue;
    }
    if (date > to) continue;
    a.moved = true;
    switch (m.kind) {
      case 'IN':
        a.received += q;
        a.receivedValue += value(q, m.unit_cost === null ? cost(m.item_id) : Number(m.unit_cost));
        break;
      case 'SALE':
      case 'SALE_CANCEL':
        a.consumed -= q;
        break;
      case 'LOSS':
        a.losses -= q;
        break;
      case 'OUT':
        a.outs -= q;
        break;
      case 'COUNT':
        a.adjustments += q;
        break;
    }
    if (m.kind === 'LOSS' || m.kind === 'OUT' || m.kind === 'COUNT') {
      const quantity = m.kind === 'COUNT' ? q : -q;
      events.push({ id: m.id, at: Number(m.created_at), itemName: item.name, unit: item.unit, kind: m.kind, quantity: fromMilli(quantity), value: value(quantity, cost(m.item_id)), reason: m.reason, by: m.display_name });
    }
  }

  const rows = items
    .filter((i) => i.status === 'ACTIVE' || acc.get(i.id)!.moved)
    .map((i) => {
      const a = acc.get(i.id)!;
      const unitCost = i.unit_cost === null ? null : Number(i.unit_cost);
      const closing = a.opening + a.received - a.consumed - a.losses - a.outs + a.adjustments;
      return {
        itemId: i.id,
        name: i.name,
        unit: i.unit,
        opening: fromMilli(a.opening),
        received: fromMilli(a.received),
        consumed: fromMilli(a.consumed),
        losses: fromMilli(a.losses),
        outs: fromMilli(a.outs),
        adjustments: fromMilli(a.adjustments),
        closing: fromMilli(closing),
        unitCost,
        consumedValue: value(a.consumed, unitCost ?? 0),
        lossValue: value(a.losses, unitCost ?? 0),
        receivedValue: a.receivedValue,
      };
    });

  return {
    currency: location.currency,
    from,
    to,
    items: rows.map(({ receivedValue: _ignored, ...row }) => row),
    totals: {
      receivedValue: sum(rows, (r) => r.receivedValue),
      consumedValue: sum(rows, (r) => r.consumedValue),
      lossValue: sum(rows, (r) => r.lossValue),
    },
    events: events.sort((a, b) => b.at - a.at).slice(0, 200),
  };
}
