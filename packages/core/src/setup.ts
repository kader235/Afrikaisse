import { z } from 'zod';
import { TABLE_SHAPES } from './floor.ts';
import { orderSchema } from './orders.ts';
import { ROLES } from './roles.ts';

/**
 * Assistant de mise en route d'un établissement (§70) et restaurant de démonstration (§71).
 * L'avancement se lit dans les vraies données : une étape est faite quand ce qu'elle configure existe.
 */
export const SETUP_STEPS = ['restaurant', 'logo', 'address', 'currency', 'categories', 'products', 'tables', 'qr', 'stations', 'users', 'printers', 'test'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const SETUP_STEP_LABELS: Record<SetupStep, string> = {
  restaurant: 'Restaurant',
  logo: 'Logo',
  address: 'Adresse',
  currency: 'Devise',
  categories: 'Catégories',
  products: 'Produits',
  tables: 'Tables',
  qr: 'QR',
  stations: 'Stations',
  users: 'Utilisateurs',
  printers: 'Imprimantes',
  test: 'Test',
};

/** Motif inscrit au journal quand la commande de test est annulée. */
export const SETUP_TEST_REASON = 'Commande de test de la mise en route';

export const setupStatusSchema = z.object({
  locationId: z.string(),
  zones: z.number(),
  tables: z.number(),
  categories: z.number(),
  products: z.number(),
  stations: z.number(),
  members: z.number(),
  cashSessions: z.number(),
  orders: z.number(),
  printers: z.number(),
  hasLogo: z.boolean(),
  hasAddress: z.boolean(),
  testDone: z.boolean(),
  isDemo: z.boolean(),
  /** Assez pour servir : au moins une table et un produit. */
  complete: z.boolean(),
  /** L'assistant a été ouvert et la première étape validée. */
  started: z.boolean(),
  completedAt: z.number().nullable(),
  steps: z.array(z.object({ id: z.enum(SETUP_STEPS), label: z.string(), done: z.boolean(), skipped: z.boolean() })),
  /** Où reprendre : première étape ni faite ni passée ; null quand tout est réglé. */
  nextStep: z.enum(SETUP_STEPS).nullable(),
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;

export const setupStepInputSchema = z.object({ skipped: z.boolean() });
export type SetupStepInput = z.infer<typeof setupStepInputSchema>;

/** Génération rapide : « 10 tables en salle, 4 en terrasse ». */
export const quickTablesSchema = z.object({
  zones: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        count: z.number().int().min(1).max(60),
        capacity: z.number().int().min(1).max(50).default(4),
        shape: z.enum(TABLE_SHAPES).optional(),
        /** Préfixe des libellés (T, TE…) ; déduit du nom de la zone s'il manque. */
        prefix: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{1,4}$/, 'Préfixe : 1 à 4 lettres')
          .optional(),
      }),
    )
    .min(1)
    .max(6),
});
export type QuickTablesInput = z.infer<typeof quickTablesSchema>;

export const setupTestOrderSchema = z.object({
  order: orderSchema,
  /** Postes qui ont reçu la commande (écran cuisine / bar). */
  stations: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['KITCHEN', 'BAR']), items: z.number() })),
});
export type SetupTestOrder = z.infer<typeof setupTestOrderSchema>;

/** Identifiants générés pour la démonstration : affichés une seule fois, jamais stockés en clair. */
export const demoCredentialSchema = z.object({ displayName: z.string(), role: z.enum(ROLES), email: z.string(), password: z.string() });
export type DemoCredential = z.infer<typeof demoCredentialSchema>;

export const demoResultSchema = setupStatusSchema.extend({ staff: z.array(demoCredentialSchema) });
export type DemoResult = z.infer<typeof demoResultSchema>;

export const demoTenantSchema = z.object({
  tenantId: z.string(),
  locationId: z.string(),
  organizationName: z.string(),
  owner: demoCredentialSchema,
  staff: z.array(demoCredentialSchema),
  status: setupStatusSchema,
});
export type DemoTenant = z.infer<typeof demoTenantSchema>;
