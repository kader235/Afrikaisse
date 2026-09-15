import { z } from 'zod';
import { CURRENCY_CODES } from './currency.ts';
import { ORDER_SOURCES } from './orders.ts';
import { PAYMENT_METHODS, SERVICE_TYPES } from './pos.ts';

/**
 * Rapports de ventes, par journée d'exploitation (la même date que les commandes et les
 * paiements : un service de nuit reste sur la bonne journée).
 * Chiffre d'affaires = commandes confirmées, non annulées (payées ou non), taxes comprises ;
 * encaissé = paiements enregistrés, non annulés.
 */

export const REPORT_MAX_DAYS = 366;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Toutes les dates de la période, bornes comprises. */
export function dateRange(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => shiftDate(from, i));
}

export const reportRangeSchema = z
  .object({ from: day, to: day })
  .refine((r) => r.from <= r.to, { message: 'La date de début dépasse la date de fin.', path: ['from'] })
  .refine((r) => daysBetween(r.from, r.to) < REPORT_MAX_DAYS, { message: `Période limitée à ${REPORT_MAX_DAYS} jours.`, path: ['to'] });
export type ReportRange = z.infer<typeof reportRangeSchema>;

export const salesReportSchema = z.object({
  currency: z.enum(CURRENCY_CODES),
  from: z.string(),
  to: z.string(),
  totals: z.object({
    revenue: z.number(),
    orders: z.number(),
    averageTicket: z.number(),
    collected: z.number(),
    /** Remises manuelles. */
    discounts: z.number(),
    /** Remises des promotions et codes promo. */
    promotions: z.number(),
    taxCollected: z.number(),
    revenueExclTax: z.number(),
    itemsSold: z.number(),
    cancelledCount: z.number(),
    cancelledAmount: z.number(),
  }),
  byDay: z.array(z.object({ date: z.string(), revenue: z.number(), orders: z.number(), collected: z.number() })),
  byMethod: z.array(z.object({ method: z.enum(PAYMENT_METHODS), count: z.number(), amount: z.number() })),
  byHour: z.array(z.object({ hour: z.number(), orders: z.number(), revenue: z.number() })),
  bySource: z.array(z.object({ source: z.enum(ORDER_SOURCES), orders: z.number(), revenue: z.number() })),
  byServiceType: z.array(z.object({ serviceType: z.enum(SERVICE_TYPES), orders: z.number(), revenue: z.number() })),
  topProducts: z.array(z.object({ name: z.string(), quantity: z.number(), revenue: z.number() })),
  byTax: z.array(z.object({ name: z.string(), rateBp: z.number(), base: z.number(), tax: z.number() })),
  byPromotion: z.array(z.object({ name: z.string(), code: z.string().nullable(), orders: z.number(), amount: z.number() })),
});
export type SalesReport = z.infer<typeof salesReportSchema>;
