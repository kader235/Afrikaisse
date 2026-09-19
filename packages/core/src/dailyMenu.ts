import { z } from 'zod';

/**
 * Menu du jour : les plats que le client peut commander par QR, pour un jour ou une période
 * (jours d'exploitation de l'établissement, bornes incluses).
 *
 * - Aucun menu du jour en vigueur : toute la carte est proposée (comportement historique).
 * - Un menu d'un seul jour l'emporte sur un menu de période ; à égalité, le plus récemment modifié.
 * - La caisse (personnel) n'est jamais limitée par le menu du jour : seul « épuisé » la bloque.
 * - « Épuisé » reste porté par le plat (`products.is_available`), pas par le menu.
 */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide');

export const dailyMenuInputSchema = z
  .object({
    startDate: dateSchema,
    endDate: dateSchema,
    productIds: z.array(z.uuid()).min(1, 'Choisissez au moins un plat.').max(300, 'Trop de plats (300 au plus).'),
  })
  .refine((m) => m.startDate <= m.endDate, { message: 'La date de fin précède la date de début.', path: ['endDate'] });
export type DailyMenuInput = z.infer<typeof dailyMenuInputSchema>;

export const dailyMenuSchema = z.object({
  id: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  productIds: z.array(z.string()),
  updatedAt: z.number(),
});
export type DailyMenu = z.infer<typeof dailyMenuSchema>;

export const dailyMenuStateSchema = z.object({
  /** Jour d'exploitation courant de l'établissement. */
  today: z.string(),
  /** Menu en vigueur aujourd'hui, ou null (toute la carte est alors proposée). */
  current: dailyMenuSchema.nullable(),
  /** Menus en vigueur ou à venir (le courant y figure). */
  menus: z.array(dailyMenuSchema),
});
export type DailyMenuState = z.infer<typeof dailyMenuStateSchema>;

export interface DailyMenuWindow {
  id: string;
  startDate: string;
  endDate: string;
  updatedAt: number;
}

/** Menu en vigueur à la date donnée (format AAAA-MM-JJ), ou null. Déterministe sur tous les nœuds. */
export function pickDailyMenu<T extends DailyMenuWindow>(menus: readonly T[], date: string): T | null {
  const rank = (m: T) => (m.startDate === m.endDate ? 1 : 0);
  let best: T | null = null;
  for (const m of menus) {
    if (m.startDate > date || m.endDate < date) continue;
    if (
      !best ||
      rank(m) > rank(best) ||
      (rank(m) === rank(best) && (m.updatedAt > best.updatedAt || (m.updatedAt === best.updatedAt && m.id > best.id)))
    ) {
      best = m;
    }
  }
  return best;
}
