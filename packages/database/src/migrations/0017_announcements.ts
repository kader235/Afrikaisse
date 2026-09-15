import type { ColumnDefinitionBuilder, Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * Annonces du menu client : le bandeau qui défile en haut du menu (photo, titre, texte, bouton).
 * Diffusion publiée ou non, sur une période propre (dates, jours, heures) ou sur celle d'une promotion liée.
 * Pas de clé étrangère vers la promotion, la cible ni la photo : un événement de synchronisation peut
 * arriver avant la ligne qu'il cite (même règle que les promotions).
 */
export function announcements(c: ColumnKit) {
  const notNull = (col: ColumnDefinitionBuilder) => col.notNull();
  return {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable('announcements')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'))
        .addColumn('title', 'text', notNull)
        .addColumn('body', 'text')
        .addColumn('button_label', 'text')
        .addColumn('target_kind', 'text')
        .addColumn('target_id', c.uuid)
        .addColumn('promotion_id', c.uuid)
        .addColumn('media_id', c.uuid)
        .addColumn('is_published', c.bool, notNull)
        .addColumn('start_date', 'text')
        .addColumn('end_date', 'text')
        .addColumn('days_mask', 'integer', notNull)
        .addColumn('start_minute', 'integer')
        .addColumn('end_minute', 'integer')
        .addColumn('display_seconds', 'integer', notNull)
        .addColumn('sort', 'integer', notNull)
        .addColumn('status', 'text', notNull)
        .addColumn('created_at', c.ts, notNull)
        .addColumn('updated_at', c.ts, notNull)
        .addColumn('updated_hlc', 'text', notNull)
        .execute();
      await db.schema.createIndex('announcements_location_idx').on('announcements').columns(['location_id', 'status']).execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.dropTable('announcements').execute();
    },
  };
}
