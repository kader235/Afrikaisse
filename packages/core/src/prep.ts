import { z } from 'zod';

/**
 * Temps de préparation (§30). Chaque commande a un minuteur qui part de sa CONFIRMATION
 * (une commande QR en attente n'est pas encore en cuisine) :
 * - durée d'une commande = confirmation → « prête » (historique des statuts) ;
 * - durée d'un article = confirmation → dernier passage « prêt » de son poste (`kds_updated_at`) ;
 * - temps prévu d'un article = `products.prep_time_min` (15 min si non renseigné, 1 min au moins) ;
 *   temps prévu d'une commande = le plus long de ses articles (les postes travaillent en parallèle) ;
 * - retard = durée − temps prévu, quand elle le dépasse.
 */

export const DEFAULT_PREP_MIN = 15;
const MINUTE = 60_000;

export function expectedMinutes(prepTimeMin: number | null | undefined): number {
  return prepTimeMin == null ? DEFAULT_PREP_MIN : Math.max(1, prepTimeMin);
}

export interface PrepItemInput {
  productId: string;
  name: string;
  stationId: string | null;
  quantity: number;
  /** Heure du passage « prêt » de l'article (null : pas encore prêt). */
  readyAt: number | null;
  prepTimeMin: number | null;
}

export interface PrepOrderInput {
  id: string;
  number: number;
  businessDate: string;
  tableLabel: string | null;
  confirmedAt: number | null;
  readyAt: number | null;
  items: PrepItemInput[];
}

export interface OrderPrep {
  durationMs: number | null;
  expectedMs: number;
  lateMs: number;
}

/** Durée, temps prévu et retard d'une commande. */
export function orderPrep(order: PrepOrderInput): OrderPrep {
  const expectedMs = Math.max(0, ...order.items.map((i) => expectedMinutes(i.prepTimeMin))) * MINUTE || DEFAULT_PREP_MIN * MINUTE;
  const itemsReady = order.items.length > 0 && order.items.every((i) => i.readyAt !== null);
  const readyAt = order.readyAt ?? (itemsReady ? Math.max(...order.items.map((i) => i.readyAt!)) : null);
  const durationMs = order.confirmedAt !== null && readyAt !== null ? Math.max(0, readyAt - order.confirmedAt) : null;
  return { durationMs, expectedMs, lateMs: durationMs === null ? 0 : Math.max(0, durationMs - expectedMs) };
}

/**
 * Minuteur en direct d'un ticket : niveau 1 au-delà du temps prévu, niveau 2 quand le retard
 * dépasse la moitié du temps prévu (10 min au moins).
 */
export function ticketDelay(confirmedAt: number, prepTimeMins: (number | null)[], now: number) {
  const expectedMs = Math.max(...prepTimeMins.map(expectedMinutes), 1) * MINUTE;
  const elapsedMs = Math.max(0, now - confirmedAt);
  const lateMs = Math.max(0, elapsedMs - expectedMs);
  const level: 0 | 1 | 2 = elapsedMs < expectedMs ? 0 : lateMs >= Math.max(10 * MINUTE, expectedMs / 2) ? 2 : 1;
  return { elapsedMs, expectedMs, lateMs, level };
}

/** « 45 s », « 12 min », « 1 h 05 ». */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

const n = z.number();

export const kitchenReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  totals: z.object({
    /** Commandes dont la durée est connue (confirmées puis prêtes). */
    measured: n,
    averageMs: n,
    medianMs: n,
    maxMs: n,
    lateCount: n,
    averageLateMs: n,
    itemsMeasured: n,
  }),
  byStation: z.array(z.object({ stationId: z.string().nullable(), name: z.string(), items: n, averageMs: n, maxMs: n, lateCount: n })),
  byProduct: z.array(z.object({ productId: z.string(), name: z.string(), quantity: n, measured: n, averageMs: n, expectedMs: n, lateCount: n })),
  byDay: z.array(z.object({ date: z.string(), measured: n, averageMs: n, lateCount: n })),
  lateTickets: z.array(
    z.object({
      orderId: z.string(),
      number: n,
      businessDate: z.string(),
      tableLabel: z.string().nullable(),
      confirmedAt: n,
      durationMs: n,
      expectedMs: n,
      lateMs: n,
    }),
  ),
});
export type KitchenReport = z.infer<typeof kitchenReportSchema>;

