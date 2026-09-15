import { z } from 'zod';
import { OPERATING_MODES } from './floor.ts';

/**
 * Supervision d'un établissement (§68-69) : chaque contrôle lit une donnée réelle (requête, dernier
 * signe de vie, file d'impression, fichier de sauvegarde) et donne un état. `NONE` : l'élément
 * n'existe pas ici (établissement sans serveur local, aucune imprimante…).
 */

export const CHECK_STATES = ['OK', 'WARN', 'ERROR', 'NONE'] as const;
export type CheckState = (typeof CHECK_STATES)[number];

export const CHECK_STATE_LABELS: Record<CheckState, string> = { OK: 'Normal', WARN: 'À surveiller', ERROR: 'En défaut', NONE: 'Non utilisé' };

/** Seuils (millisecondes) : un serveur local relié appelle le Cloud toutes les 5 s, un écran cuisine toutes les 30 s. */
export const MONITORING_THRESHOLDS = {
  heartbeatOkMs: 60_000,
  heartbeatWarnMs: 10 * 60_000,
  screenOkMs: 90_000,
  screenWarnMs: 10 * 60_000,
  /** Écrans affichés : vus dans les dernières 24 h. */
  screenListMs: 24 * 3600_000,
  printPendingWarnMs: 60_000,
  backupOkMs: 2 * 3600_000,
  backupWarnMs: 26 * 3600_000,
  databaseSlowMs: 300,
} as const;

const RANK: Record<CheckState, number> = { NONE: 0, OK: 1, WARN: 2, ERROR: 3 };

/** Le plus grave des états ; `NONE` si rien n'est utilisé. */
export function worstState(states: CheckState[]): CheckState {
  return states.reduce<CheckState>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'NONE');
}

/** État d'un signe de vie : récent, en retard, absent. */
export function ageState(lastAt: number | null, now: number, okMs: number, warnMs: number): CheckState {
  if (lastAt === null) return 'ERROR';
  const age = now - lastAt;
  return age <= okMs ? 'OK' : age <= warnMs ? 'WARN' : 'ERROR';
}

const state = z.enum(CHECK_STATES);

export const monitoringSchema = z.object({
  checkedAt: z.number(),
  profile: z.enum(['cloud', 'local']),
  locationId: z.string(),
  overall: state,
  api: z.object({ state, version: z.string(), build: z.string(), startedAt: z.number(), uptimeSec: z.number() }),
  database: z.object({ state, engine: z.enum(['postgres', 'sqlite']), latencyMs: z.number().nullable(), error: z.string().nullable() }),
  cloud: z.object({ state, url: z.string().nullable(), lastContactAt: z.number().nullable(), error: z.string().nullable() }),
  localServer: z.object({
    state,
    mode: z.enum(OPERATING_MODES),
    servers: z.array(z.object({ id: z.string(), name: z.string(), state, lastSeenAt: z.number().nullable(), appVersion: z.string().nullable() })),
  }),
  sync: z.object({
    state,
    paired: z.boolean(),
    lastSuccessAt: z.number().nullable(),
    pending: z.number(),
    failed: z.number(),
    conflicts: z.number(),
    error: z.string().nullable(),
  }),
  printers: z.object({
    state,
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        state,
        lastSuccessAt: z.number().nullable(),
        lastFailureAt: z.number().nullable(),
        lastError: z.string().nullable(),
        pendingJobs: z.number(),
      }),
    ),
  }),
  kds: z.object({
    state,
    screens: z.array(z.object({ id: z.string(), name: z.string().nullable(), stationName: z.string().nullable(), state, lastSeenAt: z.number() })),
  }),
  backup: z.object({ state, enabled: z.boolean(), lastAt: z.number().nullable(), lastName: z.string().nullable() }),
});
export type Monitoring = z.infer<typeof monitoringSchema>;

export const screenHeartbeatSchema = z.object({
  /** Identifiant tiré au hasard par l'écran et gardé dans son stockage local. */
  screenId: z.uuid(),
  stationId: z.uuid().nullable().default(null),
  name: z.string().trim().max(60).optional(),
});
export type ScreenHeartbeatInput = z.infer<typeof screenHeartbeatSchema>;
