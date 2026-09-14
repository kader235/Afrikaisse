import { z } from 'zod';
import type { Permission } from './roles.ts';

/**
 * Postes de préparation (cuisine, grill, bar…) et écran cuisine (KDS).
 * Chaque article d'une commande est copié vers le poste de son produit ; chaque poste avance
 * ses articles ; la commande est « prête » quand tous les postes ont fini.
 */

export const STATION_KINDS = ['KITCHEN', 'BAR'] as const;
export type StationKind = (typeof STATION_KINDS)[number];

export const STATION_KIND_LABELS: Record<StationKind, string> = {
  KITCHEN: 'Cuisine',
  BAR: 'Bar',
};

/** Permission qui ouvre un poste : la cuisine ne touche pas au bar, et inversement. */
export function stationPermission(kind: StationKind): Permission {
  return kind === 'BAR' ? 'bar.use' : 'kitchen.use';
}

export const KDS_STATUSES = ['QUEUED', 'PREPARING', 'READY'] as const;
export type KdsStatus = (typeof KDS_STATUSES)[number];

export const KITCHEN_ACTIONS = ['START', 'READY', 'RECALL'] as const;
export type KitchenAction = (typeof KITCHEN_ACTIONS)[number];

/** Colonne d'un ticket sur l'écran d'un poste. */
export function ticketState(items: { kdsStatus: KdsStatus }[]): 'queued' | 'preparing' | 'ready' {
  if (items.length > 0 && items.every((i) => i.kdsStatus === 'READY')) return 'ready';
  return items.some((i) => i.kdsStatus !== 'QUEUED') ? 'preparing' : 'queued';
}

const stationName = z.string().trim().min(1).max(40);

export const createStationSchema = z.object({ name: stationName, kind: z.enum(STATION_KINDS) });
export type CreateStationInput = z.infer<typeof createStationSchema>;

export const updateStationSchema = z
  .object({ name: stationName, kind: z.enum(STATION_KINDS), sort: z.number().int().min(0).max(1000) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucune modification demandée' });
export type UpdateStationInput = z.infer<typeof updateStationSchema>;

export const stationSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  name: z.string(),
  kind: z.enum(STATION_KINDS),
  sort: z.number(),
  productCount: z.number(),
});
export type Station = z.infer<typeof stationSchema>;

export const kitchenActionSchema = z.object({
  /** null : tous les articles de la commande (écran « tous les postes »). */
  stationId: z.uuid().nullable().default(null),
  action: z.enum(KITCHEN_ACTIONS),
});
export type KitchenActionInput = z.infer<typeof kitchenActionSchema>;
