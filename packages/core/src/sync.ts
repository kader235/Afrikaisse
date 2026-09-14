import { z } from 'zod';

/**
 * Synchronisation serveur local ↔ Cloud (phase 12, SYNC.md).
 * Le serveur local ouvre toutes les connexions : il envoie ses événements (push) et récupère
 * ceux des autres nœuds (pull). Un événement porte la ligne après écriture ; son identité
 * (eventId) le rend idempotent des deux côtés.
 */

export const SYNC_RESULTS = ['APPLIED', 'DUPLICATE', 'CONFLICT', 'REJECTED'] as const;
export type SyncResultStatus = (typeof SYNC_RESULTS)[number];

// Identifiants en UUID : une valeur mal formée est refusée à l'entrée (400) au lieu de faire
// échouer une requête PostgreSQL au milieu de l'application.
export const wireEventSchema = z.object({
  eventId: z.uuid(),
  deviceId: z.uuid(),
  tenantId: z.uuid(),
  locationId: z.uuid().nullable(),
  entityType: z.string().min(1).max(40),
  entityId: z.uuid(),
  operation: z.string().min(1).max(40),
  payload: z.record(z.string(), z.unknown()),
  hlc: z.string().regex(/^\d{15}-\d{5}-.+$/),
  createdAt: z.number(),
});
export type WireEvent = z.infer<typeof wireEventSchema>;

export const pushRequestSchema = z.object({ events: z.array(wireEventSchema).max(500) });
export const pushResponseSchema = z.object({
  results: z.array(z.object({ eventId: z.string(), status: z.enum(SYNC_RESULTS), error: z.string().optional() })),
});
export type PushResponse = z.infer<typeof pushResponseSchema>;

export const pullResponseSchema = z.object({ events: z.array(wireEventSchema), cursor: z.number() });
export type PullResponse = z.infer<typeof pullResponseSchema>;

/** Saisi par le gérant : « K7QM-3XRA » ; tirets et espaces ignorés, casse indifférente. */
export const pairingCodeInputSchema = z
  .string()
  .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9]{8}$/, 'Code d’appairage attendu : 8 caractères, par exemple K7QM-3XRA.'));

export const pairingCodeSchema = z.object({ code: z.string(), expiresAt: z.number(), locationName: z.string() });
export type PairingCode = z.infer<typeof pairingCodeSchema>;

export const pairRequestSchema = z.object({ code: pairingCodeInputSchema, deviceName: z.string().trim().min(1).max(60).default('Serveur local') });

export const snapshotSchema = z.array(z.object({ table: z.string(), rows: z.array(z.record(z.string(), z.unknown())) }));
export type Snapshot = z.infer<typeof snapshotSchema>;

export const pairResponseSchema = z.object({
  deviceId: z.string(),
  deviceSecret: z.string(),
  tenantId: z.string(),
  locationId: z.string(),
  organization: z.string(),
  location: z.string(),
  cursor: z.number(),
  snapshot: snapshotSchema,
});
export type PairResponse = z.infer<typeof pairResponseSchema>;

export const localPairRequestSchema = z.object({
  cloudUrl: z.url().refine((u) => /^https?:\/\//.test(u), 'Adresse du Cloud attendue, par exemple https://app.afrikaisse.com'),
  code: pairingCodeInputSchema,
});

export const syncStatusSchema = z.object({
  paired: z.boolean(),
  cloudUrl: z.string().nullable(),
  deviceId: z.string().nullable(),
  pending: z.number(),
  conflicts: z.number(),
  lastPushAt: z.number().nullable(),
  lastPullAt: z.number().nullable(),
  lastError: z.string().nullable(),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const syncRunSchema = z.object({ pushed: z.number(), pulled: z.number(), conflicts: z.number(), status: syncStatusSchema });
export type SyncRun = z.infer<typeof syncRunSchema>;
