import type { Kysely } from 'kysely';
import { uuidv7 } from '@afrikaisse/core';
import type { ColumnKit } from '../columns.ts';

/** Phase 7 : postes de préparation, poste et avancement de chaque article (écran cuisine). */
export function kitchen(c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable('stations')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('sort', 'integer', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('stations_location_idx').on('stations').columns(['location_id', 'status']).execute();

      // SQLite n'ajoute qu'une colonne par ALTER TABLE.
      await db.schema.alterTable('products').addColumn('station_id', c.uuid, (col) => col.references('stations.id')).execute();
      await db.schema.alterTable('order_items').addColumn('station_id', c.uuid).execute();
      await db.schema.alterTable('order_items').addColumn('kds_status', 'text', (col) => col.notNull().defaultTo('QUEUED')).execute();
      await db.schema.alterTable('order_items').addColumn('kds_updated_at', c.ts).execute();
      await db.schema.createIndex('order_items_station_idx').on('order_items').columns(['station_id', 'kds_status']).execute();

      // Commandes déjà prêtes, servies, terminées ou annulées : plus rien à préparer.
      await db
        .updateTable('order_items')
        .set({ kds_status: 'READY' })
        .where('order_id', 'in', db.selectFrom('orders').select('id').where('status', 'in', ['READY', 'SERVED', 'COMPLETED', 'CANCELLED']))
        .execute();

      // Établissements existants : une cuisine et un bar, comme à la création.
      const now = Date.now();
      const hlc = `${String(now).padStart(15, '0')}-00000-migration`;
      const locations = await db.selectFrom('locations').select(['id', 'tenant_id']).execute();
      for (const l of locations) {
        const defaults: [string, string][] = [
          ['Cuisine', 'KITCHEN'],
          ['Bar', 'BAR'],
        ];
        for (const [sort, [name, kind]] of defaults.entries()) {
          await db
            .insertInto('stations')
            .values({ id: uuidv7(), tenant_id: l.tenant_id, location_id: l.id, name, kind, sort, status: 'ACTIVE', created_at: now, updated_at: now, updated_hlc: hlc })
            .execute();
        }
      }
    },

    async down(db: Kysely<any>) {
      await db.schema.dropIndex('order_items_station_idx').execute();
      for (const col of ['kds_updated_at', 'kds_status', 'station_id']) {
        await db.schema.alterTable('order_items').dropColumn(col).execute();
      }
      await db.schema.alterTable('products').dropColumn('station_id').execute();
      await db.schema.dropIndex('stations_location_idx').execute();
      await db.schema.dropTable('stations').execute();
    },
  };
}
