import { Kysely, PostgresDialect, SqliteDialect, type Dialect } from 'kysely';
import type { Database } from './types.ts';

export type DialectKind = 'postgres' | 'sqlite';

export type DatabaseConfig =
  | { kind: 'postgres'; url: string; maxConnections?: number }
  | { kind: 'sqlite'; file: string }
  /** PostgreSQL embarqué en WASM : sert aux tests, jamais en production. */
  | { kind: 'pglite' };

export interface AppDatabase {
  db: Kysely<Database>;
  kind: DialectKind;
  close(): Promise<void>;
}

/** `postgres://…`, `sqlite:chemin/fichier.sqlite` (ou `sqlite::memory:`), `pglite:`. */
export async function databaseConfigFromUrl(url: string): Promise<DatabaseConfig> {
  if (/^postgres(ql)?:\/\//.test(url)) return { kind: 'postgres', url };
  if (url.startsWith('pglite:')) return { kind: 'pglite' };
  if (url.startsWith('sqlite:')) {
    const file = url.slice('sqlite:'.length);
    if (file !== ':memory:') {
      const { mkdirSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(file), { recursive: true });
    }
    return { kind: 'sqlite', file };
  }
  throw new Error(`AFK_DB non reconnu : ${url.split(':')[0]}:…`);
}

export async function createDatabase(config: DatabaseConfig): Promise<AppDatabase> {
  switch (config.kind) {
    case 'postgres':
      return wrap(await postgresDialect(config.url, config.maxConnections ?? 5), 'postgres');
    case 'sqlite':
      return wrap(await sqliteDialect(config.file), 'sqlite');
    case 'pglite':
      return wrap(await pgliteDialect(), 'postgres');
  }
}

function wrap(dialect: Dialect, kind: DialectKind): AppDatabase {
  const db = new Kysely<Database>({ dialect });
  return { db, kind, close: () => db.destroy() };
}

// int8 (bigint) : les dates en millisecondes et les montants tiennent largement
// dans un Number JavaScript (2^53) ; sans ce parseur, pg renvoie des chaînes.
const INT8_OID = 20;

async function postgresDialect(url: string, max: number): Promise<Dialect> {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(INT8_OID, (v) => Number(v));
  return new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max }) });
}

/**
 * SQLite via `node:sqlite` (intégré à Node 24) : aucun module natif à compiler,
 * ce qui compte ici (pas de compilateur sur o2switch ni sur le poste de build).
 */
async function sqliteDialect(file: string): Promise<Dialect> {
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL');
  // FULL : une coupure de courant ne doit jamais perdre un paiement validé.
  raw.exec('PRAGMA synchronous = FULL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');

  const bind = (params: ReadonlyArray<unknown>) =>
    params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p)) as never[];

  return new SqliteDialect({
    database: {
      close: () => raw.close(),
      prepare(sql: string) {
        const stmt = raw.prepare(sql);
        return {
          reader: stmt.columns().length > 0,
          all: (params: ReadonlyArray<unknown>) => stmt.all(...bind(params)),
          run: (params: ReadonlyArray<unknown>) => {
            const r = stmt.run(...bind(params));
            return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
          },
          iterate: (params: ReadonlyArray<unknown>) => stmt.iterate(...bind(params)),
        };
      },
    },
  });
}

async function pgliteDialect(): Promise<Dialect> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = await PGlite.create({ parsers: { [INT8_OID]: (v: string) => Number(v) } });

  // PGlite n'a qu'une connexion : on la prête à un seul client à la fois,
  // sinon deux transactions Kysely s'entremêleraient.
  let queue: Promise<void> = Promise.resolve();
  const pool = {
    async connect() {
      let release!: () => void;
      const previous = queue;
      queue = new Promise<void>((r) => (release = r));
      await previous;
      return {
        async query(sql: string, params: unknown[]) {
          const res = await pglite.query<Record<string, unknown>>(sql, params);
          const command = /^\s*(\w+)/.exec(sql)?.[1]?.toUpperCase() ?? 'SELECT';
          return { command, rowCount: res.affectedRows ?? res.rows.length, rows: res.rows };
        },
        release: () => release(),
      };
    },
    end: () => pglite.close(),
  };
  return new PostgresDialect({ pool: pool as never });
}
