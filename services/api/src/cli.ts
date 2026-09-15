import { existsSync } from 'node:fs';
import { sql } from 'kysely';
import { createDatabase, databaseConfigFromUrl, migrateToLatest } from '@afrikaisse/database';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDemoTenant } from './services/demo.ts';

/**
 * Commandes d'exploitation :
 *   migrate                        applique les migrations
 *   grant-platform-admin <e-mail>  donne l'accès au back-office AfriKaisse
 *   revoke-platform-admin <e-mail> le retire
 *   create-demo [e-mail]           crée une organisation « AfriKaisse Demo Restaurant » pour un prospect
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
      case 'create-demo': {
        await migrateToLatest(database);
        const { app, ctx } = await buildApp({ database, config });
        try {
          const demo = await createDemoTenant(ctx, { ip: null, userAgent: 'cli' }, { email: arg });
          const role = (r: string) => ({ OWNER: 'Propriétaire', MANAGER: 'Gérant', CASHIER: 'Caissier', WAITER: 'Serveur', KITCHEN: 'Cuisine', BAR: 'Bar', STOCK_MANAGER: 'Magasinier', ADMIN: 'Administrateur' })[r] ?? r;
          console.log(`${demo.organizationName} créé : ${demo.status.tables} tables, ${demo.status.products} produits, ${demo.status.orders} commandes.`);
          console.log('Identifiants (affichés une seule fois, notez-les) :');
          for (const c of [demo.owner, ...demo.staff]) console.log(`  ${role(c.role).padEnd(14)} ${c.displayName.padEnd(18)} ${c.email}  ${c.password}`);
        } finally {
          await app.close();
        }
        break;
      }
      default:
        console.log('Usage : cli migrate | grant-platform-admin <e-mail> | revoke-platform-admin <e-mail> | create-demo [e-mail]');
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
