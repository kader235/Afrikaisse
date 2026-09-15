import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * Thème du menu client (QR) choisi par l'établissement : identifiant de `MENU_THEMES` (@afrikaisse/core).
 * null : thème par défaut (« Bleu AfriKaisse »). Colonne texte nullable : identique en SQLite et PostgreSQL 9.6.
 */
export function menuTheme(_c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema.alterTable('locations').addColumn('menu_theme', 'text').execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.alterTable('locations').dropColumn('menu_theme').execute();
    },
  };
}
