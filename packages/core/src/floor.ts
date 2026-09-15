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

/** Slogan du menu client : une ligne (espaces resserrés), 80 caractères ; vide → null (retour à la phrase d'accueil). */
export const SLOGAN_MAX = 80;
export const sloganSchema = z
  .string()
  .trim()
  .max(SLOGAN_MAX, `Slogan : ${SLOGAN_MAX} caractères au plus`)
  .transform((v) => v.replace(/\s+/g, ' ') || null)
  .nullable();

// Sans valeurs par défaut : un PATCH ne doit jamais remettre un champ absent à zéro.
export const updateLocationSchema = z
  .object({
    ...locationFields,
    /** Thème du menu client (QR) : un identifiant de MENU_THEMES. */
    menuTheme: z.enum(MENU_THEMES),
    /** Slogan affiché en titre du menu client ; null ou vide le retire. */
    slogan: sloganSchema,
  })
  .partial()
  .refine(nonEmpty, NO_CHANGE);
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

const planWidth = z.number().int().min(PLAN.minWidth).max(PLAN.maxWidth);
const planHeight = z.number().int().min(PLAN.minHeight).max(PLAN.maxHeight);
const zoneName = z.string().trim().min(1).max(60);

/**
 * Couleur de zone : un liseré ou une pastille à côté des tables, jamais un fond sous du texte.
 * Huit teintes nettement distinctes, lisibles en trait sur fond blanc comme sous un texte blanc (AA).
 */
export const ZONE_COLORS = ['#1D4ED8', '#15803D', '#C2410C', '#7C3AED', '#0F766E', '#B91C1C', '#B45309', '#BE185D'] as const;

export const zoneColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur attendue au format #RRGGBB')
  .transform((v) => v.toUpperCase());

/** Couleur affichée : celle choisie, sinon une teinte de la palette selon l'ordre de la zone. */
export function resolveZoneColor(color: string | null | undefined, sort: number): string {
  const n = ZONE_COLORS.length;
  return color ?? ZONE_COLORS[((sort % n) + n) % n]!;
}

export const createZoneSchema = z.object({
  name: zoneName,
  planWidth: planWidth.default(PLAN.defaultWidth),
  planHeight: planHeight.default(PLAN.defaultHeight),
  /** Absente : la première couleur de la palette que les autres zones n'utilisent pas. */
  color: zoneColorSchema.optional(),
});
export type CreateZoneInput = z.infer<typeof createZoneSchema>;

export const updateZoneSchema = z
  .object({ name: zoneName, planWidth, planHeight, sort: z.number().int().min(0).max(1000), color: zoneColorSchema })
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

/** Plusieurs tables d'un coup : « T1 à T20 ». Les libellés déjà pris sont passés. */
export const TABLES_RANGE_MAX = 100;
const rangeNumber = z.number().int().min(0).max(999);

export const createTablesRangeSchema = z
  .object({
    prefix: z.string().trim().max(6).default('T'),
    from: rangeNumber,
    to: rangeNumber,
    capacity: capacity.default(4),
    shape: z.enum(TABLE_SHAPES).default('SQUARE'),
  })
  .refine((v) => v.to >= v.from, { message: 'Le dernier numéro doit être supérieur ou égal au premier.', path: ['to'] })
  .refine((v) => v.to - v.from + 1 <= TABLES_RANGE_MAX, { message: `${TABLES_RANGE_MAX} tables au plus en une fois.`, path: ['to'] });
export type CreateTablesRangeInput = z.infer<typeof createTablesRangeSchema>;

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
  /** Slogan du menu client ; null : le menu affiche sa phrase d'accueil. */
  slogan: z.string().nullable(),
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
  /** Toujours renseignée : couleur choisie, sinon teinte de la palette selon l'ordre. */
  color: z.string(),
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

export const tablesRangeResultSchema = z.object({
  created: z.array(diningTableSchema),
  /** Libellés déjà utilisés dans l'établissement : passés. */
  skipped: z.array(z.string()),
  /** Libellés non créés faute de place dans le plan de la zone. */
  full: z.array(z.string()),
});
export type TablesRangeResult = z.infer<typeof tablesRangeResultSchema>;

export const floorSchema = z.object({
  location: locationDetailsSchema,
  zones: z.array(zoneSchema),
  tables: z.array(diningTableSchema),
});
export type Floor = z.infer<typeof floorSchema>;
