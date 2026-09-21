import { z } from 'zod';
import { RELEASE_CHANNELS, type ReleaseChannel } from '@afrikaisse/core';
import { EMBEDDED_RELEASE_PUBLIC_KEY } from './lib/releases.ts';

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
  // « true », « false », ou une liste d'adresses/plages de relais de confiance séparées par des virgules.
  AFK_TRUST_PROXY: z.string().min(1).optional(),
  AFK_AUTO_MIGRATE: flag.optional(),
  AFK_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AFK_WEB_DIR: z.string().min(1).optional(),
  AFK_PORT_FILE: z.string().min(1).optional(),
  AFK_BACKUP_DIR: z.string().min(1).optional(),
  AFK_RATE_LIMIT: flag.optional(),
  AFK_LOG_DIR: z.string().min(1).optional(),
  AFK_RELEASE_PUBLIC_KEY: z.string().min(40).optional(),
  AFK_UPDATE_URL: z.url().optional(),
  AFK_UPDATE_CHANNEL: z.enum(RELEASE_CHANNELS).default('stable'),
  AFK_FCM_CREDENTIALS_FILE: z.string().min(1).optional(),
  AFK_FCM_CREDENTIALS: z.string().min(1).optional(),
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
  /**
   * Quels relais devant l'API sont dignes de confiance pour lire l'adresse réelle du client dans
   * X-Forwarded-For. Par défaut sur le Cloud : uniquement le relais local (o2switch place son
   * Apache/Passenger sur une adresse privée), si bien que l'adresse retenue est celle que CE relais
   * a écrite, et non celle qu'un client aurait glissée en tête de l'en-tête pour contourner les
   * limites par IP. `true` fait confiance à tous les intermédiaires (à éviter) ; `false` ignore
   * l'en-tête (serveur local, connexions directes du LAN).
   */
  trustProxy: boolean | string[];
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
  /** Serveur local : un fichier journal par catégorie dans ce dossier (§74). Absent : sortie standard. */
  logDir: string | undefined;
  /** Clé publique Ed25519 des annonces de version ; par défaut celle embarquée à la construction (§73). */
  releasePublicKey: string;
  /** Adresse interrogée pour les mises à jour ; par défaut le Cloud relié, sinon le Cloud AfriKaisse. */
  updateUrl: string | undefined;
  updateChannel: ReleaseChannel;
  /** Notifications push Android (FCM) : chemin du fichier « compte de service » Firebase. Absent : pas de push. */
  fcmCredentialsFile: string | undefined;
  /** Idem, mais le JSON lui-même (hébergeur sans fichier). Prioritaire sur le fichier. */
  fcmCredentials: string | undefined;
  accessTokenTtlSec: number;
  sessionTtlSec: number;
  loginMaxFailures: number;
  loginWindowSec: number;
}

/**
 * Cloud (o2switch) : le relais Apache/Passenger parle à l'API depuis une adresse locale/privée.
 * On ne fait confiance qu'à ces plages, donc l'adresse retenue (request.ip) est la première adresse
 * publique de X-Forwarded-For écrite par le relais — pas celle qu'un client aurait glissée en tête
 * de l'en-tête pour se faire passer pour une autre adresse et contourner les limites par IP.
 * Serveur local : connexions directes du LAN, aucun relais, on ignore l'en-tête.
 */
const LOCAL_PROXY_RANGES = ['loopback', 'linklocal', 'uniquelocal'];

function parseTrustProxy(raw: string | undefined, cloud: boolean): boolean | string[] {
  if (raw === undefined) return cloud ? LOCAL_PROXY_RANGES : false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
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
    trustProxy: parseTrustProxy(e.AFK_TRUST_PROXY, cloud),
    autoMigrate: e.AFK_AUTO_MIGRATE ?? true,
    logLevel: e.AFK_LOG_LEVEL,
    webDir: e.AFK_WEB_DIR,
    portFile: e.AFK_PORT_FILE,
    backupDir: e.AFK_BACKUP_DIR,
    rateLimit: e.AFK_RATE_LIMIT ?? true,
    logDir: e.AFK_LOG_DIR,
    releasePublicKey: e.AFK_RELEASE_PUBLIC_KEY ?? EMBEDDED_RELEASE_PUBLIC_KEY,
    updateUrl: e.AFK_UPDATE_URL?.replace(/\/+$/, ''),
    updateChannel: e.AFK_UPDATE_CHANNEL,
    fcmCredentialsFile: e.AFK_FCM_CREDENTIALS_FILE,
    fcmCredentials: e.AFK_FCM_CREDENTIALS,
    accessTokenTtlSec: 15 * 60,
    sessionTtlSec: 30 * 24 * 3600,
    loginMaxFailures: 5,
    loginWindowSec: 15 * 60,
  };
}
