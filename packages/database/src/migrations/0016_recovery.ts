import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * Récupération du compte par question secrète : la question est posée à la création du compte,
 * la réponse est hachée comme un mot de passe. Colonnes nullables : un compte créé avant cette
 * migration n'a pas de question, l'application la lui demande à la connexion suivante.
 */
export function recovery(_c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema.alterTable('users').addColumn('recovery_question', 'text').execute();
      await db.schema.alterTable('users').addColumn('recovery_answer_hash', 'text').execute();
    },

    async down(db: Kysely<any>) {
      for (const column of ['recovery_answer_hash', 'recovery_question']) {
        await db.schema.alterTable('users').dropColumn(column).execute();
      }
    },
  };
}
