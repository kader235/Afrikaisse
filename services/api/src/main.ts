import { existsSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { createDatabase, databaseConfigFromUrl, migrateToLatest, type AppDatabase } from '@afrikaisse/database';
import { buildApp } from './app.ts';
import { backupNow, scheduleBackups } from './lib/backup.ts';
import { startPrintWorker } from './services/printing.ts';
import { loadConfig } from './config.ts';

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = loadConfig();
  const database = await createDatabase(await databaseConfigFromUrl(config.databaseUrl));
  const backups = config.profile === 'local' && config.backupDir && database.kind === 'sqlite' ? config.backupDir : null;
  // Copie avant toute migration : une mise à jour ratée se rattrape avec la base d'avant.
  if (backups) await backupNow(database, backups, 'demarrage').catch((err) => console.error('Sauvegarde de démarrage impossible :', err));
  if (config.autoMigrate) await migrateToLatest(database);

  const { app, ctx } = await buildApp({ database, config, logger: { level: config.logLevel } });
  if (config.profile === 'cloud') {
    // Sous Passenger (o2switch), listen() est intercepté : le port est ignoré.
    await app.listen({ host: config.host, port: config.port });
  } else {
    const port = await listenLocal(app, database, config.host, config.port);
    // Le lanceur Windows attend ce fichier pour ouvrir le navigateur sur le bon port ; l'identifiant
    // du nœud lui permet de vérifier qu'il parle bien à CE serveur et pas à un autre logiciel.
    if (config.portFile) writeFileSync(config.portFile, JSON.stringify({ port, nodeId: ctx.nodeId }));
    if (backups) scheduleBackups(database, backups, (err) => app.log.error({ err }, 'Sauvegarde horaire impossible'));
    // Seul le serveur du restaurant voit les imprimantes du réseau local.
    startPrintWorker(ctx, (err) => app.log.error({ err }, "File d'impression"));
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
async function listenLocal(app: Awaited<ReturnType<typeof buildApp>>['app'], database: AppDatabase, host: string, preferred: number): Promise<number> {
  const remembered = await database.db.selectFrom('node_state').select('value').where('key', '=', 'listen_port').executeTakeFirst();
  // Jamais de port de la liste « unsafe » des navigateurs (6000, 6665-6669, 10080…) :
  // le serveur démarrerait, mais aucune tablette ne pourrait l'appeler.
  // Dernier recours (0) : un port libre attribué par Windows, retenu pour les démarrages suivants.
  const candidates = [...new Set([Number(remembered?.value) || preferred, preferred, 7300, 8300, 9300, 7400, 8800, 3000, 18300, 28300, 0])];
  for (const candidate of candidates) {
    // Windows laisse deux programmes écouter le même port sur 0.0.0.0 et 127.0.0.1 : listen()
    // réussit, mais le PC lui-même parlerait à l'autre programme. Un port qui répond déjà est sauté.
    if (candidate !== 0 && (await answers(candidate))) {
      app.log.warn(`Port ${candidate} déjà utilisé par un autre programme.`);
      continue;
    }
    try {
      await app.listen({ host, port: candidate });
      const address = app.server.address();
      const port = address && typeof address === 'object' ? address.port : candidate;
      await database.db
        .insertInto('node_state')
        .values({ key: 'listen_port', value: String(port) })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: String(port) }))
        .execute();
      if (port !== preferred) app.log.warn(`Port ${preferred} indisponible : serveur local sur le port ${port}.`);
      return port;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'EACCES' && code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(`Aucun port disponible parmi ${candidates.join(', ')}.`);
}

function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
