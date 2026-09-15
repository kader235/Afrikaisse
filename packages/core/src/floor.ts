import { z } from 'zod';
import { CURRENCY_CODES, LOCATION_TYPES } from './currency.ts';
import { BILL_MODES } from './guests.ts';
import { MENU_THEMES } from './menuThemes.ts';

/**
 * Établissements, zones et plan de salle.
 * Le plan est une grille de cases entières : pas de flottants, placement au doigt
 * « aimanté », et les mêmes règles de géométrie côté serveur et côté tablette.
 */
export const OPERATING_MODES = ['CLOUD', 'HYBRID'] as const;
export type OperatingMode = (typeof OPERATING_MODES)[number];

export const TABLE_SHAPES = ['SQUARE', 'ROUND', 'RECT'] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

export const DEFAULT_TABLE_SIZE: Record<TableShape, { w: number; h: number }> = {
  SQUARE: { w: 2, h: 2 },
  ROUND: { w: 2, h: 2 },
  RECT: { w: 4, h: 2 },
};

export const PLAN = {
  minWidth: 8,
  maxWidth: 60,
  minHeight: 6,
  maxHeight: 60,
  maxTableSide: 12,
  defaultWidth: 24,
  defaultHeight: 16,
} as const;

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const nonEmpty = (v: object) => Object.keys(v).length > 0;
const NO_CHANGE = { message: 'Aucune modification demandée' };

const locationFields = {
  name: z.string().trim().min(2).max(120),
  type: z.enum(LOCATION_TYPES),
  currency: z.enum(CURRENCY_CODES),
  timezone: z.string().trim().min(3).max(64).refine(isValidTimezone, 'Fuseau horaire inconnu'),
  country: z.string().trim().length(2).toUpperCase(),
  address: z.string().trim().max(300).nullable(),
  phone: z.string().trim().max(40).nullable(),
  /** Minutes après minuit : les ventes avant cette heure comptent pour la veille. */
  businessDayCutoffMin: z.number().int().min(0).max(720),
  operatingMode: z.enum(OPERATING_MODES),
  /** Logo : une image déjà téléversée (`POST /locations/:id/media`) ; null le retire. */
  logoMediaId: z.uuid().nullable(),
  /** Le client saisit le code de la table avant sa première commande QR (I-9). */
  tableCodeRequired: z.boolean(),
  billMode: z.enum(BILL_MODES),
};

