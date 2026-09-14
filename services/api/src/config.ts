import { z } from 'zod';

const flag = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  AFK_PROFILE: z.enum(['cloud', 'local']).default('cloud'),
  AFK_DB: z.string().min(1).default('sqlite:.data/afrikaisse.sqlite'),
  AFK_HOST: z.string().optional(),
  AFK_PORT: z.coerce.number().int().positive().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  AFK_JWT_SECRET: z.string().min(32).optional(),
  AFK_CORS_ORIGINS: z.string().default(''),
  AFK_PUBLIC_URL: z.url().optional(),
  AFK_COOKIE_SECURE: flag.optional(),
  AFK_TRUST_PROXY: flag.optional(),
  AFK_AUTO_MIGRATE: flag.optional(),
  AFK_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AFK_WEB_DIR: z.string().min(1).optional(),
  AFK_PORT_FILE: z.string().min(1).optional(),
  AFK_BACKUP_DIR: z.string().min(1).optional(),
  AFK_RATE_LIMIT: flag.optional(),
});

export type Profile = 'cloud' | 'local';

export interface AppConfig {
  /** cloud = SaaS multi-tenant (o2switch) ; local = serveur du restaurant (LAN, hors ligne). */
  profile: Profile;
  databaseUrl: string;
  host: string;
  port: number;
  /** Absent : un secret est généré une fois et conservé dans node_state. */
  jwtSecret: string | undefined;
  corsOrigins: string[];
  /** Adresse publique du menu client, écrite dans les QR (ex. https://app.afrikaisse.com). */
  publicUrl: string | undefined;
  cookieSecure: boolean;
  trustProxy: boolean;
  autoMigrate: boolean;
  logLevel: string;
  /** Dossier de l'application web construite, servie par l'API (serveur local). */
  webDir: string | undefined;
  /** Fichier où écrire le port réellement retenu (lu par le lanceur Windows). */
  portFile: string | undefined;
  /** Serveur local : dossier des sauvegardes automatiques de la base (§69). */
  backupDir: string | undefined;
  /** Limites par adresse IP sur les routes ouvertes sans connexion (désactivées dans les tests). */
  rateLimit: boolean;
  accessTokenTtlSec: number;
  sessionTtlSec: number;
  loginMaxFailures: number;
  loginWindowSec: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const e = envSchema.parse(env);
  const cloud = e.AFK_PROFILE === 'cloud';
  return {
    profile: e.AFK_PROFILE,
    databaseUrl: e.AFK_DB,
    // Le serveur local doit être joignable par les tablettes et téléphones du LAN.
    host: e.AFK_HOST ?? (cloud ? '127.0.0.1' : '0.0.0.0'),
    port: e.AFK_PORT ?? e.PORT ?? 4300,
    jwtSecret: e.AFK_JWT_SECRET,
    corsOrigins: e.AFK_CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    publicUrl: e.AFK_PUBLIC_URL?.replace(/\/+$/, ''),
    cookieSecure: e.AFK_COOKIE_SECURE ?? cloud,
    trustProxy: e.AFK_TRUST_PROXY ?? cloud,
    autoMigrate: e.AFK_AUTO_MIGRATE ?? true,
    logLevel: e.AFK_LOG_LEVEL,
    webDir: e.AFK_WEB_DIR,
    portFile: e.AFK_PORT_FILE,
    backupDir: e.AFK_BACKUP_DIR,
    rateLimit: e.AFK_RATE_LIMIT ?? true,
    accessTokenTtlSec: 15 * 60,
    sessionTtlSec: 30 * 24 * 3600,
    loginMaxFailures: 5,
    loginWindowSec: 15 * 60,
  };
}
