import { z } from 'zod';
import { CURRENCY_CODES } from './currency.ts';
import { PAYMENT_METHODS } from './pos.ts';
import { INVENTORY_UNITS } from './stock.ts';

/**
 * Rapports détaillés (§38-39) : périodes (semaine, mois), produits, catégories, personnel,
 * paiements, stock. Même règle que le rapport de ventes : journées d'exploitation, commandes
 * confirmées non annulées, paiements non annulés.
 */

const n = z.number();

// --- Regroupement des journées ----------------------------------------------------

export type PeriodGrain = 'day' | 'week' | 'month';

/** Lundi de la semaine (ISO) d'une date AAAA-MM-JJ. */
export function weekStart(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const dow = new Date(ms).getUTCDay();
  return new Date(ms - ((dow + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

export interface DayFigures {
  date: string;
  revenue: number;
  orders: number;
  collected: number;
}

export interface PeriodFigures extends DayFigures {
  /** Première et dernière journée de la période présentes dans les données. */
  from: string;
  to: string;
}

/** Journées → semaines (clé = lundi) ou mois (clé = AAAA-MM). */
export function groupDays(days: DayFigures[], grain: PeriodGrain): PeriodFigures[] {
  const out = new Map<string, PeriodFigures>();
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = grain === 'day' ? d.date : grain === 'week' ? weekStart(d.date) : d.date.slice(0, 7);
    const p = out.get(key) ?? { date: key, from: d.date, to: d.date, revenue: 0, orders: 0, collected: 0 };
    p.to = d.date;
    p.revenue += d.revenue;
    p.orders += d.orders;
    p.collected += d.collected;
    out.set(key, p);
  }
  return [...out.values()];
}

const period = z.object({ date: z.string(), from: z.string(), to: z.string(), revenue: n, orders: n, collected: n });

export const breakdownReportSchema = z.object({
  currency: z.enum(CURRENCY_CODES),
  from: z.string(),
  to: z.string(),
  byWeek: z.array(period),
  byMonth: z.array(period),
  /** Catégorie ACTUELLE du produit (les lignes de commande ne copient que le nom). */
  categories: z.array(z.object({ name: z.string(), quantity: n, revenue: n })),
  products: z.array(z.object({ productId: z.string(), name: z.string(), categoryName: z.string(), quantity: n, revenue: n })),
  /** Commande attribuée à qui l'a saisie, sinon à qui l'a confirmée (commande QR). */
  staff: z.array(z.object({ userId: z.string().nullable(), name: z.string(), orders: n, revenue: n, averageTicket: n, payments: n, collected: n })),
  payments: z.object({
    byMethod: z.array(z.object({ method: z.enum(PAYMENT_METHODS), count: n, amount: n })),
    byDay: z.array(z.object({ date: z.string(), method: z.enum(PAYMENT_METHODS), count: n, amount: n })),
    voidedCount: n,
    voidedAmount: n,
  }),
});
export type BreakdownReport = z.infer<typeof breakdownReportSchema>;

export const STOCK_REPORT_EVENTS = ['LOSS', 'OUT', 'COUNT'] as const;

export const stockReportSchema = z.object({
  currency: z.enum(CURRENCY_CODES),
  from: z.string(),
  to: z.string(),
  /** Quantités en unités de l'article (décimales) ; consommé et pertes en positif, ajustements signés. */
  items: z.array(
    z.object({
      itemId: z.string(),
      name: z.string(),
      unit: z.enum(INVENTORY_UNITS),
      opening: n,
      received: n,
      consumed: n,
      losses: n,
      outs: n,
      adjustments: n,
      closing: n,
      unitCost: n.nullable(),
      consumedValue: n,
      lossValue: n,
    }),
  ),
  totals: z.object({ receivedValue: n, consumedValue: n, lossValue: n }),
  events: z.array(
    z.object({ id: z.string(), at: n, itemName: z.string(), unit: z.enum(INVENTORY_UNITS), kind: z.enum(STOCK_REPORT_EVENTS), quantity: n, value: n, reason: z.string().nullable(), by: z.string().nullable() }),
  ),
});
export type StockReport = z.infer<typeof stockReportSchema>;

// --- Export CSV ------------------------------------------------------------------

export type CsvValue = string | number | null | undefined;

/** Cellule pour Excel en français : décimales à virgule, guillemets doublés. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(value).replace('.', ',') : value;
  return /[";\r\n]/.test(text) || typeof value === 'string' ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Document CSV complet : BOM UTF-8 (accents lus par Excel), point-virgule, fins de ligne Windows. */
export function csvDocument(rows: CsvValue[][]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
