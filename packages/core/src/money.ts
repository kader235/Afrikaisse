import { CURRENCIES, type CurrencyCode } from './currency.ts';

/**
 * Montants : entiers dans la plus petite unité (1 FCFA, 1 centime).
 * Ce fichier n'importe rien d'autre que les devises : le menu client l'utilise sans
 * embarquer Zod.
 */
export const MONEY_MAX = 1_000_000_000;

export function formatMoney(minor: number, currency: CurrencyCode, locale = 'fr-FR'): string {
  const digits = CURRENCIES[currency].minorUnits;
  const major = minor / 10 ** digits;
  if (currency === 'XAF' || currency === 'XOF') {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(major)} FCFA`;
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
}

/** « 5 500 », « 5500 FCFA », « 12,50 € » → unités mineures ; null si illisible ou trop précis. */
export function parseMoney(input: string, currency: CurrencyCode): number | null {
  const digits = CURRENCIES[currency].minorUnits;
  const clean = input
    .replace(/[\s  ]/g, '')
    .replace(/fcfa|xaf|xof|eur|usd|€|\$/gi, '')
    .replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [int = '0', frac = ''] = clean.split('.');
  if (frac.length > digits) return null;
  const value = Number(int) * 10 ** digits + (digits ? Number(frac.padEnd(digits, '0')) : 0);
  return value <= MONEY_MAX ? value : null;
}

/** Valeur éditable dans un champ : « 5500 », « 12,50 ». */
export function moneyToInput(minor: number, currency: CurrencyCode): string {
  const digits = CURRENCIES[currency].minorUnits;
  if (!digits) return String(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 10 ** digits)},${String(abs % 10 ** digits).padStart(digits, '0')}`;
}
