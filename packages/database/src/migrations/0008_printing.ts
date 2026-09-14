import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/** Phase 9 : imprimantes réseau et file d'impression (propre au nœud, jamais synchronisée). */
export function printing(c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable('printers')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('host', 'text', (col) => col.notNull())
        .addColumn('port', 'integer', (col) => col.notNull())
        .addColumn('width', 'integer', (col) => col.notNull())
        .addColumn('station_id', c.uuid, (col) => col.references('stations.id'))
        .addColumn('prints_kitchen', c.bool, (col) => col.notNull())
        .addColumn('prints_receipts', c.bool, (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('last_ok_at', c.ts)
        .addColumn('last_error', 'text')
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('printers_location_idx').on('printers').columns(['location_id', 'status']).execute();

      await db.schema
        .createTable('print_jobs')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'))
        .addColumn('printer_id', c.uuid, (col) => col.notNull().references('printers.id'))
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('payload', 'text', (col) => col.notNull())
        .addColumn('attempts', 'integer', (col) => col.notNull())
        .addColumn('last_error', 'text')
        .addColumn('order_id', c.uuid, (col) => col.references('orders.id'))
        .addColumn('next_attempt_at', c.ts, (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('sent_at', c.ts)
        .execute();
      await db.schema.createIndex('print_jobs_queue_idx').on('print_jobs').columns(['status', 'next_attempt_at']).execute();
      await db.schema.createIndex('print_jobs_order_idx').on('print_jobs').column('order_id').execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.dropTable('print_jobs').execute();
      await db.schema.dropTable('printers').execute();
    },
  };
}
