import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/** Phase 17 : échéance de l'abonnement (null = sans échéance, cas des organisations existantes). */
export function plans(c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema.alterTable('tenants').addColumn('plan_expires_at', c.ts).execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.alterTable('tenants').dropColumn('plan_expires_at').execute();
    },
  };
}
