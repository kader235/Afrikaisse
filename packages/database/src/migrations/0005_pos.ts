import { sql, type CreateTableBuilder, type Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/** Phase 6 : caisse (type de service, remises, paiements, sessions de caisse, reçus). */
export function pos(c: ColumnKit) {
  const base = <T extends string>(table: CreateTableBuilder<T, never>) =>
    table
      .addColumn('id', c.uuid, (col) => col.primaryKey())
      .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
      .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'));

  return {
    async up(db: Kysely<any>) {
      // SQLite n'ajoute qu'une colonne par ALTER TABLE.
      const orderColumns: [string, 'text' | ColumnKit['money'] | ColumnKit['uuid'], string | number | null][] = [
        ['service_type', 'text', 'DINE_IN'],
        ['customer_name', 'text', null],
        ['discount', c.money, 0],
        ['discount_reason', 'text', null],
        ['discount_by', c.uuid, null],
        ['paid_amount', c.money, 0],
        ['payment_status', 'text', 'UNPAID'],
      ];
      for (const [name, type, fallback] of orderColumns) {
        await db.schema
          .alterTable('orders')
          .addColumn(name, type, (col) => (fallback === null ? col : col.notNull().defaultTo(fallback)))
          .execute();
      }
      await db.schema.createIndex('orders_location_payment_idx').on('orders').columns(['location_id', 'payment_status']).execute();

      await base(db.schema.createTable('cash_sessions'))
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('business_date', 'text', (col) => col.notNull())
        .addColumn('opening_float', c.money, (col) => col.notNull())
        .addColumn('opened_at', c.ts, (col) => col.notNull())
        .addColumn('opened_by', c.uuid)
        .addColumn('closed_at', c.ts)
        .addColumn('closed_by', c.uuid)
        .addColumn('counted_cash', c.money)
        .addColumn('expected_cash', c.money)
        .addColumn('difference', c.money)
        .addColumn('note', 'text')
        .addColumn('report', 'text')
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      // Une caisse ouverte par établissement : un seul tiroir à rapprocher en fin de service.
      await db.schema.createIndex('cash_sessions_open_uq').on('cash_sessions').column('location_id').unique().where(sql.ref('status'), '=', 'OPEN').execute();

      await base(db.schema.createTable('cash_movements'))
        .addColumn('cash_session_id', c.uuid, (col) => col.notNull().references('cash_sessions.id'))
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('amount', c.money, (col) => col.notNull())
        .addColumn('reason', 'text', (col) => col.notNull())
        .addColumn('by_user_id', c.uuid)
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('cash_movements_session_idx').on('cash_movements').column('cash_session_id').execute();

      await base(db.schema.createTable('payments'))
        .addColumn('cash_session_id', c.uuid, (col) => col.notNull().references('cash_sessions.id'))
        .addColumn('receipt_number', 'integer', (col) => col.notNull())
        .addColumn('business_date', 'text', (col) => col.notNull())
        .addColumn('method', 'text', (col) => col.notNull())
        .addColumn('amount', c.money, (col) => col.notNull())
        .addColumn('tendered', c.money, (col) => col.notNull())
        .addColumn('change_given', c.money, (col) => col.notNull())
        .addColumn('provider', 'text')
        .addColumn('reference', 'text')
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('void_reason', 'text')
        .addColumn('voided_by', c.uuid)
        .addColumn('voided_at', c.ts)
        .addColumn('created_by', c.uuid)
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('payments_session_idx').on('payments').column('cash_session_id').execute();
      await db.schema.createIndex('payments_receipt_uq').on('payments').columns(['location_id', 'receipt_number']).unique().execute();

      await base(db.schema.createTable('payment_allocations'))
        .addColumn('payment_id', c.uuid, (col) => col.notNull().references('payments.id'))
        .addColumn('order_id', c.uuid, (col) => col.notNull().references('orders.id'))
        .addColumn('amount', c.money, (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .execute();
      await db.schema.createIndex('payment_allocations_payment_idx').on('payment_allocations').column('payment_id').execute();
      await db.schema.createIndex('payment_allocations_order_idx').on('payment_allocations').column('order_id').execute();

      // Compteurs de documents qui ne repartent jamais à zéro (reçus…).
      await db.schema
        .createTable('document_counters')
        .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'))
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('last_number', 'integer', (col) => col.notNull())
        .addPrimaryKeyConstraint('document_counters_pk', ['location_id', 'kind'])
        .execute();
    },

    async down(db: Kysely<any>) {
      for (const t of ['document_counters', 'payment_allocations', 'payments', 'cash_movements', 'cash_sessions']) {
        await db.schema.dropTable(t).execute();
      }
      await db.schema.dropIndex('orders_location_payment_idx').execute();
      for (const col of ['payment_status', 'paid_amount', 'discount_by', 'discount_reason', 'discount', 'customer_name', 'service_type']) {
        await db.schema.alterTable('orders').dropColumn(col).execute();
      }
    },
  };
}
