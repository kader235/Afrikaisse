import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREP_MIN,
  buildKitchenReport,
  canSeeNotification,
  csvDocument,
  expectedMinutes,
  formatDuration,
  groupDays,
  notificationTarget,
  notificationText,
  orderPrep,
  ticketDelay,
  weekStart,
  type PrepOrderInput,
} from '../src/index.ts';

const MIN = 60_000;
const T0 = Date.parse('2026-09-15T12:00:00Z');

function order(id: string, number: number, items: PrepOrderInput['items'], extra: Partial<PrepOrderInput> = {}): PrepOrderInput {
  return { id, number, businessDate: '2026-09-15', tableLabel: 'T1', confirmedAt: T0, readyAt: null, items, ...extra };
}
const item = (productId: string, stationId: string | null, readyMin: number | null, prepTimeMin: number | null, quantity = 1) => ({
  productId,
  name: productId,
  stationId,
  quantity,
  readyAt: readyMin === null ? null : T0 + readyMin * MIN,
  prepTimeMin,
});

describe('Temps de préparation', () => {
  it('temps prévu : celui du produit, 15 min sans valeur, 1 min au moins', () => {
    expect(expectedMinutes(null)).toBe(DEFAULT_PREP_MIN);
    expect(expectedMinutes(0)).toBe(1);
    expect(expectedMinutes(8)).toBe(8);
  });

  it('durée = confirmation → prête ; prévu = article le plus long ; retard au-delà', () => {
    const o = order('a', 1, [item('brochettes', 'grill', 12, 10), item('bissap', 'bar', 3, 2)], { readyAt: T0 + 12 * MIN });
    expect(orderPrep(o)).toEqual({ durationMs: 12 * MIN, expectedMs: 10 * MIN, lateMs: 2 * MIN });
    // Sans historique « prête » mais tous les articles prêts : le dernier article fait foi.
    expect(orderPrep({ ...o, readyAt: null }).durationMs).toBe(12 * MIN);
    // Un article pas encore prêt : pas de durée.
    expect(orderPrep(order('b', 2, [item('riz', 'cuisine', null, null)])).durationMs).toBeNull();
    // En avance : aucun retard.
    expect(orderPrep(order('c', 3, [item('riz', 'cuisine', 5, null)], { readyAt: T0 + 5 * MIN })).lateMs).toBe(0);
  });

  it('minuteur en direct : niveau 1 au temps prévu, niveau 2 quand le retard devient franc', () => {
    expect(ticketDelay(T0, [10, 2], T0 + 9 * MIN).level).toBe(0);
    expect(ticketDelay(T0, [10, 2], T0 + 11 * MIN)).toMatchObject({ level: 1, lateMs: MIN, expectedMs: 10 * MIN });
    expect(ticketDelay(T0, [10], T0 + 20 * MIN).level).toBe(2);
    expect(ticketDelay(T0, [null], T0 + 16 * MIN).level).toBe(1);
    expect(ticketDelay(T0, [40], T0 + 61 * MIN).level).toBe(2);
  });

  it('rapport : moyenne, médiane, retards, par poste, par produit, par jour', () => {
    const orders = [
      order('a', 1, [item('brochettes', 'grill', 12, 10, 2), item('bissap', 'bar', 3, 2)], { readyAt: T0 + 12 * MIN }),
      order('b', 2, [item('riz', 'cuisine', 5, null)], { readyAt: T0 + 5 * MIN, tableLabel: null }),
      order('c', 3, [item('riz', 'cuisine', null, null)]),
      order('d', 4, [item('riz', null, 7, null)], { confirmedAt: null }),
    ];
    const report = buildKitchenReport('2026-09-15', '2026-09-15', orders, [
      { id: 'grill', name: 'Grill' },
      { id: 'bar', name: 'Bar' },
      { id: 'cuisine', name: 'Cuisine' },
    ]);
    expect(report.totals).toEqual({ measured: 2, averageMs: 8.5 * MIN, medianMs: 8.5 * MIN, maxMs: 12 * MIN, lateCount: 1, averageLateMs: 2 * MIN, itemsMeasured: 3 });
    expect(report.byStation.map((s) => [s.name, s.items, s.averageMs, s.lateCount])).toEqual([
      ['Grill', 1, 12 * MIN, 1],
      ['Cuisine', 1, 5 * MIN, 0],
      ['Bar', 1, 3 * MIN, 1],
    ]);
    expect(report.byProduct.map((p) => [p.name, p.quantity, p.averageMs, p.expectedMs, p.lateCount])).toEqual([
      ['brochettes', 2, 12 * MIN, 10 * MIN, 1],
      ['riz', 1, 5 * MIN, 15 * MIN, 0],
      ['bissap', 1, 3 * MIN, 2 * MIN, 1],
    ]);
    expect(report.byDay).toEqual([{ date: '2026-09-15', measured: 2, averageMs: 8.5 * MIN, lateCount: 1 }]);
    expect(report.lateTickets).toEqual([{ orderId: 'a', number: 1, businessDate: '2026-09-15', tableLabel: 'T1', confirmedAt: T0, durationMs: 12 * MIN, expectedMs: 10 * MIN, lateMs: 2 * MIN }]);
  });

  it('rapport vide et durées lisibles', () => {
    const empty = buildKitchenReport('2026-09-15', '2026-09-15', [], []);
    expect(empty.totals).toEqual({ measured: 0, averageMs: 0, medianMs: 0, maxMs: 0, lateCount: 0, averageLateMs: 0, itemsMeasured: 0 });
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(12 * MIN + 20_000)).toBe('12 min');
    expect(formatDuration(65 * MIN)).toBe('1 h 05');
  });
});