const average = (list: number[]) => (list.length ? Math.round(list.reduce((s, v) => s + v, 0) / list.length) : 0);

function median(list: number[]): number {
  if (list.length === 0) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export const LATE_TICKETS_MAX = 50;

/** Rapport cuisine d'une période : temps moyen, retards, temps par poste et par produit. */
export function buildKitchenReport(from: string, to: string, orders: PrepOrderInput[], stations: { id: string; name: string }[]): KitchenReport {
  const measured = orders.map((order) => ({ order, prep: orderPrep(order) })).filter((m) => m.prep.durationMs !== null);
  const durations = measured.map((m) => m.prep.durationMs!);
  const late = measured.filter((m) => m.prep.lateMs > 0);

  const stationName = new Map(stations.map((s) => [s.id, s.name]));
  const byStation = new Map<string, { stationId: string | null; durations: number[]; late: number }>();
  const byProduct = new Map<string, { name: string; quantity: number; durations: number[]; expectedMs: number; late: number }>();
  let itemsMeasured = 0;
  for (const order of orders) {
    if (order.confirmedAt === null) continue;
    for (const item of order.items) {
      if (item.readyAt === null) continue;
      itemsMeasured += 1;
      const duration = Math.max(0, item.readyAt - order.confirmedAt);
      const expected = expectedMinutes(item.prepTimeMin) * MINUTE;
      const isLate = duration > expected ? 1 : 0;
      const s = byStation.get(item.stationId ?? '') ?? { stationId: item.stationId, durations: [], late: 0 };
      s.durations.push(duration);
      s.late += isLate;
      byStation.set(item.stationId ?? '', s);
      const p = byProduct.get(item.productId) ?? { name: item.name, quantity: 0, durations: [], expectedMs: expected, late: 0 };
      p.name = item.name;
      p.expectedMs = expected;
      p.quantity += item.quantity;
      p.durations.push(duration);
      p.late += isLate;
      byProduct.set(item.productId, p);
    }
  }

  const days = [...new Set(measured.map((m) => m.order.businessDate))].sort();
  return {
    from,
    to,
    totals: {
      measured: measured.length,
      averageMs: average(durations),
      medianMs: median(durations),
      maxMs: durations.length ? Math.max(...durations) : 0,
      lateCount: late.length,
      averageLateMs: average(late.map((m) => m.prep.lateMs)),
      itemsMeasured,
    },
    byStation: [...byStation.values()]
      .map((s) => ({
        stationId: s.stationId,
        name: s.stationId === null ? 'Sans poste' : (stationName.get(s.stationId) ?? 'Poste supprimé'),
        items: s.durations.length,
        averageMs: average(s.durations),
        maxMs: Math.max(...s.durations),
        lateCount: s.late,
      }))
      .sort((a, b) => b.averageMs - a.averageMs || a.name.localeCompare(b.name)),
    byProduct: [...byProduct.entries()]
      .map(([productId, p]) => ({ productId, name: p.name, quantity: p.quantity, measured: p.durations.length, averageMs: average(p.durations), expectedMs: p.expectedMs, lateCount: p.late }))
      .sort((a, b) => b.averageMs - a.averageMs || a.name.localeCompare(b.name)),
    byDay: days.map((date) => {
      const list = measured.filter((m) => m.order.businessDate === date);
      return { date, measured: list.length, averageMs: average(list.map((m) => m.prep.durationMs!)), lateCount: list.filter((m) => m.prep.lateMs > 0).length };
    }),
    lateTickets: late
      .sort((a, b) => b.prep.lateMs - a.prep.lateMs)
      .slice(0, LATE_TICKETS_MAX)
      .map(({ order, prep }) => ({
        orderId: order.id,
        number: order.number,
        businessDate: order.businessDate,
        tableLabel: order.tableLabel,
        confirmedAt: order.confirmedAt!,
        durationMs: prep.durationMs!,
        expectedMs: prep.expectedMs,
        lateMs: prep.lateMs,
      })),
  };
}
