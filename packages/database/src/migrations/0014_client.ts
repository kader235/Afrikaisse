import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * Menu client (§17, §23, §43, §45, §49) : commandes multi-clients sur une même table,
 * code de table contre les commandes à distance (I-9), addition partagée ou par client,
 * moyen de paiement annoncé avec la demande d'addition (I-7).
 * SQLite n'ajoute qu'une colonne par ALTER TABLE ; rien qui ne passe sur PostgreSQL 9.6.
 */
export function client(c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      // Établissement : code de table exigé (0/1) et mode d'addition.
      await db.schema.alterTable('locations').addColumn('table_code_required', c.bool, (col) => col.notNull().defaultTo(0)).execute();
      await db.schema.alterTable('locations').addColumn('bill_mode', 'text', (col) => col.notNull().defaultTo('SHARED')).execute();

      // Code à 4 chiffres tiré à l'ouverture de la table, montré au personnel et imprimé sur l'addition.
      await db.schema.alterTable('table_sessions').addColumn('join_code', 'text').execute();

      // Demande d'addition : moyen de paiement choisi par le client et portée (toute la table ou sa part).
      await db.schema.alterTable('service_requests').addColumn('payment_method', 'text').execute();
      await db.schema.alterTable('service_requests').addColumn('bill_scope', 'text').execute();

      // Clients d'une table ouverte : un téléphone (client_token) par ligne, surnom facultatif.
      await db.schema
        .createTable('session_guests')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'))
        .addColumn('table_session_id', c.uuid, (col) => col.notNull().references('table_sessions.id'))
        .addColumn('client_token', 'text', (col) => col.notNull())
        .addColumn('nickname', 'text')
        .addColumn('joined_at', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('session_guests_client_uq').on('session_guests').columns(['table_session_id', 'client_token']).unique().execute();

      // Recommandations « Populaires » : ventes terminées d'un établissement sur 30 jours.
      await db.schema.createIndex('orders_location_created_idx').on('orders').columns(['location_id', 'created_at']).execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.dropIndex('orders_location_created_idx').execute();
      await db.schema.dropTable('session_guests').execute();
      for (const column of ['bill_scope', 'payment_method']) await db.schema.alterTable('service_requests').dropColumn(column).execute();
      await db.schema.alterTable('table_sessions').dropColumn('join_code').execute();
      for (const column of ['bill_mode', 'table_code_required']) await db.schema.alterTable('locations').dropColumn(column).execute();
    },
  };
}
