import { sql, type CreateTableBuilder, type Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/** Phases 4-5 : sessions de table, commandes (lignes, options, historique), numéros, appels. */
export function orders(c: ColumnKit) {
  const base = <T extends string>(table: CreateTableBuilder<T, never>) =>
    table
      .addColumn('id', c.uuid, (col) => col.primaryKey())
      .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
      .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'));

  return {
    async up(db: Kysely<any>) {
      await base(db.schema.createTable('table_sessions'))
        .addColumn('table_id', c.uuid, (col) => col.notNull().references('dining_tables.id'))
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('opened_at', c.ts, (col) => col.notNull())
        .addColumn('opened_by', c.uuid)
        .addColumn('closed_at', c.ts)
        .addColumn('closed_by', c.uuid)
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      // Une seule session ouverte par table : deux clients qui commandent en même temps partagent la même addition.
      await db.schema
        .createIndex('table_sessions_open_uq')
        .on('table_sessions')
        .column('table_id')
        .unique()
        .where(sql.ref('status'), '=', 'OPEN')
        .execute();

      await base(db.schema.createTable('orders'))
        .addColumn('table_session_id', c.uuid, (col) => col.references('table_sessions.id'))
        .addColumn('table_id', c.uuid, (col) => col.references('dining_tables.id'))
        .addColumn('number', 'integer', (col) => col.notNull())
        .addColumn('business_date', 'text', (col) => col.notNull())
        .addColumn('source', 'text', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('note', 'text')
        .addColumn('currency', 'text', (col) => col.notNull())
        .addColumn('subtotal', c.money, (col) => col.notNull())
        .addColumn('total', c.money, (col) => col.notNull())
        .addColumn('client_token', 'text')
        .addColumn('created_by', c.uuid)
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('status_changed_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('orders_number_uq').on('orders').columns(['location_id', 'business_date', 'number']).unique().execute();
      await db.schema.createIndex('orders_location_status_idx').on('orders').columns(['location_id', 'status']).execute();
      await db.schema.createIndex('orders_session_idx').on('orders').column('table_session_id').execute();
      await db.schema.createIndex('orders_client_idx').on('orders').columns(['client_token', 'created_at']).execute();

      await base(db.schema.createTable('order_items'))
        .addColumn('order_id', c.uuid, (col) => col.notNull().references('orders.id'))
        .addColumn('product_id', c.uuid, (col) => col.notNull().references('products.id'))
        .addColumn('variant_id', c.uuid, (col) => col.references('product_variants.id'))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('variant_name', 'text')
        .addColumn('unit_price', c.money, (col) => col.notNull())
        .addColumn('quantity', 'integer', (col) => col.notNull())
        .addColumn('total', c.money, (col) => col.notNull())
        .addColumn('note', 'text')
        .addColumn('sort', 'integer', (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .execute();
      await db.schema.createIndex('order_items_order_idx').on('order_items').column('order_id').execute();

      await base(db.schema.createTable('order_item_modifiers'))
        .addColumn('order_item_id', c.uuid, (col) => col.notNull().references('order_items.id'))
        .addColumn('modifier_id', c.uuid, (col) => col.notNull().references('modifiers.id'))
        .addColumn('group_name', 'text', (col) => col.notNull())
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('price_delta', c.money, (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .execute();
      await db.schema.createIndex('order_item_modifiers_item_idx').on('order_item_modifiers').column('order_item_id').execute();

      await base(db.schema.createTable('order_status_history'))
        .addColumn('order_id', c.uuid, (col) => col.notNull().references('orders.id'))
        .addColumn('from_status', 'text')
        .addColumn('to_status', 'text', (col) => col.notNull())
        .addColumn('reason', 'text')
        .addColumn('by_user_id', c.uuid)
        .addColumn('source', 'text', (col) => col.notNull())
        .addColumn('at', c.ts, (col) => col.notNull())
        .addColumn('hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('order_status_history_order_idx').on('order_status_history').column('order_id').execute();

      await db.schema
        .createTable('order_counters')
        .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'))
        .addColumn('business_date', 'text', (col) => col.notNull())
        .addColumn('last_number', 'integer', (col) => col.notNull())
        .addPrimaryKeyConstraint('order_counters_pk', ['location_id', 'business_date'])
        .execute();

      await base(db.schema.createTable('service_requests'))
        .addColumn('table_id', c.uuid, (col) => col.notNull().references('dining_tables.id'))
        .addColumn('table_session_id', c.uuid, (col) => col.references('table_sessions.id'))
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('client_token', 'text')
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('handled_at', c.ts)
        .addColumn('handled_by', c.uuid)
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('service_requests_location_status_idx').on('service_requests').columns(['location_id', 'status']).execute();

      // Flux d'activité des écrans (commandes, KDS) : événements d'un établissement après un curseur.
      await db.schema.createIndex('sync_events_location_seq_idx').on('sync_events').columns(['location_id', 'seq']).execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.dropIndex('sync_events_location_seq_idx').execute();
      for (const t of ['service_requests', 'order_counters', 'order_status_history', 'order_item_modifiers', 'order_items', 'orders', 'table_sessions']) {
        await db.schema.dropTable(t).execute();
      }
    },
  };
}
