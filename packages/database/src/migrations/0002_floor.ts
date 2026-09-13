import { sql, type Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/** Phase 2 : mode d'exploitation des établissements, zones et tables du plan de salle. */
export function floor(c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema.alterTable('locations').addColumn('operating_mode', 'text', (col) => col.notNull().defaultTo('CLOUD')).execute();
      await db.schema.alterTable('locations').addColumn('address', 'text').execute();
      await db.schema.alterTable('locations').addColumn('phone', 'text').execute();

      await db.schema
        .createTable('zones')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('sort', 'integer', (col) => col.notNull())
        .addColumn('plan_width', 'integer', (col) => col.notNull())
        .addColumn('plan_height', 'integer', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('zones_location_idx').on('zones').column('location_id').execute();

      await db.schema
        .createTable('dining_tables')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'))
        .addColumn('zone_id', c.uuid, (col) => col.notNull().references('zones.id'))
        .addColumn('label', 'text', (col) => col.notNull())
        .addColumn('label_key', 'text', (col) => col.notNull())
        .addColumn('capacity', 'integer', (col) => col.notNull())
        .addColumn('shape', 'text', (col) => col.notNull())
        .addColumn('x', 'integer', (col) => col.notNull())
        .addColumn('y', 'integer', (col) => col.notNull())
        .addColumn('w', 'integer', (col) => col.notNull())
        .addColumn('h', 'integer', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('dining_tables_zone_idx').on('dining_tables').column('zone_id').execute();
      // Unicité du libellé parmi les tables ACTIVES seulement : une table archivée libère son nom.
      await db.schema
        .createIndex('dining_tables_label_uq')
        .on('dining_tables')
        .columns(['location_id', 'label_key'])
        .unique()
        .where(sql.ref('status'), '=', 'ACTIVE')
        .execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.dropTable('dining_tables').execute();
      await db.schema.dropTable('zones').execute();
      for (const column of ['phone', 'address', 'operating_mode']) {
        await db.schema.alterTable('locations').dropColumn(column).execute();
      }
    },
  };
}
