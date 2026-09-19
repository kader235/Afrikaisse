import { existsSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { createDatabase, databaseConfigFromUrl, migrateToLatest, type AppDatabase } from '@afrikaisse/database';
import { buildApp } from './app.ts';
import { backupNow, scheduleBackups } from './lib/backup.ts';
import { createFcmSender, loadFcmCredentials } from './lib/fcm.ts';
import { loggerOptions } from './lib/logger.ts';
import { startPrintWorker } from './services/printing.ts';
import { startPushDispatcher } from './services/push.ts';
import { startUpdateChecks } from './services/releases.ts';
import { startSyncLoop } from './services/sync/client.ts';
import { loadConfig } from './config.ts';

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = loadConfig();
  const database = await createDatabase(await databaseConfigFromUrl(config.databaseUrl));
  const backups = config.profile === 'local' && config.backupDir && database.kind === 'sqlite' ? config.backupDir : null;
  // Copie avant toute migration : une mise à jour ratée se rattrape avec la base d'avant.
  // Le logger n'existe pas encore : la sortie d'erreur va dans journaux/serveur.log (lanceur Windows).
  if (backups) await backupNow(database, backups, 'demarrage').catch((err) => console.error('Sauvegarde de démarrage impossible :', err));
  const applied = config.autoMigrate ? await migrateToLatest(database) : [];

  const { app, ctx } = await buildApp({ database, config, logger: loggerOptions(config) });
  ctx.log.system.info({ profile: config.profile, version: ctx.version, build: ctx.build, nodeId: ctx.nodeId }, 'Démarrage');
  if (applied.length) ctx.log.database.info({ applied }, 'Migrations appliquées');
  if (config.profile === 'cloud') {
    // Sous Passenger (o2switch), l'application doit écouter la socket « passenger ». Fastify appelé
    // avec { path: 'passenger' } échoue (EADDRINUSE, fastify#5407) : on prépare Fastify, puis on
    // écoute directement sur son serveur HTTP, comme le fait Express.
    if (typeof (globalThis as { PhusionPassenger?: unknown }).PhusionPassenger !== 'undefined') {
      await app.ready();
      app.server.listen('passenger');
    } else {
      await app.listen({ host: config.host, port: config.port });
    }
  } else {
    const port = await listenLocal(app, database, config.host, config.port);
    // Le lanceur Windows attend ce fichier pour ouvrir le navigateur sur le bon port ; l'identifiant
    // du nœud lui permet de vérifier qu'il parle bien à CE serveur et pas à un autre logiciel.
    if (config.portFile) writeFileSync(config.portFile, JSON.stringify({ port, nodeId: ctx.nodeId }));
    if (backups) scheduleBackups(database, backups, (err) => ctx.log.database.error({ err }, 'Sauvegarde horaire impossible'));
    // Seul le serveur du restaurant voit les imprimantes du réseau local.
    startPrintWorker(ctx, (err) => ctx.log.printer.error({ err }, "File d'impression"));
    startSyncLoop(ctx, (err) => ctx.log.sync.warn({ err }, 'Synchronisation avec le Cloud'));
    // Annonce seulement : aucune installation automatique (§73).
    startUpdateChecks(ctx);
  }

  // Notifications push (tablette fermée) : seulement si les identifiants Firebase sont fournis.
  try {
    const fcm = loadFcmCredentials(config);
    if (fcm) {
      startPushDispatcher(ctx, createFcmSender(fcm), (err) => ctx.log.system.warn({ err }, 'Notifications push'));
      ctx.log.system.info({ project: fcm.projectId }, 'Notifications push activées');
    }
  } catch (err) {
    // Fichier illisible ou incomplet : l'application démarre quand même, sans push.
    ctx.log.system.error({ err }, 'Notifications push désactivées : identifiants Firebase inutilisables');
  }

  const shutdown = async () => {
    ctx.log.system.info('Arrêt demandé');
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
  const log = app.log.child({ category: 'system' });
  const remembered = await database.db.selectFrom('node_state').select('value').where('key', '=', 'listen_port').executeTakeFirst();
  // Jamais de port de la liste « unsafe » des navigateurs (6000, 6665-6669, 10080…) :
  // le serveur démarrerait, mais aucune tablette ne pourrait l'appeler.
  // Dernier recours (0) : un port libre attribué par Windows, retenu pour les démarrages suivants.
  const candidates = [...new Set([Number(remembered?.value) || preferred, preferred, 7300, 8300, 9300, 7400, 8800, 3000, 18300, 28300, 0])];
  for (const candidate of candidates) {
    // Windows laisse deux programmes écouter le même port sur 0.0.0.0 et 127.0.0.1 : listen()
    // réussit, mais le PC lui-même parlerait à l'autre programme. Un port qui répond déjà est sauté.
    if (candidate !== 0 && (await answers(candidate))) {
      log.warn(`Port ${candidate} déjà utilisé par un autre programme.`);
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
      if (port !== preferred) log.warn(`Port ${preferred} indisponible : serveur local sur le port ${port}.`);
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
