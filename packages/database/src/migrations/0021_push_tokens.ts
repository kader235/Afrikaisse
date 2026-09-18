import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/** Tokens FCM des tablettes : locaux au Cloud, jamais synchronisés vers un serveur de restaurant. */
export function pushTokens(c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable('push_tokens')
        .addColumn('token', 'text', (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull())
        .addColumn('location_id', c.uuid, (col) => col.notNull())
        .addColumn('user_id', c.uuid, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .execute();
      await db.schema.createIndex('push_tokens_location_idx').on('push_tokens').columns(['location_id', 'user_id']).execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.dropTable('push_tokens').execute();
    },
  };
}