describe('Regroupement par période', () => {
  const day = (date: string, revenue: number) => ({ date, revenue, orders: 1, collected: revenue });

  it('semaine ISO (lundi) et mois', () => {
    expect(weekStart('2026-09-15')).toBe('2026-09-14'); // mardi → lundi
    expect(weekStart('2026-09-14')).toBe('2026-09-14');
    expect(weekStart('2026-09-20')).toBe('2026-09-14'); // dimanche → lundi précédent
    const days = [day('2026-08-30', 100), day('2026-08-31', 200), day('2026-09-01', 300), day('2026-09-07', 400)];
    expect(groupDays(days, 'week')).toEqual([
      { date: '2026-08-24', from: '2026-08-30', to: '2026-08-30', revenue: 100, orders: 1, collected: 100 },
      { date: '2026-08-31', from: '2026-08-31', to: '2026-09-01', revenue: 500, orders: 2, collected: 500 },
      { date: '2026-09-07', from: '2026-09-07', to: '2026-09-07', revenue: 400, orders: 1, collected: 400 },
    ]);
    expect(groupDays(days, 'month').map((p) => [p.date, p.revenue, p.orders])).toEqual([
      ['2026-08', 300, 2],
      ['2026-09', 700, 2],
    ]);
    expect(groupDays(days, 'day')).toHaveLength(4);
  });
});

describe('Export CSV pour Excel', () => {
  it('BOM UTF-8, point-virgule, virgule décimale, guillemets', () => {
    const csv = csvDocument([
      ['Produit', 'Quantité', 'Montant'],
      ['Riz "gras"; sauce', 1.5, 2500],
      [null, undefined, 0],
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('"Produit";"Quantité";"Montant"\r\n"Riz ""gras""; sauce";1,5;2500\r\n;;0\r\n');
  });
});

describe('Notifications', () => {
  it('public par permission : la salle pour le service, le stock pour les ruptures', () => {
    expect(canSeeNotification('WAITER', 'ORDER_READY')).toBe(true);
    expect(canSeeNotification('CASHIER', 'KITCHEN_PROBLEM')).toBe(true);
    expect(canSeeNotification('KITCHEN', 'ORDER_NEW')).toBe(false);
    expect(canSeeNotification('WAITER', 'STOCK_LOW')).toBe(false);
    expect(canSeeNotification('STOCK_MANAGER', 'STOCK_LOW')).toBe(true);
    expect(notificationTarget('STOCK_LOW')).toBe('stock');
    expect(notificationTarget('BILL_REQUESTED')).toBe('orders');
  });

  it('textes en français calculés depuis les données', () => {
    expect(notificationText('ORDER_NEW', { orderNumber: 12, tableLabel: 'T4' })).toEqual({ title: 'Nouvelle commande n°12', body: 'Table T4 · QR' });
    expect(notificationText('ORDER_READY', { orderNumber: 3, tableLabel: null, serviceType: 'TAKEAWAY' })).toEqual({ title: 'Commande n°3 prête', body: 'À emporter' });
    expect(notificationText('WAITER_CALL', { tableLabel: 'T2', request: 'CALL_WAITER' }).title).toBe('Table T2 appelle un serveur');
    expect(notificationText('WAITER_CALL', { tableLabel: 'T2', request: 'HELP' }).title).toBe("Table T2 demande de l'aide");
    expect(notificationText('BILL_REQUESTED', { tableLabel: 'T2' }).title).toBe("Table T2 demande l'addition");
    expect(notificationText('KITCHEN_PROBLEM', { orderNumber: 7, stationName: 'Grill', message: 'Produit manquant' })).toEqual({ title: 'Problème cuisine · commande n°7', body: 'Grill : Produit manquant' });
    expect(notificationText('STOCK_LOW', { itemName: 'Poulet', level: 1.5, unit: 'KG', state: 'LOW' })).toEqual({ title: 'Stock faible : Poulet', body: 'Reste 1,5 kg' });
    expect(notificationText('STOCK_LOW', { itemName: 'Poulet', level: -0.2, unit: 'KG', state: 'OUT' })).toEqual({ title: 'Rupture : Poulet', body: 'Reste 0 kg' });
  });
});
