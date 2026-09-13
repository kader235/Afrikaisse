import type { Kysely } from 'kysely';
import type { HybridClock } from '@afrikaisse/core';
import type { Database, DialectKind } from '@afrikaisse/database';
import type { AppConfig } from './config.ts';

/** Tout ce dont un service a besoin, injecté (aucun état global). */
export interface AppContext {
  db: Kysely<Database>;
  dbKind: DialectKind;
  config: AppConfig;
  /** Identifiant de ce nœud (Cloud ou serveur local), aussi device_id des événements. */
  nodeId: string;
  issuer: string;
  jwtKey: Uint8Array;
  clock: HybridClock;
  now: () => number;
}

export type Db = Kysely<Database>;

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}
