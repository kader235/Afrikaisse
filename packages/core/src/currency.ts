/**
 * Les montants sont TOUJOURS des entiers dans la plus petite unité de la devise
 * (1 FCFA, 1 centime d'euro). Jamais de flottants pour de l'argent.
 */
export const CURRENCIES = {
  XAF: { minorUnits: 0, label: 'Franc CFA (CEMAC)' },
  XOF: { minorUnits: 0, label: 'Franc CFA (UEMOA)' },
  EUR: { minorUnits: 2, label: 'Euro' },
  USD: { minorUnits: 2, label: 'Dollar US' },
  NGN: { minorUnits: 2, label: 'Naira' },
  GHS: { minorUnits: 2, label: 'Cedi' },
  MAD: { minorUnits: 2, label: 'Dirham marocain' },
  GNF: { minorUnits: 0, label: 'Franc guinéen' },
  CDF: { minorUnits: 2, label: 'Franc congolais' },
  RWF: { minorUnits: 0, label: 'Franc rwandais' },
} as const;
export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];

export const LOCATION_TYPES = [
  'RESTAURANT',
  'HOTEL',
  'CAFE',
  'BAR',
  'LOUNGE',
  'FAST_FOOD',
  'BAKERY',
  'PASTRY',
  'FOOD_COURT',
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];