export const createLocationSchema = z.object({
  ...locationFields,
  address: locationFields.address.default(null),
  phone: locationFields.phone.default(null),
  logoMediaId: locationFields.logoMediaId.default(null),
  businessDayCutoffMin: locationFields.businessDayCutoffMin.default(300),
  operatingMode: locationFields.operatingMode.default('CLOUD'),
  tableCodeRequired: locationFields.tableCodeRequired.default(false),
  billMode: locationFields.billMode.default('SHARED'),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

// Sans valeurs par défaut : un PATCH ne doit jamais remettre un champ absent à zéro.
export const updateLocationSchema = z
  .object({
    ...locationFields,
    /** Thème du menu client (QR) : un identifiant de MENU_THEMES. */
    menuTheme: z.enum(MENU_THEMES),
  })
  .partial()
  .refine(nonEmpty, NO_CHANGE);
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

const planWidth = z.number().int().min(PLAN.minWidth).max(PLAN.maxWidth);
const planHeight = z.number().int().min(PLAN.minHeight).max(PLAN.maxHeight);
const zoneName = z.string().trim().min(1).max(60);

export const createZoneSchema = z.object({
  name: zoneName,
  planWidth: planWidth.default(PLAN.defaultWidth),
  planHeight: planHeight.default(PLAN.defaultHeight),
});
export type CreateZoneInput = z.infer<typeof createZoneSchema>;

export const updateZoneSchema = z
  .object({ name: zoneName, planWidth, planHeight, sort: z.number().int().min(0).max(1000) })
  .partial()
  .refine(nonEmpty, NO_CHANGE);
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;

const cell = z.number().int().min(0).max(PLAN.maxWidth - 1);
const side = z.number().int().min(1).max(PLAN.maxTableSide);
const tableLabel = z.string().trim().min(1).max(12);
const capacity = z.number().int().min(1).max(50);

export const createTableSchema = z.object({
  label: tableLabel,
  capacity: capacity.default(4),
  shape: z.enum(TABLE_SHAPES).default('SQUARE'),
  x: cell.optional(),
  y: cell.optional(),
  w: side.optional(),
  h: side.optional(),
});
export type CreateTableInput = z.infer<typeof createTableSchema>;

export const updateTableSchema = z
  .object({ label: tableLabel, capacity, shape: z.enum(TABLE_SHAPES), zoneId: z.uuid() })
  .partial()
  .refine(nonEmpty, NO_CHANGE);
export type UpdateTableInput = z.infer<typeof updateTableSchema>;

export const layoutSchema = z.object({
  tables: z.array(z.object({ id: z.uuid(), x: cell, y: cell, w: side, h: side })).min(1).max(500),
});
export type LayoutInput = z.infer<typeof layoutSchema>;

// --- Géométrie (partagée serveur / tablette) -------------------------------

export interface PlanRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectsOverlap(a: PlanRect, b: PlanRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function rectInside(r: PlanRect, width: number, height: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height;
}

/** Première place libre en lecture (haut → bas, gauche → droite), avec une case d'allée si possible. */
export function findFreeSpot(occupied: PlanRect[], w: number, h: number, width: number, height: number): { x: number; y: number } | null {
  for (const gap of [1, 0]) {
    for (let y = 0; y + h <= height; y++) {
      for (let x = 0; x + w <= width; x++) {
        const probe = { x: x - gap, y: y - gap, w: w + 2 * gap, h: h + 2 * gap };
        if (!occupied.some((o) => rectsOverlap(probe, o))) return { x, y };
      }
    }
  }
  return null;
}

export interface LayoutIssues {
  outOfBounds: string[];
  overlaps: [string, string][];
}

export function findLayoutIssues(items: (PlanRect & { id: string })[], width: number, height: number): LayoutIssues {
  const outOfBounds = items.filter((i) => !rectInside(i, width, height)).map((i) => i.id);
  const overlaps: [string, string][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (rectsOverlap(items[i]!, items[j]!)) overlaps.push([items[i]!.id, items[j]!.id]);
    }
  }
  return { outOfBounds, overlaps };
}

// --- Réponses ---------------------------------------------------------------

const RECORD_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;

export const locationDetailsSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(LOCATION_TYPES),
  currency: z.enum(CURRENCY_CODES),
  timezone: z.string(),
  country: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  logoMediaId: z.string().nullable(),
  logoUrl: z.string().nullable(),
  businessDayCutoffMin: z.number(),
  operatingMode: z.enum(OPERATING_MODES),
  tableCodeRequired: z.boolean(),
  billMode: z.enum(BILL_MODES),
  /** Thème du menu client (QR) ; « bleu » quand l'établissement n'en a pas choisi. */
  menuTheme: z.enum(MENU_THEMES),
  status: z.enum(RECORD_STATUSES),
  createdAt: z.number(),
});
export type LocationDetails = z.infer<typeof locationDetailsSchema>;

export const zoneSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  name: z.string(),
  sort: z.number(),
  planWidth: z.number(),
  planHeight: z.number(),
  status: z.enum(RECORD_STATUSES),
});
export type Zone = z.infer<typeof zoneSchema>;

export const diningTableSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  zoneId: z.string(),
  label: z.string(),
  capacity: z.number(),
  shape: z.enum(TABLE_SHAPES),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  status: z.enum(RECORD_STATUSES),
});
export type DiningTable = z.infer<typeof diningTableSchema>;

export const floorSchema = z.object({
  location: locationDetailsSchema,
  zones: z.array(zoneSchema),
  tables: z.array(diningTableSchema),
});
export type Floor = z.infer<typeof floorSchema>;
