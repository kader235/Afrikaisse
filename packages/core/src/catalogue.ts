import { z } from 'zod';
import { CURRENCIES, type CurrencyCode } from './currency.ts';

/**
 * Catalogue de plats à importer : le restaurateur choisit son pays et reçoit des plats pré-remplis
 * (nom, description, catégorie, photo libre de droits, prix indicatif). Les données vivent dans
 * apps/web/public/catalogue/ : embarquées avec les écrans, elles marchent aussi hors ligne.
 */
export const CATALOGUE_CATEGORIES = ['Entrées', 'Plats', 'Grillades', 'Accompagnements', 'Fast-food', 'Boissons', 'Desserts', 'Petit-déjeuner'] as const;
export type CatalogueCategory = (typeof CATALOGUE_CATEGORIES)[number];

export const catalogueDishSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).nullable(),
  category: z.enum(CATALOGUE_CATEGORIES),
  group: z.string().min(1),
  countries: z.array(z.string().regex(/^([A-Z]{2}|\*)$/)).min(1),
  priceXaf: z.number().int().positive(),
  image: z.string().regex(/^[a-z0-9-]+\.webp$/).nullable(),
  credit: z.object({ author: z.string().min(1), license: z.string().min(1), source: z.string().min(1) }).nullable(),
});
export type CatalogueDish = z.infer<typeof catalogueDishSchema>;

export const catalogueSchema = z.object({
  version: z.number().int(),
  baseCurrency: z.literal('XAF'),
  groups: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })),
  dishes: z.array(catalogueDishSchema),
});
export type Catalogue = z.infer<typeof catalogueSchema>;

/** Valeur indicative d'un franc CFA (XAF) dans l'unité principale de chaque devise. L'euro est fixe (655,957). */
export const XAF_RATES: Record<CurrencyCode, number> = {
  XAF: 1,
  XOF: 1,
  EUR: 1 / 655.957,
  USD: 1 / 600,
  NGN: 2.5,
  GHS: 0.02,
  MAD: 0.0155,
  GNF: 14.3,
  CDF: 4.7,
  RWF: 2.33,
};

/** Pas d'arrondi en unité principale : un prix de carte est un montant « rond ». */
const PRICE_STEP: Record<CurrencyCode, number> = {
  XAF: 50,
  XOF: 50,
  EUR: 0.5,
  USD: 0.5,
  NGN: 50,
  GHS: 1,
  MAD: 1,
  GNF: 500,
  CDF: 100,
  RWF: 50,
};

/** Prix indicatif d'un plat dans la devise de l'établissement, en plus petite unité (comme tous les montants). */
export function cataloguePrice(priceXaf: number, currency: CurrencyCode): number {
  const step = PRICE_STEP[currency];
  const major = Math.max(step, Math.round((priceXaf * XAF_RATES[currency]) / step) * step);
  return Math.round(major * 10 ** CURRENCIES[currency].minorUnits);
}

/** Plats couramment vendus dans un pays (ou partout). */
export function dishesForCountry(catalogue: Catalogue, country: string): CatalogueDish[] {
  return catalogue.dishes.filter((d) => d.countries.includes(country) || d.countries.includes('*'));
}
