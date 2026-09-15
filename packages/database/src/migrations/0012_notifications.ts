import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * §42 : centre de notifications. Propre au nœud (jamais synchronisé) : chaque serveur écrit les
 * notifications des événements qu'il vit ou reçoit, et garde l'état lu / non lu de ses utilisateurs.
 * `seq` n'est qu'un curseur local (interrogation `since=`), l'identité est `id` (UUID v7).
 */
export function notifications(c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable('notifications')
        .addColumn('seq', c.autoPk.type, c.autoPk.build)
        .addColumn('id', c.uuid, (col) => col.notNull())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull())
        .addColumn('location_id', c.uuid, (col) => col.notNull())
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('audience', 'text', (col) => col.notNull())
        .addColumn('urgent', c.bool, (col) => col.notNull())
        .addColumn('data', 'text', (col) => col.notNull())
        .addColumn('entity_type', 'text')
        .addColumn('entity_id', c.uuid)
        .addColumn('dedupe_key', 'text')
        .addColumn('created_by', c.uuid)
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .execute();
      await db.schema.createIndex('notifications_id_uq').on('notifications').column('id').unique().execute();
      // Plusieurs NULL permis en PostgreSQL comme en SQLite : seules les clés posées sont uniques.
      await db.schema.createIndex('notifications_dedupe_uq').on('notifications').column('dedupe_key').unique().execute();
      await db.schema.createIndex('notifications_location_seq_idx').on('notifications').columns(['location_id', 'seq']).execute();
      await db.schema.createIndex('notifications_location_created_idx').on('notifications').columns(['location_id', 'created_at']).execute();

      await db.schema
        .createTable('notification_reads')
        .addColumn('notification_id', c.uuid, (col) => col.notNull())
        .addColumn('user_id', c.uuid, (col) => col.notNull())
        .addColumn('read_at', c.ts, (col) => col.notNull())
        .addPrimaryKeyConstraint('notification_reads_pk', ['notification_id', 'user_id'])
        .execute();

      // « Tout marquer lu » : un seul repère par personne et établissement au lieu d'une ligne par notification.
      await db.schema
        .createTable('notification_marks')
        .addColumn('user_id', c.uuid, (col) => col.notNull())
        .addColumn('location_id', c.uuid, (col) => col.notNull())
        .addColumn('read_seq', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addPrimaryKeyConstraint('notification_marks_pk', ['user_id', 'location_id'])
        .execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.dropTable('notification_marks').execute();
      await db.schema.dropTable('notification_reads').execute();
      await db.schema.dropTable('notifications').execute();
    },
  };
}
