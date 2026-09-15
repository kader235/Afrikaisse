import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * §67-§73 : back-office, supervision, journal d'erreurs, annonces de mise à jour.
 * Rien de ce qui est créé ici n'est synchronisé : ce sont des données propres au nœud qui les écrit
 * (docs/DATABASE.md, « Classification »).
 */
export function platform(c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      // Ce que le Cloud sait d'un serveur local relié : version et compteurs annoncés à chaque appel.
      // Une colonne par instruction : SQLite n'ajoute qu'une colonne à la fois.
      await db.schema.alterTable('devices').addColumn('app_version', 'text').execute();
      await db.schema.alterTable('devices').addColumn('last_push_at', c.ts).execute();
      await db.schema.alterTable('devices').addColumn('last_pull_at', c.ts).execute();
      await db.schema.alterTable('devices').addColumn('reported_pending', 'integer').execute();
      await db.schema.alterTable('devices').addColumn('reported_failed', 'integer').execute();
      await db.schema.alterTable('devices').addColumn('reported_conflicts', 'integer').execute();
      await db.schema.alterTable('devices').addColumn('reported_at', c.ts).execute();

      // Erreurs serveur (500) : borné en nombre et en âge, sans corps de requête ni en-têtes.
      await db.schema
        .createTable('error_logs')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('node_id', c.uuid)
        .addColumn('request_id', 'text')
        .addColumn('method', 'text')
        .addColumn('route', 'text')
        .addColumn('status', 'integer', (col) => col.notNull())
        .addColumn('code', 'text', (col) => col.notNull())
        .addColumn('message', 'text', (col) => col.notNull())
        // Sans clé étrangère : une trace ne doit jamais empêcher d'écrire l'erreur qu'elle décrit.
        .addColumn('tenant_id', c.uuid)
        .execute();
      await db.schema.createIndex('error_logs_created_idx').on('error_logs').column('created_at').execute();

      // Signe de vie des écrans cuisine (KDS) : une ligne par écran, mise à jour à chaque appel.
      await db.schema
        .createTable('screen_heartbeats')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'))
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('station_id', c.uuid)
        .addColumn('name', 'text')
        .addColumn('user_id', c.uuid)
        .addColumn('last_seen_at', c.ts, (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .execute();
      await db.schema.createIndex('screen_heartbeats_location_idx').on('screen_heartbeats').columns(['location_id', 'last_seen_at']).execute();

      // Annonces de version publiées par le Cloud, signées hors du serveur web (cli release-publish).
      await db.schema
        .createTable('app_releases')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('channel', 'text', (col) => col.notNull())
        .addColumn('version', 'text', (col) => col.notNull())
        .addColumn('released_at', c.ts, (col) => col.notNull())
        .addColumn('notes', 'text', (col) => col.notNull())
        .addColumn('download_url', 'text', (col) => col.notNull())
        .addColumn('sha256', 'text', (col) => col.notNull())
        .addColumn('signature', 'text', (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .execute();
      await db.schema.createIndex('app_releases_channel_version_uq').on('app_releases').columns(['channel', 'version']).unique().execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.dropTable('app_releases').execute();
      await db.schema.dropTable('screen_heartbeats').execute();
      await db.schema.dropTable('error_logs').execute();
      for (const col of ['reported_at', 'reported_conflicts', 'reported_failed', 'reported_pending', 'last_pull_at', 'last_push_at', 'app_version']) {
        await db.schema.alterTable('devices').dropColumn(col).execute();
      }
    },
  };
}
