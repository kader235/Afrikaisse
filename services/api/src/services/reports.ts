import { ORDER_SOURCES, PAYMENT_METHODS, SERVICE_TYPES, dateRange, type SalesReport } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { assertLocation } from './orders.ts';

/** Rapport de ventes d'un établissement sur une période de journées d'exploitation. */
export async function salesReport(ctx: AppContext, scope: TenantScope, locationId: string, from: string, to: string): Promise<SalesReport> {
  const location = await assertLocation(ctx.db, scope, locationId);
  const inRange = <T extends { where: (...args: never[]) => T }>(q: T) => q;
  void inRange;

  const [orders, payments, products] = await Promise.all([
    ctx.db
      .selectFrom('orders')
      .select(['business_date', 'status', 'total', 'discount', 'created_at', 'source', 'service_type'])
      .where('location_id', '=', locationId)
      .where('business_date', '>=', from)
      .where('business_date', '<=', to)
      .execute(),
    ctx.db
      .selectFrom('payments')
      .select(['business_date', 'method', 'amount'])
      .where('location_id', '=', locationId)
      .where('status', '=', 'RECORDED')
      .where('business_date', '>=', from)
      .where('business_date', '<=', to)
      .execute(),
    ctx.db
      .selectFrom('order_items as i')
      .innerJoin('orders as o', 'o.id', 'i.order_id')
      .select('i.name')
      .select((eb) => [eb.fn.sum<number>('i.quantity').as('quantity'), eb.fn.sum<number>('i.total').as('revenue')])
      .where('o.location_id', '=', locationId)
      .where('o.business_date', '>=', from)
      .where('o.business_date', '<=', to)
      .where('o.status', 'not in', ['CANCELLED', 'PENDING'])
      .groupBy('i.name')
      .execute(),
  ]);

  // Une commande QR encore en attente n'est pas une vente : le personnel peut la refuser.
  const sold = orders.filter((o) => o.status !== 'CANCELLED' && o.status !== 'PENDING');
  const cancelled = orders.filter((o) => o.status === 'CANCELLED');
  const sum = <T>(list: T[], pick: (x: T) => number) => list.reduce((s, x) => s + Number(pick(x)), 0);
  const revenue = sum(sold, (o) => o.total);
  const hourOf = new Intl.DateTimeFormat('en-GB', { timeZone: location.timezone, hour: 'numeric', hourCycle: 'h23' });
  const hours = new Map<number, { orders: number; revenue: number }>();
  for (const o of sold) {
    const hour = Number(hourOf.format(new Date(Number(o.created_at)))) % 24;
    const slot = hours.get(hour) ?? { orders: 0, revenue: 0 };
    slot.orders += 1;
    slot.revenue += Number(o.total);
    hours.set(hour, slot);
  }
  const topProducts = products
    .map((p) => ({ name: p.name, quantity: Number(p.quantity), revenue: Number(p.revenue) }))
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
    .slice(0, 15);

  return {
    currency: location.currency,
    from,
    to,
    totals: {
      revenue,
      orders: sold.length,
      averageTicket: sold.length ? Math.floor(revenue / sold.length) : 0,
      collected: sum(payments, (p) => p.amount),
      discounts: sum(sold, (o) => o.discount),
      itemsSold: sum(topProducts.length === products.length ? topProducts : products, (p) => p.quantity),
      cancelledCount: cancelled.length,
      cancelledAmount: sum(cancelled, (o) => o.total),
    },
    byDay: dateRange(from, to).map((date) => {
      const day = sold.filter((o) => o.business_date === date);
      return { date, revenue: sum(day, (o) => o.total), orders: day.length, collected: sum(payments.filter((p) => p.business_date === date), (p) => p.amount) };
    }),
    byMethod: PAYMENT_METHODS.map((method) => {
      const list = payments.filter((p) => p.method === method);
      return { method, count: list.length, amount: sum(list, (p) => p.amount) };
    }).filter((m) => m.count > 0),
    byHour: [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ hour, ...v })),
    bySource: ORDER_SOURCES.map((source) => {
      const list = sold.filter((o) => o.source === source);
      return { source, orders: list.length, revenue: sum(list, (o) => o.total) };
    }).filter((s) => s.orders > 0),
    byServiceType: SERVICE_TYPES.map((serviceType) => {
      const list = sold.filter((o) => o.service_type === serviceType);
      return { serviceType, orders: list.length, revenue: sum(list, (o) => o.total) };
    }).filter((s) => s.orders > 0),
    topProducts,
  };
}
