import { existsSync } from 'node:fs';
import { createDatabase, databaseConfigFromUrl, migrateToLatest, type AppDatabase } from '@afrikaisse/database';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = loadConfig();
  const database = await createDatabase(await databaseConfigFromUrl(config.databaseUrl));
  if (config.autoMigrate) await migrateToLatest(database);

  const { app } = await buildApp({ database, config, logger: { level: config.logLevel } });
  if (config.profile === 'cloud') {
    // Sous Passenger (o2switch), listen() est intercepté : le port est ignoré.
    await app.listen({ host: config.host, port: config.port });
  } else {
    await listenLocal(app, database, config.host, config.port);
  }

  const shutdown = async () => {
    await app.close();
    await database.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * Serveur local : Windows (Hyper-V, WSL, Docker) réserve dynamiquement des plages
 * de ports qui refusent l'écoute (EACCES), différentes d'un PC à l'autre et d'un
 * démarrage à l'autre. Un port codé en dur peut donc empêcher le restaurant de
 * travailler. On essaie le dernier port qui a fonctionné, puis le port configuré,
 * puis une liste de repli, et on retient le gagnant pour que les appareils
 * appairés le retrouvent.
 */
async function listenLocal(app: Awaited<ReturnType<typeof buildApp>>['app'], database: AppDatabase, host: string, preferred: number) {
  const remembered = await database.db.selectFrom('node_state').select('value').where('key', '=', 'listen_port').executeTakeFirst();
  // Jamais de port de la liste « unsafe » des navigateurs (6000, 6665-6669, 10080…) :
  // le serveur démarrerait, mais aucune tablette ne pourrait l'appeler.
  const candidates = [...new Set([Number(remembered?.value) || preferred, preferred, 7300, 8300, 9300, 3000, 18300])];
  for (const port of candidates) {
    try {
      await app.listen({ host, port });
      await database.db
        .insertInto('node_state')
        .values({ key: 'listen_port', value: String(port) })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: String(port) }))
        .execute();
      if (port !== preferred) app.log.warn(`Port ${preferred} indisponible : serveur local sur le port ${port}.`);
      return;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'EACCES' && code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(`Aucun port disponible parmi ${candidates.join(', ')}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
