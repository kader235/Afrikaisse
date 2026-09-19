import type { ColumnDefinitionBuilder, Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * Menu du jour : une ligne = un menu pour un jour ou une période (jours d'exploitation, AAAA-MM-JJ, bornes incluses).
 * La liste des plats est un tableau JSON d'identifiants dans la même ligne : la synchronisation (dernier écrivain
 * gagnant par HLC) remplace le menu d'un bloc, sans fusion partielle. Pas de clé étrangère vers les plats : un
 * événement de synchronisation peut arriver avant la ligne qu'il cite (même règle que les annonces).
 * Un menu n'est jamais supprimé (archivé).
 */
export function dailyMenu(c: ColumnKit) {
  const notNull = (col: ColumnDefinitionBuilder) => col.notNull();
  return {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable('daily_menus')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'))
        .addColumn('start_date', 'text', notNull)
        .addColumn('end_date', 'text', notNull)
        .addColumn('product_ids', 'text', notNull)
        .addColumn('status', 'text', notNull)
        .addColumn('created_at', c.ts, notNull)
        .addColumn('updated_at', c.ts, notNull)
        .addColumn('updated_hlc', 'text', notNull)
        .execute();
      await db.schema.createIndex('daily_menus_location_idx').on('daily_menus').columns(['location_id', 'status', 'end_date']).execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.dropTable('daily_menus').execute();
    },
  };
}
