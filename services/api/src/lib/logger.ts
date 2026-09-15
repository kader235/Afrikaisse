import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.ts';

/**
 * Journaux structurés séparés (§74). Un seul logger pino (celui de Fastify), et un champ
 * `category` porté par des loggers enfants : application, security, sync, printer, database, system.
 *
 * - Cloud (Passenger) : sortie standard, comme avant ; l'hébergeur la range.
 * - Serveur local avec `AFK_LOG_DIR` : un fichier par catégorie dans le dossier de données, avec
 *   rotation par taille et par jour, et suppression des anciens fichiers. Écrit en JavaScript pur
 *   (aucun module natif, aucun processus annexe) : un journal plein ne doit jamais remplir le disque
 *   du PC du restaurant.
 */

export const LOG_CATEGORIES = ['application', 'security', 'sync', 'printer', 'database', 'system'] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];
export type CategoryLoggers = Record<LogCategory, FastifyBaseLogger>;

export function categoryLoggers(root: FastifyBaseLogger): CategoryLoggers {
  return Object.fromEntries(LOG_CATEGORIES.map((category) => [category, root.child({ category })])) as CategoryLoggers;
}

export interface RotationOptions {
  /** Taille au-delà de laquelle le fichier courant est archivé. */
  maxBytes: number;
  /** Nombre de fichiers archivés gardés (`sync.1.log` … `sync.N.log`). */
  keep: number;
  /** Archive plus ancienne : supprimée même si `keep` n'est pas atteint. */
  maxAgeMs: number;
}

export const DEFAULT_ROTATION: RotationOptions = { maxBytes: 2 * 1024 * 1024, keep: 7, maxAgeMs: 30 * 24 * 3600_000 };

const dayOf = (ms: number) => new Date(ms).toDateString();

/** Fichier journal à rotation : taille ou changement de jour → `x.log` devient `x.1.log`, etc. */
export class RotatingFile {
  private fd: number | null = null;
  private size = 0;
  private day = '';

  constructor(
    private readonly dir: string,
    private readonly name: string,
    private readonly options: RotationOptions = DEFAULT_ROTATION,
    private readonly now: () => number = Date.now,
  ) {}

  private path(index = 0) {
    return join(this.dir, index === 0 ? `${this.name}.log` : `${this.name}.${index}.log`);
  }

  private open() {
    mkdirSync(this.dir, { recursive: true });
    this.fd = openSync(this.path(), 'a');
    const stat = fstatSync(this.fd);
    this.size = stat.size;
    this.day = dayOf(stat.size > 0 ? stat.mtimeMs : this.now());
  }

  write(line: string) {
    if (this.fd === null) this.open();
    const bytes = Buffer.byteLength(line);
    if (this.size > 0 && (this.size + bytes > this.options.maxBytes || this.day !== dayOf(this.now()))) this.rotate();
    writeSync(this.fd!, line);
    this.size += bytes;
  }

  rotate() {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
    const last = this.path(this.options.keep);
    if (existsSync(last)) unlinkSync(last);
    for (let i = this.options.keep - 1; i >= 1; i--) {
      if (existsSync(this.path(i))) renameSync(this.path(i), this.path(i + 1));
    }
    if (existsSync(this.path())) renameSync(this.path(), this.path(1));
    this.prune();
    this.open();
  }

  /** Archives trop anciennes ou au-delà du nombre gardé (fichiers laissés par une version précédente). */
  prune() {
    const re = new RegExp(`^${this.name}\\.(\\d+)\\.log$`);
    for (const file of readdirSync(this.dir)) {
      const m = re.exec(file);
      if (!m) continue;
      const full = join(this.dir, file);
      try {
        if (Number(m[1]) > this.options.keep || this.now() - statSync(full).mtimeMs > this.options.maxAgeMs) unlinkSync(full);
      } catch {
        /* fichier ouvert par un autre programme : réessayé à la prochaine rotation */
      }
    }
  }

  close() {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}

const CATEGORY_RE = /"category":"([a-z]+)"/;

/** Flux pino : chaque ligne JSON part dans le fichier de sa catégorie (application par défaut). */
export function categoryFileStream(dir: string, options: RotationOptions = DEFAULT_ROTATION, now: () => number = Date.now) {
  const files = new Map<LogCategory, RotatingFile>(LOG_CATEGORIES.map((c) => [c, new RotatingFile(dir, c, options, now)]));
  return {
    write(line: string) {
      const found = CATEGORY_RE.exec(line)?.[1] as LogCategory | undefined;
      const file = files.get(found && files.has(found) ? found : 'application')!;
      try {
        file.write(line);
      } catch {
        // Disque plein, droits retirés… : le journal ne doit jamais arrêter la caisse.
        process.stderr.write(line);
      }
    },
    close() {
      for (const f of files.values()) f.close();
    },
  };
}

/** Options du logger Fastify selon le profil. */
export function loggerOptions(config: AppConfig) {
  if (config.profile === 'local' && config.logDir) {
    return { level: config.logLevel, stream: categoryFileStream(config.logDir) };
  }
  return { level: config.logLevel };
}
