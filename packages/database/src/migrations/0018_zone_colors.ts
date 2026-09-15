import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * Couleur de zone : les tables d'une zone portent son liseré sur le plan, à la prise de commande et à la caisse.
 * Nullable : une zone d'avant cette migration reçoit une teinte de la palette selon son ordre.
 */
export function zoneColors(_c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema.alterTable('zones').addColumn('color', 'text').execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.alterTable('zones').dropColumn('color').execute();
    },
  };
}
