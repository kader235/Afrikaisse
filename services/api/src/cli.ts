import { existsSync } from 'node:fs';
import { sql } from 'kysely';
import { createDatabase, databaseConfigFromUrl, migrateToLatest } from '@afrikaisse/database';
import { loadConfig } from './config.ts';

/**
 * Commandes d'exploitation :
 *   migrate                        applique les migrations
 *   grant-platform-admin <e-mail>  donne l'accès au back-office AfriKaisse
 *   revoke-platform-admin <e-mail> le retire
 */
async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const [command, arg] = process.argv.slice(2);
  const config = loadConfig();
  const database = await createDatabase(await databaseConfigFromUrl(config.databaseUrl));
  try {
    switch (command) {
      case 'migrate': {
        const applied = await migrateToLatest(database);
        console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base déjà à jour.');
        break;
      }
      case 'db-version': {
        // Lu par le script de dépôt o2switch : « 90624 9.6.24 migrations=3 ».
        if (database.kind !== 'postgres') {
          console.log(`0 ${database.kind} migrations=?`);
          break;
        }
        const { rows } = await sql<{ num: string; nom: string }>`select current_setting('server_version_num') as num, current_setting('server_version') as nom`.execute(database.db);
        let applied = 0;
        try {
          const count = await sql<{ n: string }>`select count(*) as n from kysely_migration`.execute(database.db);
          applied = Number(count.rows[0]?.n ?? 0);
        } catch {
          applied = 0; // base neuve : la table de suivi n'existe pas encore
        }
        console.log(`${rows[0]!.num} ${rows[0]!.nom.split(' ')[0]} migrations=${applied}`);
        break;
      }
      case 'grant-platform-admin':
      case 'revoke-platform-admin': {
        if (!arg) throw new Error('Adresse e-mail manquante.');
        const res = await database.db
          .updateTable('users')
          .set({ is_platform_admin: command === 'grant-platform-admin' ? 1 : 0, updated_at: Date.now() })
          .where('email', '=', arg.trim().toLowerCase())
          .executeTakeFirst();
        if (Number(res.numUpdatedRows) === 0) throw new Error(`Aucun compte pour ${arg}.`);
        console.log(`${command === 'grant-platform-admin' ? 'Accès back-office donné à' : 'Accès back-office retiré à'} ${arg}.`);
        break;
      }
      default:
        console.log('Usage : cli migrate | grant-platform-admin <e-mail> | revoke-platform-admin <e-mail>');
        process.exitCode = 1;
    }
  } finally {
    await database.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
