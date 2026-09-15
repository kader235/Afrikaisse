import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * Slogan de l'établissement, affiché en grand titre du menu client (QR) à la place de la phrase d'accueil.
 * null : pas de slogan (le menu garde « Qu'est-ce qui vous fait envie ? »). Texte nullable : identique en SQLite et PostgreSQL 9.6.
 */
export function locationSlogan(_c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema.alterTable('locations').addColumn('slogan', 'text').execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.alterTable('locations').dropColumn('slogan').execute();
    },
  };
}
