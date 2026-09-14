import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/** Phase 12 : secret des serveurs locaux appairés, codes d'appairage à usage unique. */
export function sync(c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema.alterTable('devices').addColumn('secret_hash', 'text').execute();
      await db.schema
        .createTable('pairing_codes')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'))
        .addColumn('code_hash', 'text', (col) => col.notNull())
        .addColumn('expires_at', c.ts, (col) => col.notNull())
        .addColumn('used_at', c.ts)
        .addColumn('created_by', c.uuid)
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .execute();
      await db.schema.createIndex('pairing_codes_hash_uq').on('pairing_codes').column('code_hash').unique().execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.dropTable('pairing_codes').execute();
      await db.schema.alterTable('devices').dropColumn('secret_hash').execute();
    },
  };
}
