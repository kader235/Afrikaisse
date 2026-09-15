import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * §70 : logo de l'établissement et avancement de l'assistant de mise en route.
 * Colonnes nullables sans valeur calculée : identiques en SQLite et en PostgreSQL 9.6.
 */
export function onboarding(c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema.alterTable('locations').addColumn('logo_media_id', c.uuid).execute();
      // Étapes passées par le propriétaire (tableau JSON). null : assistant jamais commencé.
      await db.schema.alterTable('locations').addColumn('setup_skipped', 'text').execute();
      await db.schema.alterTable('locations').addColumn('setup_completed_at', c.ts).execute();
    },

    async down(db: Kysely<any>) {
      for (const column of ['setup_completed_at', 'setup_skipped', 'logo_media_id']) {
        await db.schema.alterTable('locations').dropColumn(column).execute();
      }
    },
  };
}
